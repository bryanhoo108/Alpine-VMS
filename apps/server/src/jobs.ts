/**
 * Background jobs, run in the server process (no extra service to install).
 * Each job never overlaps itself; a failure (SAP or CWIS down) is logged and
 * the job simply runs again next time. The gate never waits on any of them.
 */
import { pollCwisTickets, sendCwisPushes } from './services/cwis.js';
import { discoverDos, sendSapWrites } from './services/dos.js';
import { syncTransporters } from './services/businessPartners.js';
import type { ServiceDeps } from './services/deps.js';
import { refreshSdoCache } from './services/sdoCache.js';
import type { Site } from './services/sites.js';
import type { EventBus } from './events.js';
import type { FileStore } from './files.js';
import { purgeExpiredPhotos } from './services/retention.js';

export interface JobDef {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

/** Jobs run about a second after a trip changes, besides their own schedule. */
export const SOON_AFTER_TRIP_CHANGE = ['cwis-push', 'do-discovery', 'sap-writes'];

export const SDO_FULL_REFRESH_EVERY = 20; // incremental every 3 min, full about hourly

export function defineJobs(deps: ServiceDeps & { files: FileStore }, site: Site): JobDef[] {
  let sdoRuns = 0;
  return [
    {
      name: 'sdo-refresh',
      everyMs: 3 * 60_000,
      run: () => refreshSdoCache(deps, site, { full: sdoRuns++ % SDO_FULL_REFRESH_EVERY === 0 }),
    },
    { name: 'cwis-poll', everyMs: 30_000, run: () => pollCwisTickets(deps, site) },
    { name: 'cwis-push', everyMs: 10_000, run: () => sendCwisPushes(deps, site) },
    { name: 'do-discovery', everyMs: 2 * 60_000, run: () => discoverDos(deps, site) },
    { name: 'sap-writes', everyMs: 15_000, run: () => sendSapWrites(deps, site) },
    {
      name: 'transporter-sync',
      everyMs: 60 * 60_000,
      run: () => syncTransporters(deps.db, deps.adapters.sap, site.id),
    },
    {
      name: 'photo-retention',
      everyMs: 60 * 60_000,
      run: () => purgeExpiredPhotos(deps.db, deps.files, site.id, deps.now()),
    },
  ];
}

export interface JobStatus {
  name: string;
  running: boolean;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  /** Error of the latest run, or null if it succeeded. */
  lastError: string | null;
}

export interface JobRunner {
  /** Run a job now (still never overlapping itself). */
  runNow(name: string): Promise<void>;
  status(): JobStatus[];
  stop(): void;
}

export function startJobs(
  jobs: JobDef[],
  events: EventBus,
  log: { warn: (obj: object, msg: string) => void },
): JobRunner {
  const running = new Map<string, Promise<void>>();
  const timers: NodeJS.Timeout[] = [];
  const state = new Map<string, Omit<JobStatus, 'name' | 'running'>>(
    jobs.map((j) => [j.name, { lastRunAt: null, lastOkAt: null, lastError: null }]),
  );

  const runNow = (name: string): Promise<void> => {
    const job = jobs.find((j) => j.name === name);
    if (!job) return Promise.reject(new Error(`no job ${name}`));
    const busy = running.get(name);
    if (busy) return busy;
    const s = state.get(name)!;
    s.lastRunAt = new Date();
    const p = job
      .run()
      .then(() => {
        s.lastOkAt = new Date();
        s.lastError = null;
      })
      .catch((err: Error) => {
        s.lastError = err.message;
        log.warn({ job: name, err: err.message }, 'job failed; will retry');
      })
      .finally(() => running.delete(name));
    running.set(name, p);
    return p;
  };

  for (const job of jobs) {
    void runNow(job.name);
    timers.push(setInterval(() => void runNow(job.name), job.everyMs));
  }

  // A trip edit (SDO linked, company set, check done) reaches CWIS and SAP
  // within a second, and new DOs for it are looked up.
  let pushSoon: NodeJS.Timeout | null = null;
  const off = events.subscribe((e) => {
    if (e.type !== 'trip_changed' || pushSoon) return;
    pushSoon = setTimeout(() => {
      pushSoon = null;
      for (const name of SOON_AFTER_TRIP_CHANGE) {
        if (jobs.some((j) => j.name === name)) void runNow(name);
      }
    }, 1000);
  });

  return {
    runNow,
    status: () =>
      jobs.map((j) => ({ name: j.name, running: running.has(j.name), ...state.get(j.name)! })),
    stop() {
      timers.forEach(clearInterval);
      if (pushSoon) clearTimeout(pushSoon);
      off();
    },
  };
}

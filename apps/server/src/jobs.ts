/**
 * Background jobs, run in the server process (no extra service to install).
 * Each job never overlaps itself; a failure (SAP or CWIS down) is logged and
 * the job simply runs again next time. The gate never waits on any of them.
 */
import { sendCwisPushes, pollCwisTickets } from './services/cwis.js';
import { syncTransporters } from './services/businessPartners.js';
import type { ServiceDeps } from './services/deps.js';
import { refreshSdoCache } from './services/sdoCache.js';
import type { Site } from './services/sites.js';
import type { EventBus } from './events.js';

export interface JobDef {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

export const SDO_FULL_REFRESH_EVERY = 20; // incremental every 3 min, full about hourly

export function defineJobs(deps: ServiceDeps, site: Site): JobDef[] {
  let sdoRuns = 0;
  return [
    {
      name: 'sdo-refresh',
      everyMs: 3 * 60_000,
      run: () => refreshSdoCache(deps, site, { full: sdoRuns++ % SDO_FULL_REFRESH_EVERY === 0 }),
    },
    { name: 'cwis-poll', everyMs: 30_000, run: () => pollCwisTickets(deps, site) },
    { name: 'cwis-push', everyMs: 10_000, run: () => sendCwisPushes(deps, site) },
    {
      name: 'transporter-sync',
      everyMs: 60 * 60_000,
      run: () => syncTransporters(deps.db, deps.adapters.sap, site.id),
    },
  ];
}

export interface JobRunner {
  /** Run a job now (still never overlapping itself). */
  runNow(name: string): Promise<void>;
  stop(): void;
}

export function startJobs(
  jobs: JobDef[],
  events: EventBus,
  log: { warn: (obj: object, msg: string) => void },
): JobRunner {
  const running = new Map<string, Promise<void>>();
  const timers: NodeJS.Timeout[] = [];

  const runNow = (name: string): Promise<void> => {
    const job = jobs.find((j) => j.name === name);
    if (!job) return Promise.reject(new Error(`no job ${name}`));
    const busy = running.get(name);
    if (busy) return busy;
    const p = job
      .run()
      .then(() => undefined)
      .catch((err: Error) => log.warn({ job: name, err: err.message }, 'job failed; will retry'))
      .finally(() => running.delete(name));
    running.set(name, p);
    return p;
  };

  for (const job of jobs) {
    void runNow(job.name);
    timers.push(setInterval(() => void runNow(job.name), job.everyMs));
  }

  // A trip edit (SDO linked, company set) goes to CWIS within a second.
  let pushSoon: NodeJS.Timeout | null = null;
  const off = events.subscribe((e) => {
    if (e.type !== 'trip_changed' || pushSoon) return;
    pushSoon = setTimeout(() => {
      pushSoon = null;
      void runNow('cwis-push');
    }, 1000);
  });

  return {
    runNow,
    stop() {
      timers.forEach(clearInterval);
      if (pushSoon) clearTimeout(pushSoon);
      off();
    },
  };
}

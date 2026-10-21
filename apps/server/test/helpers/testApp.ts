import {
  adapterConfigFromEnv,
  createAdapters,
  type Adapters,
  type LogNotifier,
  type MockCwisAdapter,
  type MockSapAdapter,
} from '@vms/adapters';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { seed } from '../../src/db/seed.js';
import { EventBus } from '../../src/events.js';
import type { ServiceDeps } from '../../src/services/deps.js';
import { refreshSdoCache } from '../../src/services/sdoCache.js';
import { getSite, type Site } from '../../src/services/sites.js';
import { createTestDb, type TestDatabase } from './testDb.js';
import { testConfig } from './testConfig.js';

export const DEMO_PIN = '2468';
export const DEMO_PASSWORD = 'test-password';

export interface TestApp {
  app: FastifyInstance;
  t: TestDatabase;
  adapters: Adapters;
  sap: MockSapAdapter;
  cwis: MockCwisAdapter;
  notifier: LogNotifier;
  clock: { now: Date };
  /** For calling services and jobs directly (jobs do not run on their own in tests). */
  deps: ServiceDeps;
  site: Site;
  /** Sign in and return the cookie header value. */
  login(username: string, secret?: string): Promise<string>;
  close(): Promise<void>;
}

/** Seeded database (with the SDO cache filled) + app with a controllable clock. */
export async function createTestApp(
  start = new Date('2026-10-21T02:00:00Z'),
  env: NodeJS.ProcessEnv = {},
): Promise<TestApp> {
  const clock = { now: start };
  const now = () => clock.now;
  const t = await createTestDb();
  const adapterConfig = adapterConfigFromEnv({});
  const adapters = createAdapters({ ...adapterConfig, now });
  await seed(t.db, adapters.sap, {
    siteCode: 'APM',
    demoPin: DEMO_PIN,
    demoPassword: DEMO_PASSWORD,
    now: start,
  });
  const config = testConfig(t.url, env);
  const app = await buildApp({ config, db: t.db, adapters, adapterConfig, now });
  const deps: ServiceDeps = { db: t.db, adapters, events: new EventBus(), config, now };
  const site = await getSite(t.db, 'APM');
  await refreshSdoCache(deps, site, { full: true });

  return {
    app,
    t,
    adapters,
    sap: adapters.mocks.sap!,
    cwis: adapters.mocks.cwis!,
    notifier: adapters.notifier as LogNotifier,
    clock,
    deps,
    site,
    async login(username, secret) {
      const isPin = ['guard.entry', 'guard.exit', 'checker1', 'checker2'].includes(username);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, secret: secret ?? (isPin ? DEMO_PIN : DEMO_PASSWORD) },
      });
      if (res.statusCode !== 200) throw new Error(`login ${username}: ${res.body}`);
      const cookie = res.cookies.find((c) => c.name === 'vms_session');
      return `vms_session=${cookie!.value}`;
    },
    async close() {
      await app.close();
      await t.drop();
    },
  };
}

/** Gate a truck in over HTTP as the entry guard; returns the response body. */
export async function gateInTruck(
  h: TestApp,
  guardCookie: string,
  body: {
    plate: string;
    cardNo: string;
    type?: 'outbound' | 'inbound';
    transporterId?: string | null;
  },
) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/gate/in',
    headers: { cookie: guardCookie },
    payload: {
      plateReadId: null,
      type: body.type ?? 'outbound',
      cardNo: body.cardNo,
      photoIds: [],
      transporterId: body.transporterId ?? null,
      preRegistrationId: null,
      plate: body.plate,
    },
  });
  if (res.statusCode !== 200) throw new Error(`gate in ${body.plate}: ${res.body}`);
  return res.json() as { trip: { id: string; tripNo: string }; sdoNos: string[] };
}

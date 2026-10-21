import {
  adapterConfigFromEnv,
  createAdapters,
  type Adapters,
  type LogNotifier,
} from '@vms/adapters';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { seed } from '../../src/db/seed.js';
import { createTestDb, type TestDatabase } from './testDb.js';
import { testConfig } from './testConfig.js';

export const DEMO_PIN = '2468';
export const DEMO_PASSWORD = 'test-password';

export interface TestApp {
  app: FastifyInstance;
  t: TestDatabase;
  adapters: Adapters;
  notifier: LogNotifier;
  clock: { now: Date };
  /** Sign in and return the cookie header value. */
  login(username: string, secret?: string): Promise<string>;
  close(): Promise<void>;
}

/** Seeded database + app with a controllable clock. */
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
  const app = await buildApp({
    config: testConfig(t.url, env),
    db: t.db,
    adapters,
    adapterConfig,
    now,
  });

  return {
    app,
    t,
    adapters,
    notifier: adapters.notifier as LogNotifier,
    clock,
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

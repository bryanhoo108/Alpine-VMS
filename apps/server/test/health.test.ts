import { adapterConfigFromEnv, createAdapters, MockSapAdapter } from '@vms/adapters';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testConfig } from './helpers/testConfig.js';
import { seed } from '../src/db/seed.js';
import { createTestDb, type TestDatabase } from './helpers/testDb.js';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.drop());

const app = (siteCode = 'APM') => {
  const adapterConfig = adapterConfigFromEnv({});
  return buildApp({
    config: testConfig(t.url, { SITE_CODE: siteCode }),
    db: t.db,
    adapters: createAdapters(adapterConfig),
    adapterConfig,
  });
};

describe('GET /api/health', () => {
  it('reports 503 before the site is seeded', async () => {
    const res = await (await app()).inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: expect.stringContaining('seed') });
  });

  it('reports the site, adapter modes and counts once seeded', async () => {
    await seed(t.db, new MockSapAdapter(), {
      siteCode: 'APM',
      demoPin: '1',
      demoPassword: '1',
      now: new Date(),
    });
    const res = await (await app()).inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      db: 'up',
      site: { code: 'APM', name: 'Alpine Pipe Manufacturing, Shah Alam' },
      adapters: { sap: 'mock', cwis: 'mock', lpr: 'mock' },
      trucksOnSite: 0,
      freeCards: 60,
      queues: {
        sapWrites: { pending: 0, oldestPendingAt: null },
        cwisPushes: { pending: 0, oldestPendingAt: null },
      },
      jobs: null, // jobs do not run in tests
    });
  });
});

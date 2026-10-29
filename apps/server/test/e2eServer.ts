/**
 * Server for browser tests (apps/web/e2e): fresh database, seeded, serving the
 * built web app. POST /__e2e/reset wipes trips and re-seeds between tests.
 * Never used in production.
 */
import { adapterConfigFromEnv, createAdapters } from '@vms/adapters';
import { sql } from 'drizzle-orm';
import { buildApp, type AppContext } from '../src/app.js';
import { demoClock } from '../src/demo/clock.js';
import { seed } from '../src/db/seed.js';
import { EventBus } from '../src/events.js';
import { refreshSdoCache } from '../src/services/sdoCache.js';
import { getSite } from '../src/services/sites.js';
import { createTestDb } from './helpers/testDb.js';
import { testConfig } from './helpers/testConfig.js';

const PORT = Number(process.env.E2E_PORT ?? 8090);
const PIN = process.env.E2E_PIN ?? '2468';
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

const t = await createTestDb();
const adapterConfig = adapterConfigFromEnv({});
// Demo clock, so "Restart day" on the Live screen can backdate its trucks.
const adapters = createAdapters({ ...adapterConfig, now: demoClock.now });
const config = testConfig(t.url, { WEB_DIR: new URL('../../web/dist', import.meta.url).pathname });
const reseed = async () => {
  adapters.mocks.sap!.reset();
  adapters.mocks.cwis!.reset();
  await seed(t.db, adapters.sap, {
    siteCode: 'APM',
    demoPin: PIN,
    demoPassword: PASSWORD,
    now: new Date(),
  });
  const deps = { db: t.db, adapters, events: new EventBus(), config, now: demoClock.now };
  await refreshSdoCache(deps, await getSite(t.db, 'APM'), { full: true });
};
await reseed();

let ctx: AppContext | null = null;
const app = await buildApp({
  config,
  db: t.db,
  adapters,
  adapterConfig,
  jobs: true,
  now: demoClock.now,
  onContext: (c) => (ctx = c),
});

app.post('/__e2e/reset', async () => {
  // Auto-play left on by a test must not move trucks in the next one.
  ctx?.autoplay?.stop();
  ctx?.autoplay?.setSpeed(1);
  const rows = await t.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'sites'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(', ');
  await t.db.execute(sql.raw(`truncate ${names} cascade`));
  await reseed();
  return { ok: true };
});

const stop = async () => {
  await app.close();
  await t.drop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`e2e server on http://127.0.0.1:${PORT}`);

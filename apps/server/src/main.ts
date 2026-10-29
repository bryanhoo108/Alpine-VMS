import { readFileSync } from 'node:fs';
import { adapterConfigFromEnv, createAdapters } from '@vms/adapters';
import { buildApp } from './app.js';
import { demoClock } from './demo/clock.js';
import { loadConfig } from './config.js';
import { connect, runMigrations } from './db/client.js';

const config = loadConfig();
const adapterConfig = adapterConfigFromEnv(process.env);
const database = connect(config.databaseUrl);
await runMigrations(database.db);

const app = await buildApp(
  {
    config,
    db: database.db,
    adapters: createAdapters({
      ...adapterConfig,
      now: demoClock.now,
      log: (line) => app.log.info(line),
    }),
    now: demoClock.now,
    demo: { day: process.env.DEMO_DAY === 'on', autoplay: process.env.DEMO_AUTOPLAY === 'on' },
    adapterConfig,
    jobs: true,
  },
  {
    logger: true,
    ...(config.https && {
      https: { cert: readFileSync(config.https.certFile), key: readFileSync(config.https.keyFile) },
    }),
  },
);

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });

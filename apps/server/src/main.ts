import { readFileSync } from 'node:fs';
import { adapterConfigFromEnv, createAdapters } from '@vms/adapters';
import { buildApp } from './app.js';
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
    adapters: createAdapters({ ...adapterConfig, log: (line) => app.log.info(line) }),
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

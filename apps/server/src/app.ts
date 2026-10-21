import type { Adapters, AdapterConfig } from '@vms/adapters';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  config: Config;
  db: Db;
  adapters: Adapters;
  adapterConfig: AdapterConfig;
}

export async function buildApp(
  deps: AppDeps,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(healthRoutes, deps);
  return app;
}

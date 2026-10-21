import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { AdapterConfig, Adapters } from '@vms/adapters';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import { loadSessionUser, SESSION_COOKIE } from './auth/session.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { EventBus } from './events.js';
import { FileStore } from './files.js';
import { defineJobs, startJobs, type JobRunner } from './jobs.js';
import { authRoutes } from './routes/auth.js';
import { clerkRoutes } from './routes/clerk.js';
import { devRoutes } from './routes/dev.js';
import { eventRoutes } from './routes/events.js';
import { gateRoutes } from './routes/gate.js';
import { healthRoutes } from './routes/health.js';
import { photoRoutes } from './routes/photos.js';
import { recordPlateRead } from './services/plateReads.js';
import { ServiceError } from './services/errors.js';
import { getSite, type Site } from './services/sites.js';

export interface AppDeps {
  config: Config;
  db: Db;
  adapters: Adapters;
  adapterConfig: AdapterConfig;
  now?: () => Date;
  /** Run background jobs (SAP/CWIS sync). Off in tests, which call services directly. */
  jobs?: boolean;
}

/** Everything routes and services need, built once at start. */
export interface AppContext extends AppDeps {
  site: Site;
  events: EventBus;
  files: FileStore;
  now: () => Date;
  jobRunner: JobRunner | null;
}

export async function buildApp(
  deps: AppDeps,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(healthRoutes, deps);

  // The rest needs a seeded site; health still answers (503) without one.
  let site: Site;
  try {
    site = await getSite(deps.db, deps.config.siteCode);
  } catch (err) {
    app.log.error((err as Error).message);
    return app;
  }

  const ctx: AppContext = {
    ...deps,
    site,
    events: new EventBus(),
    files: new FileStore(deps.config.filesDir),
    now: deps.now ?? (() => new Date()),
    jobRunner: null,
  };

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: err.code });
    if (err.validation) return reply.code(400).send({ error: 'BAD_REQUEST', message: err.message });
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'BAD_REQUEST', message: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'SERVER_ERROR' });
  });

  await app.register(cookie);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = await loadSessionUser(
      ctx.db,
      req.cookies[SESSION_COOKIE],
      ctx.config.sessionSecret,
      ctx.now(),
    );
  });

  await app.register(authRoutes, ctx);
  await app.register(photoRoutes, ctx);
  await app.register(gateRoutes, ctx);
  await app.register(eventRoutes, ctx);
  await app.register(clerkRoutes, ctx);
  const { lpr, cwis, sap } = deps.adapters.mocks;
  if (lpr && cwis && sap) await app.register(devRoutes, { ...ctx, mocks: { lpr, cwis, sap } });

  if (deps.jobs) {
    ctx.jobRunner = startJobs(defineJobs(ctx, site), ctx.events, app.log);
    app.addHook('onClose', async () => ctx.jobRunner?.stop());
  }

  // Camera reads arrive from the LPR adapter (webhook for real cameras, dev panel for the mock).
  const off = deps.adapters.lpr.onPlateEvent(async (event) => {
    try {
      await recordPlateRead(ctx, site.id, event);
    } catch (err) {
      app.log.error(err, 'failed to record plate read');
    }
  });
  app.addHook('onClose', async () => off());

  app.post<{ Params: { camera: 'entry' | 'exit' } }>(
    '/api/lpr/:camera',
    {
      schema: {
        params: {
          type: 'object',
          properties: { camera: { type: 'string', enum: ['entry', 'exit'] } },
        },
      },
    },
    async (req, reply) => {
      const token = deps.config.lprWebhookToken;
      if (token && req.headers['x-vms-token'] !== token) {
        return reply.code(401).send({ error: 'BAD_TOKEN' });
      }
      try {
        await deps.adapters.lpr.handleWebhook(req.params.camera, req.body);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  if (deps.config.webDir) {
    const root = path.resolve(deps.config.webDir);
    await app.register(fastifyStatic, { root });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'NOT_FOUND' })
        : reply.sendFile('index.html'),
    );
  }

  return app;
}

import { and, count, eq, min, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { cards, cwisPushes, sapWrites, trips } from '../db/schema.js';
import type { JobStatus } from '../jobs.js';
import { getSite } from '../services/sites.js';

export interface HealthOptions extends AppDeps {
  /** Background job status, once jobs run (null in tests and before start). */
  jobStatus: () => JobStatus[] | null;
}

/**
 * GET /api/health for IT: database reachable, site seeded, adapter modes,
 * trucks on site, free cards, SAP/CWIS queue backlog and job status.
 * A growing backlog or a job with lastError means SAP or CWIS is unreachable;
 * the gate keeps working meanwhile.
 */
export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, deps) => {
  app.get('/api/health', async (_req, reply) => {
    const adapters = {
      sap: deps.adapterConfig.sap,
      cwis: deps.adapterConfig.cwis,
      lpr: deps.adapterConfig.lpr,
    };
    try {
      await deps.db.execute(sql`select 1`);
      const site = await getSite(deps.db, deps.config.siteCode);
      const [onSite] = await deps.db
        .select({ n: count() })
        .from(trips)
        .where(and(eq(trips.siteId, site.id), eq(trips.status, 'on_site')));
      const [freeCards] = await deps.db
        .select({ n: count() })
        .from(cards)
        .where(and(eq(cards.siteId, site.id), eq(cards.status, 'free')));
      const [sap] = await deps.db
        .select({ pending: count(), oldest: min(sapWrites.createdAt) })
        .from(sapWrites)
        .where(and(eq(sapWrites.siteId, site.id), eq(sapWrites.status, 'pending')));
      const [cwis] = await deps.db
        .select({ pending: count(), oldest: min(cwisPushes.createdAt) })
        .from(cwisPushes)
        .where(and(eq(cwisPushes.siteId, site.id), eq(cwisPushes.status, 'pending')));
      return {
        ok: true,
        db: 'up',
        site: { code: site.code, name: site.name },
        adapters,
        trucksOnSite: onSite?.n ?? 0,
        freeCards: freeCards?.n ?? 0,
        queues: {
          sapWrites: { pending: sap?.pending ?? 0, oldestPendingAt: sap?.oldest ?? null },
          cwisPushes: { pending: cwis?.pending ?? 0, oldestPendingAt: cwis?.oldest ?? null },
        },
        jobs: deps.jobStatus(),
      };
    } catch (err) {
      return reply
        .code(503)
        .send({ ok: false, db: 'down', adapters, error: (err as Error).message });
    }
  });
};

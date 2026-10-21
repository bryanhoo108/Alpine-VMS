import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { cards, trips } from '../db/schema.js';
import { getSite } from '../services/sites.js';

/** GET /api/health: database reachable, site seeded, adapter modes, basic counts. */
export const healthRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
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
      return {
        ok: true,
        db: 'up',
        site: { code: site.code, name: site.name },
        adapters,
        trucksOnSite: onSite?.n ?? 0,
        freeCards: freeCards?.n ?? 0,
      };
    } catch (err) {
      return reply
        .code(503)
        .send({ ok: false, db: 'down', adapters, error: (err as Error).message });
    }
  });
};

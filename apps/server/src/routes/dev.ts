/**
 * Mock-only controls for development and demos: make the camera "see" a plate
 * and find a free card to tap. Registered only when the adapters are mocks.
 */
import { SAMPLE_PLATES, type MockLprAdapter } from '@vms/adapters';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth/session.js';
import { cards } from '../db/schema.js';

export const devRoutes: FastifyPluginAsync<AppContext & { lpr: MockLprAdapter }> = async (
  app,
  ctx,
) => {
  app.get('/api/dev', async () => ({ mock: true, samplePlates: SAMPLE_PLATES }));

  app.post<{ Body: { camera: 'entry' | 'exit'; plate: string; confidence?: number } }>(
    '/api/dev/lpr',
    {
      preHandler: requireRole(),
      schema: {
        body: {
          type: 'object',
          required: ['camera', 'plate'],
          properties: {
            camera: { type: 'string', enum: ['entry', 'exit'] },
            plate: { type: 'string', minLength: 1, maxLength: 16 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
    async (req) => {
      const { camera, plate, confidence } = req.body;
      await ctx.lpr.simulate(camera, plate, confidence === undefined ? {} : { confidence });
      return { ok: true };
    },
  );

  app.get('/api/dev/free-card', { preHandler: requireRole() }, async (_req, reply) => {
    const [card] = await ctx.db
      .select({ cardNo: cards.cardNo })
      .from(cards)
      .where(and(eq(cards.siteId, ctx.site.id), eq(cards.status, 'free')))
      .orderBy(asc(cards.cardNo))
      .limit(1);
    if (!card) return reply.code(404).send({ error: 'NO_FREE_CARD' });
    return card;
  });
};

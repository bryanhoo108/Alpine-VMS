import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { currentUser, requireRole } from '../auth/session.js';
import { entryState, gateIn, type GateInInput } from '../services/gateIn.js';

export const gateRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  app.get('/api/gate/entry', { preHandler: requireRole('guard', 'supervisor') }, async () =>
    entryState(ctx, ctx.site),
  );

  app.post<{ Body: GateInInput }>(
    '/api/gate/in',
    {
      preHandler: requireRole('guard', 'supervisor'),
      schema: {
        body: {
          type: 'object',
          required: [
            'plateReadId',
            'plate',
            'type',
            'cardNo',
            'photoIds',
            'transporterId',
            'preRegistrationId',
          ],
          additionalProperties: false,
          properties: {
            plateReadId: { type: ['string', 'null'], format: 'uuid' },
            plate: { type: 'string', minLength: 1, maxLength: 16 },
            type: { type: 'string', enum: ['outbound', 'inbound'] },
            cardNo: { type: 'string', minLength: 1, maxLength: 64 },
            photoIds: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } },
            transporterId: { type: ['string', 'null'], format: 'uuid' },
            preRegistrationId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await gateIn(ctx, ctx.site, currentUser(req).id, req.body);
      if (!result.ok) return reply.code(409).send({ error: result.error });
      return result;
    },
  );
};

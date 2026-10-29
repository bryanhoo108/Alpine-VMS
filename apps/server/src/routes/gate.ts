import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { currentUser, requireRole } from '../auth/session.js';
import { entryState, gateIn, type GateInInput } from '../services/gateIn.js';
import {
  exitState,
  exitTruckByCard,
  exitTruckById,
  gateOut,
  recoverLostCard,
  type GateOutInput,
} from '../services/gateOut.js';
import { reconcile } from '../services/reports.js';

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
            icRejected: { type: 'boolean' },
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

  const guard = { preHandler: requireRole('guard', 'supervisor') };
  const idParams = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  } as const;
  const cardParams = {
    type: 'object',
    required: ['cardNo'],
    properties: { cardNo: { type: 'string', minLength: 1, maxLength: 64 } },
  } as const;

  app.get('/api/gate/exit', guard, () => exitState(ctx, ctx.site));

  app.get<{ Params: { id: string } }>(
    '/api/gate/exit/trips/:id',
    { ...guard, schema: { params: idParams } },
    (req) => exitTruckById(ctx, ctx.site, req.params.id),
  );

  app.get<{ Params: { cardNo: string } }>(
    '/api/gate/exit/card/:cardNo',
    { ...guard, schema: { params: cardParams } },
    (req) => exitTruckByCard(ctx, ctx.site, req.params.cardNo),
  );

  app.post<{ Body: GateOutInput }>(
    '/api/gate/out',
    {
      ...guard,
      schema: {
        body: {
          type: 'object',
          required: ['tripId', 'plateReadId', 'cardNo'],
          additionalProperties: false,
          properties: {
            tripId: { type: 'string', format: 'uuid' },
            plateReadId: { type: ['string', 'null'], format: 'uuid' },
            cardNo: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    (req) => gateOut(ctx, ctx.site, currentUser(req).id, req.body),
  );

  /** A lost card handed back later goes back into the pool. */
  app.post<{ Params: { cardNo: string } }>(
    '/api/cards/:cardNo/recover',
    { preHandler: requireRole('guard', 'clerk', 'supervisor'), schema: { params: cardParams } },
    async (req) => {
      await recoverLostCard(ctx, ctx.site, currentUser(req).id, req.params.cardNo);
      return { ok: true };
    },
  );

  app.get<{ Querystring: { date: string } }>(
    '/api/reports/reconcile',
    {
      preHandler: requireRole('clerk', 'supervisor'),
      schema: {
        querystring: {
          type: 'object',
          required: ['date'],
          properties: { date: { type: 'string', format: 'date' } },
        },
      },
    },
    (req) => reconcile(ctx, ctx.site, req.query.date),
  );
};

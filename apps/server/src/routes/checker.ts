import { REJECT_REASONS } from '@vms/domain';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { currentUser, requireRole } from '../auth/session.js';
import {
  checkerQueue,
  checkView,
  decide,
  tripByCard,
  type DecisionInput,
} from '../services/checker.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const checkerRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  const checker = { preHandler: requireRole('checker', 'supervisor') };

  app.get('/api/checker/queue', checker, () => checkerQueue(ctx, ctx.site));

  app.get<{ Params: { cardNo: string } }>(
    '/api/checker/card/:cardNo',
    {
      ...checker,
      schema: {
        params: {
          type: 'object',
          required: ['cardNo'],
          properties: { cardNo: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    (req) => tripByCard(ctx, ctx.site, req.params.cardNo),
  );

  app.get<{ Params: { id: string } }>(
    '/api/checker/trips/:id',
    { ...checker, schema: { params: idParams } },
    (req) => checkView(ctx, ctx.site, req.params.id),
  );

  app.post<{ Params: { id: string }; Body: DecisionInput }>(
    '/api/checker/trips/:id/decision',
    {
      ...checker,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['decision', 'reason', 'versions', 'lines', 'photoIds'],
          additionalProperties: false,
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject'] },
            reason: { type: ['string', 'null'], enum: [...REJECT_REASONS, null] },
            versions: { type: 'object', additionalProperties: { type: 'string' } },
            lines: {
              type: 'array',
              maxItems: 200,
              items: {
                type: 'object',
                required: ['sdoNo', 'lineNo', 'actualPieces'],
                additionalProperties: false,
                properties: {
                  sdoNo: { type: 'string', minLength: 1, maxLength: 20 },
                  lineNo: { type: 'integer', minimum: 0 },
                  actualPieces: { type: 'integer', minimum: 0, maximum: 100000 },
                },
              },
            },
            photoIds: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
    (req) => decide(ctx, ctx.site, currentUser(req).id, req.params.id, req.body),
  );
};

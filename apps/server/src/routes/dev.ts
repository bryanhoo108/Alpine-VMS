/**
 * Mock-only controls for development and demos: the camera "sees" a plate,
 * a free card to tap, and the weighbridge weighs a truck in and out.
 * Registered only when the adapters are mocks.
 */
import {
  SAMPLE_PLATES,
  type MockCwisAdapter,
  type MockLprAdapter,
  type MockSapAdapter,
} from '@vms/adapters';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth/session.js';
import { cards, trips, weighTickets } from '../db/schema.js';
import { pollCwisTickets, sendCwisPushes } from '../services/cwis.js';
import { conflict, notFound } from '../services/errors.js';

interface DevContext extends AppContext {
  mocks: { lpr: MockLprAdapter; cwis: MockCwisAdapter; sap: MockSapAdapter };
}

export const devRoutes: FastifyPluginAsync<DevContext> = async (app, ctx) => {
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
      await ctx.mocks.lpr.simulate(camera, plate, confidence === undefined ? {} : { confidence });
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

  const tripBody = {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string', format: 'uuid' },
      plate: { type: 'string', minLength: 1, maxLength: 16 },
      sdoNos: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20 } },
    },
  } as const;

  /**
   * Weighbridge operator taps the truck's card (option A). Optional: a
   * different plate (mismatch case) or SDOs typed in CWIS.
   */
  app.post<{ Body: { tripId: string; plate?: string; sdoNos?: string[] } }>(
    '/api/dev/cwis/weigh-in',
    { preHandler: requireRole(), schema: { body: tripBody } },
    async (req) => {
      const [trip] = await ctx.db
        .select({ plate: trips.plateIn, cardNo: cards.cardNo })
        .from(trips)
        .leftJoin(cards, eq(cards.id, trips.cardId))
        .where(and(eq(trips.siteId, ctx.site.id), eq(trips.id, req.body.tripId)));
      if (!trip) throw notFound('TRIP_NOT_FOUND');
      await sendCwisPushes(ctx, ctx.site);
      const ticket = ctx.mocks.cwis.weighIn({
        plate: req.body.plate ?? trip.plate,
        ...(trip.cardNo ? { cardNo: trip.cardNo } : {}),
        ...(req.body.sdoNos ? { sdoNos: req.body.sdoNos } : {}),
      });
      await pollCwisTickets(ctx, ctx.site);
      return ticket;
    },
  );

  app.post<{ Body: { tripId: string } }>(
    '/api/dev/cwis/weigh-out',
    { preHandler: requireRole(), schema: { body: tripBody } },
    async (req) => {
      const [ticket] = await ctx.db
        .select({ ticketNo: weighTickets.ticketNo, out: weighTickets.weighOutAt })
        .from(weighTickets)
        .where(and(eq(weighTickets.siteId, ctx.site.id), eq(weighTickets.tripId, req.body.tripId)));
      if (!ticket) throw conflict('NOT_WEIGHED_IN');
      const out = ctx.mocks.cwis.weighOut(ticket.ticketNo);
      await pollCwisTickets(ctx, ctx.site);
      return out;
    },
  );

  /** Logistics amends an SDO line in SAP (to see "SDO changed" on the checker). */
  app.post<{ Body: { sdoNo: string; lineNo: number; pieces: number } }>(
    '/api/dev/sap/amend',
    {
      preHandler: requireRole(),
      schema: {
        body: {
          type: 'object',
          required: ['sdoNo', 'lineNo', 'pieces'],
          properties: {
            sdoNo: { type: 'string', minLength: 1, maxLength: 20 },
            lineNo: { type: 'integer', minimum: 0 },
            pieces: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (req) => {
      ctx.mocks.sap.amendSdoLine(req.body.sdoNo, req.body.lineNo, { pieces: req.body.pieces });
      return { ok: true };
    },
  );
};

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
import { discoverDos } from '../services/dos.js';
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

  /**
   * Logistics does "Copy To" from SDO(s) to a new DO in SAP. With half=true
   * each line carries half the pieces (a split delivery). Then DOs are looked up.
   */
  app.post<{ Body: { sdoNos: string[]; half?: boolean } }>(
    '/api/dev/sap/create-do',
    {
      preHandler: requireRole(),
      schema: {
        body: {
          type: 'object',
          required: ['sdoNos'],
          properties: {
            sdoNos: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1, maxLength: 20 },
            },
            half: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => {
      const sap = ctx.mocks.sap;
      const sources = await Promise.all(
        req.body.sdoNos.map(async (sdoNo) => {
          if (!req.body.half) return sdoNo;
          const sdo = await sap.getSdo(sdoNo);
          if (!sdo) throw notFound('SDO_NOT_FOUND');
          return {
            sdoNo,
            lines: sdo.lines.map((l) => ({
              lineNo: l.lineNo,
              pieces: Math.max(1, Math.floor(l.pieces / 2)),
            })),
          };
        }),
      );
      const created = sap.createDo(sources);
      await discoverDos(ctx, ctx.site);
      return created;
    },
  );

  /** The card a truck on site carries (stands in for the driver handing it over). */
  app.get<{ Params: { tripId: string } }>(
    '/api/dev/card-of/:tripId',
    {
      preHandler: requireRole(),
      schema: {
        params: { type: 'object', properties: { tripId: { type: 'string', format: 'uuid' } } },
      },
    },
    async (req) => {
      const [row] = await ctx.db
        .select({ cardNo: cards.cardNo })
        .from(trips)
        .innerJoin(cards, eq(cards.id, trips.cardId))
        .where(and(eq(trips.siteId, ctx.site.id), eq(trips.id, req.params.tripId)));
      if (!row) throw notFound('NO_CARD');
      return row;
    },
  );
};

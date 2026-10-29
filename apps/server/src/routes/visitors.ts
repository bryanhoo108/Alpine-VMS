import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { currentUser, requireRole } from '../auth/session.js';
import {
  cancelInvite,
  createHost,
  createInvite,
  expectedToday,
  findInvite,
  listHosts,
  listInvites,
  setHostActive,
  type NewHost,
  type NewInvite,
} from '../services/invites.js';
import {
  currentMuster,
  endMuster,
  logStaff,
  markMuster,
  peopleOnSite,
  startMuster,
  visitExitByCard,
  visitExitById,
  visitGateIn,
  visitGateOut,
  visitsOnSite,
  type VisitGateInInput,
  type VisitGateOutInput,
} from '../services/visits.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const optionalText = (max: number) => ({ type: ['string', 'null'], maxLength: max }) as const;

export const visitorRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  const office = { preHandler: requireRole('clerk', 'supervisor') };
  const gate = { preHandler: requireRole('guard', 'supervisor') };

  // --- Hosts (office) ---
  app.get<{ Querystring: { all?: boolean } }>(
    '/api/hosts',
    {
      preHandler: requireRole('clerk', 'supervisor', 'guard'),
      schema: { querystring: { type: 'object', properties: { all: { type: 'boolean' } } } },
    },
    (req) => listHosts(ctx, ctx.site, req.query.all === true),
  );

  app.post<{ Body: NewHost }>(
    '/api/hosts',
    {
      ...office,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'department', 'phone'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 80 },
            department: optionalText(60),
            phone: optionalText(30),
          },
        },
      },
    },
    (req) => createHost(ctx, ctx.site, currentUser(req).id, req.body),
  );

  app.post<{ Params: { id: string }; Body: { active: boolean } }>(
    '/api/hosts/:id/active',
    {
      ...office,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['active'],
          additionalProperties: false,
          properties: { active: { type: 'boolean' } },
        },
      },
    },
    async (req) => {
      await setHostActive(ctx, ctx.site, currentUser(req).id, req.params.id, req.body.active);
      return { ok: true };
    },
  );

  // --- Invites (office) ---
  app.get('/api/invites', office, () => listInvites(ctx, ctx.site));

  app.post<{ Body: NewInvite }>(
    '/api/invites',
    {
      ...office,
      schema: {
        body: {
          type: 'object',
          required: [
            'type',
            'name',
            'company',
            'phone',
            'groupSize',
            'hostId',
            'purpose',
            'validFrom',
            'validTo',
            'untilTime',
            'plate',
          ],
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['visitor', 'contractor'] },
            name: { type: 'string', minLength: 2, maxLength: 80 },
            company: optionalText(80),
            phone: optionalText(30),
            groupSize: { type: 'integer', minimum: 1, maximum: 60 },
            hostId: uuid,
            purpose: optionalText(200),
            validFrom: { type: 'string', format: 'date' },
            validTo: { type: 'string', format: 'date' },
            untilTime: {
              type: ['string', 'null'],
              pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
            },
            plate: optionalText(16),
          },
        },
      },
    },
    (req) => createInvite(ctx, ctx.site, currentUser(req).id, req.body),
  );

  app.post<{ Params: { id: string } }>(
    '/api/invites/:id/cancel',
    { ...office, schema: { params: idParams } },
    async (req) => {
      await cancelInvite(ctx, ctx.site, currentUser(req).id, req.params.id);
      return { ok: true };
    },
  );

  // --- Gate: expected today, scanned QR ---
  app.get('/api/gate/invites/today', gate, () => expectedToday(ctx, ctx.site));

  app.get<{ Querystring: { code: string } }>(
    '/api/gate/invites/find',
    {
      ...gate,
      schema: {
        querystring: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    (req) => findInvite(ctx, ctx.site, req.query.code),
  );

  // --- Gate: visitor / contractor in, staff plate log ---
  app.post<{ Body: VisitGateInInput }>(
    '/api/gate/visit-in',
    {
      ...gate,
      schema: {
        body: {
          type: 'object',
          required: [
            'inviteId',
            'type',
            'name',
            'company',
            'phone',
            'hostId',
            'groupSize',
            'hostConfirmed',
            'plate',
            'plateReadId',
            'cardNo',
            'photoIds',
          ],
          additionalProperties: false,
          properties: {
            inviteId: { type: ['string', 'null'], format: 'uuid' },
            type: { type: 'string', enum: ['visitor', 'contractor'] },
            name: { type: 'string', maxLength: 80 },
            company: optionalText(80),
            phone: optionalText(30),
            hostId: { type: ['string', 'null'], format: 'uuid' },
            groupSize: { type: 'integer', minimum: 1, maximum: 60 },
            hostConfirmed: { type: 'boolean' },
            plate: optionalText(16),
            plateReadId: { type: ['string', 'null'], format: 'uuid' },
            cardNo: { type: 'string', minLength: 1, maxLength: 64 },
            photoIds: { type: 'array', maxItems: 10, items: uuid },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await visitGateIn(ctx, ctx.site, currentUser(req).id, req.body);
      if (!result.ok) return reply.code(409).send({ error: result.error });
      return result;
    },
  );

  app.post<{ Body: { camera: 'entry' | 'exit'; plate: string; plateReadId: string | null } }>(
    '/api/gate/staff',
    {
      ...gate,
      schema: {
        body: {
          type: 'object',
          required: ['camera', 'plate', 'plateReadId'],
          additionalProperties: false,
          properties: {
            camera: { type: 'string', enum: ['entry', 'exit'] },
            plate: { type: 'string', minLength: 1, maxLength: 16 },
            plateReadId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
      },
    },
    (req) => logStaff(ctx, ctx.site, currentUser(req).id, req.body),
  );

  // --- Gate out for visitors and contractors ---
  const cardParams = {
    type: 'object',
    required: ['cardNo'],
    properties: { cardNo: { type: 'string', minLength: 1, maxLength: 64 } },
  } as const;

  app.get('/api/gate/exit/people', gate, () => visitsOnSite(ctx, ctx.site));

  app.get<{ Params: { id: string } }>(
    '/api/gate/exit/visits/:id',
    { ...gate, schema: { params: idParams } },
    (req) => visitExitById(ctx, ctx.site, req.params.id),
  );

  app.get<{ Params: { cardNo: string } }>(
    '/api/gate/exit/visit-card/:cardNo',
    { ...gate, schema: { params: cardParams } },
    (req) => visitExitByCard(ctx, ctx.site, req.params.cardNo),
  );

  app.post<{ Body: VisitGateOutInput }>(
    '/api/gate/visit-out',
    {
      ...gate,
      schema: {
        body: {
          type: 'object',
          required: ['visitId', 'cardNo', 'plateReadId'],
          additionalProperties: false,
          properties: {
            visitId: uuid,
            cardNo: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
            plateReadId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
      },
    },
    (req) => visitGateOut(ctx, ctx.site, currentUser(req).id, req.body),
  );

  // --- Headcount and muster: anyone signed in can start or help with a roll call ---
  const anyone = { preHandler: requireRole() };

  app.get('/api/people', anyone, () => peopleOnSite(ctx, ctx.site));
  app.get('/api/muster', anyone, () => currentMuster(ctx, ctx.site));
  app.post('/api/muster/start', anyone, (req) => startMuster(ctx, ctx.site, currentUser(req).id));

  app.post<{ Params: { id: string }; Body: { entryId: string; safe: boolean } }>(
    '/api/muster/:id/mark',
    {
      ...anyone,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['entryId', 'safe'],
          additionalProperties: false,
          properties: { entryId: uuid, safe: { type: 'boolean' } },
        },
      },
    },
    (req) =>
      markMuster(
        ctx,
        ctx.site,
        currentUser(req).id,
        req.params.id,
        req.body.entryId,
        req.body.safe,
      ),
  );

  app.post<{ Params: { id: string } }>(
    '/api/muster/:id/end',
    { ...anyone, schema: { params: idParams } },
    (req) => endMuster(ctx, ctx.site, currentUser(req).id, req.params.id),
  );
};

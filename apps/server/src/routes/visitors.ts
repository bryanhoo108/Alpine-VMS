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
};

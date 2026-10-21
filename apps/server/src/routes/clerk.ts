import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { currentUser, requireRole } from '../auth/session.js';
import {
  clearAlert,
  clearPreRegistration,
  clerkLists,
  createPreRegistration,
  linkSdos,
  listPreRegistrations,
  openAlerts,
  setDriver,
  setTransporter,
  tripDetail,
  tripsOnSite,
  unlinkSdo,
  type NewPreRegistration,
} from '../services/clerk.js';
import { unlinkedTickets } from '../services/cwis.js';
import { linkDo, unlinkDo } from '../services/dos.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const reasonBody = {
  type: 'object',
  required: ['reason'],
  additionalProperties: false,
  properties: { reason: { type: 'string', minLength: 2, maxLength: 300 } },
} as const;
const sdoNo = { type: 'string', minLength: 1, maxLength: 20 } as const;

export const clerkRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  const office = { preHandler: requireRole('clerk', 'supervisor') };

  app.get('/api/clerk/trips', office, () => tripsOnSite(ctx, ctx.site));
  app.get('/api/clerk/lists', office, () => clerkLists(ctx, ctx.site));
  app.get('/api/clerk/tickets/unlinked', office, () => unlinkedTickets(ctx.db, ctx.site.id));

  app.get<{ Params: { id: string } }>(
    '/api/clerk/trips/:id',
    { ...office, schema: { params: idParams } },
    (req) => tripDetail(ctx, ctx.site, req.params.id),
  );

  app.post<{ Params: { id: string }; Body: { sdoNos: string[] } }>(
    '/api/clerk/trips/:id/sdos',
    {
      ...office,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['sdoNos'],
          additionalProperties: false,
          properties: { sdoNos: { type: 'array', minItems: 1, maxItems: 20, items: sdoNo } },
        },
      },
    },
    async (req) => {
      await linkSdos(ctx, ctx.site, currentUser(req).id, req.params.id, req.body.sdoNos);
      return tripDetail(ctx, ctx.site, req.params.id);
    },
  );

  app.delete<{ Params: { id: string; sdoNo: string } }>(
    '/api/clerk/trips/:id/sdos/:sdoNo',
    {
      ...office,
      schema: {
        params: { type: 'object', required: ['id', 'sdoNo'], properties: { id: uuid, sdoNo } },
      },
    },
    async (req) => {
      await unlinkSdo(ctx, ctx.site, currentUser(req).id, req.params.id, req.params.sdoNo);
      return tripDetail(ctx, ctx.site, req.params.id);
    },
  );

  app.post<{ Params: { id: string }; Body: { doNo: string } }>(
    '/api/clerk/trips/:id/dos',
    {
      ...office,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['doNo'],
          additionalProperties: false,
          properties: { doNo: sdoNo },
        },
      },
    },
    async (req) => {
      await linkDo(ctx, ctx.site, currentUser(req).id, req.params.id, req.body.doNo);
      return tripDetail(ctx, ctx.site, req.params.id);
    },
  );

  app.delete<{ Params: { id: string; doNo: string } }>(
    '/api/clerk/trips/:id/dos/:doNo',
    {
      ...office,
      schema: {
        params: {
          type: 'object',
          required: ['id', 'doNo'],
          properties: { id: uuid, doNo: sdoNo },
        },
      },
    },
    async (req) => {
      await unlinkDo(ctx, ctx.site, currentUser(req).id, req.params.id, req.params.doNo);
      return tripDetail(ctx, ctx.site, req.params.id);
    },
  );

  app.put<{ Params: { id: string }; Body: { transporterId: string | null } }>(
    '/api/clerk/trips/:id/transporter',
    {
      ...office,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['transporterId'],
          additionalProperties: false,
          properties: { transporterId: { type: ['string', 'null'], format: 'uuid' } },
        },
      },
    },
    async (req) => {
      await setTransporter(
        ctx,
        ctx.site,
        currentUser(req).id,
        req.params.id,
        req.body.transporterId,
      );
      return tripDetail(ctx, ctx.site, req.params.id);
    },
  );

  app.put<{ Params: { id: string }; Body: { name: string; icLast4: string | null } }>(
    '/api/clerk/trips/:id/driver',
    {
      ...office,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['name', 'icLast4'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 100 },
            // Only the last 4 digits are ever accepted (decision Q2).
            icLast4: { type: ['string', 'null'], pattern: '^[0-9]{4}$' },
          },
        },
      },
    },
    async (req) => {
      await setDriver(ctx, ctx.site, currentUser(req).id, req.params.id, req.body);
      return tripDetail(ctx, ctx.site, req.params.id);
    },
  );

  app.get('/api/clerk/pre-registrations', office, () => listPreRegistrations(ctx, ctx.site));

  app.post<{ Body: NewPreRegistration }>(
    '/api/clerk/pre-registrations',
    {
      ...office,
      schema: {
        body: {
          type: 'object',
          required: ['plate', 'expectedDate', 'sdoNos', 'transporterId', 'note'],
          additionalProperties: false,
          properties: {
            plate: { type: 'string', minLength: 2, maxLength: 16 },
            expectedDate: { type: 'string', format: 'date' },
            sdoNos: { type: 'array', minItems: 1, maxItems: 20, items: sdoNo },
            transporterId: { type: ['string', 'null'], format: 'uuid' },
            note: { type: ['string', 'null'], maxLength: 300 },
          },
        },
      },
    },
    (req) => createPreRegistration(ctx, ctx.site, currentUser(req).id, req.body),
  );

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/api/clerk/pre-registrations/:id/clear',
    { ...office, schema: { params: idParams, body: reasonBody } },
    async (req) => {
      await clearPreRegistration(
        ctx,
        ctx.site,
        currentUser(req).id,
        req.params.id,
        req.body.reason,
      );
      return { ok: true };
    },
  );

  app.get('/api/alerts', office, () => openAlerts(ctx, ctx.site));

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/api/alerts/:id/clear',
    { ...office, schema: { params: idParams, body: reasonBody } },
    async (req) => {
      await clearAlert(ctx, ctx.site, currentUser(req).id, req.params.id, req.body.reason);
      return { ok: true };
    },
  );
};

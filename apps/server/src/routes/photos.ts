import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { currentUser, requireRole } from '../auth/session.js';
import { photos } from '../db/schema.js';
import { isAllowedUpload } from '../files.js';
import { readIcPhoto } from '../services/icRead.js';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const KINDS = ['ic', 'document', 'load'] as const;

export const photoRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  app.addContentTypeParser(
    /^image\//,
    { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES },
    (_req, body, done) => done(null, body),
  );

  /** Upload one photo (raw image body). IC photos get a PDPA delete-after date. */
  app.post<{ Querystring: { kind: (typeof KINDS)[number] } }>(
    '/api/photos',
    {
      preHandler: requireRole('guard', 'checker', 'clerk', 'supervisor'),
      schema: {
        querystring: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', enum: [...KINDS] } },
        },
      },
    },
    async (req, reply) => {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (!isAllowedUpload(contentType) || !Buffer.isBuffer(req.body)) {
        return reply.code(415).send({ error: 'NOT_AN_IMAGE' });
      }
      const now = ctx.now();
      const path = await ctx.files.save(req.body, contentType, now);
      const deleteAfter =
        req.query.kind === 'ic'
          ? new Date(now.getTime() + ctx.config.icPhotoRetentionDays * 86_400_000)
          : null;
      const [row] = await ctx.db
        .insert(photos)
        .values({
          siteId: ctx.site.id,
          kind: req.query.kind,
          path,
          contentType,
          takenAt: now,
          takenBy: currentUser(req).id,
          deleteAfter,
        })
        .returning({ id: photos.id });
      return { id: row!.id };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/photos/:id',
    {
      preHandler: requireRole(),
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (req, reply) => {
      const [row] = await ctx.db
        .select()
        .from(photos)
        .where(
          and(
            eq(photos.siteId, ctx.site.id),
            eq(photos.id, req.params.id),
            isNull(photos.deletedAt),
          ),
        );
      if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
      reply
        .header('content-type', row.contentType)
        .header('cache-control', 'private, max-age=86400')
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
      return ctx.files.read(row.path);
    },
  );

  /** Read the IC number and name from an IC photo; only the last 4 digits come back. */
  app.post<{ Params: { id: string } }>(
    '/api/photos/:id/read-ic',
    {
      preHandler: requireRole('guard', 'clerk', 'supervisor'),
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    (req) => readIcPhoto(ctx, ctx.site, req.params.id),
  );
};

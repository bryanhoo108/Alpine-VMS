import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { verifySecret } from '../auth/secret.js';
import { SESSION_COOKIE, signSession } from '../auth/session.js';
import { users } from '../db/schema.js';

export const authRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  /** Guards and checkers sign in by tapping their name, then a PIN: no typing. */
  app.get('/api/auth/people', async () => {
    return ctx.db
      .select({ username: users.username, displayName: users.displayName, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.siteId, ctx.site.id),
          eq(users.active, true),
          inArray(users.role, ['guard', 'checker']),
        ),
      )
      .orderBy(asc(users.displayName));
  });

  app.post<{ Body: { username: string; secret: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'secret'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            secret: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (req, reply) => {
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(
          and(
            eq(users.siteId, ctx.site.id),
            eq(users.username, req.body.username),
            eq(users.active, true),
          ),
        );
      const stored = user?.pinHash ?? user?.passwordHash;
      if (!user || !stored || !(await verifySecret(req.body.secret, stored))) {
        return reply.code(401).send({ error: 'WRONG_LOGIN' });
      }
      const now = ctx.now();
      const exp = now.getTime() + ctx.config.sessionHours * 3_600_000;
      reply.setCookie(
        SESSION_COOKIE,
        signSession({ uid: user.id, exp }, ctx.config.sessionSecret),
        {
          path: '/',
          httpOnly: true,
          sameSite: 'strict',
          secure: ctx.config.https !== null,
          expires: new Date(exp),
        },
      );
      return { id: user.id, displayName: user.displayName, role: user.role };
    },
  );

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'NOT_SIGNED_IN' });
    return { id: req.user.id, displayName: req.user.displayName, role: req.user.role };
  });
};

import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

export type Role = (typeof users.$inferSelect)['role'];

export interface SessionUser {
  id: string;
  siteId: string;
  displayName: string;
  role: Role;
}

export const SESSION_COOKIE = 'vms_session';

interface Payload {
  uid: string;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Token = base64url(payload).base64url(hmac). Stateless; user is re-read on each request. */
export function signSession(payload: Payload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(body).digest();
  return `${body}.${b64(mac)}`;
}

export function verifySession(token: string, secret: string, now: Date): Payload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    return payload.exp > now.getTime() ? payload : null;
  } catch {
    return null;
  }
}

export async function loadSessionUser(
  db: Db,
  token: string | undefined,
  secret: string,
  now: Date,
): Promise<SessionUser | null> {
  if (!token) return null;
  const payload = verifySession(token, secret, now);
  if (!payload) return null;
  const [user] = await db
    .select({
      id: users.id,
      siteId: users.siteId,
      displayName: users.displayName,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.id, payload.uid), eq(users.active, true)));
  return user ?? null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** preHandler: signed in, and (if roles given) one of those roles. Admin passes all. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'NOT_SIGNED_IN' });
    if (roles.length > 0 && req.user.role !== 'admin' && !roles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'WRONG_ROLE' });
    }
  };
}

export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new Error('requireRole must run before currentUser');
  return req.user;
}

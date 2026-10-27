import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../src/auth/session.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
beforeAll(async () => {
  h = await createTestApp();
});
afterAll(async () => h?.close());

describe('sessions', () => {
  const secret = 'x'.repeat(32);
  const now = new Date('2026-10-21T00:00:00Z');

  it('verifies a signed token until it expires', () => {
    const token = signSession({ uid: 'u1', exp: now.getTime() + 1000 }, secret);
    expect(verifySession(token, secret, now)?.uid).toBe('u1');
    expect(verifySession(token, secret, new Date(now.getTime() + 2000))).toBeNull();
  });

  it('rejects a tampered token or a different key', () => {
    const token = signSession({ uid: 'u1', exp: now.getTime() + 1000 }, secret);
    const [, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ uid: 'admin', exp: 9e15 })).toString('base64url')}.${mac}`;
    expect(verifySession(forged, secret, now)).toBeNull();
    expect(verifySession(token, 'y'.repeat(32), now)).toBeNull();
    expect(verifySession('garbage', secret, now)).toBeNull();
  });
});

describe('auth routes', () => {
  it('lists guards and checkers for tap sign-in, not clerks or supervisors', async () => {
    const res = await h.app.inject('/api/auth/people');
    const roles = new Set(res.json().map((p: { role: string }) => p.role));
    expect([...roles].sort()).toEqual(['checker', 'guard']);
  });

  it('signs in with the right PIN and rejects a wrong one', async () => {
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'guard.entry', secret: '0000' },
    });
    expect(bad.statusCode).toBe(401);
    const cookie = await h.login('guard.entry');
    const me = await h.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ displayName: 'Entry Guard', role: 'guard' });
  });

  it('rejects an unknown user the same way as a wrong PIN', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', secret: '1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'WRONG_LOGIN' });
  });

  it('keeps guard screens away from other roles', async () => {
    expect((await h.app.inject('/api/gate/entry')).statusCode).toBe(401);
    const cookie = await h.login('checker1');
    expect((await h.app.inject({ url: '/api/gate/entry', headers: { cookie } })).statusCode).toBe(
      403,
    );
  });
});

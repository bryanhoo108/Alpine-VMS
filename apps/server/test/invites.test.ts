import { inviteQrText } from '@vms/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_INVITE_CODES } from '../src/db/seed.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let clerk: string;

beforeAll(async () => {
  h = await createTestApp(); // 2026-10-21 10:00 in Shah Alam
  guard = await h.login('guard.entry');
  clerk = await h.login('clerk');
});
afterAll(async () => h?.close());

const get = (url: string, cookie = clerk) => h.app.inject({ url, headers: { cookie } });
const post = (url: string, payload: object, cookie = clerk) =>
  h.app.inject({ method: 'POST', url, headers: { cookie }, payload });

const hostId = async () =>
  ((await get('/api/hosts')).json() as { id: string; name: string }[]).find(
    (x) => x.name === 'Sales Manager',
  )!.id;

const invite = async (over: object = {}) =>
  post('/api/invites', {
    type: 'visitor',
    name: 'Visitor Gamma',
    company: 'Supplier Gamma',
    phone: null,
    groupSize: 3,
    hostId: await hostId(),
    purpose: 'Audit',
    validFrom: '2026-10-22',
    validTo: '2026-10-22',
    untilTime: '16:30',
    plate: 'wxa 99',
    ...over,
  });

describe('hosts', () => {
  it('lists the sample hosts; guards can read them for walk-ins', async () => {
    const list = (await get('/api/hosts', guard)).json();
    expect(list.map((x: { name: string }) => x.name)).toEqual([
      'HR Executive',
      'Plant Engineer',
      'Sales Manager',
    ]);
  });

  it('office adds a host and switches one off; guards cannot add', async () => {
    const add = await post('/api/hosts', { name: 'QA Lead', department: 'QA', phone: null });
    expect(add.statusCode).toBe(200);
    const id = add.json().id;
    expect((await post(`/api/hosts/${id}/active`, { active: false })).statusCode).toBe(200);
    const names = (await get('/api/hosts')).json().map((x: { name: string }) => x.name);
    expect(names).not.toContain('QA Lead');
    const all = (await get('/api/hosts?all=true')).json().map((x: { name: string }) => x.name);
    expect(all).toContain('QA Lead');
    expect(
      (await post('/api/hosts', { name: 'X Y', department: null, phone: null }, guard)).statusCode,
    ).toBe(403);
  });
});

describe('invites', () => {
  it('creates an invite with a QR code text and a normalised plate', async () => {
    const res = await invite();
    expect(res.statusCode).toBe(200);
    const inv = res.json();
    expect(inv).toMatchObject({
      type: 'visitor',
      name: 'Visitor Gamma',
      groupSize: 3,
      plate: 'WXA99',
      state: 'not_yet',
      host: { name: 'Sales Manager' },
      insideVisitId: null,
    });
    expect(inv.code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(inv.qrText).toBe(inviteQrText(inv.code));
  });

  it('refuses bad dates, long jobs and bad group sizes', async () => {
    expect((await invite({ validFrom: '2026-10-23', validTo: '2026-10-22' })).json().error).toBe(
      'DATES_INVALID',
    );
    expect((await invite({ validFrom: '2026-10-01', validTo: '2026-10-02' })).json().error).toBe(
      'DATES_IN_PAST',
    );
    expect((await invite({ validTo: '2026-12-30' })).json().error).toBe('DATES_TOO_LONG');
    expect((await invite({ groupSize: 0 })).statusCode).toBe(400);
    expect((await invite({ untilTime: '25:00' })).statusCode).toBe(400);
  });

  it('the gate sees only invites expected today and not inside', async () => {
    const today = (await get('/api/gate/invites/today', guard)).json();
    expect(today.map((i: { code: string }) => i.code).sort()).toEqual(
      [SAMPLE_INVITE_CODES.contractor, SAMPLE_INVITE_CODES.visitor].sort(),
    );
    expect(today.find((i: { type: string }) => i.type === 'contractor')).toMatchObject({
      groupSize: 4,
      company: 'Contractor Beta Engineering',
      state: 'expected',
    });
  });

  it('finds an invite from the scanned QR or a code read out', async () => {
    const qr = inviteQrText(SAMPLE_INVITE_CODES.visitor);
    const byQr = await get(`/api/gate/invites/find?code=${encodeURIComponent(qr)}`, guard);
    expect(byQr.json()).toMatchObject({ name: 'Sample Visitor', state: 'expected' });
    const spoken = await get('/api/gate/invites/find?code=demv-2345', guard);
    expect(spoken.json().code).toBe(SAMPLE_INVITE_CODES.visitor);
    const other = await get('/api/gate/invites/find?code=https%3A%2F%2Fexample.com', guard);
    expect(other.json().error).toBe('NOT_AN_INVITE');
    const unknown = await get('/api/gate/invites/find?code=ZZZZ2222', guard);
    expect(unknown.json().error).toBe('INVITE_NOT_FOUND');
  });

  it('a cancelled invite is gone from today but still found, marked cancelled', async () => {
    const inv = (await invite({ validFrom: '2026-10-21', validTo: '2026-10-21' })).json();
    expect((await get('/api/gate/invites/today', guard)).json()).toHaveLength(3);
    expect((await post(`/api/invites/${inv.id}/cancel`, {})).statusCode).toBe(200);
    expect((await post(`/api/invites/${inv.id}/cancel`, {})).json().error).toBe(
      'ALREADY_CANCELLED',
    );
    expect((await get('/api/gate/invites/today', guard)).json()).toHaveLength(2);
    const found = await get(`/api/gate/invites/find?code=${inv.code}`, guard);
    expect(found.json().state).toBe('cancelled');
  });

  it('guards cannot list or create office invites', async () => {
    expect((await get('/api/invites', guard)).statusCode).toBe(403);
    const body = {
      type: 'visitor',
      name: 'Visitor Delta',
      company: null,
      phone: null,
      groupSize: 1,
      hostId: await hostId(),
      purpose: null,
      validFrom: '2026-10-22',
      validTo: '2026-10-22',
      untilTime: null,
      plate: null,
    };
    expect((await post('/api/invites', body, guard)).statusCode).toBe(403);
  });
});

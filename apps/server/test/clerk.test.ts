import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, transporters, vehicles } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { pollCwisTickets } from '../src/services/cwis.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let clerk: string;
let card = 10;
const nextCard = () => sampleCardNo(++card);

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
  clerk = await h.login('clerk');
});
afterAll(async () => h?.close());

const get = async (url: string, cookie = clerk) => h.app.inject({ url, headers: { cookie } });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = clerk) =>
  h.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const transporterId = async (code: string) =>
  (await h.t.db.select().from(transporters).where(eq(transporters.sapBpCode, code)))[0]!.id;

describe('access', () => {
  it('is for clerks and supervisors, not guards', async () => {
    expect((await get('/api/clerk/trips', guard)).statusCode).toBe(403);
    expect((await get('/api/clerk/trips', await h.login('supervisor'))).statusCode).toBe(200);
  });
});

describe('trucks on site', () => {
  it('lists each truck with its stage, newest first', async () => {
    const a = await gateInTruck(h, guard, { plate: 'WXY1234', cardNo: nextCard() });
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const b = await gateInTruck(h, guard, {
      plate: 'VBA5521',
      cardNo: nextCard(),
      type: 'inbound',
    });
    const list = (await get('/api/clerk/trips')).json();
    expect(list.map((t: { id: string }) => t.id)).toEqual([b.trip.id, a.trip.id]);
    expect(list[1]).toMatchObject({
      plate: 'WXY1234',
      preAdvised: true,
      sdoNos: ['5005'],
      transporterName: 'Transporter One Logistics',
      stage: { matched: true, weighedIn: false, checked: null, doCount: 0 },
      alertLevel: null,
    });
    expect(list[0]).toMatchObject({
      type: 'inbound',
      preAdvised: false,
      stage: { matched: false },
    });
  });
});

describe('matching SDOs to a walk-in truck', () => {
  let tripId: string;

  it('shortlists SDOs: on the CWIS ticket first, then usual customers, then newest', async () => {
    // Transporter One carried SDO 5005 (customer C0004) earlier today.
    const { trip } = await gateInTruck(h, guard, {
      plate: 'BJR9102',
      cardNo: nextCard(),
      transporterId: await transporterId('T0001'),
    });
    tripId = trip.id;
    h.cwis.weighIn({ plate: 'BJR9102', sdoNos: ['5011'] });
    await pollCwisTickets(h.deps, h.site);

    const d = (await get(`/api/clerk/trips/${tripId}`)).json();
    expect(d.sdos).toEqual([]);
    expect(d.tickets).toMatchObject([{ sdoNos: ['5011'], plateDiffers: false }]);
    const reasons = d.shortlist.map(
      (s: { sdoNo: string; reason: string }) => `${s.sdoNo}:${s.reason}`,
    );
    expect(reasons[0]).toBe('5011:on_ticket');
    expect(reasons).toContain('5009:usual_customer'); // C0004 like 5005
    expect(reasons.indexOf('5009:usual_customer')).toBeLessThan(
      reasons.findIndex((r: string) => r.endsWith(':open')),
    );
    // SDOs on other trucks stay listed: one SDO can ship on several trucks.
    expect(d.shortlist.map((s: { sdoNo: string }) => s.sdoNo)).toContain('5005');
  });

  it('links two SDOs, records who did it, and drops them from the shortlist', async () => {
    const res = await send('POST', `/api/clerk/trips/${tripId}/sdos`, { sdoNos: ['5011', '5013'] });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.sdos.map((s: { sdoNo: string; source: string }) => `${s.sdoNo}:${s.source}`)).toEqual([
      '5011:clerk',
      '5013:clerk',
    ]);
    expect(d.sdos[0]).toMatchObject({
      customerName: 'Customer Bravo Trading',
      changed: false,
      lines: [{ pieces: 100 }],
    });
    expect(d.shortlist.map((s: { sdoNo: string }) => s.sdoNo)).not.toContain('5011');
    const log = await h.t.db.select().from(auditLog).where(eq(auditLog.entityId, tripId));
    expect(log.map((l) => l.action)).toContain('link_sdo');
  });

  it('linking the same SDO again is harmless', async () => {
    const d = (await send('POST', `/api/clerk/trips/${tripId}/sdos`, { sdoNos: ['5011'] })).json();
    expect(d.sdos).toHaveLength(2);
  });

  it('unlinks an SDO', async () => {
    const d = (await send('DELETE', `/api/clerk/trips/${tripId}/sdos/5013`)).json();
    expect(d.sdos.map((s: { sdoNo: string }) => s.sdoNo)).toEqual(['5011']);
    expect((await send('DELETE', `/api/clerk/trips/${tripId}/sdos/5013`)).statusCode).toBe(404);
  });

  it('refuses unknown or closed SDOs, and SDOs on inbound coil trucks', async () => {
    expect(
      (await send('POST', `/api/clerk/trips/${tripId}/sdos`, { sdoNos: ['9999'] })).json(),
    ).toEqual({
      error: 'SDO_NOT_FOUND',
    });
    h.sap.setSdoStatus('5012', 'closed');
    const { refreshSdoCache } = await import('../src/services/sdoCache.js');
    await refreshSdoCache(h.deps, h.site, { full: true });
    expect(
      (await send('POST', `/api/clerk/trips/${tripId}/sdos`, { sdoNos: ['5012'] })).json(),
    ).toEqual({
      error: 'SDO_CLOSED',
    });
    const coil = await gateInTruck(h, guard, {
      plate: 'BHE4092',
      cardNo: nextCard(),
      type: 'inbound',
    });
    const res = await send('POST', `/api/clerk/trips/${coil.trip.id}/sdos`, { sdoNos: ['5011'] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'NOT_OUTBOUND' });
  });
});

describe('company and driver', () => {
  it('sets the company the guard skipped, and plate history learns it', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'WRC6630', cardNo: nextCard() });
    const id = await transporterId('T0003');
    const d = (
      await send('PUT', `/api/clerk/trips/${trip.id}/transporter`, { transporterId: id })
    ).json();
    expect(d.transporterName).toBe('Transporter Three Lorry Services');
    const [v] = await h.t.db.select().from(vehicles).where(eq(vehicles.plate, 'WRC6630'));
    expect(v!.transporterId).toBe(id);
  });

  it('records the driver with the last 4 IC digits only', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'WRC6631', cardNo: nextCard() });
    const bad = await send('PUT', `/api/clerk/trips/${trip.id}/driver`, {
      name: 'Driver A',
      icLast4: '880101105555',
    });
    expect(bad.statusCode).toBe(400);
    const d = (
      await send('PUT', `/api/clerk/trips/${trip.id}/driver`, { name: 'Driver A', icLast4: '5555' })
    ).json();
    expect(d.driver).toEqual({ name: 'Driver A', icLast4: '5555' });
  });
});

describe('pre-registrations', () => {
  it('creates one the guard then sees, and the plate is normalised', async () => {
    const res = await send('POST', '/api/clerk/pre-registrations', {
      plate: 'bqa 77',
      expectedDate: '2026-10-21',
      sdoNos: ['5006'],
      transporterId: await transporterId('T0002'),
      note: 'Afternoon',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plate: 'BQA77', sdoNos: ['5006'] });
    const list = (await get('/api/clerk/pre-registrations')).json();
    expect(list.find((p: { plate: string }) => p.plate === 'BQA77')).toMatchObject({
      status: 'expected',
      transporterName: 'Transporter Two Haulage',
    });
    const entry = (await get('/api/gate/entry', guard)).json();
    expect(entry.openPreRegistrations.map((p: { plate: string }) => p.plate)).toContain('BQA77');
  });

  it('lists late ones first and arrived ones with their trip number', async () => {
    const list = (await get('/api/clerk/pre-registrations')).json();
    expect(list[0]).toMatchObject({ plate: 'BMK7710', status: 'late' });
    expect(list.find((p: { plate: string }) => p.plate === 'WXY1234')).toMatchObject({
      status: 'arrived',
      tripNo: expect.stringMatching(/^T-/),
    });
  });

  it('refuses an SDO that is not open, or no SDO', async () => {
    const base = { plate: 'BQA78', expectedDate: '2026-10-21', transporterId: null, note: null };
    expect(
      (await send('POST', '/api/clerk/pre-registrations', { ...base, sdoNos: ['5014'] }))
        .statusCode,
    ).toBe(404);
    expect(
      (await send('POST', '/api/clerk/pre-registrations', { ...base, sdoNos: [] })).statusCode,
    ).toBe(400);
  });

  it('is cleared by hand with a reason, never by itself', async () => {
    const list = (await get('/api/clerk/pre-registrations')).json();
    const late = list.find((p: { plate: string }) => p.plate === 'BMK7710');
    expect(
      (await send('POST', `/api/clerk/pre-registrations/${late.id}/clear`, { reason: '' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await send('POST', `/api/clerk/pre-registrations/${late.id}/clear`, {
          reason: 'Customer cancelled',
        })
      ).statusCode,
    ).toBe(200);
    const after = (await get('/api/clerk/pre-registrations')).json();
    expect(after.find((p: { id: string }) => p.id === late.id)).toMatchObject({
      status: 'cleared',
      clearReason: 'Customer cancelled',
    });
    expect(
      (await send('POST', `/api/clerk/pre-registrations/${late.id}/clear`, { reason: 'again' }))
        .statusCode,
    ).toBe(409);
  });
});

describe('alerts', () => {
  it('lists open amber/red alerts, red first, and clears one with a reason', async () => {
    await gateInTruck(h, guard, { plate: 'BQL1187', cardNo: nextCard() }); // watchlist: red
    await gateInTruck(h, guard, { plate: 'BQL1187', cardNo: nextCard() }); // + already inside: amber
    const list = (await get('/api/alerts')).json();
    expect(list[0]).toMatchObject({ level: 'red', type: 'WATCHLIST_HIT', plate: 'BQL1187' });
    expect(list.some((a: { level: string }) => a.level === 'logged')).toBe(false);
    const amber = list.find((a: { type: string }) => a.type === 'PLATE_ALREADY_ON_SITE');
    expect(
      (await send('POST', `/api/alerts/${amber.id}/clear`, { reason: 'Same truck, double tap' }))
        .statusCode,
    ).toBe(200);
    const after = (await get('/api/alerts')).json();
    expect(after.find((a: { id: string }) => a.id === amber.id)).toBeUndefined();
    expect(
      (await send('POST', `/api/alerts/${amber.id}/clear`, { reason: 'again' })).statusCode,
    ).toBe(409);
  });
});

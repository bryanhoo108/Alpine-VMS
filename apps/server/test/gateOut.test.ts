import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, cards, sapWrites, transporters, trips } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { pollCwisTickets, sendCwisPushes } from '../src/services/cwis.js';
import { discoverDos, sendSapWrites } from '../src/services/dos.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let exitGuard: string;
let clerk: string;
let checker: string;
let card = 40;
const nextCard = () => sampleCardNo(++card);

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
  exitGuard = await h.login('guard.exit');
  clerk = await h.login('clerk');
  checker = await h.login('checker1');
});
afterAll(async () => h?.close());
beforeEach(() => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
});
const later = () => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
};

const inject = (method: 'GET' | 'POST', url: string, payload?: object, cookie = exitGuard) =>
  h.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function truck(
  plate: string,
  o: { sdoNos?: string[]; type?: 'outbound' | 'inbound'; transporterCode?: string } = {},
) {
  const cardNo = nextCard();
  const transporterId = o.transporterCode
    ? (
        await h.t.db
          .select()
          .from(transporters)
          .where(eq(transporters.sapBpCode, o.transporterCode))
      )[0]!.id
    : null;
  const { trip } = await gateInTruck(h, guard, {
    plate,
    cardNo,
    type: o.type ?? 'outbound',
    transporterId,
  });
  if (o.sdoNos?.length) {
    await inject('POST', `/api/clerk/trips/${trip.id}/sdos`, { sdoNos: o.sdoNos }, clerk);
  }
  return { id: trip.id, tripNo: trip.tripNo, cardNo };
}

async function approve(tripId: string) {
  const v = (await inject('GET', `/api/checker/trips/${tripId}`, undefined, checker)).json();
  const res = await inject(
    'POST',
    `/api/checker/trips/${tripId}/decision`,
    {
      decision: 'approve',
      reason: null,
      versions: Object.fromEntries(
        v.sdos.map((s: { sdoNo: string; version: string }) => [s.sdoNo, s.version]),
      ),
      lines: v.sdos.flatMap((s: { sdoNo: string; lines: { lineNo: number; expected: number }[] }) =>
        s.lines.map((l) => ({ sdoNo: s.sdoNo, lineNo: l.lineNo, actualPieces: l.expected })),
      ),
      photoIds: [],
    },
    checker,
  );
  if (res.statusCode !== 200) throw new Error(res.body);
}

async function weigh(t: { id: string; cardNo: string }, plate: string, out = true) {
  await sendCwisPushes(h.deps, h.site);
  const ticket = h.cwis.weighIn({ plate, cardNo: t.cardNo });
  if (out) h.cwis.weighOut(ticket.ticketNo);
  await pollCwisTickets(h.deps, h.site);
  return ticket;
}

const exitSees = (plate: string) => inject('POST', '/api/dev/lpr', { camera: 'exit', plate });
const out = (tripId: string, cardNo: string | null, plateReadId: string | null = null) =>
  inject('POST', '/api/gate/out', { tripId, plateReadId, cardNo });
const types = (status: { reasons: { type: string }[] }) => status.reasons.map((r) => r.type);

describe('green: everything done', () => {
  it('shows green at the exit camera, collects the card, closes the trip, stamps gate-out in SAP', async () => {
    const t = await truck('BKA4321', { sdoNos: ['5006'] });
    later();
    const d = h.sap.createDo(['5006']);
    await discoverDos(h.deps, h.site);
    await approve(t.id);
    await weigh(t, 'BKA4321');

    await exitSees('BKA 4321');
    const state = (await inject('GET', '/api/gate/exit')).json();
    expect(state.truck).toMatchObject({ id: t.id, status: { level: 'green', reasons: [] } });

    const res = await out(t.id, t.cardNo, state.read.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: { level: 'green' }, cardReturned: true });

    const [trip] = await h.t.db.select().from(trips).where(eq(trips.id, t.id));
    expect(trip).toMatchObject({
      status: 'closed',
      exitLevel: 'green',
      cardReturned: true,
      plateOut: 'BKA4321',
    });
    const [c] = await h.t.db.select().from(cards).where(eq(cards.cardNo, t.cardNo));
    expect(c).toMatchObject({ status: 'free', currentTripId: null });
    expect((await inject('GET', '/api/gate/exit')).json().truck).toBeNull();

    await sendSapWrites(h.deps, h.site);
    expect(h.sap.udfsOf(d.doNo)).toMatchObject({
      gateOutAt: expect.any(Date),
      checkerName: 'Checker 1',
    });
  });
});

describe('amber and red: recorded and sent, never kept in', () => {
  it('no check + no DO: red, each reason alerts the supervisor, truck still goes out', async () => {
    const t = await truck('BJR9102', { sdoNos: ['5011'] });
    const before = h.notifier.sent.length;
    const res = await out(t.id, t.cardNo);
    expect(res.statusCode).toBe(200);
    expect(res.json().status.level).toBe('red');
    expect(types(res.json().status)).toEqual(['EXIT_NO_CHECK', 'EXIT_NO_DO']);
    expect(h.notifier.sent.slice(before).map((n) => n.alert.type)).toEqual([
      'EXIT_NO_CHECK',
      'EXIT_NO_DO',
    ]);
  });

  it('approved but no DO: amber', async () => {
    const t = await truck('BJR9103', { sdoNos: ['5013'] });
    await approve(t.id);
    const res = await out(t.id, t.cardNo);
    expect(res.json().status).toMatchObject({
      level: 'amber',
      reasons: [{ type: 'EXIT_NO_DO', detail: { sdoNo: '5013' } }],
    });
  });

  it('no SDO linked: red', async () => {
    const t = await truck('BJR9104');
    expect(types((await out(t.id, t.cardNo)).json().status)).toEqual([
      'EXIT_NO_CHECK',
      'EXIT_NO_SDO',
    ]);
  });

  it('CWIS plate differs: amber, shown before the card tap', async () => {
    const t = await truck('BJR9105', { sdoNos: ['5012'] });
    later();
    h.sap.createDo(['5012']);
    await discoverDos(h.deps, h.site);
    await approve(t.id);
    await weigh(t, 'BJR 9150');
    const preview = (await inject('GET', `/api/gate/exit/trips/${t.id}`)).json();
    expect(preview.status).toMatchObject({ level: 'amber', reasons: [{ type: 'PLATE_MISMATCH' }] });
  });

  it('inbound coil: amber without weigh-out, green with it; never asks for check or DO', async () => {
    const a = await truck('VBA5521', { type: 'inbound' });
    expect((await out(a.id, a.cardNo)).json().status).toMatchObject({
      level: 'amber',
      reasons: [{ type: 'EXIT_NO_WEIGH_OUT' }],
    });
    const b = await truck('VBA5522', { type: 'inbound' });
    await weigh(b, 'VBA5522');
    expect((await out(b.id, b.cardNo)).json().status.level).toBe('green');
  });
});

describe('cards at the exit', () => {
  it('no card: red, card lost, lost-card count for the company; the card cannot be reissued until found', async () => {
    const t = await truck('WRC6650', { sdoNos: ['5008'], transporterCode: 'T0004' });
    const [before] = await h.t.db
      .select()
      .from(transporters)
      .where(eq(transporters.sapBpCode, 'T0004'));
    const res = await out(t.id, null);
    expect(res.json()).toMatchObject({ cardReturned: false, status: { level: 'red' } });
    expect(types(res.json().status)).toContain('CARD_NOT_RETURNED');
    const [c] = await h.t.db.select().from(cards).where(eq(cards.cardNo, t.cardNo));
    expect(c).toMatchObject({ status: 'lost', currentTripId: null });
    const [after] = await h.t.db
      .select()
      .from(transporters)
      .where(eq(transporters.sapBpCode, 'T0004'));
    expect(after!.lostCardCount).toBe(before!.lostCardCount + 1);

    const lostAgain = await h.app.inject({
      method: 'POST',
      url: '/api/gate/in',
      headers: { cookie: guard },
      payload: {
        plateReadId: null,
        plate: 'WRC6652',
        type: 'outbound',
        cardNo: t.cardNo,
        photoIds: [],
        transporterId: null,
        preRegistrationId: null,
      },
    });
    expect(lostAgain.json()).toEqual({ error: 'CARD_LOST' });

    expect((await inject('POST', `/api/cards/${t.cardNo}/recover`)).statusCode).toBe(200);
    const [found] = await h.t.db.select().from(cards).where(eq(cards.cardNo, t.cardNo));
    expect(found!.status).toBe('free');
    expect((await inject('POST', `/api/cards/${t.cardNo}/recover`)).json()).toEqual({
      error: 'CARD_NOT_LOST',
    });
  });

  it("another truck's card is refused; the guard taps the right one", async () => {
    const a = await truck('WRC6660', { sdoNos: ['5007'] });
    const b = await truck('WRC6661', { sdoNos: ['5007'] });
    const res = await out(a.id, b.cardNo);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'CARD_ON_OTHER_TRIP' });
    const [trip] = await h.t.db.select().from(trips).where(eq(trips.id, a.id));
    expect(trip!.status).toBe('on_site');
    expect((await out(a.id, a.cardNo)).statusCode).toBe(200);
  });

  it('finds the truck from its card (no camera read), in NFC format too', async () => {
    const t = await truck('WRC6670', { sdoNos: ['5004'] });
    const nfc = t.cardNo.toLowerCase().match(/../g)!.join(':');
    expect(
      (await inject('GET', `/api/gate/exit/card/${encodeURIComponent(nfc)}`)).json(),
    ).toMatchObject({ id: t.id });
    expect((await inject('GET', `/api/gate/exit/card/${sampleCardNo(60)}`)).json()).toEqual({
      error: 'CARD_NOT_ON_TRIP',
    });
    expect((await inject('GET', '/api/gate/exit/card/NOPE')).statusCode).toBe(404);
  });

  it('a closed trip cannot go out twice', async () => {
    const t = await truck('WRC6671', { sdoNos: ['5004'] });
    await out(t.id, t.cardNo);
    expect((await out(t.id, null)).json()).toEqual({ error: 'TRIP_CLOSED' });
  });
});

describe('exit camera', () => {
  it('misread plate: no match, the guard picks the truck; the correction is logged', async () => {
    const t = await truck('BQA7720', { sdoNos: ['5010'] });
    await exitSees('BQA 772O');
    const state = (await inject('GET', '/api/gate/exit')).json();
    expect(state.truck).toBeNull();
    expect(state.onSite.map((x: { id: string }) => x.id)).toContain(t.id);
    await out(t.id, t.cardNo, state.read.id);
    const logged = await h.t.db.select().from(alerts).where(eq(alerts.tripId, t.id));
    expect(logged.map((a) => a.type)).toContain('LPR_CORRECTED');
  });

  it('is for guards and supervisors', async () => {
    expect((await inject('GET', '/api/gate/exit', undefined, checker)).statusCode).toBe(403);
  });
});

describe('after the truck has gone', () => {
  it('a DO made after exit still links, and SAP gets the gate-out time', async () => {
    const t = await truck('BQA7730', { sdoNos: ['5015'] });
    await approve(t.id);
    expect((await out(t.id, t.cardNo)).json().status.level).toBe('amber'); // No DO
    later();
    const d = h.sap.createDo(['5015']);
    const r = await discoverDos(h.deps, h.site);
    expect(r.linked).toEqual([{ doNo: d.doNo, tripId: t.id }]);
    const [w] = await h.t.db.select().from(sapWrites).where(eq(sapWrites.doNo, d.doNo));
    expect(w!.udfs).toMatchObject({ gateOutAt: expect.any(String), plate: 'BQA7730' });
  });

  it('nightly reconcile lists exits with no DO and DOs with no exit', async () => {
    const leftover = h.sap.createDo(['5009']); // no truck carries 5009 out
    await h.t.db.transaction(async (tx) => {
      const { cacheDos } = await import('../src/services/dos.js');
      await cacheDos(tx, h.site.id, [leftover], h.clock.now);
    });
    const res = await inject('GET', '/api/reports/reconcile?date=2026-10-21', undefined, clerk);
    const r = res.json();
    const plates = r.exitsWithoutDo.map((e: { plate: string }) => e.plate);
    expect(plates).toEqual(expect.arrayContaining(['BJR9102', 'BJR9103', 'BJR9104']));
    expect(plates).not.toContain('BKA4321');
    expect(plates).not.toContain('VBA5521'); // inbound: no DO expected
    expect(r.dosWithoutExit.map((d: { doNo: string }) => d.doNo)).toContain(leftover.doNo);
  });
});

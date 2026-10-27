import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sapWrites, tripDos } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { pollCwisTickets, sendCwisPushes } from '../src/services/cwis.js';
import { discoverDos, queueDoUdfs, sendSapWrites } from '../src/services/dos.js';
import { retryDelayMs } from '../src/services/retry.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let clerk: string;
let checker: string;
let card = 30;
const nextCard = () => sampleCardNo(++card);

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
  clerk = await h.login('clerk');
  checker = await h.login('checker1');
});
afterAll(async () => h?.close());
beforeEach(() => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
});

async function truck(plate: string, sdoNos: string[]) {
  const { trip } = await gateInTruck(h, guard, { plate, cardNo: nextCard() });
  if (sdoNos.length) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos },
    });
    if (res.statusCode !== 200) throw new Error(res.body);
  }
  return trip;
}
const later = () => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
};
const linkedOf = async (tripId: string) =>
  (
    await h.t.db
      .select()
      .from(tripDos)
      .where(and(eq(tripDos.tripId, tripId), eq(tripDos.state, 'linked')))
  ).map((r) => r.doNo);
const detail = async (tripId: string) =>
  (await h.app.inject({ url: `/api/clerk/trips/${tripId}`, headers: { cookie: clerk } })).json();
const writesOf = (tripId: string) =>
  h.t.db.select().from(sapWrites).where(eq(sapWrites.tripId, tripId));

describe('finding DOs', () => {
  it('links a new DO to the one truck carrying its SDO, and queues the SAP update', async () => {
    const trip = await truck('BKA4321', ['5006']);
    later();
    const d = h.sap.createDo(['5006']);
    const r = await discoverDos(h.deps, h.site);
    expect(r.linked).toEqual([{ doNo: d.doNo, tripId: trip.id }]);
    expect(await linkedOf(trip.id)).toEqual([d.doNo]);
    const [w] = await writesOf(trip.id);
    expect(w).toMatchObject({ doNo: d.doNo, status: 'pending', udfs: { plate: 'BKA4321' } });
    expect(w!.idempotencyKey.startsWith(`${trip.tripNo}:${d.doNo}:`)).toBe(true);
    const view = await detail(trip.id);
    expect(view.dos).toMatchObject({
      linked: [{ doNo: d.doNo, source: 'auto' }],
      sdosWithoutDo: [],
    });
  });

  it("does not take yesterday's DOs for today's truck (shown to the clerk only)", async () => {
    const trip = await truck('BMK7712', ['5001']);
    await discoverDos(h.deps, h.site);
    expect(await linkedOf(trip.id)).toEqual([]);
    const view = await detail(trip.id);
    expect(view.dos.sdosWithoutDo).toEqual(['5001']);
    expect(
      view.dos.candidates.map((c: { doNo: string; reason: string }) => `${c.doNo}:${c.reason}`),
    ).toEqual(['8001:before_gate_in', '8002:before_gate_in']);
  });

  it('split: two part DOs for one SDO both link; checker expects the DO pieces', async () => {
    const trip = await truck('WRC6640', ['5010']); // 800 pcs on the SDO
    later();
    h.sap.createDo([{ sdoNo: '5010', lines: [{ lineNo: 0, pieces: 300 }] }]);
    h.sap.createDo([{ sdoNo: '5010', lines: [{ lineNo: 0, pieces: 100 }] }]);
    await discoverDos(h.deps, h.site);
    expect(await linkedOf(trip.id)).toHaveLength(2);
    const view = (
      await h.app.inject({ url: `/api/checker/trips/${trip.id}`, headers: { cookie: checker } })
    ).json();
    expect(view.sdos[0]).toMatchObject({
      doNos: expect.any(Array),
      lines: [{ pieces: 800, expected: 400, from: 'do' }],
    });

    // Ticking the line as loaded (400) is no difference; the SDO's 800 is not the target.
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/checker/trips/${trip.id}/decision`,
      headers: { cookie: checker },
      payload: {
        decision: 'approve',
        reason: null,
        versions: { '5010': view.sdos[0].version },
        lines: [{ sdoNo: '5010', lineNo: 0, actualPieces: 400 }],
        photoIds: [],
      },
    });
    expect(res.json()).toMatchObject({ differences: [] });
  });

  it('combined: one DO for two SDOs on the truck covers both', async () => {
    const trip = await truck('WRC6641', ['5011', '5013']);
    later();
    const d = h.sap.createDo(['5011', '5013']);
    await discoverDos(h.deps, h.site);
    expect(await linkedOf(trip.id)).toEqual([d.doNo]);
    expect((await detail(trip.id)).dos.sdosWithoutDo).toEqual([]);
  });

  it('two trucks on one SDO: the DO is left for the clerk, who links it to one', async () => {
    const a = await truck('WRC6642', ['5012']);
    const b = await truck('WRC6643', ['5012']);
    later();
    const d = h.sap.createDo(['5012']);
    const r = await discoverDos(h.deps, h.site);
    expect(r.ambiguous).toEqual([{ doNo: d.doNo, tripIds: [a.id, b.id] }]);
    expect(await linkedOf(a.id)).toEqual([]);
    expect((await detail(a.id)).dos.candidates).toMatchObject([
      { doNo: d.doNo, reason: 'needs_clerk' },
    ]);

    const link = await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${b.id}/dos`,
      headers: { cookie: clerk },
      payload: { doNo: d.doNo },
    });
    expect(link.json().dos.linked).toMatchObject([{ doNo: d.doNo, source: 'clerk' }]);
    expect((await detail(a.id)).dos.candidates).toMatchObject([
      { doNo: d.doNo, reason: 'other_truck', otherTripNo: expect.stringMatching(/^T-/) },
    ]);
    const steal = await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${a.id}/dos`,
      headers: { cookie: clerk },
      payload: { doNo: d.doNo },
    });
    expect(steal.statusCode).toBe(409);
    expect(steal.json()).toEqual({ error: 'DO_ON_OTHER_TRIP' });
  });

  it('a DO the clerk unlinks is not linked back automatically', async () => {
    const trip = await truck('WRC6644', ['5015']);
    later();
    const d = h.sap.createDo(['5015']);
    await discoverDos(h.deps, h.site);
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/clerk/trips/${trip.id}/dos/${d.doNo}`,
      headers: { cookie: clerk },
    });
    expect(res.json().dos.candidates).toMatchObject([{ doNo: d.doNo, reason: 'unlinked' }]);
    await discoverDos(h.deps, h.site);
    expect(await linkedOf(trip.id)).toEqual([]);
    expect((await writesOf(trip.id)).map((w) => w.status)).toEqual(['superseded']);
  });

  it('throws while SAP is down (the job retries)', async () => {
    h.sap.setOffline(true);
    await expect(discoverDos(h.deps, h.site)).rejects.toThrow(/unreachable/);
    h.sap.setOffline(false);
  });
});

describe('writing UDFs to SAP', () => {
  it('fills plate, WB ticket, checker and gate-in on the DO as each becomes known', async () => {
    const cardNo = nextCard();
    const { trip } = await gateInTruck(h, guard, { plate: 'BPN2045', cardNo }); // pre-registered 5009+5010
    later();
    const d = h.sap.createDo(['5009']);
    await discoverDos(h.deps, h.site);
    await sendSapWrites(h.deps, h.site);
    expect(h.sap.udfsOf(d.doNo)).toEqual({ plate: 'BPN2045', gateInAt: expect.any(Date) });

    // Weighed: the WB ticket follows, keyed by the ticket number.
    await sendCwisPushes(h.deps, h.site);
    const ticket = h.cwis.weighIn({ plate: 'BPN2045', cardNo });
    await pollCwisTickets(h.deps, h.site);
    const pending = (await writesOf(trip.id)).filter((w) => w.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.idempotencyKey.startsWith(`${ticket.ticketNo}:${d.doNo}:`)).toBe(true);
    await sendSapWrites(h.deps, h.site);
    expect(h.sap.udfsOf(d.doNo)).toMatchObject({ wbTicket: ticket.ticketNo });

    // Approved: checker name and time.
    const view = (
      await h.app.inject({ url: `/api/checker/trips/${trip.id}`, headers: { cookie: checker } })
    ).json();
    await h.app.inject({
      method: 'POST',
      url: `/api/checker/trips/${trip.id}/decision`,
      headers: { cookie: checker },
      payload: {
        decision: 'approve',
        reason: null,
        versions: Object.fromEntries(
          view.sdos.map((s: { sdoNo: string; version: string }) => [s.sdoNo, s.version]),
        ),
        lines: view.sdos.flatMap(
          (s: { sdoNo: string; lines: { lineNo: number; expected: number }[] }) =>
            s.lines.map((l) => ({ sdoNo: s.sdoNo, lineNo: l.lineNo, actualPieces: l.expected })),
        ),
        photoIds: [],
      },
    });
    await sendSapWrites(h.deps, h.site);
    expect(h.sap.udfsOf(d.doNo)).toMatchObject({
      plate: 'BPN2045',
      wbTicket: ticket.ticketNo,
      checkerName: 'Checker 1',
      checkedAt: expect.any(Date),
    });
  });

  it('never queues the same values twice', async () => {
    const trip = await truck('BQA7710', ['5007']);
    later();
    h.sap.createDo(['5007']);
    await discoverDos(h.deps, h.site);
    const before = (await writesOf(trip.id)).length;
    expect(await queueDoUdfs(h.t.db, h.site.id, trip.id, h.clock.now)).toBe(0);
    expect((await writesOf(trip.id)).length).toBe(before);
  });

  it('retries while SAP refuses, without writing twice', async () => {
    await sendSapWrites(h.deps, h.site); // clear writes left by earlier tests
    const trip = await truck('BQA7711', ['5008']);
    later();
    const d = h.sap.createDo(['5008']);
    await discoverDos(h.deps, h.site);
    const applied = h.sap.appliedWrites.length;
    h.sap.failNextWrites(1);
    await sendSapWrites(h.deps, h.site);
    expect((await writesOf(trip.id))[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: expect.any(String),
    });
    h.clock.now = new Date(h.clock.now.getTime() + retryDelayMs(1));
    await sendSapWrites(h.deps, h.site);
    await sendSapWrites(h.deps, h.site);
    expect((await writesOf(trip.id))[0]).toMatchObject({ status: 'done', attempts: 2 });
    expect(h.sap.appliedWrites.length).toBe(applied + 1);
    expect(h.sap.udfsOf(d.doNo)).toMatchObject({ plate: 'BQA7711' });
    expect((await detail(trip.id)).dos.linked[0].sap).toMatchObject({
      status: 'done',
      attempts: 2,
    });
  });

  it('a newer set of values replaces an older one still waiting', async () => {
    const cardNo = nextCard();
    const { trip } = await gateInTruck(h, guard, { plate: 'BQA7712', cardNo });
    await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos: ['5004'] },
    });
    later();
    h.sap.createDo(['5004']);
    await discoverDos(h.deps, h.site);
    await sendCwisPushes(h.deps, h.site);
    h.cwis.weighIn({ plate: 'BQA7712', cardNo });
    await pollCwisTickets(h.deps, h.site);
    expect((await writesOf(trip.id)).map((w) => w.status).sort()).toEqual([
      'pending',
      'superseded',
    ]);
  });
});

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, cwisPushes, weighTickets } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { pollCwisTickets, retryDelayMs, sendCwisPushes } from '../src/services/cwis.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let clerk: string;
let card = 0;
const nextCard = () => sampleCardNo(++card);

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
  clerk = await h.login('clerk');
});
afterAll(async () => h?.close());
beforeEach(() => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
});

const pushesOf = (tripId: string) =>
  h.t.db.select().from(cwisPushes).where(eq(cwisPushes.tripId, tripId));
const ticketsOf = (tripId: string) =>
  h.t.db.select().from(weighTickets).where(eq(weighTickets.tripId, tripId));
const alertsOf = (tripId: string, type: string) =>
  h.t.db
    .select()
    .from(alerts)
    .where(and(eq(alerts.tripId, tripId), eq(alerts.type, type)));

describe('carry-forward to CWIS', () => {
  it('sends the gated-in truck (plate, card, company, SDOs) to CWIS from the queue', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'WXY1234', cardNo: nextCard() });
    expect(await pushesOf(trip.id)).toMatchObject([{ status: 'pending' }]);
    expect(await sendCwisPushes(h.deps, h.site)).toBeGreaterThanOrEqual(1);
    expect(await pushesOf(trip.id)).toMatchObject([{ status: 'done', attempts: 1 }]);
    expect(h.cwis.pendingTrucks().find((p) => p.tripNo === trip.tripNo)).toMatchObject({
      plate: 'WXY1234',
      sdoNos: ['5005'],
      transporterName: 'Transporter One Logistics',
    });
  });

  it('retries with back-off while CWIS is down, then sends', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'WVT3388', cardNo: nextCard() });
    h.cwis.setOffline(true);
    await sendCwisPushes(h.deps, h.site);
    const [p] = await pushesOf(trip.id);
    expect(p).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: expect.stringContaining('unreachable'),
    });
    expect(p!.nextAttemptAt.getTime() - h.clock.now.getTime()).toBe(retryDelayMs(1));

    h.cwis.setOffline(false);
    await sendCwisPushes(h.deps, h.site); // not due yet
    expect((await pushesOf(trip.id))[0]!.status).toBe('pending');
    h.clock.now = new Date(h.clock.now.getTime() + retryDelayMs(1));
    await sendCwisPushes(h.deps, h.site);
    expect((await pushesOf(trip.id))[0]).toMatchObject({
      status: 'done',
      attempts: 2,
      lastError: null,
    });
  });

  it('back-off doubles and caps at 10 minutes', () => {
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([10_000, 20_000, 40_000, 600_000]);
  });

  it('a clerk edit before the push updates the waiting push instead of adding one', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'BJR9102', cardNo: nextCard() });
    await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos: ['5011'] },
    });
    const pushes = await pushesOf(trip.id);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.payload).toMatchObject({ sdoNos: ['5011'] });
  });

  it('a clerk edit after the push queues a new one with the update', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'BJR9103', cardNo: nextCard() });
    await sendCwisPushes(h.deps, h.site);
    await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos: ['5012'] },
    });
    const pushes = await pushesOf(trip.id);
    expect(pushes.map((p) => p.status).sort()).toEqual(['done', 'pending']);
  });
});

describe('reading CWIS tickets', () => {
  it('links a ticket by the trip number CWIS got from the card tap (option A)', async () => {
    const cardNo = nextCard();
    const { trip } = await gateInTruck(h, guard, { plate: 'BPN2045', cardNo });
    await sendCwisPushes(h.deps, h.site);
    const ticket = h.cwis.weighIn({ plate: 'BPN2045', cardNo });
    expect(ticket.sdoNos).toEqual(['5009', '5010']);
    expect(await pollCwisTickets(h.deps, h.site)).toContain(trip.id);
    expect(await ticketsOf(trip.id)).toMatchObject([
      { ticketNo: ticket.ticketNo, weighOutAt: null },
    ]);

    h.clock.now = new Date(h.clock.now.getTime() + 20 * 60_000);
    h.cwis.weighOut(ticket.ticketNo);
    await pollCwisTickets(h.deps, h.site);
    expect((await ticketsOf(trip.id))[0]!.weighOutAt).not.toBeNull();
  });

  it('flags a CWIS plate that differs from the LPR plate, once, and tells the supervisor', async () => {
    const cardNo = nextCard();
    const { trip } = await gateInTruck(h, guard, { plate: 'BMK7710', cardNo });
    await sendCwisPushes(h.deps, h.site);
    const before = h.notifier.sent.length;
    const ticket = h.cwis.weighIn({ plate: 'BMK 7170', cardNo });
    await pollCwisTickets(h.deps, h.site);
    h.cwis.weighOut(ticket.ticketNo);
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    h.cwis.weighOut(ticket.ticketNo);
    await pollCwisTickets(h.deps, h.site);

    const found = await alertsOf(trip.id, 'PLATE_MISMATCH');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      level: 'amber',
      detail: { ticketNo: ticket.ticketNo, lpr: 'BMK7710', cwis: 'BMK 7170' },
    });
    expect(h.notifier.sent.slice(before).map((n) => n.alert.type)).toEqual(['PLATE_MISMATCH']);
  });

  it('links inbound coil (no SDO, no card) by plate', async () => {
    const { trip } = await gateInTruck(h, guard, {
      plate: 'VBA5521',
      cardNo: nextCard(),
      type: 'inbound',
    });
    h.cwis.weighIn({ plate: 'VBA 5521' });
    await pollCwisTickets(h.deps, h.site);
    expect(await ticketsOf(trip.id)).toMatchObject([{ sdoNos: [] }]);
  });

  it('a ticket that came before the clerk matched the truck links once the SDO is linked', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'WRC6630', cardNo: nextCard() });
    // Operator typed the SDO and a wrong plate, no card tap: nothing to match yet.
    const ticket = h.cwis.weighIn({ plate: 'WRC 6680', sdoNos: ['5013'] });
    await pollCwisTickets(h.deps, h.site);
    expect(await ticketsOf(trip.id)).toEqual([]);

    await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos: ['5013'] },
    });
    await pollCwisTickets(h.deps, h.site);
    expect((await ticketsOf(trip.id)).map((t) => t.ticketNo)).toEqual([ticket.ticketNo]);
    expect(await alertsOf(trip.id, 'PLATE_MISMATCH')).toHaveLength(1);
  });

  it('throws while CWIS is down so the job retries, and catches up after', async () => {
    const { trip } = await gateInTruck(h, guard, {
      plate: 'BHE4092',
      cardNo: nextCard(),
      type: 'inbound',
    });
    h.cwis.weighIn({ plate: 'BHE4092' });
    h.cwis.setOffline(true);
    await expect(pollCwisTickets(h.deps, h.site)).rejects.toThrow(/unreachable/);
    h.cwis.setOffline(false);
    await pollCwisTickets(h.deps, h.site);
    expect(await ticketsOf(trip.id)).toHaveLength(1);
  });
});

describe('ticket read overlap', () => {
  it('does not miss a ticket saved in the same second as the newest one stored', async () => {
    const a = await gateInTruck(h, guard, {
      plate: 'BQA9001',
      cardNo: nextCard(),
      type: 'inbound',
    });
    const b = await gateInTruck(h, guard, {
      plate: 'BQA9002',
      cardNo: nextCard(),
      type: 'inbound',
    });
    h.cwis.weighIn({ plate: 'BQA9001' });
    await pollCwisTickets(h.deps, h.site);
    // Same clock second as the ticket already stored:
    h.cwis.weighIn({ plate: 'BQA9002' });
    await pollCwisTickets(h.deps, h.site);
    expect(await ticketsOf(a.trip.id)).toHaveLength(1);
    expect(await ticketsOf(b.trip.id)).toHaveLength(1);
  });
});

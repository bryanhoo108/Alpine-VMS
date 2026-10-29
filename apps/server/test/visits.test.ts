import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, cards, photos, plateReads, staffEntries, visits } from '../src/db/schema.js';
import { SAMPLE_INVITE_CODES, sampleCardNo } from '../src/db/seed.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let card = 0;
const nextCard = () => sampleCardNo(++card);

beforeAll(async () => {
  h = await createTestApp(); // 2026-10-21 10:00 in Shah Alam
  guard = await h.login('guard.entry');
});
afterAll(async () => h?.close());
beforeEach(() => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
});

const get = (url: string) => h.app.inject({ url, headers: { cookie: guard } });
const post = (url: string, payload: object) =>
  h.app.inject({ method: 'POST', url, headers: { cookie: guard }, payload });
const see = (plate: string) => post('/api/dev/lpr', { camera: 'entry', plate });

const inviteByCode = async (code: string) =>
  (await get(`/api/gate/invites/find?code=${code}`)).json();
const hostId = async (name: string) =>
  (await get('/api/hosts')).json().find((x: { name: string }) => x.name === name).id;

const visitIn = (body: Record<string, unknown>) =>
  post('/api/gate/visit-in', {
    inviteId: null,
    type: 'visitor',
    name: '',
    company: null,
    phone: null,
    hostId: null,
    groupSize: 1,
    hostConfirmed: false,
    plate: null,
    plateReadId: null,
    cardNo: nextCard(),
    photoIds: [],
    ...body,
  });

describe('visitor gate in', () => {
  it('invited group: details from the invite, one card, end time from the invite', async () => {
    const inv = await inviteByCode(SAMPLE_INVITE_CODES.visitor);
    const photo = await h.app.inject({
      method: 'POST',
      url: '/api/photos?kind=ic',
      headers: { cookie: guard, 'content-type': 'image/jpeg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    const cardNo = nextCard();
    const res = await visitIn({
      inviteId: inv.id,
      groupSize: 2,
      cardNo,
      photoIds: [photo.json().id],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      visit: {
        type: 'visitor',
        name: 'Sample Visitor',
        company: 'Customer Alpha Sdn Bhd',
        groupSize: 2,
        host: 'Sales Manager',
      },
      alerts: [],
    });
    expect(body.visit.visitNo).toBe('V-261021-001');

    const [visit] = await h.t.db.select().from(visits).where(eq(visits.id, body.visit.id));
    expect(visit).toMatchObject({ hostConfirmed: true, inviteId: inv.id });
    // Invite until 17:00 in Shah Alam = 09:00 UTC.
    expect(visit!.expectedUntil?.toISOString()).toBe('2026-10-21T09:00:00.000Z');

    const [c] = await h.t.db.select().from(cards).where(eq(cards.cardNo, cardNo));
    expect(c).toMatchObject({ status: 'issued', currentVisitId: visit!.id, currentTripId: null });
    const [p] = await h.t.db.select().from(photos).where(eq(photos.id, photo.json().id));
    expect(p!.visitId).toBe(visit!.id);

    // Inside now: no longer on the expected list.
    const today = (await get('/api/gate/invites/today')).json();
    expect(today.map((i: { id: string }) => i.id)).not.toContain(inv.id);
  });

  it('a card already out on a visit cannot be given to a truck or another visit', async () => {
    const cardNo = nextCard();
    await visitIn({ name: 'Walk In One', hostConfirmed: true, cardNo });
    expect((await visitIn({ name: 'Walk In Two', hostConfirmed: true, cardNo })).json()).toEqual({
      error: 'CARD_IN_USE',
    });
    const truck = await post('/api/gate/in', {
      plateReadId: null,
      plate: 'WXA 1',
      type: 'outbound',
      cardNo,
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
    });
    expect(truck.json()).toEqual({ error: 'CARD_IN_USE' });
  });

  it('walk-in whose host was not reached: still in, amber alert to the supervisor', async () => {
    const res = await visitIn({
      type: 'contractor',
      name: 'Walk In Contractor',
      company: 'Fixers Sdn Bhd',
      hostId: await hostId('Plant Engineer'),
      groupSize: 3,
      hostConfirmed: false,
    });
    const body = res.json();
    expect(body.visit).toMatchObject({ type: 'contractor', groupSize: 3, host: 'Plant Engineer' });
    expect(body.alerts.map((a: { type: string }) => a.type)).toEqual(['HOST_NOT_CONFIRMED']);
    const rows = await h.t.db.select().from(alerts).where(eq(alerts.visitId, body.visit.id));
    expect(rows.map((r) => [r.type, r.level, r.tripId])).toEqual([
      ['HOST_NOT_CONFIRMED', 'amber', null],
    ]);
    const [v] = await h.t.db.select().from(visits).where(eq(visits.id, body.visit.id));
    expect(v!.expectedUntil).toBeNull();
  });

  it('came by car: uses the camera read once, and a watchlisted plate is red', async () => {
    await see('BQL 1187'); // sample watchlist plate
    const read = (await get('/api/gate/entry')).json().read;
    expect(read.plate).toBe('BQL1187');
    const body = (
      await visitIn({ name: 'Visitor By Car', hostConfirmed: true, plateReadId: read.id })
    ).json();
    expect(body.alerts.map((a: { type: string; level: string }) => [a.type, a.level])).toEqual([
      ['WATCHLIST_HIT', 'red'],
    ]);
    const [v] = await h.t.db.select().from(visits).where(eq(visits.id, body.visit.id));
    expect(v!.plate).toBe('BQL1187');
    // The read is used: the guard's waiting screen does not show it again.
    expect((await get('/api/gate/entry')).json().read).toBeNull();
  });

  it('an invite for another day still lets them in, as a walk-in for the host check', async () => {
    const clerk = await h.login('clerk');
    const tomorrow = await h.app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie: clerk },
      payload: {
        type: 'visitor',
        name: 'Early Visitor',
        company: null,
        phone: null,
        groupSize: 1,
        hostId: await hostId('HR Executive'),
        purpose: null,
        validFrom: '2026-10-22',
        validTo: '2026-10-22',
        untilTime: '12:00',
        plate: null,
      },
    });
    const body = (await visitIn({ inviteId: tomorrow.json().id })).json();
    expect(body.visit).toMatchObject({ name: 'Early Visitor', host: 'HR Executive' });
    expect(body.alerts.map((a: { type: string }) => a.type)).toEqual(['HOST_NOT_CONFIRMED']);
    const [v] = await h.t.db.select().from(visits).where(eq(visits.id, body.visit.id));
    expect(v!.expectedUntil).toBeNull();
  });

  it('refuses a walk-in without a name, and group sizes out of range', async () => {
    expect((await visitIn({ name: 'X' })).json().error).toBe('NAME_REQUIRED');
    expect((await visitIn({ name: 'Group Big', groupSize: 61 })).statusCode).toBe(400);
  });
});

describe('staff plate log', () => {
  it('logs the plate, marks the read used, needs no card', async () => {
    await see('WSF 8080');
    const read = (await get('/api/gate/entry')).json().read;
    const res = await post('/api/gate/staff', {
      camera: 'entry',
      plate: read.plate,
      plateReadId: read.id,
    });
    expect(res.json()).toMatchObject({ plate: 'WSF8080' });
    const rows = await h.t.db.select().from(staffEntries);
    expect(rows.map((r) => [r.plate, r.camera])).toEqual([['WSF8080', 'entry']]);
    const [r] = await h.t.db.select().from(plateReads).where(eq(plateReads.id, read.id));
    expect(r!.handledAt).not.toBeNull();
    expect((await get('/api/gate/entry')).json().read).toBeNull();
  });
});

describe('visitor gate out', () => {
  const walkIn = async (name: string, groupSize = 1) => {
    const cardNo = nextCard();
    const body = (await visitIn({ name, groupSize, hostConfirmed: true, cardNo })).json();
    return { id: body.visit.id as string, cardNo };
  };

  it('the card tap finds the group; handing it back frees the card: green', async () => {
    const v = await walkIn('Leaver Green', 3);
    // The truck card lookup says it is a visitor card, so the screen switches.
    expect((await get(`/api/gate/exit/card/${v.cardNo}`)).json().error).toBe('CARD_ON_VISIT');
    const found = (await get(`/api/gate/exit/visit-card/${v.cardNo}`)).json();
    expect(found).toMatchObject({ id: v.id, name: 'Leaver Green', groupSize: 3 });
    expect(found.status.level).toBe('green');

    const out = await post('/api/gate/visit-out', {
      visitId: v.id,
      cardNo: v.cardNo,
      plateReadId: null,
    });
    expect(out.json()).toMatchObject({ status: { level: 'green' }, cardReturned: true });
    const [c] = await h.t.db.select().from(cards).where(eq(cards.cardNo, v.cardNo));
    expect(c).toMatchObject({ status: 'free', currentVisitId: null });
    expect(
      (await post('/api/gate/visit-out', { visitId: v.id, cardNo: null, plateReadId: null })).json()
        .error,
    ).toBe('NOT_ON_SITE');
  });

  it("another group's card is refused", async () => {
    const a = await walkIn('Group A');
    const b = await walkIn('Group B');
    const res = await post('/api/gate/visit-out', {
      visitId: a.id,
      cardNo: b.cardNo,
      plateReadId: null,
    });
    expect(res.json().error).toBe('CARD_ON_OTHER_TRIP');
  });

  it('no card: red, the card is marked lost, the supervisor is alerted', async () => {
    const v = await walkIn('Leaver No Card');
    const out = (
      await post('/api/gate/visit-out', { visitId: v.id, cardNo: null, plateReadId: null })
    ).json();
    expect(out.status.level).toBe('red');
    const [c] = await h.t.db.select().from(cards).where(eq(cards.cardNo, v.cardNo));
    expect(c!.status).toBe('lost');
    const rows = await h.t.db.select().from(alerts).where(eq(alerts.visitId, v.id));
    expect(rows.map((r) => r.type)).toEqual(['CARD_NOT_RETURNED']);
  });

  it('leaving well after the invite end time: amber "Stayed late"', async () => {
    const clerk = await h.login('clerk');
    const inv = await h.app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie: clerk },
      payload: {
        type: 'contractor',
        name: 'Late Leaver',
        company: null,
        phone: null,
        groupSize: 2,
        hostId: await hostId('Plant Engineer'),
        purpose: null,
        validFrom: '2026-10-21',
        validTo: '2026-10-21',
        untilTime: '13:00',
        plate: null,
      },
    });
    const cardNo = nextCard();
    const v = (await visitIn({ inviteId: inv.json().id, groupSize: 2, cardNo })).json().visit;
    h.clock.now = new Date('2026-10-21T05:31:00Z'); // 13:31 local, 31 min past 13:00
    expect((await get(`/api/gate/exit/visits/${v.id}`)).json().status.level).toBe('amber');
    const out = (
      await post('/api/gate/visit-out', { visitId: v.id, cardNo, plateReadId: null })
    ).json();
    expect(out.status.reasons.map((r: { type: string }) => r.type)).toEqual(['VISIT_OVERSTAY']);
  });
});

describe('headcount and muster', () => {
  it('counts truck drivers and visit groups; the roll is fixed when the muster starts', async () => {
    const people = (await get('/api/people')).json();
    const visitsInside = (await get('/api/gate/exit/people')).json();
    const groupPeople = visitsInside.reduce(
      (n: number, x: { groupSize: number }) => n + x.groupSize,
      0,
    );
    expect(people.headcount.visitors + people.headcount.contractors).toBe(groupPeople);
    expect(people.headcount.total).toBe(groupPeople + people.headcount.truckDrivers);

    const started = await post('/api/muster/start', {});
    expect(started.statusCode, started.body).toBe(200);
    const m = started.json();
    expect(m).toMatchObject({ people: people.headcount.total, safePeople: 0 });
    // Starting again returns the same muster.
    expect((await post('/api/muster/start', {})).json().id).toBe(m.id);

    const first = m.roll[0];
    const marked = (
      await post(`/api/muster/${m.id}/mark`, { entryId: first.id, safe: true })
    ).json();
    expect(marked.safePeople).toBe(first.people);
    expect(marked.roll[0].safe).toBe(true);

    // Someone arriving now is not on this roll.
    const late = (await visitIn({ name: 'After The Alarm', hostConfirmed: true })).json();
    const view = (await get('/api/muster')).json();
    expect(view.roll.map((e: { id: string }) => e.id)).not.toContain(late.visit.id);
    expect(
      (await post(`/api/muster/${m.id}/mark`, { entryId: late.visit.id, safe: true })).json().error,
    ).toBe('NOT_ON_ROLL');

    // Untick, end, then marking is refused and there is no current muster.
    expect(
      (await post(`/api/muster/${m.id}/mark`, { entryId: first.id, safe: false })).json()
        .safePeople,
    ).toBe(0);
    expect((await post(`/api/muster/${m.id}/end`, {})).json()).toEqual({ ok: true });
    expect(
      (await post(`/api/muster/${m.id}/mark`, { entryId: first.id, safe: true })).json().error,
    ).toBe('MUSTER_ENDED');
    expect((await get('/api/muster')).body).toBe('null');
  });
});

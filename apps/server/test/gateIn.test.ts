import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  alerts,
  auditLog,
  cards,
  cwisPushes,
  photos,
  plateReads,
  preRegistrations,
  transporters,
  trips,
  tripSdos,
  vehicles,
} from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let cardSeq = 0;
const nextCard = () => sampleCardNo(++cardSeq);

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
});
afterAll(async () => h?.close());
beforeEach(() => {
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
});

const see = (plate: string, camera: 'entry' | 'exit' = 'entry') =>
  h.app.inject({
    method: 'POST',
    url: '/api/dev/lpr',
    headers: { cookie: guard },
    payload: { camera, plate },
  });

const entry = async () =>
  (await h.app.inject({ url: '/api/gate/entry', headers: { cookie: guard } })).json();

const gateIn = (body: Record<string, unknown>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/gate/in',
    headers: { cookie: guard },
    payload: {
      plateReadId: null,
      type: 'outbound',
      cardNo: nextCard(),
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
      ...body,
    },
  });

const upload = (kind: string, contentType = 'image/jpeg') =>
  h.app.inject({
    method: 'POST',
    url: `/api/photos?kind=${kind}`,
    headers: { cookie: guard, 'content-type': contentType },
    payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  });

describe('pre-registered truck, plate read correctly', () => {
  it('shows the camera read with its pre-registration, then gates in with SDOs linked', async () => {
    await see('WXY 1234');
    const state = await entry();
    expect(state.read).toMatchObject({
      plate: 'WXY1234',
      preRegistration: { sdoNos: ['5005'], late: false },
      alerts: [],
    });
    expect(state.read.photoId).toEqual(expect.any(String));

    const ic = (await upload('ic')).json().id;
    const doc = (await upload('document')).json().id;
    const res = await gateIn({
      plateReadId: state.read.id,
      plate: 'WXY 1234',
      photoIds: [ic, doc],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      trip: { tripNo: 'T-261021-001', plate: 'WXY1234' },
      sdoNos: ['5005'],
      alerts: [],
    });

    const tripId = body.trip.id;
    const [card] = await h.t.db.select().from(cards).where(eq(cards.cardNo, body.cardNo));
    expect(card).toMatchObject({ status: 'issued', currentTripId: tripId });
    expect(await h.t.db.select().from(tripSdos).where(eq(tripSdos.tripId, tripId))).toMatchObject([
      { sdoNo: '5005', source: 'pre_registration' },
    ]);
    const [pre] = await h.t.db
      .select()
      .from(preRegistrations)
      .where(eq(preRegistrations.plate, 'WXY1234'));
    expect(pre!.arrivedTripId).toBe(tripId);
    const [read] = await h.t.db.select().from(plateReads).where(eq(plateReads.id, state.read.id));
    expect(read).toMatchObject({ tripId, confirmedPlate: 'WXY1234', corrected: false });
    // IC, document and plate photo all belong to the trip.
    expect(await h.t.db.select().from(photos).where(eq(photos.tripId, tripId))).toHaveLength(3);
    // Carry-forward to CWIS is queued, not sent inline.
    const [push] = await h.t.db.select().from(cwisPushes).where(eq(cwisPushes.tripId, tripId));
    expect(push).toMatchObject({
      status: 'pending',
      payload: { plate: 'WXY1234', sdoNos: ['5005'], transporterName: 'Transporter One Logistics' },
    });
    expect(await h.t.db.select().from(auditLog).where(eq(auditLog.entityId, tripId))).toMatchObject(
      [{ action: 'gate_in' }],
    );
    // The read is used up: the screen goes back to waiting.
    expect((await entry()).read).toBeNull();
  });
});

describe('camera misread', () => {
  it('guard picks the pre-registration: SDOs link and the correction is logged', async () => {
    await see('BPN 2O45'); // letter O instead of zero
    const state = await entry();
    expect(state.read.preRegistration).toBeNull();
    const pick = state.openPreRegistrations.find((p: { plate: string }) => p.plate === 'BPN2045');
    expect(pick).toBeDefined();

    const res = await gateIn({
      plateReadId: state.read.id,
      plate: pick.plate,
      preRegistrationId: pick.id,
    });
    const body = res.json();
    expect(body.sdoNos).toEqual(['5009', '5010']);
    expect(body.alerts.map((a: { type: string }) => a.type)).toEqual(['LPR_CORRECTED']);
    const [read] = await h.t.db.select().from(plateReads).where(eq(plateReads.id, state.read.id));
    expect(read).toMatchObject({
      plateText: 'BPN2O45',
      confirmedPlate: 'BPN2045',
      corrected: true,
    });
    const logged = await h.t.db.select().from(alerts).where(eq(alerts.tripId, body.trip.id));
    expect(logged).toMatchObject([{ type: 'LPR_CORRECTED', level: 'logged', notifiedAt: null }]);
  });
});

describe('late pre-registration', () => {
  it('is listed as late and still matches when the truck comes', async () => {
    const state0 = await entry();
    expect(
      state0.openPreRegistrations.find((p: { plate: string }) => p.plate === 'BMK7710'),
    ).toMatchObject({ late: true });
    await see('BMK 7710');
    const state = await entry();
    expect(state.read.preRegistration).toMatchObject({ sdoNos: ['5007'], late: true });
  });
});

describe('walk-in truck, first visit', () => {
  it('records the transporter the guard tapped and remembers it next time', async () => {
    const [t1] = await h.t.db
      .select()
      .from(transporters)
      .where(eq(transporters.sapBpCode, 'T0002'));
    await see('VBA 5521');
    const state = await entry();
    expect(state.read).toMatchObject({ transporterId: null, preRegistration: null });
    expect(state.transporters.length).toBe(4);

    const res = await gateIn({
      plateReadId: state.read.id,
      plate: 'VBA5521',
      type: 'inbound',
      transporterId: t1!.id,
    });
    expect(res.json()).toMatchObject({ sdoNos: [], trip: { type: 'inbound' } });
    const [v] = await h.t.db.select().from(vehicles).where(eq(vehicles.plate, 'VBA5521'));
    expect(v!.transporterId).toBe(t1!.id);
  });

  it('gates in with no camera read at all (plate typed), logged', async () => {
    const res = await gateIn({ plate: 'bjr-9102' });
    expect(res.json()).toMatchObject({
      trip: { plate: 'BJR9102' },
      alerts: [{ type: 'LPR_NOT_CONFIRMED', level: 'logged' }],
    });
  });
});

describe('alerts at gate in (never blocks)', () => {
  it('watchlisted plate: red shown before tapping, recorded, supervisor told', async () => {
    await see('BQL 1187');
    const state = await entry();
    expect(state.read.alerts).toMatchObject([{ type: 'WATCHLIST_HIT', level: 'red' }]);
    const before = h.notifier.sent.length;
    const res = await gateIn({ plateReadId: state.read.id, plate: 'BQL1187' });
    expect(res.statusCode).toBe(200);
    const sent = h.notifier.sent.slice(before);
    expect(sent).toMatchObject([{ alert: { type: 'WATCHLIST_HIT' }, plate: 'BQL1187' }]);
    const [row] = await h.t.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.tripId, res.json().trip.id), eq(alerts.type, 'WATCHLIST_HIT')));
    expect(row!.notifiedAt).not.toBeNull();
  });

  it('plate already inside: amber, and the truck still gets a trip', async () => {
    const res = await gateIn({ plate: 'BQL1187' });
    expect(res.statusCode).toBe(200);
    expect(res.json().alerts.map((a: { type: string }) => a.type)).toEqual(
      expect.arrayContaining(['WATCHLIST_HIT', 'PLATE_ALREADY_ON_SITE']),
    );
  });
});

describe('cards', () => {
  it('refuses a card already on a trip, so the guard taps another', async () => {
    const cardNo = nextCard();
    expect((await gateIn({ plate: 'WRC6630', cardNo })).statusCode).toBe(200);
    const again = await gateIn({ plate: 'WRC6631', cardNo });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'CARD_IN_USE' });
  });

  it('accepts the card number in NFC format (colons, lower case)', async () => {
    const cardNo = nextCard();
    const nfc = cardNo.toLowerCase().match(/../g)!.join(':');
    const res = await gateIn({ plate: 'WRC6634', cardNo: nfc });
    expect(res.json()).toMatchObject({ cardNo });
  });

  it('refuses an unknown card', async () => {
    const res = await gateIn({ plate: 'WRC6632', cardNo: 'NOT-A-CARD' });
    expect(res.json()).toEqual({ error: 'CARD_UNKNOWN' });
  });

  it('a refused card leaves no half-made trip behind', async () => {
    const count = (await h.t.db.select().from(trips)).length;
    await gateIn({ plate: 'WRC6633', cardNo: 'NOT-A-CARD' });
    expect((await h.t.db.select().from(trips)).length).toBe(count);
  });
});

describe('trip numbers', () => {
  it('count up per site-local day', async () => {
    const all = await h.t.db.select({ tripNo: trips.tripNo }).from(trips);
    const nos = all.map((r) => r.tripNo).sort();
    expect(nos[0]).toBe('T-261021-001');
    expect(nos).toEqual(nos.map((_, i) => `T-261021-${String(i + 1).padStart(3, '0')}`));
  });
});

describe('camera reads', () => {
  it('stops offering a read after 15 minutes', async () => {
    await see('BHE 4092');
    expect((await entry()).read.plate).toBe('BHE4092');
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60_000);
    expect((await entry()).read).toBeNull();
  });

  it('ignores exit camera reads on the entry screen', async () => {
    await see('BHE 4093', 'exit');
    expect((await entry()).read).toBeNull();
  });
});

describe('photos', () => {
  it('gives IC photos a delete-after date (PDPA) and documents none', async () => {
    const ic = (await upload('ic')).json().id;
    const doc = (await upload('document')).json().id;
    const [icRow] = await h.t.db.select().from(photos).where(eq(photos.id, ic));
    const [docRow] = await h.t.db.select().from(photos).where(eq(photos.id, doc));
    expect(icRow!.deleteAfter!.getTime() - icRow!.takenAt.getTime()).toBe(90 * 86_400_000);
    expect(docRow!.deleteAfter).toBeNull();
  });

  it('rejects SVG and non-image uploads', async () => {
    expect((await upload('ic', 'image/svg+xml')).statusCode).toBe(415);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/photos?kind=ic',
      headers: { cookie: guard, 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(res.statusCode).toBe(415);
  });

  it('serves a photo only to signed-in users, sandboxed', async () => {
    const id = (await upload('document')).json().id;
    expect((await h.app.inject(`/api/photos/${id}`)).statusCode).toBe(401);
    const res = await h.app.inject({ url: `/api/photos/${id}`, headers: { cookie: guard } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });
});

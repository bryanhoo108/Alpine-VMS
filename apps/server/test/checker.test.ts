import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, auditLog, checkerDecisions, photos } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { refreshSdoCache } from '../src/services/sdoCache.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let clerk: string;
let checker: string;
let card = 20;
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

const get = (url: string, cookie = checker) => h.app.inject({ url, headers: { cookie } });
const post = (url: string, payload: object, cookie = checker) =>
  h.app.inject({ method: 'POST', url, headers: { cookie }, payload });

interface View {
  id: string;
  offline: boolean;
  sdos: {
    sdoNo: string;
    version: string;
    changed: boolean;
    changes: unknown[];
    lines: { lineNo: number; pieces: number }[];
  }[];
  lastDecision: { decision: string } | null;
}
const view = async (tripId: string) => (await get(`/api/checker/trips/${tripId}`)).json() as View;

/** Decision body ticking every line as expected, with optional changes. */
function body(
  v: View,
  o: {
    decision?: 'approve' | 'reject';
    reason?: string | null;
    pieces?: Record<string, number>;
    photoIds?: string[];
  } = {},
) {
  return {
    decision: o.decision ?? 'approve',
    reason: o.reason ?? null,
    versions: Object.fromEntries(v.sdos.map((s) => [s.sdoNo, s.version])),
    lines: v.sdos.flatMap((s) =>
      s.lines.map((l) => ({
        sdoNo: s.sdoNo,
        lineNo: l.lineNo,
        actualPieces: o.pieces?.[`${s.sdoNo}#${l.lineNo}`] ?? l.pieces,
      })),
    ),
    photoIds: o.photoIds ?? [],
  };
}

async function linkedTruck(plate: string, sdoNos: string[]) {
  const { trip } = await gateInTruck(h, guard, { plate, cardNo: nextCard() });
  if (sdoNos.length) {
    await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos },
    });
  }
  return trip;
}

describe('access', () => {
  it('is for checkers and supervisors', async () => {
    expect((await get('/api/checker/queue', guard)).statusCode).toBe(403);
    expect((await get('/api/checker/queue', clerk)).statusCode).toBe(403);
    expect((await get('/api/checker/queue')).statusCode).toBe(200);
  });
});

describe('waiting list and card tap', () => {
  it('lists outbound trucks with SDOs that are not approved yet', async () => {
    const pre = await gateInTruck(h, guard, { plate: 'WXY1234', cardNo: nextCard() }); // pre-registered 5005
    const unmatched = await linkedTruck('BJR9102', []);
    const coil = await gateInTruck(h, guard, {
      plate: 'VBA5521',
      cardNo: nextCard(),
      type: 'inbound',
    });
    const ids = (await get('/api/checker/queue')).json().map((q: { id: string }) => q.id);
    expect(ids).toContain(pre.trip.id);
    expect(ids).not.toContain(unmatched.id);
    expect(ids).not.toContain(coil.trip.id);
  });

  it('opens the truck from its card, in NFC format too', async () => {
    const cardNo = nextCard();
    const { trip } = await gateInTruck(h, guard, { plate: 'WVT3388', cardNo });
    const nfc = cardNo.toLowerCase().match(/../g)!.join(':');
    expect((await get(`/api/checker/card/${encodeURIComponent(nfc)}`)).json()).toEqual({
      tripId: trip.id,
    });
    expect((await get(`/api/checker/card/${sampleCardNo(59)}`)).statusCode).toBe(404); // free card
  });
});

describe('checking a load', () => {
  it('shows the latest SDO lines read live from SAP', async () => {
    const trip = await linkedTruck('BPN2046', ['5009', '5010']);
    const v = await view(trip.id);
    expect(v.offline).toBe(false);
    expect(v.sdos.map((s) => s.sdoNo)).toEqual(['5009', '5010']);
    expect(v.sdos[0]!.lines.map((l) => l.pieces)).toEqual([24, 30]);
    expect(v.lastDecision).toBeNull();
  });

  it('approves with every line ticked: recorded, audited, off the waiting list', async () => {
    const trip = await linkedTruck('BKA4321', ['5006']);
    const v = await view(trip.id);
    const res = await post(`/api/checker/trips/${trip.id}/decision`, body(v));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ decision: 'approve', differences: [] });
    const [d] = await h.t.db
      .select()
      .from(checkerDecisions)
      .where(eq(checkerDecisions.tripId, trip.id));
    expect(d).toMatchObject({
      decision: 'approve',
      reason: null,
      lineChecks: [{ sdoNo: '5006', expectedPieces: 500, actualPieces: 500, ok: true }],
    });
    const ids = (await get('/api/checker/queue')).json().map((q: { id: string }) => q.id);
    expect(ids).not.toContain(trip.id);
    const log = await h.t.db.select().from(auditLog).where(eq(auditLog.entityId, trip.id));
    expect(log.map((l) => l.action)).toContain('checker_approve');
    const office = (
      await h.app.inject({ url: '/api/clerk/trips', headers: { cookie: clerk } })
    ).json();
    expect(office.find((t: { id: string }) => t.id === trip.id).stage.checked).toBe('approve');
  });

  it('approves a part load (split delivery) and records the difference', async () => {
    const trip = await linkedTruck('BMK7711', ['5010']);
    const v = await view(trip.id);
    const res = await post(
      `/api/checker/trips/${trip.id}/decision`,
      body(v, { pieces: { '5010#0': 400 } }),
    );
    expect(res.json()).toMatchObject({
      decision: 'approve',
      differences: [{ sdoNo: '5010', lineNo: 0, expectedPieces: 800, actualPieces: 400 }],
    });
  });

  it('rejects with a reason: red alert to supervisor and logistics, truck back on the list', async () => {
    const trip = await linkedTruck('WRC6630', ['5008']);
    const v = await view(trip.id);
    expect(
      (
        await post(`/api/checker/trips/${trip.id}/decision`, body(v, { decision: 'reject' }))
      ).json(),
    ).toEqual({
      error: 'REASON_REQUIRED',
    });
    const before = h.notifier.sent.length;
    const res = await post(
      `/api/checker/trips/${trip.id}/decision`,
      body(v, { decision: 'reject', reason: 'damaged' }),
    );
    expect(res.json()).toMatchObject({ decision: 'reject' });
    expect(h.notifier.sent.slice(before)).toMatchObject([
      {
        alert: {
          type: 'CHECKER_REJECTED',
          level: 'red',
          notify: ['supervisor', 'logistics'],
          detail: { reason: 'damaged' },
        },
      },
    ]);
    const q = (await get('/api/checker/queue'))
      .json()
      .find((x: { id: string }) => x.id === trip.id);
    expect(q).toMatchObject({ lastDecision: 'reject' });

    // Re-loaded and checked again: the latest decision counts.
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await post(`/api/checker/trips/${trip.id}/decision`, body(await view(trip.id)));
    expect((await view(trip.id)).lastDecision).toMatchObject({ decision: 'approve' });
  });

  it('refuses a reason on approve, a missing line, and an unknown reason', async () => {
    const trip = await linkedTruck('WRC6631', ['5012']);
    const v = await view(trip.id);
    expect(
      (await post(`/api/checker/trips/${trip.id}/decision`, body(v, { reason: 'damaged' })))
        .statusCode,
    ).toBe(400);
    const short = body(v);
    short.lines.pop();
    expect((await post(`/api/checker/trips/${trip.id}/decision`, short)).json()).toEqual({
      error: 'LINE_MISSING',
    });
    expect(
      (
        await post(
          `/api/checker/trips/${trip.id}/decision`,
          body(v, { decision: 'reject', reason: 'bored' }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it('attaches load photos to the decision', async () => {
    const trip = await linkedTruck('WRC6632', ['5013']);
    const up = await h.app.inject({
      method: 'POST',
      url: '/api/photos?kind=load',
      headers: { cookie: checker, 'content-type': 'image/jpeg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]),
    });
    const photoId = up.json().id;
    const res = await post(
      `/api/checker/trips/${trip.id}/decision`,
      body(await view(trip.id), { photoIds: [photoId] }),
    );
    const [p] = await h.t.db.select().from(photos).where(eq(photos.id, photoId));
    expect(p).toMatchObject({ tripId: trip.id, kind: 'load' });
    expect(p!.checkerDecisionId).not.toBeNull();
    expect(res.statusCode).toBe(200);
  });

  it('refuses inbound coil trucks', async () => {
    const coil = await gateInTruck(h, guard, {
      plate: 'BHE4092',
      cardNo: nextCard(),
      type: 'inbound',
    });
    expect((await get(`/api/checker/trips/${coil.trip.id}`)).json()).toEqual({
      error: 'NOT_OUTBOUND',
    });
  });
});

describe('SDO amended after gate in', () => {
  it('shows "changed" with the line that moved, records an amber alert once, tells nobody', async () => {
    const trip = await linkedTruck('BQA7701', ['5004']);
    h.clock.now = new Date(h.clock.now.getTime() + 3_600_000);
    h.sap.amendSdoLine('5004', 0, { pieces: 30 });
    const before = h.notifier.sent.length;

    const v = await view(trip.id); // live read sees the amendment at once
    expect(v.sdos[0]).toMatchObject({
      changed: true,
      lines: [{ pieces: 30 }],
      changes: [{ lineNo: 0, change: 'changed', before: { pieces: 40 }, after: { pieces: 30 } }],
    });
    await view(trip.id);
    const found = await h.t.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.tripId, trip.id), eq(alerts.type, 'SDO_CHANGED')));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: 'amber', notify: [] });
    expect(h.notifier.sent.length).toBe(before);
  });

  it('a pre-registered SDO is versioned at gate in, so an amendment is caught', async () => {
    // BPN 2045 pre-registered with 5009 + 5010 (seed); SDO cache already holds them.
    const sap = h.sap;
    const { trip } = await gateInTruck(h, guard, { plate: 'BPN2045', cardNo: nextCard() });
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    sap.amendSdoLine('5009', 1, { pieces: 10 });
    const v = await view(trip.id);
    expect(v.sdos.find((s) => s.sdoNo === '5009')).toMatchObject({ changed: true });
  });

  it('refuses a decision on a version the checker did not see', async () => {
    const trip = await linkedTruck('BQA7702', ['5011']);
    const v = await view(trip.id);
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    h.sap.amendSdoLine('5011', 0, { pieces: 90 });
    await refreshSdoCache(h.deps, h.site, { full: false });
    const res = await post(`/api/checker/trips/${trip.id}/decision`, body(v));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'SDO_CHANGED_AGAIN' });
  });
});

describe('SAP down', () => {
  it('shows the cached SDO lines and says so', async () => {
    const trip = await linkedTruck('BQA7703', ['5007']);
    h.sap.setOffline(true);
    const v = await view(trip.id);
    h.sap.setOffline(false);
    expect(v.offline).toBe(true);
    expect(v.sdos[0]!.lines.map((l) => l.pieces)).toEqual([60, 60]);
  });
});

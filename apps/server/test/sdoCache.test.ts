import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sdoCache, sdoLines, tripSdos } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { refreshSdoCache } from '../src/services/sdoCache.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
let clerk: string;
beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
  clerk = await h.login('clerk');
});
afterAll(async () => h?.close());

const cached = async (sdoNo: string) =>
  (
    await h.t.db
      .select()
      .from(sdoCache)
      .where(and(eq(sdoCache.siteId, h.site.id), eq(sdoCache.sdoNo, sdoNo)))
  )[0];

describe('SDO cache', () => {
  it('holds every open SDO with its lines after a full refresh', async () => {
    const rows = await h.t.db.select().from(sdoCache).where(eq(sdoCache.status, 'open'));
    expect(rows).toHaveLength(14);
    expect(await cached('5014')).toBeUndefined(); // closed in SAP: never cached
    const lines = await h.t.db.select().from(sdoLines).where(eq(sdoLines.sdoNo, '5012'));
    expect(lines.map((l) => l.pieces)).toEqual([150, 100, 100]);
  });

  it('fills the version on SDOs linked before they were cached', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'WXY1234', cardNo: sampleCardNo(1) });
    await h.t.db
      .update(tripSdos)
      .set({ sdoVersionAtLink: null })
      .where(eq(tripSdos.tripId, trip.id));
    await refreshSdoCache(h.deps, h.site, { full: false });
    const [link] = await h.t.db.select().from(tripSdos).where(eq(tripSdos.tripId, trip.id));
    expect(link!.sdoVersionAtLink).toBe((await cached('5005'))!.version);
  });

  it('picks up an amended SDO on an incremental refresh and the clerk sees "changed"', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'BKA4321', cardNo: sampleCardNo(2) });
    await h.app.inject({
      method: 'POST',
      url: `/api/clerk/trips/${trip.id}/sdos`,
      headers: { cookie: clerk },
      payload: { sdoNos: ['5004'] },
    });
    h.clock.now = new Date(h.clock.now.getTime() + 3_600_000);
    h.sap.amendSdoLine('5004', 0, { pieces: 30 });
    const r = await refreshSdoCache(h.deps, h.site, { full: false });
    expect(r.updated).toBeGreaterThanOrEqual(1); // the overlap may re-read the newest one too
    const detail = (
      await h.app.inject({ url: `/api/clerk/trips/${trip.id}`, headers: { cookie: clerk } })
    ).json();
    expect(detail.sdos).toMatchObject([{ sdoNo: '5004', changed: true, lines: [{ pieces: 30 }] }]);
  });

  it('marks SDOs SAP has closed on a full refresh', async () => {
    h.sap.setSdoStatus('5015', 'closed');
    const r = await refreshSdoCache(h.deps, h.site, { full: true });
    expect(r.closed).toBe(1);
    expect((await cached('5015'))!.status).toBe('closed');
  });

  it('keeps the cache when SAP is down (refresh throws, data stays)', async () => {
    h.sap.setOffline(true);
    await expect(refreshSdoCache(h.deps, h.site, { full: true })).rejects.toThrow();
    h.sap.setOffline(false);
    expect((await cached('5001'))!.status).toBe('open');
  });
});

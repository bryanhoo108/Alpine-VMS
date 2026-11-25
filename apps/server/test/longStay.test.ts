import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCardNo } from '../src/db/seed.js';
import { checkLongStays } from '../src/services/longStay.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

// Decision G4: amber after 2 h inside, red after 4 h; one alert per level.
let h: TestApp;
let guard: string;
let sup: string;
const start = new Date('2026-10-21T02:00:00Z');
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

beforeAll(async () => {
  h = await createTestApp(start);
  guard = await h.login('guard.entry');
  sup = await h.login('supervisor');
});
afterAll(async () => h?.close());

const overviewRow = async (tripId: string) => {
  const o = (
    await h.app.inject({ method: 'GET', url: '/api/overview', headers: { cookie: sup } })
  ).json();
  return { row: o.inside.find((t: { id: string }) => t.id === tripId), limits: o.longStay };
};
const longStayAlerts = async () =>
  (await h.app.inject({ method: 'GET', url: '/api/alerts', headers: { cookie: sup } }))
    .json()
    .filter((a: { type: string }) => a.type.startsWith('LONG_STAY'));

describe('long stay', () => {
  it('flags a truck amber after 2 h and red after 4 h, alerting once per level', async () => {
    const { trip } = await gateInTruck(h, guard, { plate: 'VLS 3301', cardNo: sampleCardNo(11) });

    h.clock.now = at(60);
    expect(await checkLongStays(h.deps, h.site)).toBe(0);
    let o = await overviewRow(trip.id);
    expect(o.row.stay).toBe('ok');
    expect(o.limits).toEqual({ amberMinutes: 120, redMinutes: 240 });

    h.clock.now = at(125);
    expect(await checkLongStays(h.deps, h.site)).toBe(1);
    expect(await checkLongStays(h.deps, h.site)).toBe(0); // once only
    o = await overviewRow(trip.id);
    expect(o.row.stay).toBe('amber');

    h.clock.now = at(245);
    expect(await checkLongStays(h.deps, h.site)).toBe(1);
    expect((await overviewRow(trip.id)).row.stay).toBe('red');

    const raised = await longStayAlerts();
    expect(raised.map((a: { type: string }) => a.type).sort()).toEqual([
      'LONG_STAY',
      'LONG_STAY_RED',
    ]);
    expect(h.notifier.sent.some((n) => n.alert.type === 'LONG_STAY_RED')).toBe(true);
  });
});

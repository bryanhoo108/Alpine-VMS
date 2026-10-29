import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoContext } from '../src/demo/actions.js';
import { AUTOPLAY_PREFIX, AutoPlay } from '../src/demo/autoplay.js';
import { trips, visits } from '../src/db/schema.js';
import { FileStore } from '../src/files.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let supervisor: string;
beforeAll(async () => {
  h = await createTestApp(undefined, {}, { realClock: true });
  supervisor = await h.login('supervisor');
});
afterAll(async () => h?.close());

const get = async (url: string) =>
  (await h.app.inject({ url, headers: { cookie: supervisor } })).json();
const tripId = async (plate: string) =>
  (await h.t.db.select({ id: trips.id }).from(trips).where(eq(trips.plateIn, plate)))[0]!.id;

interface Inside {
  plate: string;
  stage: string;
  level: string;
  reasons: string[];
  openAlert: string | null;
}

describe('demo day', () => {
  it('is only for the supervisor', async () => {
    const clerk = await h.login('clerk');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/reset',
      headers: { cookie: clerk },
    });
    expect(res.statusCode).toBe(403);
  });

  it('builds 6 trucks that left and 9 inside, each in a different situation', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/reset',
      headers: { cookie: supervisor },
    });
    expect(res.statusCode).toBe(200);
    const o = await get('/api/overview');
    expect(o.today).toMatchObject({
      in: 15,
      out: 6,
      inside: 9,
      exits: { green: 3, amber: 2, red: 1 },
    });
    expect(o.today.avgMinutesInside).toBeGreaterThan(30);

    const by = (plate: string) =>
      (o.inside as Inside[]).find((t) => t.plate === plate.replace(' ', ''))!;
    expect(by('BMK 7711')).toMatchObject({ stage: 'Ready to go', level: 'green' });
    expect(by('BQA 7701')).toMatchObject({ stage: 'Waiting check' });
    expect(by('VBA 5530')).toMatchObject({ stage: 'Waiting weigh-out' });
    expect(by('WRC 6650')).toMatchObject({ stage: 'Not matched', level: 'red' });
    expect(by('BKA 7788')).toMatchObject({ stage: 'Waiting check' });
    expect(by('BKA 7788').reasons).toContain('Plate differs');
    expect(by('BPN 3301')).toMatchObject({ stage: 'Rejected', openAlert: 'red' });
    expect(by('BJR 4410')).toMatchObject({ stage: 'Waiting weigh-in' });
    expect(by('BQL 1187')).toMatchObject({ openAlert: 'red' });

    // SAP and CWIS have caught up; the presenter's pre-registrations are still open.
    expect(o.integrations).toMatchObject({ sapWaiting: 0, cwisWaiting: 0 });
    const pre = await get('/api/clerk/pre-registrations');
    expect(
      pre.filter((p: { status: string }) => p.status === 'expected' || p.status === 'late'),
    ).toHaveLength(3);
  });

  it('spreads the day over the past hours, so the timeline reads like a real day', async () => {
    const t = await get(`/api/trips/${await tripId('BKA4321')}/timeline`);
    const kinds = t.events.map((e: { kind: string }) => e.kind);
    for (const k of [
      'gate_in',
      'sdo',
      'cwis',
      'weigh_in',
      'do',
      'sap',
      'check',
      'weigh_out',
      'gate_out',
    ]) {
      expect(kinds).toContain(k);
    }
    expect(kinds[0]).toBe('gate_in');
    expect(kinds.at(-1)).toBe('gate_out');
    const minutesAgo = (Date.now() - new Date(t.events[0].at).getTime()) / 60_000;
    expect(minutesAgo).toBeGreaterThan(300);
    expect(t.events.find((e: { kind: string }) => e.kind === 'check').actor).toBe('Checker 1');
  });

  it('has visitor and contractor groups: 3 inside (9 people), 2 that left', async () => {
    const people = await get('/api/people');
    expect(people.headcount).toEqual({
      total: 18,
      truckDrivers: 9,
      visitors: 4,
      contractors: 5,
    });
    const rows = await h.t.db.select().from(visits);
    const left = rows.filter((v) => v.status === 'closed');
    expect(left.map((v) => [v.name, v.exitLevel]).sort()).toEqual([
      ['Pump Service Lead', 'amber'],
      ['Supplier Delta Rep', 'green'],
    ]);
    const walkIn = rows.find((v) => v.name === 'Walk-in Salesman')!;
    expect(walkIn.hostConfirmed).toBe(false);
    // The presenter's sample invites are still free.
    const invites = await get('/api/invites');
    const free = invites.filter((i: { code: string; insideVisitId: string | null }) =>
      ['DEMV2345', 'DEMC6789'].includes(i.code),
    );
    expect(free.map((i: { insideVisitId: string | null }) => i.insideVisitId)).toEqual([
      null,
      null,
    ]);
  });

  it('timeline shows the problems of the red exit', async () => {
    const t = await get(`/api/trips/${await tripId('WRC6630')}/timeline`);
    const last = t.events.at(-1);
    expect(last).toMatchObject({ kind: 'gate_out', tone: 'bad' });
    expect(last.detail).toContain('card NOT returned');
    expect(
      t.events
        .filter((e: { kind: string }) => e.kind === 'alert')
        .map((e: { title: string }) => e.title),
    ).toEqual(expect.arrayContaining(['Alert: No check', 'Alert: No DO', 'Alert: No card']));
  });

  it('leaves the shared-SDO DO for the clerk', async () => {
    const d = await get(`/api/clerk/trips/${await tripId('BJR4410')}`);
    expect(d.dos.candidates.map((c: { reason: string }) => c.reason)).toContain('needs_clerk');
  });

  it('lists the trucks that left today for the clerk', async () => {
    const left = await get('/api/clerk/trips?scope=left_today');
    expect(left).toHaveLength(6);
    expect(left.map((t: { exitLevel: string }) => t.exitLevel).sort()).toEqual([
      'amber',
      'amber',
      'green',
      'green',
      'green',
      'red',
    ]);
  });

  it('can be rebuilt again, the same each time, and users still sign in', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/reset',
      headers: { cookie: supervisor },
    });
    const o = await get('/api/overview');
    expect(o.today).toMatchObject({ in: 15, out: 6, inside: 9 });
    expect(await h.login('guard.entry')).toContain('vms_session=');
  });
});

describe('auto-play', () => {
  it('moves only its own trucks through every step until they leave', async () => {
    const ctx = {
      ...h.deps,
      site: h.site,
      files: new FileStore(h.deps.config.filesDir),
      adapterConfig: { sap: 'mock', cwis: 'mock', lpr: 'mock', notifier: 'log' },
      jobRunner: null,
      autoplay: null,
      mocks: { sap: h.sap, cwis: h.cwis, lpr: h.adapters.mocks.lpr! },
    } as unknown as DemoContext;
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const play = new AutoPlay(ctx, 1e9, random);

    const before = (await get('/api/overview')).inside as Inside[];
    const did: string[] = [];
    for (let i = 0; i < 80; i++) did.push(await play.step());

    expect(did.some((d) => d.endsWith('arrived'))).toBe(true);
    expect(did.some((d) => d.endsWith('left'))).toBe(true);
    const gone = await h.t.db
      .select()
      .from(trips)
      .where(like(trips.plateIn, `${AUTOPLAY_PREFIX}%`));
    expect(gone.some((t) => t.status === 'closed')).toBe(true);

    // The demo day's trucks are exactly where they were.
    const after = ((await get('/api/overview')).inside as Inside[]).filter(
      (t) => !t.plate.startsWith(AUTOPLAY_PREFIX),
    );
    expect(after.map((t) => `${t.plate}:${t.stage}`).sort()).toEqual(
      before.map((t) => `${t.plate}:${t.stage}`).sort(),
    );
    // 80 steps through the real services; slower when other test files share the CPU.
  }, 30_000);

  it('is switched on and off by the supervisor', async () => {
    const on = await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/autoplay',
      headers: { cookie: supervisor },
      payload: { on: true },
    });
    expect(on.json()).toEqual({ autoplay: true, speed: 1 });
    expect((await get('/api/dev')).autoplay).toBe(true);
    const fast = await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/autoplay',
      headers: { cookie: supervisor },
      payload: { on: true, speed: 10 },
    });
    expect(fast.json()).toEqual({ autoplay: true, speed: 10 });
    expect((await get('/api/dev')).autoplaySpeed).toBe(10);
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/autoplay',
      headers: { cookie: supervisor },
      payload: { on: true, speed: 50 },
    });
    expect(bad.statusCode).toBe(400);
    const off = await h.app.inject({
      method: 'POST',
      url: '/api/dev/demo/autoplay',
      headers: { cookie: supervisor },
      payload: { on: false },
    });
    expect(off.json()).toEqual({ autoplay: false, speed: 10 });
  });
});

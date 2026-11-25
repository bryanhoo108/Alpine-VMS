import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCardNo } from '../src/db/seed.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

// DO_TRACKING=off: DOs are handled in SAP separately, so the VMS does not wait for them.
let h: TestApp;
let guard: string;
let clerk: string;
let checker: string;

beforeAll(async () => {
  h = await createTestApp(undefined, { DO_TRACKING: 'off' });
  guard = await h.login('guard.entry');
  clerk = await h.login('clerk');
  checker = await h.login('checker1');
});
afterAll(async () => h?.close());

const inject = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
  h.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe('DO tracking off', () => {
  it('a checked truck with its SDO exits green without any DO; screens are told to hide DOs', async () => {
    const me = (await inject('GET', '/api/auth/me', clerk)).json();
    expect(me.doTracking).toBe(false);

    const { trip } = await gateInTruck(h, guard, { plate: 'VDO 1001', cardNo: sampleCardNo(5) });
    await inject('POST', `/api/clerk/trips/${trip.id}/sdos`, clerk, { sdoNos: ['PL26110634'] });
    const v = (await inject('GET', `/api/checker/trips/${trip.id}`, checker)).json();
    await inject('POST', `/api/checker/trips/${trip.id}/decision`, checker, {
      decision: 'approve',
      reason: null,
      versions: Object.fromEntries(
        v.sdos.map((s: { sdoNo: string; version: string }) => [s.sdoNo, s.version]),
      ),
      lines: v.sdos.flatMap((s: { sdoNo: string; lines: { lineNo: number; expected: number }[] }) =>
        s.lines.map((l) => ({ sdoNo: s.sdoNo, lineNo: l.lineNo, actualPieces: l.expected })),
      ),
      photoIds: [],
    });

    const exit = (await inject('GET', `/api/gate/exit/trips/${trip.id}`, guard)).json();
    expect(exit.status).toEqual({ level: 'green', reasons: [] });

    const overview = (await inject('GET', '/api/overview', clerk)).json();
    const inside = overview.inside.find((t: { id: string }) => t.id === trip.id);
    expect(inside.stage).toBe('Waiting weigh-in');
    expect(overview.stages['Waiting DO']).toBe(0);
  });
});

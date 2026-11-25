import { selectDosForTrip, sdoVersion } from '@vms/domain';
import { describe, expect, it } from 'vitest';
import {
  MockCwisAdapter,
  MockLprAdapter,
  MockSapAdapter,
  adapterConfigFromEnv,
  createAdapters,
} from '../src/index.js';
import { cwisContract } from './contract/cwis.contract.js';
import { lprContract } from './contract/lpr.contract.js';
import { sapContract } from './contract/sap.contract.js';

const NOW = new Date('2026-10-21T10:00:00+08:00');
let clock = NOW;
const now = () => clock;

sapContract('mock', async () => ({ adapter: new MockSapAdapter({ now }), testDoNo: '8001' }));
cwisContract('mock', async () => {
  const cwis = new MockCwisAdapter({ now });
  cwis.weighIn({ plate: 'WVT 3388', sdoNos: ['PL26110612', 'PL26110634'] });
  return cwis;
});
lprContract('mock', async () => ({
  adapter: new MockLprAdapter({ now }),
  webhookBody: (plate) => ({ plate, confidence: 0.9 }),
}));

describe('MockSapAdapter sample scenarios', () => {
  it('never dates sample data in the future, even early in the morning', async () => {
    const early = new Date('2026-10-21T00:30:00+08:00');
    const sap = new MockSapAdapter({ now: () => early });
    for (const s of await sap.listOpenSdos()) {
      expect(s.updatedAt.getTime()).toBeLessThan(early.getTime());
    }
  });

  it('does not list the closed SDO', async () => {
    const sap = new MockSapAdapter({ now });
    expect((await sap.listOpenSdos()).map((s) => s.sdoNo)).not.toContain('PL26100401');
    expect((await sap.getSdo('PL26100401'))?.status).toBe('closed');
  });

  it('has a split SDO (PL26090245 → 8001, 8002)', async () => {
    const sap = new MockSapAdapter({ now });
    const dos = await sap.getDosForSdos(['PL26090245']);
    expect(dos.map((d) => d.doNo).sort()).toEqual(['8001', '8002']);
  });

  it('has a combined DO (PL26100318 + PL26100322 → 8003)', async () => {
    const sap = new MockSapAdapter({ now });
    expect((await sap.getDosForSdos(['PL26100318'])).map((d) => d.doNo)).toEqual(['8003']);
    expect((await sap.getDosForSdos(['PL26100322'])).map((d) => d.doNo)).toEqual(['8003']);
  });

  it("yesterday's DOs do not count for a truck that gated in today", async () => {
    const sap = new MockSapAdapter({ now });
    const r = selectDosForTrip({
      tripId: 'T1',
      gateInAt: new Date('2026-10-21T08:00:00+08:00'),
      sdoNos: ['PL26090245'],
      dos: await sap.getDosForSdos(['PL26090245']),
      claims: new Map(),
    });
    expect(r.sdosWithoutDo).toEqual(['PL26090245']);
  });

  it('creates a combined DO from two SDOs with Copy To references', async () => {
    const sap = new MockSapAdapter({ now });
    const d = sap.createDo(['PL26110612', 'PL26110634']);
    expect(d.createdAt).toEqual(NOW);
    expect(d.lines.map((l) => l.baseSdoNo)).toEqual(['PL26110612', 'PL26110612', 'PL26110634']);
    expect((await sap.getDosForSdos(['PL26110634'])).map((x) => x.doNo)).toEqual([d.doNo]);
  });

  it('creates a partial DO (split delivery)', () => {
    const sap = new MockSapAdapter({ now });
    const d = sap.createDo([{ sdoNo: 'PL26110612', lines: [{ lineNo: 1, pieces: 50 }] }]);
    expect(d.lines).toEqual([
      { lineNo: 0, itemCode: 'GI-050-M-6', pieces: 50, baseSdoNo: 'PL26110612', baseLineNo: 1 },
    ]);
  });

  it('amending an SDO changes its update stamp and line version', async () => {
    const sap = new MockSapAdapter({ now });
    const before = (await sap.getSdo('PL26110587'))!;
    clock = new Date(NOW.getTime() + 60_000);
    sap.amendSdoLine('PL26110587', 0, { pieces: 30 });
    const after = (await sap.getSdo('PL26110587'))!;
    clock = NOW;
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(sdoVersion(after.lines)).not.toBe(sdoVersion(before.lines));
  });

  it('returns copies, so callers cannot change SAP data', async () => {
    const sap = new MockSapAdapter({ now });
    const s = (await sap.getSdo('PL26090245'))!;
    s.lines[0]!.pieces = 1;
    expect((await sap.getSdo('PL26090245'))!.lines[0]!.pieces).toBe(400);
  });

  it('fails the next writes on request, then succeeds', async () => {
    const sap = new MockSapAdapter({ now });
    sap.failNextWrites(2);
    await expect(sap.writeDoUdfs('8001', { plate: 'A1' }, 'k')).rejects.toThrow(/unreachable/);
    await expect(sap.writeDoUdfs('8001', { plate: 'A1' }, 'k')).rejects.toThrow();
    await sap.writeDoUdfs('8001', { plate: 'A1' }, 'k');
    expect(sap.udfsOf('8001')).toEqual({ plate: 'A1' });
  });

  it('applies a retried write once and merges UDFs from separate writes', async () => {
    const sap = new MockSapAdapter({ now });
    await sap.writeDoUdfs('8001', { plate: 'A1', wbTicket: 'WB1' }, 'WB1:8001');
    await sap.writeDoUdfs('8001', { plate: 'A1', wbTicket: 'WB1' }, 'WB1:8001');
    await sap.writeDoUdfs('8001', { checkerName: 'Checker 1', checkedAt: NOW }, 'WB1:8001:check');
    expect(sap.appliedWrites).toHaveLength(2);
    expect(sap.udfsOf('8001')).toEqual({
      plate: 'A1',
      wbTicket: 'WB1',
      checkerName: 'Checker 1',
      checkedAt: NOW,
    });
  });

  it('closes an SDO on request', async () => {
    const sap = new MockSapAdapter({ now });
    sap.setSdoStatus('PL26090245', 'closed');
    expect((await sap.listOpenSdos()).map((s) => s.sdoNo)).not.toContain('PL26090245');
  });

  it('resets to fresh sample data', async () => {
    const sap = new MockSapAdapter({ now });
    sap.createDo(['PL26110612']);
    sap.setSdoStatus('PL26090245', 'closed');
    sap.reset();
    expect(await sap.getDosForSdos(['PL26110612'])).toEqual([]);
    expect((await sap.getSdo('PL26090245'))?.status).toBe('open');
  });

  it('can go offline and back', async () => {
    const sap = new MockSapAdapter({ now });
    sap.setOffline(true);
    await expect(sap.listOpenSdos()).rejects.toThrow(/unreachable/);
    sap.setOffline(false);
    await expect(sap.listOpenSdos()).resolves.not.toHaveLength(0);
  });
});

describe('MockCwisAdapter', () => {
  it('keeps several SDOs on one ticket when the operator enters them', () => {
    const cwis = new MockCwisAdapter({ now });
    expect(
      cwis.weighIn({ plate: 'WVT 3388', sdoNos: ['PL26110678', 'PL26110679'] }).sdoNos,
    ).toEqual(['PL26110678', 'PL26110679']);
  });

  it('fills the ticket from the pending truck when the card is tapped (option A)', async () => {
    const cwis = new MockCwisAdapter({ now });
    await cwis.pushPendingTruck({
      tripNo: 'T-261021-001',
      cardNo: '04A1B2C3D40001',
      plate: 'WXY 1234',
      transporterName: 'Transporter One Logistics',
      driverName: null,
      sdoNos: ['PL26110612', 'PL26110634'],
    });
    const t = cwis.weighIn({ plate: 'WXY 1234', cardNo: '04A1B2C3D40001' });
    expect(t).toMatchObject({
      sdoNos: ['PL26110612', 'PL26110634'],
      vmsTripNo: 'T-261021-001',
      transporterName: 'Transporter One Logistics',
      weighOutAt: null,
    });
  });

  it('keeps the plate the operator recorded (mismatch case)', async () => {
    const cwis = new MockCwisAdapter({ now });
    await cwis.pushPendingTruck({
      tripNo: 'T1',
      cardNo: 'C1',
      plate: 'WXY 1234',
      transporterName: null,
      driverName: null,
      sdoNos: ['PL26110612'],
    });
    expect(cwis.weighIn({ plate: 'WXY 1243', cardNo: 'C1' })).toMatchObject({
      plate: 'WXY 1243',
      vmsTripNo: 'T1',
    });
  });

  it('creates an inbound ticket with no SDO, and records weigh-out', async () => {
    const cwis = new MockCwisAdapter({ now });
    const t = cwis.weighIn({ plate: 'BKA 4321' });
    expect(t.sdoNos).toEqual([]);
    clock = new Date(NOW.getTime() + 30 * 60_000);
    const out = cwis.weighOut(t.ticketNo);
    clock = NOW;
    expect(out.weighOutAt?.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    expect(await cwis.listTickets({ updatedSince: NOW })).toHaveLength(1);
  });

  it('updates a pending truck pushed twice instead of duplicating it', async () => {
    const cwis = new MockCwisAdapter({ now });
    const base = {
      tripNo: 'T1',
      cardNo: null,
      plate: 'A1',
      transporterName: null,
      driverName: null,
    };
    await cwis.pushPendingTruck({ ...base, sdoNos: [] });
    await cwis.pushPendingTruck({ ...base, sdoNos: ['PL26090245'] });
    expect(cwis.pendingTrucks()).toEqual([{ ...base, sdoNos: ['PL26090245'] }]);
  });

  it('gives a reused card the newest truck, and a weigh-in uses the pending truck up', async () => {
    const cwis = new MockCwisAdapter({ now });
    const truck = (tripNo: string, plate: string, sdo: string) => ({
      tripNo,
      cardNo: 'C1',
      plate,
      transporterName: null,
      driverName: null,
      sdoNos: [sdo],
    });
    await cwis.pushPendingTruck(truck('T1', 'A1', 'PL26110715'));
    expect(cwis.weighIn({ plate: 'A1', cardNo: 'C1' }).sdoNos).toEqual(['PL26110715']);
    expect(cwis.pendingTrucks()).toEqual([]);

    // T2 never weighed in; T3 got the same card later.
    await cwis.pushPendingTruck(truck('T2', 'B2', 'PL26090245'));
    await cwis.pushPendingTruck(truck('T3', 'C3', 'PL26110655'));
    expect(cwis.weighIn({ plate: 'C3', cardNo: 'C1' })).toMatchObject({
      sdoNos: ['PL26110655'],
      vmsTripNo: 'T3',
    });
  });
});

describe('MockLprAdapter', () => {
  it('attaches a generated plate photo by default', async () => {
    const lpr = new MockLprAdapter({ now });
    const e = await lpr.simulate('entry', 'BKA 4321', { confidence: 0.6 });
    expect(e.photo?.contentType).toBe('image/svg+xml');
    expect(e.photo?.data.toString()).toContain('BKA 4321');
    expect(e.confidence).toBe(0.6);
  });

  it('escapes plate text in the photo', async () => {
    const lpr = new MockLprAdapter({ now });
    const e = await lpr.simulate('entry', '<b>');
    expect(e.photo?.data.toString()).not.toContain('<b>');
  });
});

describe('createAdapters', () => {
  it('defaults every adapter to mock', () => {
    expect(adapterConfigFromEnv({})).toMatchObject({ sap: 'mock', cwis: 'mock', lpr: 'mock' });
  });

  it('refuses a real adapter until one exists', () => {
    expect(() => adapterConfigFromEnv({ SAP_ADAPTER: 'servicelayer' })).toThrow(/only "mock"/);
  });

  it('exposes mock controls in mock mode', () => {
    const a = createAdapters({ ...adapterConfigFromEnv({}), now });
    expect(a.mocks.sap).toBe(a.sap);
    expect(a.mocks.cwis).toBe(a.cwis);
  });
});

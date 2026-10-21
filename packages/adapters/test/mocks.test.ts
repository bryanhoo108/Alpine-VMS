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
  cwis.weighIn({ plate: 'BKA 4321', sdoNo: '5005' });
  return cwis;
});
lprContract('mock', async () => ({
  adapter: new MockLprAdapter({ now }),
  webhookBody: (plate) => ({ plate, confidence: 0.9 }),
}));

describe('MockSapAdapter sample scenarios', () => {
  it('does not list the closed SDO', async () => {
    const sap = new MockSapAdapter({ now });
    expect((await sap.listOpenSdos()).map((s) => s.sdoNo)).not.toContain('5014');
    expect((await sap.getSdo('5014'))?.status).toBe('closed');
  });

  it('has a split SDO (5001 → 8001, 8002)', async () => {
    const sap = new MockSapAdapter({ now });
    const dos = await sap.getDosForSdos(['5001']);
    expect(dos.map((d) => d.doNo).sort()).toEqual(['8001', '8002']);
  });

  it('has a combined DO (5002 + 5003 → 8003)', async () => {
    const sap = new MockSapAdapter({ now });
    expect((await sap.getDosForSdos(['5002'])).map((d) => d.doNo)).toEqual(['8003']);
    expect((await sap.getDosForSdos(['5003'])).map((d) => d.doNo)).toEqual(['8003']);
  });

  it("yesterday's DOs do not count for a truck that gated in today", async () => {
    const sap = new MockSapAdapter({ now });
    const r = selectDosForTrip({
      tripId: 'T1',
      gateInAt: new Date('2026-10-21T08:00:00+08:00'),
      sdoNos: ['5001'],
      dos: await sap.getDosForSdos(['5001']),
      claims: new Map(),
    });
    expect(r.sdosWithoutDo).toEqual(['5001']);
  });

  it('creates a combined DO from two SDOs with Copy To references', async () => {
    const sap = new MockSapAdapter({ now });
    const d = sap.createDo(['5005', '5006']);
    expect(d.createdAt).toEqual(NOW);
    expect(d.lines.map((l) => l.baseSdoNo)).toEqual(['5005', '5005', '5006']);
    expect((await sap.getDosForSdos(['5006'])).map((x) => x.doNo)).toEqual([d.doNo]);
  });

  it('creates a partial DO (split delivery)', () => {
    const sap = new MockSapAdapter({ now });
    const d = sap.createDo([{ sdoNo: '5005', lines: [{ lineNo: 1, pieces: 50 }] }]);
    expect(d.lines).toEqual([
      { lineNo: 0, itemCode: 'GI-050-M-6', pieces: 50, baseSdoNo: '5005', baseLineNo: 1 },
    ]);
  });

  it('amending an SDO changes its update stamp and line version', async () => {
    const sap = new MockSapAdapter({ now });
    const before = (await sap.getSdo('5004'))!;
    clock = new Date(NOW.getTime() + 60_000);
    sap.amendSdoLine('5004', 0, { pieces: 30 });
    const after = (await sap.getSdo('5004'))!;
    clock = NOW;
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(sdoVersion(after.lines)).not.toBe(sdoVersion(before.lines));
  });

  it('returns copies, so callers cannot change SAP data', async () => {
    const sap = new MockSapAdapter({ now });
    const s = (await sap.getSdo('5001'))!;
    s.lines[0]!.pieces = 1;
    expect((await sap.getSdo('5001'))!.lines[0]!.pieces).toBe(400);
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

  it('can go offline and back', async () => {
    const sap = new MockSapAdapter({ now });
    sap.setOffline(true);
    await expect(sap.listOpenSdos()).rejects.toThrow(/unreachable/);
    sap.setOffline(false);
    await expect(sap.listOpenSdos()).resolves.not.toHaveLength(0);
  });
});

describe('MockCwisAdapter', () => {
  it('fills the ticket from the pending truck when the card is tapped (option A)', async () => {
    const cwis = new MockCwisAdapter({ now });
    await cwis.pushPendingTruck({
      tripNo: 'T-261021-001',
      cardNo: '04A1B2C3D40001',
      plate: 'WXY 1234',
      transporterName: 'Transporter One Logistics',
      driverName: null,
      sdoNos: ['5005'],
    });
    const t = cwis.weighIn({ plate: 'WXY 1234', cardNo: '04A1B2C3D40001' });
    expect(t).toMatchObject({
      sdoNo: '5005',
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
      sdoNos: ['5005'],
    });
    expect(cwis.weighIn({ plate: 'WXY 1243', cardNo: 'C1' })).toMatchObject({
      plate: 'WXY 1243',
      vmsTripNo: 'T1',
    });
  });

  it('creates an inbound ticket with no SDO, and records weigh-out', async () => {
    const cwis = new MockCwisAdapter({ now });
    const t = cwis.weighIn({ plate: 'BKA 4321' });
    expect(t.sdoNo).toBeNull();
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
    await cwis.pushPendingTruck({ ...base, sdoNos: ['5001'] });
    expect(cwis.pendingTrucks()).toEqual([{ ...base, sdoNos: ['5001'] }]);
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

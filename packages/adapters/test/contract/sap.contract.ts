/**
 * Behaviour every SapAdapter must have. Run against the mock now; run against
 * the real adapter (on a test company database) when it exists.
 */
import { selectDosForTrip } from '@vms/domain';
import { describe, expect, it } from 'vitest';
import type { SapAdapter } from '../../src/index.js';

export interface SapContractFixture {
  adapter: SapAdapter;
  /** A DO that is safe to write test UDFs to. */
  testDoNo: string;
}

export function sapContract(name: string, make: () => Promise<SapContractFixture>) {
  describe(`SapAdapter contract: ${name}`, () => {
    it('lists only open SDOs, each with at least one line', async () => {
      const { adapter } = await make();
      const sdos = await adapter.listOpenSdos();
      expect(sdos.length).toBeGreaterThan(0);
      for (const s of sdos) {
        expect(s.status).toBe('open');
        expect(s.lines.length).toBeGreaterThan(0);
        for (const l of s.lines) expect(l.pieces).toBeGreaterThan(0);
      }
    });

    it('filters by update time', async () => {
      const { adapter } = await make();
      const all = await adapter.listOpenSdos();
      const newest = Math.max(...all.map((s) => s.updatedAt.getTime()));
      expect(await adapter.listOpenSdos({ updatedSince: new Date(newest) })).toEqual([]);
    });

    it('gets one SDO by number, and null for an unknown number', async () => {
      const { adapter } = await make();
      const [first] = await adapter.listOpenSdos();
      expect((await adapter.getSdo(first!.sdoNo))?.sdoNo).toBe(first!.sdoNo);
      expect(await adapter.getSdo('NO-SUCH-SDO')).toBeNull();
    });

    it('returns only DOs copied from the SDOs asked for', async () => {
      const { adapter } = await make();
      const sdoNos = (await adapter.listOpenSdos()).map((s) => s.sdoNo);
      const dos = await adapter.getDosForSdos(sdoNos);
      for (const d of dos) {
        expect(d.lines.some((l) => l.baseSdoNo !== null && sdoNos.includes(l.baseSdoNo))).toBe(
          true,
        );
      }
      expect(await adapter.getDosForSdos([])).toEqual([]);
    });

    it('DOs plug straight into the domain linking rule', async () => {
      const { adapter } = await make();
      const sdoNos = (await adapter.listOpenSdos()).map((s) => s.sdoNo);
      const dos = await adapter.getDosForSdos(sdoNos);
      const r = selectDosForTrip({
        tripId: 'T',
        gateInAt: new Date(0),
        sdoNos,
        dos,
        claims: new Map(),
      });
      expect(r.doNos.sort()).toEqual(dos.map((d) => d.doNo).sort());
    });

    it('lists customers and transporters', async () => {
      const { adapter } = await make();
      const bps = await adapter.listBusinessPartners();
      expect(bps.some((b) => b.type === 'customer')).toBe(true);
      expect(bps.some((b) => b.type === 'transporter')).toBe(true);
    });

    it('accepts a retried UDF write with the same idempotency key', async () => {
      const { adapter, testDoNo } = await make();
      const udfs = { plate: 'WXY1234', wbTicket: 'WB000001' };
      await adapter.writeDoUdfs(testDoNo, udfs, 'WB000001:' + testDoNo);
      await expect(
        adapter.writeDoUdfs(testDoNo, udfs, 'WB000001:' + testDoNo),
      ).resolves.toBeUndefined();
    });
  });
}

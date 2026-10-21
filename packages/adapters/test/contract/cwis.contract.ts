import { describe, expect, it } from 'vitest';
import type { CwisAdapter } from '../../src/index.js';

export function cwisContract(name: string, make: () => Promise<CwisAdapter>) {
  describe(`CwisAdapter contract: ${name}`, () => {
    it('lists tickets with a number and plate', async () => {
      const adapter = await make();
      for (const t of await adapter.listTickets()) {
        expect(t.ticketNo).toMatch(/\S/);
        expect(t.plate).toMatch(/\S/);
        if (t.weighOutAt) expect(t.weighInAt).not.toBeNull();
      }
    });

    it('returns nothing updated after the newest ticket', async () => {
      const adapter = await make();
      const all = await adapter.listTickets();
      const newest = Math.max(0, ...all.map((t) => t.updatedAt.getTime()));
      expect(await adapter.listTickets({ updatedSince: new Date(newest) })).toEqual([]);
    });

    it('accepts the same pending truck twice (update, not duplicate)', async () => {
      const adapter = await make();
      const truck = {
        tripNo: 'T-CONTRACT-1',
        cardNo: null,
        plate: 'WXY1234',
        transporterName: null,
        driverName: null,
        sdoNos: [],
      };
      await adapter.pushPendingTruck(truck);
      await expect(
        adapter.pushPendingTruck({ ...truck, sdoNos: ['5001'] }),
      ).resolves.toBeUndefined();
    });
  });
}

import { describe, expect, it } from 'vitest';
import type { LprAdapter, PlateEvent } from '../../src/index.js';

export interface LprContractFixture {
  adapter: LprAdapter;
  /** A webhook body the camera would send for this plate. */
  webhookBody: (plate: string) => unknown;
}

export function lprContract(name: string, make: () => Promise<LprContractFixture>) {
  describe(`LprAdapter contract: ${name}`, () => {
    it('turns a webhook push into a plate event for the right camera', async () => {
      const { adapter, webhookBody } = await make();
      const events: PlateEvent[] = [];
      adapter.onPlateEvent((e) => void events.push(e));
      await adapter.handleWebhook('exit', webhookBody('WXY 1234'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ camera: 'exit', plateText: 'WXY 1234' });
      expect(events[0]!.confidence).toBeGreaterThanOrEqual(0);
      expect(events[0]!.confidence).toBeLessThanOrEqual(1);
    });

    it('stops delivering after unsubscribe', async () => {
      const { adapter, webhookBody } = await make();
      const events: PlateEvent[] = [];
      const off = adapter.onPlateEvent((e) => void events.push(e));
      off();
      await adapter.handleWebhook('entry', webhookBody('WXY 1234'));
      expect(events).toHaveLength(0);
    });

    it('rejects a body it cannot parse', async () => {
      const { adapter } = await make();
      await expect(adapter.handleWebhook('entry', { nonsense: true })).rejects.toThrow();
    });
  });
}

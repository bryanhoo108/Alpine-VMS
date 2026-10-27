import { describe, expect, it } from 'vitest';
import { gateInAlerts, type GateInCheckInput } from '../src/gateIn.js';

const input = (o: Partial<GateInCheckInput> = {}): GateInCheckInput => ({
  lprPlate: 'WXY 1234',
  confirmedPlate: 'WXY1234',
  transporterId: null,
  platesOnSite: [],
  watchlist: [],
  ...o,
});

const types = (o: Partial<GateInCheckInput>) => gateInAlerts(input(o)).map((x) => x.type);

describe('gateInAlerts', () => {
  it('raises nothing for a confirmed read of a new plate', () => {
    expect(gateInAlerts(input())).toEqual([]);
  });

  it('logs a corrected plate', () => {
    const alerts = gateInAlerts(input({ lprPlate: 'WXY 1284' }));
    expect(alerts.map((a) => a.type)).toEqual(['LPR_CORRECTED']);
    expect(alerts[0]?.level).toBe('logged');
  });

  it('logs a plate entered with no camera read', () => {
    expect(types({ lprPlate: null })).toEqual(['LPR_NOT_CONFIRMED']);
  });

  it('flags amber when the plate is already on site', () => {
    const alerts = gateInAlerts(input({ platesOnSite: ['BKA 1', 'wxy 1234'] }));
    expect(alerts.map((a) => a.type)).toEqual(['PLATE_ALREADY_ON_SITE']);
    expect(alerts[0]?.level).toBe('amber');
    expect(alerts[0]?.notify).toContain('supervisor');
  });

  it('flags red for a watchlisted plate', () => {
    const alerts = gateInAlerts(
      input({ watchlist: [{ kind: 'plate', value: 'wxy-1234', reason: 'Extra pipes found' }] }),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'WATCHLIST_HIT',
      level: 'red',
      detail: { reason: 'Extra pipes found' },
    });
  });

  it('flags red for a watchlisted transporter', () => {
    expect(
      types({
        transporterId: 'TR-9',
        watchlist: [{ kind: 'transporter', value: 'TR-9', reason: 'Unpaid card fees' }],
      }),
    ).toEqual(['WATCHLIST_HIT']);
  });

  it('ignores watchlist entries that do not match', () => {
    expect(
      types({
        transporterId: 'TR-1',
        watchlist: [
          { kind: 'plate', value: 'BKA 1', reason: 'x' },
          { kind: 'transporter', value: 'TR-9', reason: 'y' },
        ],
      }),
    ).toEqual([]);
  });
});

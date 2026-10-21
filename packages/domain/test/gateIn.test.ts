import { describe, expect, it } from 'vitest';
import { gateInAlerts } from '../src/gateIn.js';

const types = (a: ReturnType<typeof gateInAlerts>) => a.map((x) => x.type);

describe('gateInAlerts', () => {
  it('raises nothing for a confirmed read of a new plate', () => {
    expect(
      gateInAlerts({ lprPlate: 'WXY 1234', confirmedPlate: 'WXY1234', platesOnSite: [] }),
    ).toEqual([]);
  });

  it('logs a corrected plate', () => {
    const alerts = gateInAlerts({
      lprPlate: 'WXY 1284',
      confirmedPlate: 'WXY 1234',
      platesOnSite: [],
    });
    expect(types(alerts)).toEqual(['LPR_CORRECTED']);
    expect(alerts[0]?.level).toBe('logged');
  });

  it('logs a plate typed with no camera read', () => {
    expect(
      types(gateInAlerts({ lprPlate: null, confirmedPlate: 'WXY 1234', platesOnSite: [] })),
    ).toEqual(['LPR_NOT_CONFIRMED']);
  });

  it('flags amber when the plate is already on site', () => {
    const alerts = gateInAlerts({
      lprPlate: 'WXY1234',
      confirmedPlate: 'WXY1234',
      platesOnSite: ['BKA 1', 'wxy 1234'],
    });
    expect(types(alerts)).toEqual(['PLATE_ALREADY_ON_SITE']);
    expect(alerts[0]?.level).toBe('amber');
    expect(alerts[0]?.notify).toContain('supervisor');
  });
});

import { describe, expect, it } from 'vitest';
import {
  findPreRegistration,
  openPreRegistrations,
  preRegStatus,
  type PreRegistration,
} from '../src/preRegistration.js';

const TODAY = '2026-10-21';

const pre = (id: string, plate: string, expectedDate: string, o: Partial<PreRegistration> = {}) =>
  ({
    id,
    plate,
    expectedDate,
    sdoNos: ['5001'],
    arrivedTripId: null,
    clearedAt: null,
    ...o,
  }) satisfies PreRegistration;

describe('preRegStatus', () => {
  it('is expected on or before its date', () => {
    expect(preRegStatus(pre('1', 'WXY1234', TODAY), TODAY)).toBe('expected');
    expect(preRegStatus(pre('1', 'WXY1234', '2026-10-22'), TODAY)).toBe('expected');
  });

  it('becomes late after its date and stays until cleared', () => {
    expect(preRegStatus(pre('1', 'WXY1234', '2026-10-20'), TODAY)).toBe('late');
    expect(preRegStatus(pre('1', 'WXY1234', '2026-09-01'), TODAY)).toBe('late');
  });

  it('is arrived once linked to a trip, and cleared when the clerk clears it', () => {
    expect(preRegStatus(pre('1', 'WXY1234', '2026-10-20', { arrivedTripId: 'T1' }), TODAY)).toBe(
      'arrived',
    );
    expect(preRegStatus(pre('1', 'WXY1234', '2026-10-20', { clearedAt: new Date() }), TODAY)).toBe(
      'cleared',
    );
  });
});

describe('findPreRegistration', () => {
  it('matches the plate exactly, ignoring formatting', () => {
    const list = [pre('1', 'WXY 1234', TODAY)];
    expect(findPreRegistration('wxy-1234', list, TODAY)?.id).toBe('1');
  });

  it('does not match a misread plate (guard picks from the list instead)', () => {
    expect(findPreRegistration('WXY 1284', [pre('1', 'WXY 1234', TODAY)], TODAY)).toBeNull();
  });

  it('matches a late pre-registration', () => {
    expect(findPreRegistration('WXY1234', [pre('1', 'WXY1234', '2026-10-19')], TODAY)?.id).toBe(
      '1',
    );
  });

  it('skips arrived and cleared pre-registrations', () => {
    const list = [
      pre('1', 'WXY1234', TODAY, { arrivedTripId: 'T0' }),
      pre('2', 'WXY1234', TODAY, { clearedAt: new Date() }),
    ];
    expect(findPreRegistration('WXY1234', list, TODAY)).toBeNull();
  });

  it('prefers today over late over future when a plate has several', () => {
    const list = [
      pre('future', 'WXY1234', '2026-10-23'),
      pre('late', 'WXY1234', '2026-10-20'),
      pre('today', 'WXY1234', TODAY),
    ];
    expect(findPreRegistration('WXY1234', list, TODAY)?.id).toBe('today');
    expect(findPreRegistration('WXY1234', list.slice(0, 2), TODAY)?.id).toBe('late');
  });

  it('never matches an empty plate', () => {
    expect(findPreRegistration('', [pre('1', '', TODAY)], TODAY)).toBeNull();
  });
});

describe('openPreRegistrations', () => {
  it('lists today first, then late (newest first), then future (soonest first)', () => {
    const list = [
      pre('f2', 'A1', '2026-10-25'),
      pre('l1', 'A2', '2026-10-15'),
      pre('t', 'A3', TODAY),
      pre('f1', 'A4', '2026-10-22'),
      pre('l2', 'A5', '2026-10-20'),
      pre('gone', 'A6', TODAY, { arrivedTripId: 'T9' }),
    ];
    expect(openPreRegistrations(list, TODAY).map((p) => p.id)).toEqual([
      't',
      'l2',
      'l1',
      'f1',
      'f2',
    ]);
  });
});

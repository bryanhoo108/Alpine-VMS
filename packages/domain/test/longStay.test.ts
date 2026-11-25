import { describe, expect, it } from 'vitest';
import { DEFAULT_LONG_STAY, longStayAlertsDue, parseLongStay, stayLevel } from '../src/index.js';

const L = DEFAULT_LONG_STAY;

describe('stayLevel', () => {
  it('is ok under 2 h, amber from 2 h, red from 4 h', () => {
    expect(stayLevel(0, L)).toBe('ok');
    expect(stayLevel(119, L)).toBe('ok');
    expect(stayLevel(120, L)).toBe('amber');
    expect(stayLevel(239, L)).toBe('amber');
    expect(stayLevel(240, L)).toBe('red');
    expect(stayLevel(900, L)).toBe('red');
  });
});

describe('longStayAlertsDue', () => {
  it('raises each level once', () => {
    expect(longStayAlertsDue(60, L, [])).toEqual([]);
    expect(longStayAlertsDue(130, L, [])).toEqual(['LONG_STAY']);
    expect(longStayAlertsDue(130, L, ['LONG_STAY'])).toEqual([]);
    expect(longStayAlertsDue(250, L, ['LONG_STAY'])).toEqual(['LONG_STAY_RED']);
    expect(longStayAlertsDue(300, L, ['LONG_STAY', 'LONG_STAY_RED'])).toEqual([]);
  });

  it('a truck already past red gets only the red alert', () => {
    expect(longStayAlertsDue(250, L, [])).toEqual(['LONG_STAY_RED']);
  });

  it('other alerts on the truck do not count', () => {
    expect(longStayAlertsDue(130, L, ['WATCHLIST_HIT'])).toEqual(['LONG_STAY']);
  });
});

describe('parseLongStay', () => {
  it('reads minutes from settings', () => {
    expect(parseLongStay('90', '180')).toEqual({ amberMinutes: 90, redMinutes: 180 });
  });
  it('falls back to 2 h / 4 h when missing or wrong', () => {
    expect(parseLongStay(undefined, undefined)).toEqual(L);
    expect(parseLongStay('abc', '-5')).toEqual(L);
  });
  it('keeps red after amber', () => {
    expect(parseLongStay('300', '200')).toEqual({ amberMinutes: 300, redMinutes: 600 });
  });
});

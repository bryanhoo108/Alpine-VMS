import { describe, expect, it } from 'vitest';
import { formatPlate, normalizePlate, platesMatch } from '../src/plate.js';

describe('plate', () => {
  it('normalises case, spaces and dashes', () => {
    expect(normalizePlate(' wxy-1234 ')).toBe('WXY1234');
    expect(normalizePlate('WXY 1234')).toBe('WXY1234');
  });

  it('matches plates that differ only in formatting', () => {
    expect(platesMatch('WXY 1234', 'wxy1234')).toBe(true);
    expect(platesMatch('WXY 1234', 'WXY 1235')).toBe(false);
  });

  it('never matches empty plates', () => {
    expect(platesMatch('', '')).toBe(false);
    expect(platesMatch(' - ', '')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatPlate('wxy1234')).toBe('WXY 1234');
    expect(formatPlate('VBA1234A')).toBe('VBA 1234 A');
  });
});

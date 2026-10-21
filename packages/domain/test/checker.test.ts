import { describe, expect, it } from 'vitest';
import { evaluateLineChecks } from '../src/checker.js';

const expected = [
  { sdoNo: '5009', lineNo: 0, pieces: 24 },
  { sdoNo: '5009', lineNo: 1, pieces: 30 },
  { sdoNo: '5010', lineNo: 0, pieces: 800 },
];
const all = (pieces: number[]) =>
  expected.map((e, i) => ({ sdoNo: e.sdoNo, lineNo: e.lineNo, actualPieces: pieces[i]! }));

describe('evaluateLineChecks', () => {
  it('all lines ticked as expected: no differences', () => {
    const r = evaluateLineChecks(expected, all([24, 30, 800]));
    expect(r).toMatchObject({ ok: true, differences: [] });
    if (r.ok) expect(r.lines.every((l) => l.ok)).toBe(true);
  });

  it('records lines whose pieces differ (split delivery or short load), without refusing', () => {
    const r = evaluateLineChecks(expected, all([24, 30, 400]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.differences).toEqual([
        { sdoNo: '5010', lineNo: 0, expectedPieces: 800, actualPieces: 400, ok: false },
      ]);
    }
  });

  it('needs every line checked', () => {
    expect(evaluateLineChecks(expected, all([24, 30, 800]).slice(0, 2))).toMatchObject({
      ok: false,
      error: 'LINE_MISSING',
      sdoNo: '5010',
    });
  });

  it('refuses a line that is not on the SDOs (e.g. SDO changed meanwhile)', () => {
    const r = evaluateLineChecks(expected, [
      ...all([24, 30, 800]),
      { sdoNo: '5009', lineNo: 7, actualPieces: 1 },
    ]);
    expect(r).toMatchObject({ ok: false, error: 'LINE_UNKNOWN', lineNo: 7 });
  });

  it('refuses negative or fractional pieces', () => {
    expect(evaluateLineChecks(expected, all([24, -1, 800]))).toMatchObject({
      ok: false,
      error: 'PIECES_INVALID',
    });
    expect(evaluateLineChecks(expected, all([24, 1.5, 800]))).toMatchObject({
      ok: false,
      error: 'PIECES_INVALID',
    });
  });

  it('zero pieces is a valid count (line not loaded)', () => {
    const r = evaluateLineChecks(expected, all([24, 0, 800]));
    expect(r.ok && r.differences.map((d) => d.actualPieces)).toEqual([0]);
  });
});

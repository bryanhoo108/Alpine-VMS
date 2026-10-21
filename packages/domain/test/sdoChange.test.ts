import { describe, expect, it } from 'vitest';
import { diffSdoLines, sdoVersion, type SdoLine } from '../src/sdoChange.js';

const line = (lineNo: number, pieces: number, o: Partial<SdoLine> = {}): SdoLine => ({
  lineNo,
  itemCode: `GI-${lineNo}`,
  size: '50mm (2")',
  spec: 'BS EN 10255 Medium',
  length: '6m',
  pieces,
  ...o,
});

describe('sdoVersion', () => {
  it('is stable regardless of line order', () => {
    expect(sdoVersion([line(1, 100), line(2, 50)])).toBe(sdoVersion([line(2, 50), line(1, 100)]));
  });

  it('changes when pieces, size, spec or length change', () => {
    const base = sdoVersion([line(1, 100)]);
    expect(sdoVersion([line(1, 120)])).not.toBe(base);
    expect(sdoVersion([line(1, 100, { size: '65mm' })])).not.toBe(base);
    expect(sdoVersion([line(1, 100, { spec: 'BS EN 10255 Heavy' })])).not.toBe(base);
    expect(sdoVersion([line(1, 100, { length: '3m' })])).not.toBe(base);
  });

  it('changes when a line is added or removed', () => {
    const base = sdoVersion([line(1, 100)]);
    expect(sdoVersion([line(1, 100), line(2, 10)])).not.toBe(base);
    expect(sdoVersion([])).not.toBe(base);
  });
});

describe('diffSdoLines', () => {
  it('returns nothing for identical lines', () => {
    expect(diffSdoLines([line(1, 100)], [line(1, 100)])).toEqual([]);
  });

  it('reports changed, added and removed lines in line order', () => {
    const diff = diffSdoLines([line(1, 100), line(2, 50)], [line(1, 80), line(3, 20)]);
    expect(diff.map((d) => [d.lineNo, d.change])).toEqual([
      [1, 'changed'],
      [2, 'removed'],
      [3, 'added'],
    ]);
    expect(diff[0]?.before?.pieces).toBe(100);
    expect(diff[0]?.after?.pieces).toBe(80);
  });
});

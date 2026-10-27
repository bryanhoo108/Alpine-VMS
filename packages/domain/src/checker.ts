/**
 * Checker line checks (docs/SPEC.md "Checker screen detail"): the checker ticks
 * each line or enters the actual pieces. Pieces that differ from the SDO are
 * recorded, not refused: on a split delivery this truck may carry only part
 * of an SDO, so the checker decides (see docs/decisions.md).
 */

export interface ExpectedLine {
  sdoNo: string;
  lineNo: number;
  pieces: number;
}

export interface ActualLine {
  sdoNo: string;
  lineNo: number;
  actualPieces: number;
}

export interface CheckedLine {
  sdoNo: string;
  lineNo: number;
  expectedPieces: number;
  actualPieces: number;
  ok: boolean;
}

export type LineCheckResult =
  | { ok: true; lines: CheckedLine[]; differences: CheckedLine[] }
  | {
      ok: false;
      error: 'LINE_MISSING' | 'LINE_UNKNOWN' | 'PIECES_INVALID';
      sdoNo: string;
      lineNo: number;
    };

const key = (l: { sdoNo: string; lineNo: number }) => `${l.sdoNo}#${l.lineNo}`;

/** Every expected line must be checked exactly once, with a whole, non-negative count. */
export function evaluateLineChecks(
  expected: readonly ExpectedLine[],
  actual: readonly ActualLine[],
): LineCheckResult {
  const given = new Map(actual.map((a) => [key(a), a]));
  const known = new Set(expected.map(key));
  for (const a of actual) {
    if (!known.has(key(a)))
      return { ok: false, error: 'LINE_UNKNOWN', sdoNo: a.sdoNo, lineNo: a.lineNo };
    if (!Number.isInteger(a.actualPieces) || a.actualPieces < 0) {
      return { ok: false, error: 'PIECES_INVALID', sdoNo: a.sdoNo, lineNo: a.lineNo };
    }
  }
  const lines: CheckedLine[] = [];
  for (const e of expected) {
    const a = given.get(key(e));
    if (!a) return { ok: false, error: 'LINE_MISSING', sdoNo: e.sdoNo, lineNo: e.lineNo };
    lines.push({
      sdoNo: e.sdoNo,
      lineNo: e.lineNo,
      expectedPieces: e.pieces,
      actualPieces: a.actualPieces,
      ok: a.actualPieces === e.pieces,
    });
  }
  return { ok: true, lines, differences: lines.filter((l) => !l.ok) };
}

export const REJECT_REASONS = ['wrong_item', 'wrong_quantity', 'damaged', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

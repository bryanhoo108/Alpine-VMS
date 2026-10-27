/**
 * Detect an SDO amended after it was linked to a trip, so the checker sees an
 * amber "SDO changed" tag. SAP's update stamp alone is not enough (it also
 * moves on header-only edits), so the version is a fingerprint of the lines
 * the checker actually checks.
 */

export interface SdoLine {
  lineNo: number;
  itemCode: string;
  size: string;
  spec: string;
  length: string;
  pieces: number;
}

function lineKey(l: SdoLine): string {
  return [l.itemCode, l.size, l.spec, l.length, l.pieces].join('|');
}

/** Stable fingerprint of an SDO's lines (order-independent). */
export function sdoVersion(lines: readonly SdoLine[]): string {
  const text = [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => `${l.lineNo}:${lineKey(l)}`)
    .join('\n');
  // FNV-1a, 32-bit: enough to spot a change, not a security hash.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface SdoLineChange {
  lineNo: number;
  change: 'added' | 'removed' | 'changed';
  before?: SdoLine;
  after?: SdoLine;
}

/** Line-by-line difference, so the checker sees which line moved. */
export function diffSdoLines(
  before: readonly SdoLine[],
  after: readonly SdoLine[],
): SdoLineChange[] {
  const old = new Map(before.map((l) => [l.lineNo, l]));
  const now = new Map(after.map((l) => [l.lineNo, l]));
  const lineNos = [...new Set([...old.keys(), ...now.keys()])].sort((a, b) => a - b);

  const changes: SdoLineChange[] = [];
  for (const lineNo of lineNos) {
    const b = old.get(lineNo);
    const a = now.get(lineNo);
    if (b && !a) changes.push({ lineNo, change: 'removed', before: b });
    else if (!b && a) changes.push({ lineNo, change: 'added', after: a });
    else if (b && a && lineKey(b) !== lineKey(a))
      changes.push({ lineNo, change: 'changed', before: b, after: a });
  }
  return changes;
}

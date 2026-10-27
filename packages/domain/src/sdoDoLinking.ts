/**
 * SDO → DO linking.
 *
 * In SAP B1, "Copy To" from an SDO to a DO stores the source document on each
 * DO line (base document and base line). The link is read from those line
 * references, which covers:
 *   - split: one SDO delivered by several DOs
 *   - combined: one DO carrying lines from several SDOs
 */

export interface DoLine {
  lineNo: number;
  /** SDO the line was copied from, or null for a line added by hand. */
  baseSdoNo: string | null;
  baseLineNo: number | null;
}

export interface DeliveryOrder {
  doNo: string;
  createdAt: Date;
  lines: readonly DoLine[];
}

/** SDOs a DO was copied from, in first-seen order. */
export function sdosOfDo(d: DeliveryOrder): string[] {
  const seen = new Set<string>();
  for (const line of d.lines) {
    if (line.baseSdoNo !== null) seen.add(line.baseSdoNo);
  }
  return [...seen];
}

export interface DoSelectionInput {
  tripId: string;
  gateInAt: Date;
  /** SDOs the clerk linked to this trip. */
  sdoNos: readonly string[];
  /** Candidate DOs from SAP (any DO copied from one of the trip's SDOs). */
  dos: readonly DeliveryOrder[];
  /** DOs already claimed by trips, doNo → tripId. */
  claims: ReadonlyMap<string, string>;
  /** DOs the clerk linked or unlinked by hand for this trip. */
  manualLinks?: readonly string[];
  manualUnlinks?: readonly string[];
}

export interface DoSelection {
  /** DOs that belong to this trip. */
  doNos: string[];
  /** For each linked SDO, the DOs on this trip copied from it. */
  bySdo: Record<string, string[]>;
  /** Linked SDOs with no DO on this trip yet. */
  sdosWithoutDo: string[];
  /**
   * SDOs carried by this trip's DOs that are not linked to the trip
   * (combined DO). Shown to the clerk as "link this SDO too?".
   */
  unlinkedSdosOnDos: string[];
}

/**
 * Pick the DOs that belong to one truck trip.
 *
 * One SDO can ship on several trucks, so not every DO of the SDO is this
 * truck's. A DO counts for the trip when it references one of the trip's SDOs,
 * was created at or after gate in, and is not claimed by another trip.
 * The clerk's manual links and unlinks override that rule.
 * (Provisional rule, see docs/decisions.md Q3.)
 */
export function selectDosForTrip(input: DoSelectionInput): DoSelection {
  const tripSdos = new Set(input.sdoNos);
  const manualLinks = new Set(input.manualLinks ?? []);
  const manualUnlinks = new Set(input.manualUnlinks ?? []);

  const chosen = input.dos.filter((d) => {
    if (manualUnlinks.has(d.doNo)) return false;
    if (manualLinks.has(d.doNo)) return true;
    const claimedBy = input.claims.get(d.doNo);
    if (claimedBy !== undefined && claimedBy !== input.tripId) return false;
    if (d.createdAt.getTime() < input.gateInAt.getTime()) return false;
    return sdosOfDo(d).some((s) => tripSdos.has(s));
  });

  const bySdo: Record<string, string[]> = {};
  for (const sdo of input.sdoNos) bySdo[sdo] = [];
  const unlinked = new Set<string>();

  for (const d of chosen) {
    for (const sdo of sdosOfDo(d)) {
      const list = bySdo[sdo];
      if (list) {
        if (!list.includes(d.doNo)) list.push(d.doNo);
      } else {
        unlinked.add(sdo);
      }
    }
  }

  return {
    doNos: chosen.map((d) => d.doNo),
    bySdo,
    sdosWithoutDo: input.sdoNos.filter((s) => bySdo[s]?.length === 0),
    unlinkedSdosOnDos: [...unlinked],
  };
}

export interface TripForDoAssignment {
  tripId: string;
  gateInAt: Date;
  sdoNos: readonly string[];
  /** DOs the clerk unlinked from this trip: never auto-linked back. */
  manualUnlinks: readonly string[];
}

export interface DoAssignment {
  /** DOs with exactly one candidate truck: link automatically. */
  assign: { doNo: string; tripId: string }[];
  /** DOs that fit more than one truck on site: left for the clerk. */
  ambiguous: { doNo: string; tripIds: string[] }[];
}

/**
 * Decide which truck on site each new DO belongs to. A truck is a candidate
 * for a DO when the DO was copied from one of its SDOs, was created at or
 * after its gate in, and the clerk has not unlinked it. Already claimed DOs
 * are skipped. Two trucks on the same SDO make the DO ambiguous: the system
 * does not guess.
 */
export function assignDos(
  trips: readonly TripForDoAssignment[],
  dos: readonly DeliveryOrder[],
  claims: ReadonlyMap<string, string>,
): DoAssignment {
  const result: DoAssignment = { assign: [], ambiguous: [] };
  for (const d of dos) {
    if (claims.has(d.doNo)) continue;
    const sdos = sdosOfDo(d);
    const candidates = trips.filter(
      (t) =>
        !t.manualUnlinks.includes(d.doNo) &&
        d.createdAt.getTime() >= t.gateInAt.getTime() &&
        sdos.some((s) => t.sdoNos.includes(s)),
    );
    if (candidates.length === 1)
      result.assign.push({ doNo: d.doNo, tripId: candidates[0]!.tripId });
    else if (candidates.length > 1) {
      result.ambiguous.push({ doNo: d.doNo, tripIds: candidates.map((t) => t.tripId) });
    }
  }
  return result;
}

/**
 * Expected pieces for one SDO line on this truck. When the truck has a DO
 * for that SDO, the DO says what was loaded (split delivery: part of the
 * SDO; a line not on the DO: 0). Otherwise the SDO line is the reference.
 */
export function expectedPieces(
  sdoNo: string,
  lineNo: number,
  sdoPieces: number,
  tripDos: readonly (DeliveryOrder & { lines: readonly (DoLine & { pieces: number })[] })[],
): { pieces: number; from: 'do' | 'sdo' } {
  const covering = tripDos.filter((d) => d.lines.some((l) => l.baseSdoNo === sdoNo));
  if (covering.length === 0) return { pieces: sdoPieces, from: 'sdo' };
  const pieces = covering
    .flatMap((d) => d.lines)
    .filter((l) => l.baseSdoNo === sdoNo && l.baseLineNo === lineNo)
    .reduce((sum, l) => sum + l.pieces, 0);
  return { pieces, from: 'do' };
}

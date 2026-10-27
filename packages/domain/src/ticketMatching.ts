/**
 * Link a CWIS weighing ticket to the truck trip it belongs to.
 * The ticket stores the SDO(s), so for outbound trucks the link is exact
 * (docs/SPEC.md "CWIS integration"). Order of evidence:
 *   1. the VMS trip number carried forward to CWIS (option A)
 *   2. an SDO on the ticket that is linked to exactly one truck on site
 *   3. the plate, for a truck on site (inbound coil has no SDO)
 * No match leaves the ticket unlinked for the clerk to see.
 */
import { normalizePlate } from './plate.js';

export interface TicketForMatching {
  plate: string;
  sdoNos: readonly string[];
  vmsTripNo: string | null;
}

export interface OpenTripForMatching {
  id: string;
  tripNo: string;
  plate: string;
  sdoNos: readonly string[];
}

export type TicketMatch = { tripId: string; by: 'trip_no' | 'sdo' | 'plate' } | null;

export function matchTicketToTrip(
  ticket: TicketForMatching,
  openTrips: readonly OpenTripForMatching[],
): TicketMatch {
  if (ticket.vmsTripNo) {
    const t = openTrips.find((x) => x.tripNo === ticket.vmsTripNo);
    if (t) return { tripId: t.id, by: 'trip_no' };
  }

  const plate = normalizePlate(ticket.plate);
  if (ticket.sdoNos.length > 0) {
    const bySdo = openTrips.filter((t) => t.sdoNos.some((s) => ticket.sdoNos.includes(s)));
    if (bySdo.length === 1) return { tripId: bySdo[0]!.id, by: 'sdo' };
    // Same SDO on two trucks: the plate decides.
    const both = bySdo.filter((t) => normalizePlate(t.plate) === plate);
    if (both.length === 1) return { tripId: both[0]!.id, by: 'sdo' };
  }

  const byPlate = openTrips.filter((t) => normalizePlate(t.plate) === plate);
  if (byPlate.length === 1) return { tripId: byPlate[0]!.id, by: 'plate' };
  return null;
}

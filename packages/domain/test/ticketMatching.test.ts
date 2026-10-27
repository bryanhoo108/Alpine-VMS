import { describe, expect, it } from 'vitest';
import { matchTicketToTrip, type OpenTripForMatching } from '../src/ticketMatching.js';

const trips: OpenTripForMatching[] = [
  { id: 'A', tripNo: 'T-261021-001', plate: 'WXY1234', sdoNos: ['5005'] },
  { id: 'B', tripNo: 'T-261021-002', plate: 'BPN2045', sdoNos: ['5009', '5010'] },
  { id: 'C', tripNo: 'T-261021-003', plate: 'VBA5521', sdoNos: [] }, // inbound coil
  { id: 'D', tripNo: 'T-261021-004', plate: 'BMK7710', sdoNos: ['5001'] },
  { id: 'E', tripNo: 'T-261021-005', plate: 'WRC6630', sdoNos: ['5001'] }, // same SDO, 2nd truck
];

const ticket = (o: Partial<Parameters<typeof matchTicketToTrip>[0]>) => ({
  plate: 'ZZZ1',
  sdoNos: [],
  vmsTripNo: null,
  ...o,
});

describe('matchTicketToTrip', () => {
  it('uses the VMS trip number first (carried forward to CWIS)', () => {
    expect(
      matchTicketToTrip(ticket({ vmsTripNo: 'T-261021-002', sdoNos: ['5005'] }), trips),
    ).toEqual({
      tripId: 'B',
      by: 'trip_no',
    });
  });

  it('falls back when the trip number is not on site', () => {
    expect(matchTicketToTrip(ticket({ vmsTripNo: 'T-OLD', sdoNos: ['5005'] }), trips)).toEqual({
      tripId: 'A',
      by: 'sdo',
    });
  });

  it('links by SDO even when the CWIS plate differs (mismatch is flagged elsewhere)', () => {
    expect(matchTicketToTrip(ticket({ plate: 'WXY 1243', sdoNos: ['5005'] }), trips)).toEqual({
      tripId: 'A',
      by: 'sdo',
    });
  });

  it('links a multi-SDO ticket when any SDO matches', () => {
    expect(matchTicketToTrip(ticket({ sdoNos: ['5010', '5099'] }), trips)?.tripId).toBe('B');
  });

  it('uses the plate to choose between two trucks on the same SDO', () => {
    expect(matchTicketToTrip(ticket({ plate: 'WRC 6630', sdoNos: ['5001'] }), trips)).toEqual({
      tripId: 'E',
      by: 'sdo',
    });
  });

  it('leaves it unlinked when two trucks share the SDO and the plate matches neither', () => {
    expect(matchTicketToTrip(ticket({ plate: 'ZZZ 9', sdoNos: ['5001'] }), trips)).toBeNull();
  });

  it('links inbound coil (no SDO) by plate', () => {
    expect(matchTicketToTrip(ticket({ plate: 'vba-5521' }), trips)).toEqual({
      tripId: 'C',
      by: 'plate',
    });
  });

  it('links by plate when the SDO typed in CWIS is on no truck yet (clerk not matched)', () => {
    expect(matchTicketToTrip(ticket({ plate: 'VBA5521', sdoNos: ['5011'] }), trips)).toEqual({
      tripId: 'C',
      by: 'plate',
    });
  });

  it('returns null when nothing matches', () => {
    expect(matchTicketToTrip(ticket({ plate: 'NOPE1' }), trips)).toBeNull();
  });
});

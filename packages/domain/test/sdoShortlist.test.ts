import { describe, expect, it } from 'vitest';
import { rankSdos } from '../src/sdoShortlist.js';

const day = (d: number) => new Date(2026, 9, d);
const sdos = [
  { sdoNo: '5001', customerCode: 'C1', docDate: day(18) },
  { sdoNo: '5002', customerCode: 'C2', docDate: day(19) },
  { sdoNo: '5003', customerCode: 'C2', docDate: day(20) },
  { sdoNo: '5004', customerCode: 'C3', docDate: day(21) },
  { sdoNo: '5005', customerCode: 'C4', docDate: day(21) },
];

const ranked = (ctx: Partial<Parameters<typeof rankSdos>[1]>) =>
  rankSdos(sdos, { linkedSdoNos: [], ticketSdoNos: [], usualCustomerCodes: [], ...ctx }).map(
    (e) => `${e.sdo.sdoNo}:${e.reason}`,
  );

describe('rankSdos', () => {
  it('with no hints, lists newest first (SDO number breaks ties)', () => {
    expect(ranked({})).toEqual(['5004:open', '5005:open', '5003:open', '5002:open', '5001:open']);
  });

  it('puts SDOs on the CWIS ticket first, then usual customers', () => {
    expect(ranked({ ticketSdoNos: ['5001'], usualCustomerCodes: ['C2'] })).toEqual([
      '5001:on_ticket',
      '5003:usual_customer',
      '5002:usual_customer',
      '5004:open',
      '5005:open',
    ]);
  });

  it('leaves out SDOs already linked to the truck', () => {
    expect(ranked({ linkedSdoNos: ['5004', '5005'] })).toEqual([
      '5003:open',
      '5002:open',
      '5001:open',
    ]);
  });
});

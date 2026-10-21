import { describe, expect, it } from 'vitest';
import { exitStatus, type InboundExitInput, type OutboundExitInput } from '../src/exitStatus.js';

const outbound = (o: Partial<OutboundExitInput> = {}): OutboundExitInput => ({
  type: 'outbound',
  lprPlate: 'WXY 1234',
  cwisPlates: ['WXY1234'],
  cardReturned: true,
  sdoNos: ['5001'],
  sdosWithoutDo: [],
  latestDecision: 'approve',
  ...o,
});

const inbound = (o: Partial<InboundExitInput> = {}): InboundExitInput => ({
  type: 'inbound',
  lprPlate: 'BKA 4321',
  cwisPlates: ['BKA 4321'],
  cardReturned: true,
  weighOutDone: true,
  ...o,
});

const types = (i: Parameters<typeof exitStatus>[0]) => exitStatus(i).reasons.map((r) => r.type);

describe('exitStatus: outbound', () => {
  it('is green when approved, every SDO has a DO and the card is back', () => {
    expect(exitStatus(outbound())).toEqual({ level: 'green', reasons: [] });
  });

  it('is red when the checker never approved', () => {
    const s = exitStatus(outbound({ latestDecision: null }));
    expect(s.level).toBe('red');
    expect(types(outbound({ latestDecision: null }))).toEqual(['EXIT_NO_CHECK']);
  });

  it('is red when the latest decision is a reject', () => {
    expect(exitStatus(outbound({ latestDecision: 'reject' })).level).toBe('red');
    expect(types(outbound({ latestDecision: 'reject' }))).toEqual(['EXIT_REJECTED']);
  });

  it('is amber with one reason per SDO that has no DO', () => {
    const input = outbound({ sdoNos: ['5001', '5002', '5003'], sdosWithoutDo: ['5002', '5003'] });
    const s = exitStatus(input);
    expect(s.level).toBe('amber');
    expect(s.reasons.map((r) => r.detail?.sdoNo)).toEqual(['5002', '5003']);
  });

  it('is amber when no SDO was linked', () => {
    expect(types(outbound({ sdoNos: [], sdosWithoutDo: [] }))).toEqual(['EXIT_NO_SDO']);
  });

  it('is red when the card is not returned, even if all else is fine', () => {
    const s = exitStatus(outbound({ cardReturned: false }));
    expect(s.level).toBe('red');
    expect(s.reasons[0]?.type).toBe('CARD_NOT_RETURNED');
  });

  it('is amber when a CWIS ticket plate differs from the LPR plate', () => {
    const s = exitStatus(outbound({ cwisPlates: ['WXY1234', 'WXY 1243'] }));
    expect(s.level).toBe('amber');
    expect(s.reasons).toHaveLength(1);
    expect(s.reasons[0]).toMatchObject({ type: 'PLATE_MISMATCH', detail: { cwis: 'WXY 1243' } });
  });

  it('ignores formatting differences between CWIS and LPR plates', () => {
    expect(exitStatus(outbound({ cwisPlates: ['wxy-1234'] })).level).toBe('green');
  });

  it('lists every reason, red before amber, and takes the worst level', () => {
    const input = outbound({
      latestDecision: null,
      sdosWithoutDo: ['5001'],
      cardReturned: false,
      cwisPlates: ['WXY 9999'],
    });
    const s = exitStatus(input);
    expect(s.level).toBe('red');
    expect(s.reasons.map((r) => r.type)).toEqual([
      'EXIT_NO_CHECK',
      'CARD_NOT_RETURNED',
      'EXIT_NO_DO',
      'PLATE_MISMATCH',
    ]);
  });

  it('every exit reason alerts the supervisor', () => {
    const s = exitStatus(
      outbound({ latestDecision: null, sdosWithoutDo: ['5001'], cardReturned: false }),
    );
    for (const r of s.reasons) expect(r.notify).toContain('supervisor');
  });
});

describe('exitStatus: inbound coil', () => {
  it('is green when CWIS weigh-out is done and the card is back', () => {
    expect(exitStatus(inbound()).level).toBe('green');
  });

  it('is amber with no weigh-out', () => {
    expect(exitStatus(inbound({ weighOutDone: false })).level).toBe('amber');
    expect(types(inbound({ weighOutDone: false }))).toEqual(['EXIT_NO_WEIGH_OUT']);
  });

  it('never asks for checker, SDO or DO', () => {
    expect(types(inbound({ cwisPlates: [] }))).toEqual([]);
  });

  it('is red when the card is not returned', () => {
    expect(exitStatus(inbound({ cardReturned: false, weighOutDone: false })).level).toBe('red');
  });
});

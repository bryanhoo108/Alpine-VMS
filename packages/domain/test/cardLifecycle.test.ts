import { describe, expect, it } from 'vitest';
import {
  collectCard,
  issueCard,
  markCardLost,
  normalizeCardNo,
  parsePassQr,
  passQrText,
  recoverCard,
  type Card,
} from '../src/cardLifecycle.js';

const free: Card = { cardNo: 'C-0001', status: 'free', currentTripId: null };

describe('card lifecycle', () => {
  it('issues a free card to a trip, then collects it back to free', () => {
    const issued = issueCard(free, 'T1');
    expect(issued).toEqual({
      ok: true,
      card: { cardNo: 'C-0001', status: 'issued', currentTripId: 'T1' },
    });
    if (!issued.ok) throw new Error();
    expect(collectCard(issued.card, 'T1')).toEqual({ ok: true, card: free });
  });

  it('refuses to issue a card that is already on a trip', () => {
    const issued: Card = { ...free, status: 'issued', currentTripId: 'T1' };
    expect(issueCard(issued, 'T2')).toMatchObject({ ok: false, error: 'CARD_IN_USE' });
  });

  it('refuses to issue a lost card until it is recovered', () => {
    const lost: Card = { ...free, status: 'lost' };
    expect(issueCard(lost, 'T1')).toMatchObject({ ok: false, error: 'CARD_LOST' });
    const recovered = recoverCard(lost);
    expect(recovered).toEqual({ ok: true, card: free });
  });

  it('refuses to collect a card that belongs to another trip', () => {
    const issued: Card = { ...free, status: 'issued', currentTripId: 'T1' };
    expect(collectCard(issued, 'T2')).toMatchObject({ ok: false, error: 'CARD_ON_OTHER_TRIP' });
  });

  it('refuses to collect a card that is not issued', () => {
    expect(collectCard(free, 'T1')).toMatchObject({ ok: false, error: 'CARD_NOT_ISSUED' });
  });

  it('marks an unreturned card lost and frees it from the trip', () => {
    const issued: Card = { ...free, status: 'issued', currentTripId: 'T1' };
    expect(markCardLost(issued, 'T1')).toEqual({
      ok: true,
      card: { cardNo: 'C-0001', status: 'lost', currentTripId: null },
    });
  });

  it('only recovers lost cards', () => {
    expect(recoverCard(free)).toMatchObject({ ok: false });
  });

  it('does not mutate the input card', () => {
    const card = { ...free };
    issueCard(card, 'T1');
    expect(card).toEqual(free);
  });
});

describe('QR gate pass', () => {
  it('reads the pass number back from its QR', () => {
    expect(passQrText('gp-0007')).toBe('APMVMS-PASS:GP0007');
    expect(parsePassQr(passQrText('GP0007'))).toBe('GP0007');
    expect(parsePassQr(' apmvms-pass:gp0007 ')).toBe('GP0007');
  });

  it('is not fooled by other QR codes', () => {
    expect(parsePassQr('APMVMS:DEMV2345')).toBeNull(); // visitor invite
    expect(parsePassQr('https://example.com')).toBeNull();
    expect(parsePassQr('GP0007')).toBeNull();
    expect(parsePassQr('APMVMS-PASS:')).toBeNull();
  });
});

describe('normalizeCardNo', () => {
  it('keeps letters, so printed pass numbers work', () => {
    expect(normalizeCardNo('gp-0007')).toBe('GP0007');
  });

  it('reads NFC serials and USB reader input the same way', () => {
    expect(normalizeCardNo('04:a1:b2:c3:00:00:01')).toBe('04A1B2C3000001');
    expect(normalizeCardNo(' 04a1b2c3000001 ')).toBe('04A1B2C3000001');
  });
});

import { describe, expect, it } from 'vitest';
import {
  collectCard,
  issueCard,
  markCardLost,
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

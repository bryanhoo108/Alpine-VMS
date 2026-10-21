/**
 * RFID gate pass lifecycle. The card stores only its number; the VMS links
 * it to a trip. free → issued (gate in) → free (collected at gate out),
 * or issued → lost (not returned). A lost card that turns up goes back to free.
 */

export type CardStatus = 'free' | 'issued' | 'lost';

export interface Card {
  cardNo: string;
  status: CardStatus;
  currentTripId: string | null;
}

export type CardError =
  | 'CARD_IN_USE' // issue: card is already on another open trip
  | 'CARD_LOST' // issue: card is marked lost; recover it first
  | 'CARD_NOT_ISSUED' // collect / lose: card is not on any trip
  | 'CARD_ON_OTHER_TRIP'; // collect / lose: card belongs to a different trip

export type CardResult = { ok: true; card: Card } | { ok: false; error: CardError; card: Card };

const fail = (card: Card, error: CardError): CardResult => ({ ok: false, error, card });

export function issueCard(card: Card, tripId: string): CardResult {
  if (card.status === 'issued') return fail(card, 'CARD_IN_USE');
  if (card.status === 'lost') return fail(card, 'CARD_LOST');
  return { ok: true, card: { ...card, status: 'issued', currentTripId: tripId } };
}

export function collectCard(card: Card, tripId: string): CardResult {
  if (card.status !== 'issued') return fail(card, 'CARD_NOT_ISSUED');
  if (card.currentTripId !== tripId) return fail(card, 'CARD_ON_OTHER_TRIP');
  return { ok: true, card: { ...card, status: 'free', currentTripId: null } };
}

/** Gate out without the card: the card is lost and leaves the pool. */
export function markCardLost(card: Card, tripId: string): CardResult {
  if (card.status !== 'issued') return fail(card, 'CARD_NOT_ISSUED');
  if (card.currentTripId !== tripId) return fail(card, 'CARD_ON_OTHER_TRIP');
  return { ok: true, card: { ...card, status: 'lost', currentTripId: null } };
}

/** A lost card handed back later returns to the pool. */
export function recoverCard(card: Card): CardResult {
  if (card.status !== 'lost') return fail(card, 'CARD_NOT_ISSUED');
  return { ok: true, card: { ...card, status: 'free', currentTripId: null } };
}

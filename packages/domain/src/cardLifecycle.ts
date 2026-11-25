/**
 * RFID gate pass lifecycle. The card stores only its number; the VMS links
 * it to a trip. free → issued (gate in) → free (collected at gate out),
 * or issued → lost (not returned). A lost card that turns up goes back to free.
 */

export type CardStatus = 'free' | 'issued' | 'lost';

/**
 * Gate pass numbers: upper case letters and digits, no separators. A QR pass
 * carries its printed number ("GP0007"); an RFID card its serial, which NFC
 * tablets report as "04:a1:b2:…" and USB readers type plain (decision G1).
 */
export function normalizeCardNo(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** What a QR gate pass holds: a prefix so other QR codes are not taken for passes. */
export const PASS_QR_PREFIX = 'APMVMS-PASS:';

export function passQrText(cardNo: string): string {
  return `${PASS_QR_PREFIX}${normalizeCardNo(cardNo)}`;
}

/**
 * The pass number from a scanned QR, or null when the QR is not a gate pass
 * (a visitor invite, a product label, a web link).
 */
export function parsePassQr(text: string): string | null {
  const raw = text.trim().toUpperCase();
  if (!raw.startsWith(PASS_QR_PREFIX)) return null;
  const cardNo = normalizeCardNo(raw.slice(PASS_QR_PREFIX.length));
  return cardNo.length >= 3 && cardNo.length <= 32 ? cardNo : null;
}

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

/**
 * Visitors and contractors (decisions V1–V10 in docs/decisions.md).
 *
 * One person registers for a group and states how many people are with them;
 * the group gets one card. Contractors are handled like visitors and marked
 * "Contractor" (no document checks yet). Nothing here blocks anyone.
 */
import { raise, type RaisedAlert } from './alerts.js';

export type VisitType = 'visitor' | 'contractor';

// --- Invites -------------------------------------------------------------------

export interface InviteDates {
  /** Site-local dates, YYYY-MM-DD. A contractor job can span several days. */
  validFrom: string;
  validTo: string;
  cancelledAt: Date | null;
}

export type InviteState = 'not_yet' | 'expected' | 'expired' | 'cancelled';

export function inviteState(invite: InviteDates, today: string): InviteState {
  if (invite.cancelledAt) return 'cancelled';
  if (today < invite.validFrom) return 'not_yet';
  if (today > invite.validTo) return 'expired';
  return 'expected';
}

/** Letters and digits that cannot be mixed up when read out (no 0/O, 1/I/L). */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 8;
/** What the QR code holds: a prefix so other QR codes are not mistaken for invites. */
export const INVITE_QR_PREFIX = 'APMVMS:';

/** random() returns [0, 1); pass a crypto-backed one in production. */
export function newInviteCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function inviteQrText(code: string): string {
  return `${INVITE_QR_PREFIX}${code}`;
}

/**
 * Read an invite code from a scanned QR, or from a code typed or read out
 * ("ab3d-ef7h"). Returns null when it cannot be an invite code.
 */
export function parseInviteCode(text: string): string | null {
  const raw = text.trim().toUpperCase();
  const body = raw.startsWith(INVITE_QR_PREFIX) ? raw.slice(INVITE_QR_PREFIX.length) : raw;
  const code = body.replace(/[\s-]/g, '');
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

// --- Gate in ---------------------------------------------------------------------

export interface VisitGateInInput {
  /** Walk-ins: the guard phoned the host and tapped "Host OK". Invites count as confirmed. */
  hostConfirmed: boolean;
  /** Plate of the car they came in, if any, is on the watchlist. */
  plateOnWatchlist: boolean;
}

export function visitGateInAlerts(input: VisitGateInInput): RaisedAlert[] {
  const out: RaisedAlert[] = [];
  if (input.plateOnWatchlist) out.push(raise('WATCHLIST_HIT'));
  if (!input.hostConfirmed) out.push(raise('HOST_NOT_CONFIRMED'));
  return out;
}

/** People in a group: at least the person who registered, at most a bus load. */
export const MAX_GROUP_SIZE = 60;

export function validGroupSize(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_GROUP_SIZE;
}

// --- Gate out --------------------------------------------------------------------

export interface VisitExitInput {
  cardReturned: boolean;
  /** End of the invite's time window on the day of the visit; null for walk-ins. */
  expectedUntil: Date | null;
  at: Date;
}

export interface VisitExitStatus {
  level: 'green' | 'amber' | 'red';
  reasons: RaisedAlert[];
}

/** Grace before a late leaver shows amber. */
export const OVERSTAY_GRACE_MINUTES = 30;

export function visitExitStatus(input: VisitExitInput): VisitExitStatus {
  const reasons: RaisedAlert[] = [];
  if (!input.cardReturned) reasons.push(raise('CARD_NOT_RETURNED'));
  if (
    input.expectedUntil &&
    input.at.getTime() > input.expectedUntil.getTime() + OVERSTAY_GRACE_MINUTES * 60_000
  ) {
    reasons.push(raise('VISIT_OVERSTAY'));
  }
  const level = reasons.some((r) => r.level === 'red')
    ? 'red'
    : reasons.some((r) => r.level === 'amber')
      ? 'amber'
      : 'green';
  return { level, reasons };
}

// --- Headcount and muster ----------------------------------------------------------

export type OnSiteKind = 'truck' | VisitType;

export interface OnSiteGroup {
  /** Trip or visit ID. */
  id: string;
  kind: OnSiteKind;
  /** People in the group: 1 driver per truck; the stated group size for visits. */
  people: number;
}

export interface Headcount {
  total: number;
  truckDrivers: number;
  visitors: number;
  contractors: number;
}

export function headcount(groups: readonly OnSiteGroup[]): Headcount {
  const sum = (kind: OnSiteKind) =>
    groups.filter((g) => g.kind === kind).reduce((n, g) => n + g.people, 0);
  const truckDrivers = sum('truck');
  const visitors = sum('visitor');
  const contractors = sum('contractor');
  return { total: truckDrivers + visitors + contractors, truckDrivers, visitors, contractors };
}

export interface MusterProgress {
  /** People on the roll and people ticked safe. A group counts when its card holder is ticked. */
  people: number;
  safePeople: number;
  groups: number;
  safeGroups: number;
  /** Groups not yet ticked, biggest first, so the largest unknowns are chased first. */
  missing: OnSiteGroup[];
}

/** Roll is fixed when the muster starts; later gate events do not change it. */
export function musterProgress(
  roll: readonly OnSiteGroup[],
  safeIds: ReadonlySet<string>,
): MusterProgress {
  const safe = roll.filter((g) => safeIds.has(g.id));
  const missing = roll.filter((g) => !safeIds.has(g.id)).sort((a, b) => b.people - a.people);
  return {
    people: roll.reduce((n, g) => n + g.people, 0),
    safePeople: safe.reduce((n, g) => n + g.people, 0),
    groups: roll.length,
    safeGroups: safe.length,
    missing,
  };
}

/**
 * Pre-registration: the clerk enters plate and SDO(s) before the truck comes.
 * At gate in, an exact plate match links the SDOs to the trip automatically.
 * If the camera misreads, the guard picks the truck from the open list or
 * registers it as a walk-in (then the clerk matches SDOs on the clerk screen).
 *
 * Pre-registrations never disappear on their own: past the expected date
 * they show as "late" until the truck arrives or the clerk clears them.
 */

import { normalizePlate } from './plate.js';

export type PreRegStatus = 'expected' | 'late' | 'arrived' | 'cleared';

export interface PreRegistration {
  id: string;
  plate: string;
  /** Site-local date, YYYY-MM-DD. */
  expectedDate: string;
  sdoNos: readonly string[];
  arrivedTripId: string | null;
  clearedAt: Date | null;
}

/** `today` is the site-local date, YYYY-MM-DD. */
export function preRegStatus(p: PreRegistration, today: string): PreRegStatus {
  if (p.arrivedTripId !== null) return 'arrived';
  if (p.clearedAt !== null) return 'cleared';
  return p.expectedDate < today ? 'late' : 'expected';
}

const isOpen = (p: PreRegistration, today: string) => {
  const s = preRegStatus(p, today);
  return s === 'expected' || s === 'late';
};

/**
 * Order for the guard's pick list and for choosing between several matches:
 * due today first, then late (most recent first), then future dates (soonest first).
 */
function rank(p: PreRegistration, today: string): [number, number] {
  const day = Date.parse(p.expectedDate);
  if (p.expectedDate === today) return [0, 0];
  if (p.expectedDate < today) return [1, -day];
  return [2, day];
}

function byRank(today: string) {
  return (a: PreRegistration, b: PreRegistration) => {
    const [ga, da] = rank(a, today);
    const [gb, db] = rank(b, today);
    return ga - gb || da - db;
  };
}

/** Open pre-registrations for the guard to pick from when the plate did not match. */
export function openPreRegistrations(
  list: readonly PreRegistration[],
  today: string,
): PreRegistration[] {
  return list.filter((p) => isOpen(p, today)).sort(byRank(today));
}

/** The open pre-registration for this plate, exact match only. */
export function findPreRegistration(
  plate: string,
  list: readonly PreRegistration[],
  today: string,
): PreRegistration | null {
  const wanted = normalizePlate(plate);
  if (wanted === '') return null;
  const matches = openPreRegistrations(list, today).filter(
    (p) => normalizePlate(p.plate) === wanted,
  );
  return matches[0] ?? null;
}

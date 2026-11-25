/**
 * Long stay (decision G4): a truck inside longer than usual is flagged on the
 * live overview, amber after `amberMinutes` and red after `redMinutes`
 * (defaults 2 h and 4 h, set per site). Flag and alert only, never block.
 */
import type { AlertType } from './alerts.js';

export interface LongStayLimits {
  amberMinutes: number;
  redMinutes: number;
}

export const DEFAULT_LONG_STAY: LongStayLimits = { amberMinutes: 120, redMinutes: 240 };

export type StayLevel = 'ok' | 'amber' | 'red';

export function stayLevel(minutesInside: number, limits: LongStayLimits): StayLevel {
  if (minutesInside >= limits.redMinutes) return 'red';
  if (minutesInside >= limits.amberMinutes) return 'amber';
  return 'ok';
}

/**
 * Alerts still to raise for a truck, given the ones it already has: each
 * level once. A truck found already past red gets only the red one.
 */
export function longStayAlertsDue(
  minutesInside: number,
  limits: LongStayLimits,
  already: readonly AlertType[],
): AlertType[] {
  const level = stayLevel(minutesInside, limits);
  if (level === 'red') return already.includes('LONG_STAY_RED') ? [] : ['LONG_STAY_RED'];
  if (level === 'amber')
    return already.includes('LONG_STAY') || already.includes('LONG_STAY_RED') ? [] : ['LONG_STAY'];
  return [];
}

/** Limits from settings; bad or missing values fall back to the defaults. */
export function parseLongStay(amber?: string, red?: string): LongStayLimits {
  const a = Number(amber);
  const r = Number(red);
  const amberMinutes = Number.isFinite(a) && a > 0 ? a : DEFAULT_LONG_STAY.amberMinutes;
  const redMinutes =
    Number.isFinite(r) && r > amberMinutes
      ? r
      : Math.max(DEFAULT_LONG_STAY.redMinutes, amberMinutes * 2);
  return { amberMinutes, redMinutes };
}

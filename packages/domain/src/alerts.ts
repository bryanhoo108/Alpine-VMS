/**
 * Alert catalogue, from the "Alerts and controls" table in docs/SPEC.md.
 * Alerts are recorded and shown; they never block a vehicle.
 */

export type AlertLevel = 'amber' | 'red' | 'logged';

/** Who gets told, besides the screen where the alert is raised. */
export type AlertAudience = 'supervisor' | 'logistics';

export interface AlertDefinition {
  level: AlertLevel;
  notify: readonly AlertAudience[];
  /** 1 to 3 words, shown on guard and checker screens. */
  label: string;
}

export const ALERTS = {
  // Gate out
  EXIT_NO_CHECK: { level: 'red', notify: ['supervisor'], label: 'No check' },
  EXIT_REJECTED: { level: 'red', notify: ['supervisor'], label: 'Load rejected' },
  EXIT_NO_DO: { level: 'amber', notify: ['supervisor'], label: 'No DO' },
  // Not in the spec table; red by decision, see docs/decisions.md (Q4).
  EXIT_NO_SDO: { level: 'red', notify: ['supervisor'], label: 'No SDO' },
  EXIT_NO_WEIGH_OUT: { level: 'amber', notify: ['supervisor'], label: 'No weigh-out' },
  CARD_NOT_RETURNED: { level: 'red', notify: ['supervisor'], label: 'No card' },
  // Weighbridge
  PLATE_MISMATCH: { level: 'amber', notify: ['supervisor'], label: 'Plate differs' },
  // Checker
  SDO_CHANGED: { level: 'amber', notify: [], label: 'SDO changed' },
  CHECKER_REJECTED: { level: 'red', notify: ['supervisor', 'logistics'], label: 'Load rejected' },
  // Gate in
  WATCHLIST_HIT: { level: 'red', notify: ['supervisor'], label: 'Watchlist' },
  PLATE_ALREADY_ON_SITE: { level: 'amber', notify: ['supervisor'], label: 'Already inside' },
  LPR_CORRECTED: { level: 'logged', notify: [], label: 'Plate changed' },
  LPR_NOT_CONFIRMED: { level: 'logged', notify: [], label: 'Plate not read' },
} as const satisfies Record<string, AlertDefinition>;

export type AlertType = keyof typeof ALERTS;

export interface RaisedAlert {
  type: AlertType;
  level: AlertLevel;
  label: string;
  notify: readonly AlertAudience[];
  /** Extra context, e.g. which SDO has no DO. */
  detail?: Record<string, string>;
}

export function raise(type: AlertType, detail?: Record<string, string>): RaisedAlert {
  const def: AlertDefinition = ALERTS[type];
  return {
    type,
    level: def.level,
    label: def.label,
    notify: def.notify,
    ...(detail && { detail }),
  };
}

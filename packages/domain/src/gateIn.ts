import { raise, type RaisedAlert } from './alerts.js';
import { normalizePlate } from './plate.js';

export interface GateInCheckInput {
  /** What the entry camera read, or null if there was no read. */
  lprPlate: string | null;
  /** What the guard confirmed (the LPR text, or their correction). */
  confirmedPlate: string;
  /** Plates of trips currently on site (gated in, not out). */
  platesOnSite: readonly string[];
}

/** Alerts raised at gate in. The truck is let in whatever the result. */
export function gateInAlerts(input: GateInCheckInput): RaisedAlert[] {
  const alerts: RaisedAlert[] = [];
  const confirmed = normalizePlate(input.confirmedPlate);

  if (input.lprPlate === null) {
    alerts.push(raise('LPR_NOT_CONFIRMED', { plate: confirmed }));
  } else if (normalizePlate(input.lprPlate) !== confirmed) {
    alerts.push(raise('LPR_CORRECTED', { read: input.lprPlate, confirmed }));
  }

  if (input.platesOnSite.some((p) => normalizePlate(p) === confirmed)) {
    alerts.push(raise('PLATE_ALREADY_ON_SITE', { plate: confirmed }));
  }

  return alerts;
}

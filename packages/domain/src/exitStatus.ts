import { raise, type RaisedAlert } from './alerts.js';
import { normalizePlate } from './plate.js';

export type ExitLevel = 'green' | 'amber' | 'red';

export type CheckerDecision = 'approve' | 'reject';

interface CommonExitInput {
  /** Plate confirmed at gate in. */
  lprPlate: string;
  /** Plates on the CWIS tickets linked to this trip. */
  cwisPlates: readonly string[];
  /** False when the guard taps "No card" at gate out. */
  cardReturned: boolean;
}

export interface OutboundExitInput extends CommonExitInput {
  type: 'outbound';
  /** SDOs linked to the trip. */
  sdoNos: readonly string[];
  /** SDOs on the trip with no DO captured (from selectDosForTrip). */
  sdosWithoutDo: readonly string[];
  /** Latest checker decision, or null if the load was never checked. */
  latestDecision: CheckerDecision | null;
}

export interface InboundExitInput extends CommonExitInput {
  type: 'inbound';
  /** True when a linked CWIS ticket has a weigh-out. */
  weighOutDone: boolean;
}

export type ExitInput = OutboundExitInput | InboundExitInput;

export interface ExitStatus {
  level: ExitLevel;
  /** Every reason, worst first. Empty when green. */
  reasons: RaisedAlert[];
}

const RANK = { logged: 0, amber: 1, red: 2 } as const;

/**
 * Status shown to the guard at gate out (spec: "Alerts and controls").
 * The truck leaves whatever the result; amber and red alert the supervisor.
 */
export function exitStatus(input: ExitInput): ExitStatus {
  const reasons: RaisedAlert[] = [];

  if (input.type === 'outbound') {
    if (input.latestDecision === null) reasons.push(raise('EXIT_NO_CHECK'));
    else if (input.latestDecision === 'reject') reasons.push(raise('EXIT_REJECTED'));

    if (input.sdoNos.length === 0) {
      reasons.push(raise('EXIT_NO_SDO'));
    } else {
      for (const sdoNo of input.sdosWithoutDo) reasons.push(raise('EXIT_NO_DO', { sdoNo }));
    }
  } else if (!input.weighOutDone) {
    reasons.push(raise('EXIT_NO_WEIGH_OUT'));
  }

  if (!input.cardReturned) reasons.push(raise('CARD_NOT_RETURNED'));

  const lpr = normalizePlate(input.lprPlate);
  for (const plate of input.cwisPlates) {
    if (normalizePlate(plate) !== lpr) {
      reasons.push(raise('PLATE_MISMATCH', { lpr: input.lprPlate, cwis: plate }));
    }
  }

  // Stable sort keeps rule order within a level.
  reasons.sort((a, b) => RANK[b.level] - RANK[a.level]);

  const worst = reasons[0]?.level;
  const level: ExitLevel = worst === 'red' ? 'red' : worst === 'amber' ? 'amber' : 'green';
  return { level, reasons };
}

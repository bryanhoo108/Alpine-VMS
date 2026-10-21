import { normalizePlate } from '@vms/domain';
import { systemClock, type Clock } from '../clock.js';
import type { CwisAdapter, CwisTicket, PendingTruck } from './CwisAdapter.js';

export class CwisUnavailableError extends Error {
  constructor() {
    super('CWIS is unreachable (mock)');
  }
}

export interface WeighInInput {
  /** Plate the weighbridge operator records (may differ from LPR: mismatch case). */
  plate: string;
  /** Card tapped at the weighbridge; picks up the pending truck (option A). */
  cardNo?: string;
  /** SDO typed by the operator when there is no pending truck. */
  sdoNo?: string;
}

/**
 * In-memory CWIS. Tickets are created only through the weigh-in/out controls,
 * the way a weighbridge operator would; the VMS side only reads them.
 */
export class MockCwisAdapter implements CwisAdapter {
  private readonly now: Clock;
  private readonly tickets = new Map<string, CwisTicket>();
  private readonly pending = new Map<string, PendingTruck>();
  private nextTicket = 260001;
  private offline = false;

  constructor(opts: { now?: Clock } = {}) {
    this.now = opts.now ?? systemClock;
  }

  // --- CwisAdapter ----------------------------------------------------------

  async listTickets(opts: { updatedSince?: Date } = {}): Promise<CwisTicket[]> {
    this.reach();
    const since = opts.updatedSince?.getTime() ?? -Infinity;
    return [...this.tickets.values()]
      .filter((t) => t.updatedAt.getTime() > since)
      .map((t) => structuredClone(t));
  }

  async pushPendingTruck(truck: PendingTruck): Promise<void> {
    this.reach();
    this.pending.set(truck.tripNo, structuredClone(truck));
  }

  // --- Controls (dev panel and tests) ---------------------------------------

  pendingTrucks(): PendingTruck[] {
    return [...this.pending.values()].map((p) => structuredClone(p));
  }

  /**
   * Weigh in. With option A the operator taps the card (or picks the plate)
   * and CWIS fills the rest from the pending truck. A CWIS ticket holds one SDO;
   * how multi-SDO trucks are ticketed is an open question for the vendor.
   */
  weighIn(input: WeighInInput): CwisTicket {
    const pending =
      [...this.pending.values()].find((p) => input.cardNo && p.cardNo === input.cardNo) ??
      [...this.pending.values()].find(
        (p) => normalizePlate(p.plate) === normalizePlate(input.plate),
      );
    const at = this.now();
    const ticket: CwisTicket = {
      ticketNo: `WB${this.nextTicket++}`,
      plate: input.plate,
      sdoNo: input.sdoNo ?? pending?.sdoNos[0] ?? null,
      transporterName: pending?.transporterName ?? null,
      vmsTripNo: pending?.tripNo ?? null,
      weighInAt: at,
      weighOutAt: null,
      updatedAt: at,
    };
    this.tickets.set(ticket.ticketNo, ticket);
    return structuredClone(ticket);
  }

  weighOut(ticketNo: string): CwisTicket {
    const t = this.tickets.get(ticketNo);
    if (!t) throw new Error(`ticket ${ticketNo} not found`);
    t.weighOutAt = this.now();
    t.updatedAt = t.weighOutAt;
    return structuredClone(t);
  }

  setOffline(offline: boolean) {
    this.offline = offline;
  }

  private reach() {
    if (this.offline) throw new CwisUnavailableError();
  }
}

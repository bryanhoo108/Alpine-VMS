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
  /** SDOs entered by the operator when there is no pending truck. */
  sdoNos?: string[];
}

/**
 * In-memory CWIS. Tickets are created only through the weigh-in/out controls,
 * the way a weighbridge operator would; the VMS side only reads them.
 */
export class MockCwisAdapter implements CwisAdapter {
  private readonly now: Clock;
  private readonly tickets = new Map<string, CwisTicket>();
  private readonly pending = new Map<string, PendingTruck>();
  /** When each pending truck arrived from the VMS (shown on the simulated CWIS screen). */
  private readonly pushedAt = new Map<string, Date>();
  /** Simulated scale readings, CWIS's own data; the VMS never reads them. */
  private readonly weights = new Map<string, { inKg: number; outKg: number | null }>();
  private readonly plannedOut = new Map<string, number>();
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
    // Re-insert so the newest push is last (cards are reused between trucks).
    this.pending.delete(truck.tripNo);
    this.pending.set(truck.tripNo, structuredClone(truck));
    this.pushedAt.set(truck.tripNo, this.now());
  }

  // --- Controls (dev panel and tests) ---------------------------------------

  /** Forget all tickets and pending trucks (browser tests reset between cases). */
  reset() {
    this.tickets.clear();
    this.pending.clear();
    this.pushedAt.clear();
    this.weights.clear();
    this.plannedOut.clear();
    this.offline = false;
  }

  pendingTrucks(): PendingTruck[] {
    return [...this.pending.values()].map((p) => structuredClone(p));
  }

  /** Pending trucks with the time they arrived from the VMS, newest first. */
  pendingWithTime(): (PendingTruck & { receivedAt: Date })[] {
    return [...this.pending.values()].reverse().map((p) => ({
      ...structuredClone(p),
      receivedAt: this.pushedAt.get(p.tripNo) ?? this.now(),
    }));
  }

  /** All tickets with simulated scale readings, newest first. */
  ticketsWithWeights(): (CwisTicket & { inKg: number | null; outKg: number | null })[] {
    return [...this.tickets.values()].reverse().map((t) => ({
      ...structuredClone(t),
      inKg: this.weights.get(t.ticketNo)?.inKg ?? null,
      outKg: this.weights.get(t.ticketNo)?.outKg ?? null,
    }));
  }

  /** The ticket weighed in but not yet out for a card's pending-truck trip. */
  openTicketForTrip(tripNo: string): CwisTicket | null {
    const t = [...this.tickets.values()].find((x) => x.vmsTripNo === tripNo && !x.weighOutAt);
    return t ? structuredClone(t) : null;
  }

  /**
   * Weigh in. With option A the operator taps the card (or picks the plate)
   * and CWIS fills the rest from the pending truck. One ticket can carry
   * several SDOs.
   */
  weighIn(input: WeighInInput): CwisTicket {
    // Newest first: a card or plate may belong to an older truck that never weighed in.
    const newestFirst = [...this.pending.values()].reverse();
    const pending =
      newestFirst.find((p) => input.cardNo && p.cardNo === input.cardNo) ??
      newestFirst.find((p) => normalizePlate(p.plate) === normalizePlate(input.plate));
    // The weigh-in uses up the pending truck, as CWIS does.
    if (pending) this.pending.delete(pending.tripNo);
    const at = this.now();
    const ticket: CwisTicket = {
      ticketNo: `WB${this.nextTicket++}`,
      plate: input.plate,
      sdoNos: [...(input.sdoNos ?? pending?.sdoNos ?? [])],
      transporterName: pending?.transporterName ?? null,
      vmsTripNo: pending?.tripNo ?? null,
      weighInAt: at,
      weighOutAt: null,
      updatedAt: at,
    };
    this.tickets.set(ticket.ticketNo, ticket);
    // Simulated scale: empty lorry 9.5 to 14 t, pipes 6 to 18 t, coils heavier.
    // Same numbers for the same ticket every run.
    const n = this.nextTicket;
    const tare = 9500 + ((n * 7919) % 45) * 100;
    const load = 6000 + ((n * 104729) % 60) * 200;
    const outbound = ticket.sdoNos.length > 0;
    this.weights.set(ticket.ticketNo, {
      inKg: outbound ? tare : tare + load + 8000,
      outKg: null,
    });
    this.plannedOut.set(ticket.ticketNo, outbound ? tare + load : tare);
    return structuredClone(ticket);
  }

  weighOut(ticketNo: string): CwisTicket {
    const t = this.tickets.get(ticketNo);
    if (!t) throw new Error(`ticket ${ticketNo} not found`);
    t.weighOutAt = this.now();
    t.updatedAt = t.weighOutAt;
    const w = this.weights.get(ticketNo);
    if (w) w.outKg = this.plannedOut.get(ticketNo) ?? w.inKg;
    if (w)
      w.outKg =
        w.inKg +
        (t.sdoNos.length ? 6000 + ((w.inKg * 31) % 60) * 200 : -((w.inKg * 13) % 30) * 100 - 15000);
    return structuredClone(t);
  }

  setOffline(offline: boolean) {
    this.offline = offline;
  }

  private reach() {
    if (this.offline) throw new CwisUnavailableError();
  }
}

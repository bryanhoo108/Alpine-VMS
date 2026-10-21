/**
 * CWIS weighbridge software. Read-only for tickets: the VMS never writes into
 * CWIS's own tables. Carry-forward of truck details goes through
 * pushPendingTruck: option A (vendor API / staging table) or option C
 * (RFID reader as keyboard + synced lists). See docs/SPEC.md "CWIS integration".
 */

export interface CwisTicket {
  ticketNo: string;
  plate: string;
  sdoNo: string | null;
  transporterName: string | null;
  /** VMS trip number, when the ticket was created from a pending truck (option A). */
  vmsTripNo: string | null;
  weighInAt: Date | null;
  weighOutAt: Date | null;
  updatedAt: Date;
}

/** Details carried forward so the weighbridge operator does not re-key. */
export interface PendingTruck {
  tripNo: string;
  cardNo: string | null;
  plate: string;
  transporterName: string | null;
  driverName: string | null;
  sdoNos: string[];
}

export interface CwisAdapter {
  /** Tickets created or changed since a time (all tickets if omitted). */
  listTickets(opts?: { updatedSince?: Date }): Promise<CwisTicket[]>;
  /**
   * Create or update the pending truck for a trip (keyed by tripNo).
   * Throws when CWIS is unreachable; the caller's queue retries.
   */
  pushPendingTruck(truck: PendingTruck): Promise<void>;
}

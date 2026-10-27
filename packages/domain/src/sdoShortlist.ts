/**
 * The clerk's shortlist of open SDOs for a truck (docs/SPEC.md "Screens by role").
 * Most likely first:
 *   1. SDOs on the truck's CWIS ticket
 *   2. SDOs for customers this transporter has carried for before
 *   3. everything else, newest first
 * SDOs already linked to this truck are left out.
 */

export interface ShortlistSdo {
  sdoNo: string;
  customerCode: string;
  docDate: Date;
}

export type ShortlistReason = 'on_ticket' | 'usual_customer' | 'open';

export interface ShortlistContext {
  linkedSdoNos: readonly string[];
  ticketSdoNos: readonly string[];
  /** Customers on SDOs this transporter's earlier trips carried. */
  usualCustomerCodes: readonly string[];
}

export interface ShortlistEntry<T extends ShortlistSdo> {
  sdo: T;
  reason: ShortlistReason;
}

const RANK: Record<ShortlistReason, number> = { on_ticket: 0, usual_customer: 1, open: 2 };

export function rankSdos<T extends ShortlistSdo>(
  sdos: readonly T[],
  ctx: ShortlistContext,
): ShortlistEntry<T>[] {
  const linked = new Set(ctx.linkedSdoNos);
  const onTicket = new Set(ctx.ticketSdoNos);
  const usual = new Set(ctx.usualCustomerCodes);
  return sdos
    .filter((s) => !linked.has(s.sdoNo))
    .map((sdo) => ({
      sdo,
      reason: onTicket.has(sdo.sdoNo)
        ? ('on_ticket' as const)
        : usual.has(sdo.customerCode)
          ? ('usual_customer' as const)
          : ('open' as const),
    }))
    .sort(
      (a, b) =>
        RANK[a.reason] - RANK[b.reason] ||
        b.sdo.docDate.getTime() - a.sdo.docDate.getTime() ||
        a.sdo.sdoNo.localeCompare(b.sdo.sdoNo),
    );
}

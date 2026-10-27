/**
 * CWIS integration (docs/SPEC.md "CWIS integration").
 * - Carry-forward: each trip's details are queued in cwis_pushes and sent by
 *   a background job with retries, so the gate never waits on CWIS.
 * - Read-back: tickets are polled read-only, copied into weigh_tickets and
 *   linked to trips; a CWIS plate that differs from the LPR plate raises an
 *   amber alert.
 */
import type { PendingTruck } from '@vms/adapters';
import { matchTicketToTrip, platesMatch, raise } from '@vms/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  alerts,
  cards,
  cwisPushes,
  persons,
  transporters,
  trips,
  tripSdos,
  weighTickets,
} from '../db/schema.js';
import { deliverAlerts, recordAlerts, type AlertRow } from './alerts.js';
import type { DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { queueDoUdfs } from './dos.js';
import { retryDelayMs } from './retry.js';
import type { Site } from './sites.js';

// --- Carry-forward (VMS → CWIS) -----------------------------------------------

/** Current carry-forward details of a trip, read from the database. */
export async function pendingTruckOf(db: DbOrTx, tripId: string): Promise<PendingTruck> {
  const [row] = await db
    .select({
      tripNo: trips.tripNo,
      plate: trips.plateIn,
      cardNo: cards.cardNo,
      transporterName: transporters.name,
      driverName: persons.name,
    })
    .from(trips)
    .leftJoin(cards, eq(cards.id, trips.cardId))
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .leftJoin(persons, eq(persons.id, trips.driverId))
    .where(eq(trips.id, tripId));
  if (!row) throw new Error(`trip ${tripId} not found`);
  const sdos = await db
    .select({ sdoNo: tripSdos.sdoNo })
    .from(tripSdos)
    .where(eq(tripSdos.tripId, tripId))
    .orderBy(asc(tripSdos.linkedAt), asc(tripSdos.sdoNo));
  return {
    tripNo: row.tripNo,
    cardNo: row.cardNo,
    plate: row.plate,
    transporterName: row.transporterName,
    driverName: row.driverName,
    sdoNos: sdos.map((s) => s.sdoNo),
  };
}

/**
 * Queue the trip's current details for CWIS. A push still waiting is updated
 * in place, so CWIS always gets the latest details once.
 */
export async function queueCwisPush(db: DbOrTx, siteId: string, tripId: string, now: Date) {
  const payload = await pendingTruckOf(db, tripId);
  const [waiting] = await db
    .select({ id: cwisPushes.id })
    .from(cwisPushes)
    .where(and(eq(cwisPushes.tripId, tripId), eq(cwisPushes.status, 'pending')));
  if (waiting) {
    await db
      .update(cwisPushes)
      .set({ payload, nextAttemptAt: now })
      .where(eq(cwisPushes.id, waiting.id));
  } else {
    await db.insert(cwisPushes).values({ siteId, tripId, payload, nextAttemptAt: now });
  }
}

export { retryDelayMs } from './retry.js';
/** Send due carry-forward pushes. Returns how many were sent. */
export async function sendCwisPushes(deps: ServiceDeps, site: Site, limit = 50): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select()
    .from(cwisPushes)
    .where(
      and(
        eq(cwisPushes.siteId, site.id),
        eq(cwisPushes.status, 'pending'),
        lte(cwisPushes.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(cwisPushes.createdAt))
    .limit(limit);
  let sent = 0;
  for (const push of due) {
    try {
      await deps.adapters.cwis.pushPendingTruck(push.payload as PendingTruck);
      await deps.db
        .update(cwisPushes)
        .set({ status: 'done', doneAt: now, attempts: push.attempts + 1, lastError: null })
        .where(eq(cwisPushes.id, push.id));
      sent++;
    } catch (err) {
      const attempts = push.attempts + 1;
      await deps.db
        .update(cwisPushes)
        .set({
          attempts,
          lastError: (err as Error).message,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
        })
        .where(eq(cwisPushes.id, push.id));
    }
  }
  return sent;
}

// --- Read-back (CWIS → VMS) ---------------------------------------------------

/** Unlinked tickets younger than this are retried against trips on site. */
export const RELINK_HOURS = 24;

async function openTripsForMatching(db: DbOrTx, siteId: string) {
  const open = await db
    .select({ id: trips.id, tripNo: trips.tripNo, plate: trips.plateIn })
    .from(trips)
    .where(and(eq(trips.siteId, siteId), eq(trips.status, 'on_site')));
  if (open.length === 0) return [];
  const links = await db
    .select({ tripId: tripSdos.tripId, sdoNo: tripSdos.sdoNo })
    .from(tripSdos)
    .where(
      inArray(
        tripSdos.tripId,
        open.map((t) => t.id),
      ),
    );
  return open.map((t) => ({
    ...t,
    sdoNos: links.filter((l) => l.tripId === t.id).map((l) => l.sdoNo),
  }));
}

/**
 * Copy new and changed tickets from CWIS, link unlinked ones to trips on
 * site, and flag plate mismatches. Throws if CWIS is unreachable (the job
 * just tries again next time). Returns the trips that changed.
 */
export async function pollCwisTickets(deps: ServiceDeps, site: Site): Promise<string[]> {
  const { db } = deps;
  const now = deps.now();
  const [last] = await db
    .select({ at: weighTickets.cwisUpdatedAt })
    .from(weighTickets)
    .where(eq(weighTickets.siteId, site.id))
    .orderBy(desc(weighTickets.cwisUpdatedAt))
    .limit(1);
  const tickets = await deps.adapters.cwis.listTickets(last ? { updatedSince: last.at } : {});

  const changed = new Set<string>();
  const newAlerts: { row: AlertRow; tripNo: string; plate: string }[] = [];

  await db.transaction(async (tx) => {
    const openTrips = await openTripsForMatching(tx, site.id);

    // Weighbridge cross-check: CWIS plate vs LPR plate, once per ticket.
    const checkPlate = async (tripId: string, ticketNo: string, cwisPlate: string) => {
      const trip = openTrips.find((o) => o.id === tripId);
      if (!trip || platesMatch(cwisPlate, trip.plate)) return;
      const [already] = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.tripId, tripId),
            eq(alerts.type, 'PLATE_MISMATCH'),
            sql`${alerts.detail}->>'ticketNo' = ${ticketNo}`,
          ),
        );
      if (already) return;
      const rows = await recordAlerts(
        tx,
        site.id,
        tripId,
        [raise('PLATE_MISMATCH', { ticketNo, lpr: trip.plate, cwis: cwisPlate })],
        now,
      );
      newAlerts.push(...rows.map((row) => ({ row, tripNo: trip.tripNo, plate: trip.plate })));
    };

    for (const t of tickets) {
      const [existing] = await tx
        .select({ tripId: weighTickets.tripId })
        .from(weighTickets)
        .where(and(eq(weighTickets.siteId, site.id), eq(weighTickets.ticketNo, t.ticketNo)));
      const tripId = existing?.tripId ?? matchTicketToTrip(t, openTrips)?.tripId ?? null;
      const values = {
        plate: t.plate,
        sdoNos: t.sdoNos,
        transporterName: t.transporterName,
        vmsTripNo: t.vmsTripNo,
        weighInAt: t.weighInAt,
        weighOutAt: t.weighOutAt,
        cwisUpdatedAt: t.updatedAt,
        fetchedAt: now,
        tripId,
      };
      await tx
        .insert(weighTickets)
        .values({ siteId: site.id, ticketNo: t.ticketNo, ...values })
        .onConflictDoUpdate({ target: [weighTickets.siteId, weighTickets.ticketNo], set: values });
      if (!tripId) continue;
      changed.add(tripId);
      await checkPlate(tripId, t.ticketNo, t.plate);
    }

    // Tickets that arrived before the clerk matched the truck: try again.
    const since = new Date(now.getTime() - RELINK_HOURS * 3_600_000);
    const waiting = await tx
      .select()
      .from(weighTickets)
      .where(
        and(
          eq(weighTickets.siteId, site.id),
          isNull(weighTickets.tripId),
          gte(weighTickets.cwisUpdatedAt, since),
        ),
      );
    for (const w of waiting) {
      const match = matchTicketToTrip(w, openTrips);
      if (!match) continue;
      await tx
        .update(weighTickets)
        .set({ tripId: match.tripId })
        .where(and(eq(weighTickets.siteId, site.id), eq(weighTickets.ticketNo, w.ticketNo)));
      changed.add(match.tripId);
      await checkPlate(match.tripId, w.ticketNo, w.plate);
    }

    // The WB ticket goes onto the trip's DOs in SAP.
    for (const tripId of changed) await queueDoUdfs(tx, site.id, tripId, now);
  });

  for (const tripId of changed) deps.events.publish({ type: 'trip_changed', tripId });
  for (const a of newAlerts) {
    await deliverAlerts(db, deps.adapters.notifier, deps.events, [a.row], {
      siteCode: site.code,
      tripNo: a.tripNo,
      plate: a.plate,
      at: now,
    });
  }
  return [...changed];
}

/** Tickets not linked to any trip, for the clerk to look at. */
export async function unlinkedTickets(db: DbOrTx, siteId: string) {
  return db
    .select()
    .from(weighTickets)
    .where(and(eq(weighTickets.siteId, siteId), isNull(weighTickets.tripId)))
    .orderBy(desc(weighTickets.cwisUpdatedAt))
    .limit(50);
}

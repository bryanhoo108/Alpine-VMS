/**
 * Clerk screen (docs/SPEC.md "Screens by role"): trucks on site, match each
 * truck to one or more SDOs, pre-registrations, and fixing exceptions.
 */
import {
  ALERTS,
  normalizePlate,
  preRegStatus,
  rankSdos,
  type AlertType,
  type ShortlistReason,
} from '@vms/domain';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
  alerts,
  checkerDecisions,
  persons,
  photos,
  preRegistrations,
  sdoCache,
  transporters,
  trips,
  tripDos,
  tripSdos,
  users,
  vehicles,
  weighTickets,
} from '../db/schema.js';
import { addDays, siteDate } from '../time.js';
import { audit, type DbOrTx } from './audit.js';
import { queueCwisPush } from './cwis.js';
import type { ServiceDeps } from './deps.js';
import { conflict, notFound, ServiceError } from './errors.js';
import { cachedSdos } from './sdoCache.js';
import type { Site } from './sites.js';

type Trip = typeof trips.$inferSelect;

async function tripOnSite(db: DbOrTx, site: Site, tripId: string): Promise<Trip> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.siteId, site.id), eq(trips.id, tripId)));
  if (!trip) throw notFound('TRIP_NOT_FOUND');
  if (trip.status !== 'on_site') throw conflict('TRIP_CLOSED');
  return trip;
}

// --- Trucks on site -------------------------------------------------------------

export interface TripSummary {
  id: string;
  tripNo: string;
  type: 'outbound' | 'inbound';
  plate: string;
  transporterName: string | null;
  gateInAt: Date;
  preAdvised: boolean;
  sdoNos: string[];
  stage: {
    matched: boolean;
    weighedIn: boolean;
    weighedOut: boolean;
    checked: 'approve' | 'reject' | null;
    doCount: number;
  };
  alertLevel: 'red' | 'amber' | null;
}

export async function tripsOnSite(deps: ServiceDeps, site: Site): Promise<TripSummary[]> {
  const { db } = deps;
  const rows = await db
    .select({
      id: trips.id,
      tripNo: trips.tripNo,
      type: trips.type,
      plate: trips.plateIn,
      transporterName: transporters.name,
      gateInAt: trips.gateInAt,
      preRegistrationId: trips.preRegistrationId,
    })
    .from(trips)
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .where(and(eq(trips.siteId, site.id), eq(trips.status, 'on_site')))
    .orderBy(desc(trips.gateInAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [sdos, tickets, decisions, dos, open] = await Promise.all([
    db.select().from(tripSdos).where(inArray(tripSdos.tripId, ids)),
    db
      .select({
        tripId: weighTickets.tripId,
        in: weighTickets.weighInAt,
        out: weighTickets.weighOutAt,
      })
      .from(weighTickets)
      .where(inArray(weighTickets.tripId, ids)),
    db
      .select({ tripId: checkerDecisions.tripId, decision: checkerDecisions.decision })
      .from(checkerDecisions)
      .where(inArray(checkerDecisions.tripId, ids))
      .orderBy(asc(checkerDecisions.decidedAt)),
    db
      .select({ tripId: tripDos.tripId })
      .from(tripDos)
      .where(and(inArray(tripDos.tripId, ids), eq(tripDos.state, 'linked'))),
    db
      .select({ tripId: alerts.tripId, level: alerts.level })
      .from(alerts)
      .where(
        and(inArray(alerts.tripId, ids), isNull(alerts.clearedAt), ne(alerts.level, 'logged')),
      ),
  ]);

  return rows.map((r) => {
    const latest = decisions.filter((d) => d.tripId === r.id).at(-1);
    const levels = open.filter((a) => a.tripId === r.id).map((a) => a.level);
    const myTickets = tickets.filter((t) => t.tripId === r.id);
    const sdoNos = sdos.filter((s) => s.tripId === r.id).map((s) => s.sdoNo);
    return {
      id: r.id,
      tripNo: r.tripNo,
      type: r.type,
      plate: r.plate,
      transporterName: r.transporterName,
      gateInAt: r.gateInAt,
      preAdvised: r.preRegistrationId !== null,
      sdoNos,
      stage: {
        matched: sdoNos.length > 0,
        weighedIn: myTickets.some((t) => t.in !== null),
        weighedOut: myTickets.some((t) => t.out !== null),
        checked: latest?.decision ?? null,
        doCount: dos.filter((d) => d.tripId === r.id).length,
      },
      alertLevel: levels.includes('red') ? 'red' : levels.includes('amber') ? 'amber' : null,
    };
  });
}

// --- One truck -------------------------------------------------------------------

export interface SdoView {
  sdoNo: string;
  customerName: string | null;
  status: string | null;
  docDate: Date | null;
  lines: { lineNo: number; size: string; spec: string; length: string; pieces: number }[];
}

const sdoView = (sdoNo: string, c: Awaited<ReturnType<typeof cachedSdos>>): SdoView => {
  const s = c.get(sdoNo);
  return {
    sdoNo,
    customerName: s?.customerName ?? null,
    status: s?.status ?? null,
    docDate: s?.docDate ?? null,
    lines: (s?.lines ?? []).map((l) => ({
      lineNo: l.lineNo,
      size: l.size,
      spec: l.spec,
      length: l.length,
      pieces: l.pieces,
    })),
  };
};

export async function tripDetail(deps: ServiceDeps, site: Site, tripId: string) {
  const { db } = deps;
  const [row] = await db
    .select({
      trip: trips,
      transporterName: transporters.name,
      driverName: persons.name,
      driverIcLast4: persons.icLast4,
      gateInByName: users.displayName,
    })
    .from(trips)
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .leftJoin(persons, eq(persons.id, trips.driverId))
    .leftJoin(users, eq(users.id, trips.gateInBy))
    .where(and(eq(trips.siteId, site.id), eq(trips.id, tripId)));
  if (!row) throw notFound('TRIP_NOT_FOUND');
  const { trip } = row;

  const [links, tickets, tripPhotos, tripAlerts] = await Promise.all([
    db.select().from(tripSdos).where(eq(tripSdos.tripId, tripId)).orderBy(asc(tripSdos.linkedAt)),
    db
      .select()
      .from(weighTickets)
      .where(eq(weighTickets.tripId, tripId))
      .orderBy(asc(weighTickets.weighInAt)),
    db
      .select({ id: photos.id, kind: photos.kind })
      .from(photos)
      .where(and(eq(photos.tripId, tripId), isNull(photos.deletedAt)))
      .orderBy(asc(photos.takenAt)),
    db.select().from(alerts).where(eq(alerts.tripId, tripId)).orderBy(desc(alerts.raisedAt)),
  ]);

  const openSdos = await db
    .select({
      sdoNo: sdoCache.sdoNo,
      customerCode: sdoCache.customerCode,
      docDate: sdoCache.docDate,
    })
    .from(sdoCache)
    .where(and(eq(sdoCache.siteId, site.id), eq(sdoCache.status, 'open')));
  const linkedNos = links.map((l) => l.sdoNo);
  const ticketSdoNos = tickets.flatMap((t) => t.sdoNos);
  const usualCustomerCodes = trip.transporterId
    ? await usualCustomers(db, site.id, trip.transporterId, trip.id)
    : [];
  const shortlist =
    trip.type === 'outbound'
      ? rankSdos(openSdos, { linkedSdoNos: linkedNos, ticketSdoNos, usualCustomerCodes })
      : [];
  const cache = await cachedSdos(db, site.id, [
    ...new Set([...linkedNos, ...shortlist.map((s) => s.sdo.sdoNo)]),
  ]);

  return {
    id: trip.id,
    tripNo: trip.tripNo,
    type: trip.type,
    status: trip.status,
    plate: trip.plateIn,
    gateInAt: trip.gateInAt,
    gateInBy: row.gateInByName,
    transporterId: trip.transporterId,
    transporterName: row.transporterName,
    driver: trip.driverId ? { name: row.driverName, icLast4: row.driverIcLast4 } : null,
    preAdvised: trip.preRegistrationId !== null,
    photos: tripPhotos,
    sdos: links.map((l) => {
      const c = cache.get(l.sdoNo);
      return {
        ...sdoView(l.sdoNo, cache),
        source: l.source,
        linkedAt: l.linkedAt,
        changed: !!c && !!l.sdoVersionAtLink && c.version !== l.sdoVersionAtLink,
      };
    }),
    shortlist: shortlist.map((e) => ({
      ...sdoView(e.sdo.sdoNo, cache),
      reason: e.reason as ShortlistReason,
    })),
    tickets: tickets.map((t) => ({
      ticketNo: t.ticketNo,
      plate: t.plate,
      plateDiffers: normalizePlate(t.plate) !== trip.plateIn,
      sdoNos: t.sdoNos,
      weighInAt: t.weighInAt,
      weighOutAt: t.weighOutAt,
    })),
    alerts: tripAlerts.map(alertView),
  };
}

/** Customers on SDOs carried by this transporter's other trips (shortlist hint). */
async function usualCustomers(
  db: DbOrTx,
  siteId: string,
  transporterId: string,
  exceptTripId: string,
) {
  const rows = await db
    .selectDistinct({ code: sdoCache.customerCode })
    .from(tripSdos)
    .innerJoin(trips, eq(trips.id, tripSdos.tripId))
    .innerJoin(
      sdoCache,
      and(eq(sdoCache.siteId, tripSdos.siteId), eq(sdoCache.sdoNo, tripSdos.sdoNo)),
    )
    .where(
      and(
        eq(trips.siteId, siteId),
        eq(trips.transporterId, transporterId),
        ne(trips.id, exceptTripId),
      ),
    );
  return rows.map((r) => r.code);
}

// --- Matching SDOs -----------------------------------------------------------------

async function afterTripEdit(deps: ServiceDeps, siteId: string, tripId: string, now: Date) {
  await queueCwisPush(deps.db, siteId, tripId, now);
  deps.events.publish({ type: 'trip_changed', tripId });
}

export async function linkSdos(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  sdoNos: string[],
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const trip = await tripOnSite(tx, site, tripId);
    if (trip.type !== 'outbound') throw conflict('NOT_OUTBOUND');
    const cache = await cachedSdos(tx, site.id, sdoNos);
    for (const sdoNo of sdoNos) {
      const sdo = cache.get(sdoNo);
      if (!sdo) throw new ServiceError(404, 'SDO_NOT_FOUND');
      if (sdo.status !== 'open') throw conflict('SDO_CLOSED');
    }
    const inserted = await tx
      .insert(tripSdos)
      .values(
        sdoNos.map((sdoNo) => ({
          siteId: site.id,
          tripId,
          sdoNo,
          source: 'clerk' as const,
          linkedBy: userId,
          linkedAt: now,
          sdoVersionAtLink: cache.get(sdoNo)!.version,
        })),
      )
      .onConflictDoNothing()
      .returning({ sdoNo: tripSdos.sdoNo });
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'link_sdo',
      entity: 'trip',
      entityId: tripId,
      after: { sdoNos: inserted.map((i) => i.sdoNo) },
      at: now,
    });
  });
  await afterTripEdit(deps, site.id, tripId, now);
}

export async function unlinkSdo(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  sdoNo: string,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await tripOnSite(tx, site, tripId);
    const removed = await tx
      .delete(tripSdos)
      .where(and(eq(tripSdos.tripId, tripId), eq(tripSdos.sdoNo, sdoNo)))
      .returning();
    if (removed.length === 0) throw notFound('SDO_NOT_LINKED');
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'unlink_sdo',
      entity: 'trip',
      entityId: tripId,
      before: removed[0],
      at: now,
    });
  });
  await afterTripEdit(deps, site.id, tripId, now);
}

// --- Company and driver -------------------------------------------------------------

export async function setTransporter(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  transporterId: string | null,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const trip = await tripOnSite(tx, site, tripId);
    if (transporterId) {
      const [t] = await tx
        .select({ id: transporters.id })
        .from(transporters)
        .where(and(eq(transporters.siteId, site.id), eq(transporters.id, transporterId)));
      if (!t) throw notFound('TRANSPORTER_NOT_FOUND');
    }
    await tx.update(trips).set({ transporterId }).where(eq(trips.id, tripId));
    // Plate history learns the company for next time.
    await tx.update(vehicles).set({ transporterId }).where(eq(vehicles.id, trip.vehicleId));
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'set_transporter',
      entity: 'trip',
      entityId: tripId,
      before: { transporterId: trip.transporterId },
      after: { transporterId },
      at: now,
    });
  });
  await afterTripEdit(deps, site.id, tripId, now);
}

export async function setDriver(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  driver: { name: string; icLast4: string | null },
) {
  if (driver.icLast4 !== null && !/^\d{4}$/.test(driver.icLast4)) {
    throw new ServiceError(400, 'IC_LAST4_INVALID');
  }
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const trip = await tripOnSite(tx, site, tripId);
    const [person] = await tx
      .insert(persons)
      .values({
        siteId: site.id,
        name: driver.name.trim(),
        icLast4: driver.icLast4,
        transporterId: trip.transporterId,
      })
      .returning({ id: persons.id });
    await tx.update(trips).set({ driverId: person!.id }).where(eq(trips.id, tripId));
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'set_driver',
      entity: 'trip',
      entityId: tripId,
      before: { driverId: trip.driverId },
      // Only the masked IC goes into the audit trail.
      after: { driverId: person!.id, name: driver.name.trim(), icLast4: driver.icLast4 },
      at: now,
    });
  });
  await afterTripEdit(deps, site.id, tripId, now);
}

// --- Pre-registrations ---------------------------------------------------------------

export async function listPreRegistrations(deps: ServiceDeps, site: Site) {
  const today = siteDate(deps.now(), site.timezone);
  // Open ones (expected or late, never hidden) and anything settled in the last 2 days.
  const recent = new Date(deps.now().getTime() - 2 * 86_400_000);
  const rows = await deps.db
    .select({ p: preRegistrations, transporterName: transporters.name, tripNo: trips.tripNo })
    .from(preRegistrations)
    .leftJoin(transporters, eq(transporters.id, preRegistrations.transporterId))
    .leftJoin(trips, eq(trips.id, preRegistrations.arrivedTripId))
    .where(
      and(
        eq(preRegistrations.siteId, site.id),
        or(
          and(isNull(preRegistrations.arrivedTripId), isNull(preRegistrations.clearedAt)),
          gte(preRegistrations.clearedAt, recent),
          and(isNotNull(preRegistrations.arrivedTripId), gte(trips.gateInAt, recent)),
          gte(preRegistrations.expectedDate, addDays(today, -2)),
        ),
      ),
    )
    .orderBy(asc(preRegistrations.expectedDate), asc(preRegistrations.plate));
  const order = { late: 0, expected: 1, arrived: 2, cleared: 3 } as const;
  return rows
    .map(({ p, transporterName, tripNo }) => ({
      id: p.id,
      plate: p.plate,
      expectedDate: p.expectedDate,
      sdoNos: p.sdoNos,
      transporterId: p.transporterId,
      transporterName,
      note: p.note,
      status: preRegStatus(
        {
          id: p.id,
          plate: p.plate,
          expectedDate: p.expectedDate,
          sdoNos: p.sdoNos,
          arrivedTripId: p.arrivedTripId,
          clearedAt: p.clearedAt,
        },
        today,
      ),
      tripNo,
      clearReason: p.clearReason,
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

export interface NewPreRegistration {
  plate: string;
  expectedDate: string;
  sdoNos: string[];
  transporterId: string | null;
  note: string | null;
}

export async function createPreRegistration(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  input: NewPreRegistration,
) {
  const plate = normalizePlate(input.plate);
  if (plate.length < 2) throw new ServiceError(400, 'PLATE_INVALID');
  if (input.sdoNos.length === 0) throw new ServiceError(400, 'SDO_REQUIRED');
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const cache = await cachedSdos(tx, site.id, input.sdoNos);
    for (const sdoNo of input.sdoNos) {
      if (cache.get(sdoNo)?.status !== 'open') throw new ServiceError(404, 'SDO_NOT_FOUND');
    }
    const [row] = await tx
      .insert(preRegistrations)
      .values({
        siteId: site.id,
        plate,
        expectedDate: input.expectedDate,
        sdoNos: [...new Set(input.sdoNos)],
        transporterId: input.transporterId,
        note: input.note?.trim() || null,
        createdBy: userId,
        createdAt: now,
      })
      .returning();
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'pre_register',
      entity: 'pre_registration',
      entityId: row!.id,
      after: row,
      at: now,
    });
    return row!;
  });
}

export async function clearPreRegistration(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  id: string,
  reason: string,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const cleared = await tx
      .update(preRegistrations)
      .set({ clearedAt: now, clearedBy: userId, clearReason: reason.trim() })
      .where(
        and(
          eq(preRegistrations.siteId, site.id),
          eq(preRegistrations.id, id),
          isNull(preRegistrations.arrivedTripId),
          isNull(preRegistrations.clearedAt),
        ),
      )
      .returning();
    if (cleared.length === 0) throw conflict('NOT_OPEN');
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'clear_pre_registration',
      entity: 'pre_registration',
      entityId: id,
      after: { reason: reason.trim() },
      at: now,
    });
  });
}

// --- Alerts ------------------------------------------------------------------------

const alertView = (a: typeof alerts.$inferSelect) => ({
  id: a.id,
  type: a.type,
  label: ALERTS[a.type as AlertType]?.label ?? a.type,
  level: a.level,
  detail: a.detail as Record<string, string> | null,
  raisedAt: a.raisedAt,
  clearedAt: a.clearedAt,
  clearReason: a.clearReason,
});

/** Open amber and red alerts (logged-only ones are history, not exceptions). */
export async function openAlerts(deps: ServiceDeps, site: Site) {
  const rows = await deps.db
    .select({ a: alerts, tripNo: trips.tripNo, plate: trips.plateIn })
    .from(alerts)
    .leftJoin(trips, eq(trips.id, alerts.tripId))
    .where(and(eq(alerts.siteId, site.id), isNull(alerts.clearedAt), ne(alerts.level, 'logged')))
    .orderBy(sql`case when ${alerts.level} = 'red' then 0 else 1 end`, desc(alerts.raisedAt));
  return rows.map((r) => ({
    ...alertView(r.a),
    tripId: r.a.tripId,
    tripNo: r.tripNo,
    plate: r.plate,
  }));
}

export async function clearAlert(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  alertId: string,
  reason: string,
) {
  const now = deps.now();
  const tripId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(alerts)
      .set({ clearedAt: now, clearedBy: userId, clearReason: reason.trim() })
      .where(and(eq(alerts.siteId, site.id), eq(alerts.id, alertId), isNull(alerts.clearedAt)))
      .returning();
    if (!row) throw conflict('ALREADY_CLEARED');
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'clear_alert',
      entity: 'alert',
      entityId: alertId,
      after: { reason: reason.trim(), type: row.type },
      at: now,
    });
    return row.tripId;
  });
  if (tripId) deps.events.publish({ type: 'trip_changed', tripId });
}

/** Transporters and open SDOs for the clerk's pickers. */
export async function clerkLists(deps: ServiceDeps, site: Site) {
  const [transporterList, sdos] = await Promise.all([
    deps.db
      .select({ id: transporters.id, name: transporters.name })
      .from(transporters)
      .where(and(eq(transporters.siteId, site.id), eq(transporters.active, true)))
      .orderBy(asc(transporters.name)),
    deps.db
      .select({
        sdoNo: sdoCache.sdoNo,
        customerName: sdoCache.customerName,
        docDate: sdoCache.docDate,
      })
      .from(sdoCache)
      .where(and(eq(sdoCache.siteId, site.id), eq(sdoCache.status, 'open')))
      .orderBy(desc(sdoCache.docDate), asc(sdoCache.sdoNo)),
  ]);
  return {
    transporters: transporterList,
    openSdos: sdos,
    today: siteDate(deps.now(), site.timezone),
  };
}

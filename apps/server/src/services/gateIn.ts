/**
 * Gate in (docs/SPEC.md "Outbound pipe flow" step 1, "Inbound coil flow" step 1).
 * Records the trip and raises alerts; it never refuses a truck. The only
 * refusal is a card problem, and the guard simply taps another card.
 */
import type { Adapters, PendingTruck } from '@vms/adapters';
import {
  findPreRegistration,
  gateInAlerts,
  issueCard,
  normalizeCardNo,
  normalizePlate,
  openPreRegistrations,
  type CardError,
  type PreRegistration,
  type RaisedAlert,
} from '@vms/domain';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import {
  cards,
  cwisPushes,
  photos,
  plateReads,
  preRegistrations,
  transporters,
  trips,
  tripSdos,
  vehicles,
  watchlist,
} from '../db/schema.js';
import type { EventBus } from '../events.js';
import { siteDate } from '../time.js';
import { deliverAlerts, recordAlerts } from './alerts.js';
import { audit, type DbOrTx } from './audit.js';
import type { Site } from './sites.js';

export interface ServiceDeps {
  db: Db;
  adapters: Adapters;
  events: EventBus;
  config: Config;
  now: () => Date;
}

/** A camera read older than this is no longer offered to the guard. */
export const PLATE_READ_FRESH_MINUTES = 15;

type PreRegRow = typeof preRegistrations.$inferSelect;

const toDomainPreReg = (p: PreRegRow): PreRegistration => ({
  id: p.id,
  plate: p.plate,
  expectedDate: p.expectedDate,
  sdoNos: p.sdoNos,
  arrivedTripId: p.arrivedTripId,
  clearedAt: p.clearedAt,
});

async function openPreRegs(db: DbOrTx, siteId: string, today: string) {
  const rows = await db
    .select()
    .from(preRegistrations)
    .where(
      and(
        eq(preRegistrations.siteId, siteId),
        isNull(preRegistrations.arrivedTripId),
        isNull(preRegistrations.clearedAt),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    rows: byId,
    open: openPreRegistrations(rows.map(toDomainPreReg), today),
  };
}

async function activeWatchlist(db: DbOrTx, siteId: string) {
  return db
    .select({ kind: watchlist.kind, value: watchlist.value, reason: watchlist.reason })
    .from(watchlist)
    .where(and(eq(watchlist.siteId, siteId), isNull(watchlist.removedAt)));
}

async function platesOnSite(db: DbOrTx, siteId: string) {
  const rows = await db
    .select({ plate: trips.plateIn })
    .from(trips)
    .where(and(eq(trips.siteId, siteId), eq(trips.status, 'on_site')));
  return rows.map((r) => r.plate);
}

async function vehicleByPlate(db: DbOrTx, siteId: string, plate: string) {
  const [v] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.siteId, siteId), eq(vehicles.plate, plate)));
  return v ?? null;
}

// --- What the entry screen shows ----------------------------------------------

export interface EntryState {
  read: {
    id: string;
    plate: string;
    confidence: number;
    photoId: string | null;
    readAt: Date;
    /** Known from plate history; null on a first visit. */
    transporterId: string | null;
    preRegistration: PreRegView | null;
    /** Alerts the guard should see before tapping (watchlist, already inside). */
    alerts: RaisedAlert[];
  } | null;
  openPreRegistrations: PreRegView[];
  transporters: { id: string; name: string }[];
}

export interface PreRegView {
  id: string;
  plate: string;
  expectedDate: string;
  late: boolean;
  sdoNos: string[];
  transporterId: string | null;
}

const preRegView = (p: PreRegRow, today: string): PreRegView => ({
  id: p.id,
  plate: p.plate,
  expectedDate: p.expectedDate,
  late: p.expectedDate < today,
  sdoNos: p.sdoNos,
  transporterId: p.transporterId,
});

export async function entryState(deps: ServiceDeps, site: Site): Promise<EntryState> {
  const { db } = deps;
  const now = deps.now();
  const today = siteDate(now, site.timezone);
  const fresh = new Date(now.getTime() - PLATE_READ_FRESH_MINUTES * 60_000);

  const [latest] = await db
    .select()
    .from(plateReads)
    .where(
      and(
        eq(plateReads.siteId, site.id),
        eq(plateReads.camera, 'entry'),
        isNull(plateReads.tripId),
        gte(plateReads.readAt, fresh),
      ),
    )
    .orderBy(desc(plateReads.readAt))
    .limit(1);

  const pre = await openPreRegs(db, site.id, today);
  const transporterList = await db
    .select({ id: transporters.id, name: transporters.name })
    .from(transporters)
    .where(and(eq(transporters.siteId, site.id), eq(transporters.active, true)))
    .orderBy(asc(transporters.name));

  let read: EntryState['read'] = null;
  if (latest) {
    const vehicle = await vehicleByPlate(db, site.id, latest.plateText);
    const match = findPreRegistration(latest.plateText, pre.open, today);
    const matchRow = match ? pre.rows.get(match.id) : undefined;
    const transporterId = vehicle?.transporterId ?? matchRow?.transporterId ?? null;
    read = {
      id: latest.id,
      plate: latest.plateText,
      confidence: latest.confidence,
      photoId: latest.photoId,
      readAt: latest.readAt,
      transporterId,
      preRegistration: matchRow ? preRegView(matchRow, today) : null,
      alerts: gateInAlerts({
        lprPlate: latest.plateText,
        confirmedPlate: latest.plateText,
        transporterId,
        platesOnSite: await platesOnSite(db, site.id),
        watchlist: await activeWatchlist(db, site.id),
      }),
    };
  }

  return {
    read,
    openPreRegistrations: pre.open.map((p) => preRegView(pre.rows.get(p.id)!, today)),
    transporters: transporterList,
  };
}

// --- Gate in ---------------------------------------------------------------------

export interface GateInInput {
  /** Camera read the guard confirmed, or null when there was no read. */
  plateReadId: string | null;
  /** Plate as confirmed: the read, the guard's correction, or a picked pre-registration. */
  plate: string;
  /** Collect = outbound pipes; Deliver = inbound coil. */
  type: 'outbound' | 'inbound';
  cardNo: string;
  /** IC and document photos uploaded beforehand. */
  photoIds: string[];
  /** Picked by the guard on a first visit; null = skip (clerk fills later). */
  transporterId: string | null;
  /** Set when the guard picked from the pre-registration list (misread plate). */
  preRegistrationId: string | null;
}

export type GateInResult =
  | {
      ok: true;
      trip: { id: string; tripNo: string; plate: string; type: 'outbound' | 'inbound' };
      cardNo: string;
      sdoNos: string[];
      preRegistrationId: string | null;
      alerts: RaisedAlert[];
    }
  | { ok: false; error: CardError | 'CARD_UNKNOWN' | 'PLATE_EMPTY' };

/** T-YYMMDD-NNN, numbered per site per site-local day. Caller holds the site lock. */
async function nextTripNo(db: DbOrTx, siteId: string, today: string): Promise<string> {
  const prefix = `T-${today.slice(2).replaceAll('-', '')}-`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trips)
    .where(and(eq(trips.siteId, siteId), sql`${trips.tripNo} like ${prefix + '%'}`));
  return prefix + String((row?.n ?? 0) + 1).padStart(3, '0');
}

export async function gateIn(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  input: GateInInput,
): Promise<GateInResult> {
  const plate = normalizePlate(input.plate);
  if (plate === '') return { ok: false, error: 'PLATE_EMPTY' };
  const now = deps.now();
  const today = siteDate(now, site.timezone);

  const result = await deps.db.transaction(async (tx) => {
    // One gate-in at a time per site keeps trip numbers and card issue consistent.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gate:' + site.id}))`);

    const [card] = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.siteId, site.id), eq(cards.cardNo, normalizeCardNo(input.cardNo))));
    if (!card) return { ok: false as const, error: 'CARD_UNKNOWN' as const };
    const issued = issueCard(
      { cardNo: card.cardNo, status: card.status, currentTripId: card.currentTripId },
      'pending',
    );
    if (!issued.ok) return { ok: false as const, error: issued.error };

    const read = input.plateReadId
      ? (
          await tx
            .select()
            .from(plateReads)
            .where(and(eq(plateReads.siteId, site.id), eq(plateReads.id, input.plateReadId)))
        )[0]
      : undefined;

    // Pre-registration: the one the guard picked, else an exact plate match.
    const pre = await openPreRegs(tx, site.id, today);
    const picked = input.preRegistrationId ? pre.rows.get(input.preRegistrationId) : undefined;
    const matched = findPreRegistration(plate, pre.open, today);
    const preReg = picked ?? (matched ? pre.rows.get(matched.id) : undefined);

    // Vehicle, learned from plate history.
    const existing = await vehicleByPlate(tx, site.id, plate);
    const transporterId =
      input.transporterId ?? existing?.transporterId ?? preReg?.transporterId ?? null;
    const [vehicle] = await tx
      .insert(vehicles)
      .values({ siteId: site.id, plate, transporterId, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [vehicles.siteId, vehicles.plate],
        set: { lastSeenAt: now, transporterId },
      })
      .returning();

    const raised = gateInAlerts({
      lprPlate: read?.plateText ?? null,
      confirmedPlate: plate,
      transporterId,
      platesOnSite: await platesOnSite(tx, site.id),
      watchlist: await activeWatchlist(tx, site.id),
    });

    const tripNo = await nextTripNo(tx, site.id, today);
    const [trip] = await tx
      .insert(trips)
      .values({
        siteId: site.id,
        tripNo,
        type: input.type,
        vehicleId: vehicle!.id,
        plateIn: plate,
        transporterId,
        cardId: card.id,
        preRegistrationId: preReg?.id ?? null,
        gateInAt: now,
        gateInBy: userId,
      })
      .returning();

    await tx
      .update(cards)
      .set({ status: 'issued', currentTripId: trip!.id })
      .where(eq(cards.id, card.id));

    // SDOs from the pre-registration (outbound only). The SDO version is filled
    // in when the SDO cache has the SDO (step 4), never by waiting on SAP here.
    const sdoNos = input.type === 'outbound' && preReg ? preReg.sdoNos : [];
    if (sdoNos.length > 0) {
      await tx.insert(tripSdos).values(
        sdoNos.map((sdoNo) => ({
          siteId: site.id,
          tripId: trip!.id,
          sdoNo,
          source: 'pre_registration' as const,
          linkedAt: now,
        })),
      );
    }
    if (preReg) {
      await tx
        .update(preRegistrations)
        .set({ arrivedTripId: trip!.id })
        .where(eq(preRegistrations.id, preReg.id));
    }

    if (read) {
      await tx
        .update(plateReads)
        .set({ tripId: trip!.id, confirmedPlate: plate, corrected: read.plateText !== plate })
        .where(eq(plateReads.id, read.id));
    }
    const photoIds = [...input.photoIds, ...(read?.photoId ? [read.photoId] : [])];
    if (photoIds.length > 0) {
      await tx
        .update(photos)
        .set({ tripId: trip!.id })
        .where(
          and(eq(photos.siteId, site.id), inArray(photos.id, photoIds), isNull(photos.tripId)),
        );
    }

    const alertRows = await recordAlerts(tx, site.id, trip!.id, raised, now);

    const transporterName = transporterId
      ? ((
          await tx
            .select({ name: transporters.name })
            .from(transporters)
            .where(eq(transporters.id, transporterId))
        )[0]?.name ?? null)
      : null;
    const pending: PendingTruck = {
      tripNo,
      cardNo: card.cardNo,
      plate,
      transporterName,
      driverName: null,
      sdoNos: [...sdoNos],
    };
    await tx.insert(cwisPushes).values({ siteId: site.id, tripId: trip!.id, payload: pending });

    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'gate_in',
      entity: 'trip',
      entityId: trip!.id,
      after: {
        tripNo,
        plate,
        lprPlate: read?.plateText ?? null,
        type: input.type,
        cardNo: card.cardNo,
        transporterId,
        preRegistrationId: preReg?.id ?? null,
        sdoNos,
        photos: input.photoIds.length,
      },
      at: now,
    });

    return {
      ok: true as const,
      trip: { id: trip!.id, tripNo, plate, type: input.type },
      cardNo: card.cardNo,
      sdoNos: [...sdoNos],
      preRegistrationId: preReg?.id ?? null,
      alerts: raised,
      alertRows,
    };
  });

  if (!result.ok) return result;
  const { alertRows, ...done } = result;
  deps.events.publish({ type: 'trip_changed', tripId: done.trip.id });
  await deliverAlerts(deps.db, deps.adapters.notifier, deps.events, alertRows, {
    siteCode: site.code,
    tripNo: done.trip.tripNo,
    plate: done.trip.plate,
    at: now,
  });
  return done;
}

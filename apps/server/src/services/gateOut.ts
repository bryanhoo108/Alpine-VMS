/**
 * Gate out (docs/SPEC.md "Outbound pipe flow", "Inbound coil flow", "Alerts
 * and controls"). The guard sees green / amber / red with the reasons, the
 * card is collected (or marked lost) and the trip closes. Nothing here ever
 * keeps a truck in: amber and red are recorded and sent to the supervisor.
 */
import {
  collectCard,
  exitStatus,
  markCardLost,
  normalizeCardNo,
  raise,
  selectDosForTrip,
  type ExitStatus,
  type RaisedAlert,
} from '@vms/domain';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  cards,
  checkerDecisions,
  plateReads,
  transporters,
  trips,
  tripSdos,
  weighTickets,
} from '../db/schema.js';
import { deliverAlerts, recordAlerts } from './alerts.js';
import { audit, type DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { queueDoUdfs, tripLinkedDos } from './dos.js';
import { conflict, notFound } from './errors.js';
import { PLATE_READ_FRESH_MINUTES } from './gateIn.js';
import type { Site } from './sites.js';

type Trip = typeof trips.$inferSelect;

/** Exit status of a trip on site, as if the card is (or is not) handed back. */
export async function tripExitStatus(
  db: DbOrTx,
  siteId: string,
  trip: Trip,
  cardReturned: boolean,
): Promise<ExitStatus> {
  const tickets = await db
    .select({ plate: weighTickets.plate, weighOutAt: weighTickets.weighOutAt })
    .from(weighTickets)
    .where(eq(weighTickets.tripId, trip.id));
  const common = {
    lprPlate: trip.plateIn,
    cwisPlates: tickets.map((t) => t.plate),
    cardReturned,
  };
  if (trip.type === 'inbound') {
    return exitStatus({
      type: 'inbound',
      ...common,
      weighOutDone: tickets.some((t) => t.weighOutAt !== null),
    });
  }
  const sdoNos = (
    await db.select({ sdoNo: tripSdos.sdoNo }).from(tripSdos).where(eq(tripSdos.tripId, trip.id))
  ).map((s) => s.sdoNo);
  const dos = await tripLinkedDos(db, siteId, trip.id);
  const coverage = selectDosForTrip({
    tripId: trip.id,
    gateInAt: trip.gateInAt,
    sdoNos,
    dos,
    claims: new Map(),
    manualLinks: dos.map((d) => d.doNo),
  });
  const [latest] = await db
    .select({ decision: checkerDecisions.decision })
    .from(checkerDecisions)
    .where(eq(checkerDecisions.tripId, trip.id))
    .orderBy(desc(checkerDecisions.decidedAt))
    .limit(1);
  return exitStatus({
    type: 'outbound',
    ...common,
    sdoNos,
    sdosWithoutDo: coverage.sdosWithoutDo,
    latestDecision: latest?.decision ?? null,
  });
}

// --- What the exit screen shows ------------------------------------------------------

export interface ExitTruck {
  id: string;
  tripNo: string;
  plate: string;
  type: 'outbound' | 'inbound';
  transporterName: string | null;
  gateInAt: Date;
  /** Status if the card comes back; "No card" adds a red reason. */
  status: ExitStatus;
}

async function exitTruck(db: DbOrTx, site: Site, trip: Trip): Promise<ExitTruck> {
  const [t] = trip.transporterId
    ? await db
        .select({ name: transporters.name })
        .from(transporters)
        .where(eq(transporters.id, trip.transporterId))
    : [];
  return {
    id: trip.id,
    tripNo: trip.tripNo,
    plate: trip.plateIn,
    type: trip.type,
    transporterName: t?.name ?? null,
    gateInAt: trip.gateInAt,
    status: await tripExitStatus(db, site.id, trip, true),
  };
}

async function onSiteTrip(db: DbOrTx, site: Site, tripId: string): Promise<Trip> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.siteId, site.id), eq(trips.id, tripId)));
  if (!trip) throw notFound('TRIP_NOT_FOUND');
  if (trip.status !== 'on_site') throw conflict('TRIP_CLOSED');
  return trip;
}

export interface ExitState {
  read: {
    id: string;
    plate: string;
    confidence: number;
    photoId: string | null;
    readAt: Date;
  } | null;
  /** The truck on site with the plate the exit camera read, if any. */
  truck: ExitTruck | null;
  /** Everything on site, for picking when the plate was misread. */
  onSite: { id: string; tripNo: string; plate: string; type: 'outbound' | 'inbound' }[];
}

export async function exitState(deps: ServiceDeps, site: Site): Promise<ExitState> {
  const { db } = deps;
  const fresh = new Date(deps.now().getTime() - PLATE_READ_FRESH_MINUTES * 60_000);
  const [read] = await db
    .select()
    .from(plateReads)
    .where(
      and(
        eq(plateReads.siteId, site.id),
        eq(plateReads.camera, 'exit'),
        isNull(plateReads.tripId),
        isNull(plateReads.handledAt),
        gte(plateReads.readAt, fresh),
      ),
    )
    .orderBy(desc(plateReads.readAt))
    .limit(1);
  const onSite = await db
    .select()
    .from(trips)
    .where(and(eq(trips.siteId, site.id), eq(trips.status, 'on_site')))
    .orderBy(asc(trips.plateIn));
  const match = read ? onSite.find((t) => t.plateIn === read.plateText) : undefined;
  return {
    read: read
      ? {
          id: read.id,
          plate: read.plateText,
          confidence: read.confidence,
          photoId: read.photoId,
          readAt: read.readAt,
        }
      : null,
    truck: match ? await exitTruck(db, site, match) : null,
    onSite: onSite.map((t) => ({ id: t.id, tripNo: t.tripNo, plate: t.plateIn, type: t.type })),
  };
}

export async function exitTruckById(deps: ServiceDeps, site: Site, tripId: string) {
  return exitTruck(deps.db, site, await onSiteTrip(deps.db, site, tripId));
}

export async function exitTruckByCard(deps: ServiceDeps, site: Site, rawCardNo: string) {
  const [card] = await deps.db
    .select()
    .from(cards)
    .where(and(eq(cards.siteId, site.id), eq(cards.cardNo, normalizeCardNo(rawCardNo))));
  if (!card) throw notFound('CARD_UNKNOWN');
  if (card.status !== 'issued' || !card.currentTripId) throw conflict('CARD_NOT_ON_TRIP');
  return exitTruckById(deps, site, card.currentTripId);
}

// --- Gate out ----------------------------------------------------------------------------

export interface GateOutInput {
  tripId: string;
  /** Exit camera read of this truck, if any. */
  plateReadId: string | null;
  /** The card handed back, or null when the guard taps "No card". */
  cardNo: string | null;
}

export async function gateOut(deps: ServiceDeps, site: Site, userId: string, input: GateOutInput) {
  const now = deps.now();
  const result = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gate:' + site.id}))`);
    const trip = await onSiteTrip(tx, site, input.tripId);
    const [card] = trip.cardId
      ? await tx.select().from(cards).where(eq(cards.id, trip.cardId))
      : [];

    // Card: collect the one handed back, or mark the trip's card lost.
    let cardReturned = false;
    if (input.cardNo !== null) {
      const cardNo = normalizeCardNo(input.cardNo);
      const [handed] = await tx
        .select()
        .from(cards)
        .where(and(eq(cards.siteId, site.id), eq(cards.cardNo, cardNo)));
      if (!handed) throw notFound('CARD_UNKNOWN');
      const collected = collectCard(
        { cardNo: handed.cardNo, status: handed.status, currentTripId: handed.currentTripId },
        trip.id,
      );
      // A card from another truck: the guard taps the right one or "No card".
      if (!collected.ok) throw conflict(collected.error);
      await tx
        .update(cards)
        .set({ status: 'free', currentTripId: null })
        .where(eq(cards.id, handed.id));
      cardReturned = true;
    } else if (card) {
      const lost = markCardLost(
        { cardNo: card.cardNo, status: card.status, currentTripId: card.currentTripId },
        trip.id,
      );
      if (lost.ok) {
        await tx
          .update(cards)
          .set({ status: 'lost', currentTripId: null })
          .where(eq(cards.id, card.id));
        // Lost-card fee goes to the transporter (spec "RFID gate pass").
        if (trip.transporterId) {
          await tx
            .update(transporters)
            .set({ lostCardCount: sql`${transporters.lostCardCount} + 1` })
            .where(eq(transporters.id, trip.transporterId));
        }
      }
    }

    const status = await tripExitStatus(tx, site.id, trip, cardReturned);

    const read = input.plateReadId
      ? (
          await tx
            .select()
            .from(plateReads)
            // A read already used by another truck is ignored, never attached twice.
            .where(
              and(
                eq(plateReads.siteId, site.id),
                eq(plateReads.id, input.plateReadId),
                isNull(plateReads.tripId),
                isNull(plateReads.handledAt),
              ),
            )
        )[0]
      : undefined;
    const extra: RaisedAlert[] = [];
    if (read) {
      await tx
        .update(plateReads)
        .set({
          tripId: trip.id,
          confirmedPlate: trip.plateIn,
          corrected: read.plateText !== trip.plateIn,
        })
        .where(eq(plateReads.id, read.id));
      if (read.plateText !== trip.plateIn) {
        extra.push(
          raise('LPR_CORRECTED', { read: read.plateText, confirmed: trip.plateIn, camera: 'exit' }),
        );
      }
    }

    await tx
      .update(trips)
      .set({
        status: 'closed',
        gateOutAt: now,
        gateOutBy: userId,
        plateOut: read?.plateText ?? null,
        exitLevel: status.level,
        exitReasons: status.reasons,
        cardReturned,
      })
      .where(eq(trips.id, trip.id));

    const alertRows = await recordAlerts(tx, site.id, trip.id, [...status.reasons, ...extra], now);
    // Gate-out time onto the DO(s) in SAP (queued).
    await queueDoUdfs(tx, site.id, trip.id, now);
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'gate_out',
      entity: 'trip',
      entityId: trip.id,
      after: {
        level: status.level,
        reasons: status.reasons.map((r) => r.type),
        cardReturned,
        cardNo: card?.cardNo ?? null,
      },
      at: now,
    });
    return { trip, status, cardReturned, alertRows };
  });

  deps.events.publish({ type: 'trip_changed', tripId: result.trip.id });
  await deliverAlerts(deps.db, deps.adapters.notifier, deps.events, result.alertRows, {
    siteCode: site.code,
    tripNo: result.trip.tripNo,
    plate: result.trip.plateIn,
    at: now,
  });
  return {
    trip: {
      id: result.trip.id,
      tripNo: result.trip.tripNo,
      plate: result.trip.plateIn,
      type: result.trip.type,
    },
    status: result.status,
    cardReturned: result.cardReturned,
  };
}

/** A lost card handed back later goes back into the pool. */
export async function recoverLostCard(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  rawCardNo: string,
) {
  const now = deps.now();
  const cardNo = normalizeCardNo(rawCardNo);
  await deps.db.transaction(async (tx) => {
    const updated = await tx
      .update(cards)
      .set({ status: 'free' })
      .where(and(eq(cards.siteId, site.id), eq(cards.cardNo, cardNo), eq(cards.status, 'lost')))
      .returning();
    if (updated.length === 0) throw conflict('CARD_NOT_LOST');
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'card_recovered',
      entity: 'card',
      entityId: cardNo,
      at: now,
    });
  });
}

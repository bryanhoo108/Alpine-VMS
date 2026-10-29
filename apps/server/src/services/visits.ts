/**
 * Visitors and contractors at the gate (decisions V3, V6–V9): gate in with an
 * invite or as a walk-in, one card per group, and the "Staff" plate log.
 * Nobody is refused: problems are recorded and alerted.
 */
import {
  collectCard,
  headcount,
  inviteState,
  issueCard,
  markCardLost,
  musterProgress,
  visitExitStatus,
  normalizeCardNo,
  normalizePlate,
  validGroupSize,
  visitGateInAlerts,
  type CardError,
  type RaisedAlert,
  type VisitType,
} from '@vms/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  cards,
  hosts,
  invites,
  musterMarks,
  musters,
  photos,
  plateReads,
  staffEntries,
  transporters,
  trips,
  visits,
  type MusterRollEntry,
} from '../db/schema.js';
import { siteDate, siteDateTime } from '../time.js';
import { deliverAlerts, recordAlerts } from './alerts.js';
import { audit, type DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { conflict, notFound, ServiceError } from './errors.js';
import { activeWatchlist } from './gateIn.js';
import type { Site } from './sites.js';

export interface VisitGateInInput {
  /** From a scanned QR or the expected list; null for a walk-in. */
  inviteId: string | null;
  /** Walk-ins: what the visitor typed on the tablet. Ignored when an invite is given. */
  type: VisitType;
  name: string;
  company: string | null;
  phone: string | null;
  hostId: string | null;
  /** People actually at the gate (may differ from the invite). */
  groupSize: number;
  /** Walk-ins: the guard phoned the host and tapped "Host OK". */
  hostConfirmed: boolean;
  /** Car they came in, if any. */
  plate: string | null;
  plateReadId: string | null;
  cardNo: string;
  /** IC photo(s) uploaded beforehand. */
  photoIds: string[];
}

export type VisitGateInResult =
  | {
      ok: true;
      visit: {
        id: string;
        visitNo: string;
        type: VisitType;
        name: string;
        company: string | null;
        groupSize: number;
        host: string | null;
      };
      cardNo: string;
      alerts: RaisedAlert[];
    }
  | { ok: false; error: CardError | 'CARD_UNKNOWN' };

/** V-YYMMDD-NNN, numbered per site per site-local day. Caller holds the gate lock. */
async function nextVisitNo(db: DbOrTx, siteId: string, today: string): Promise<string> {
  const prefix = `V-${today.slice(2).replaceAll('-', '')}-`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(visits)
    .where(and(eq(visits.siteId, siteId), sql`${visits.visitNo} like ${prefix + '%'}`));
  return prefix + String((row?.n ?? 0) + 1).padStart(3, '0');
}

export async function visitGateIn(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  input: VisitGateInInput,
): Promise<VisitGateInResult> {
  if (!validGroupSize(input.groupSize)) throw new ServiceError(400, 'GROUP_SIZE_INVALID');
  const now = deps.now();
  const today = siteDate(now, site.timezone);

  const result = await deps.db.transaction(async (tx) => {
    // Same lock as truck gate in: card issue must not race.
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

    const invite = input.inviteId
      ? (
          await tx
            .select()
            .from(invites)
            .where(and(eq(invites.siteId, site.id), eq(invites.id, input.inviteId)))
        )[0]
      : undefined;
    if (input.inviteId && !invite) throw new ServiceError(404, 'INVITE_NOT_FOUND');
    // An invite for another day, or cancelled, still lets them in: it counts as
    // a walk-in for the host check (the guard phones the host).
    const inviteValid = invite ? inviteState(invite, today) === 'expected' : false;

    const hostId = invite?.hostId ?? input.hostId;
    const host = hostId
      ? (
          await tx
            .select()
            .from(hosts)
            .where(and(eq(hosts.siteId, site.id), eq(hosts.id, hostId)))
        )[0]
      : undefined;
    if (hostId && !host) throw new ServiceError(404, 'HOST_NOT_FOUND');

    const name = (invite?.name ?? input.name).trim();
    if (name.length < 2) throw new ServiceError(400, 'NAME_REQUIRED');
    const type = invite?.type ?? input.type;
    const company = invite?.company ?? (input.company?.trim() || null);
    const phone = invite?.phone ?? (input.phone?.trim() || null);
    const hostConfirmed = inviteValid || input.hostConfirmed;

    const read = input.plateReadId
      ? (
          await tx
            .select()
            .from(plateReads)
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
    const plate = normalizePlate(input.plate ?? '') || read?.plateText || invite?.plate || null;

    const watch = plate
      ? (await activeWatchlist(tx, site.id)).find(
          (w) => w.kind === 'plate' && normalizePlate(w.value) === plate,
        )
      : undefined;
    const raised = visitGateInAlerts({ hostConfirmed, watchlistReason: watch?.reason ?? null });

    const visitNo = await nextVisitNo(tx, site.id, today);
    const [visit] = await tx
      .insert(visits)
      .values({
        siteId: site.id,
        visitNo,
        type,
        inviteId: invite?.id ?? null,
        name,
        company,
        phone,
        groupSize: input.groupSize,
        hostId: host?.id ?? null,
        hostConfirmed,
        plate,
        cardId: card.id,
        expectedUntil:
          inviteValid && invite?.untilTime
            ? siteDateTime(today, invite.untilTime, site.timezone)
            : null,
        gateInAt: now,
        gateInBy: userId,
      })
      .returning();

    await tx
      .update(cards)
      .set({ status: 'issued', currentTripId: null, currentVisitId: visit!.id })
      .where(eq(cards.id, card.id));

    if (read) {
      await tx
        .update(plateReads)
        .set({ handledAt: now, confirmedPlate: plate, corrected: read.plateText !== plate })
        .where(eq(plateReads.id, read.id));
    }
    if (input.photoIds.length > 0) {
      await tx
        .update(photos)
        .set({ visitId: visit!.id })
        .where(
          and(
            eq(photos.siteId, site.id),
            inArray(photos.id, input.photoIds),
            isNull(photos.tripId),
            isNull(photos.visitId),
          ),
        );
    }

    const alertRows = await recordAlerts(tx, site.id, null, raised, now, visit!.id);
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'visit_in',
      entity: 'visit',
      entityId: visit!.id,
      after: {
        visitNo,
        type,
        inviteId: invite?.id ?? null,
        name,
        company,
        groupSize: input.groupSize,
        hostId: host?.id ?? null,
        hostConfirmed,
        plate,
        cardNo: card.cardNo,
        photos: input.photoIds.length,
      },
      at: now,
    });

    return {
      ok: true as const,
      visit: {
        id: visit!.id,
        visitNo,
        type,
        name,
        company,
        groupSize: input.groupSize,
        host: host?.name ?? null,
      },
      cardNo: card.cardNo,
      alerts: raised,
      alertRows,
    };
  });

  if (!result.ok) return result;
  const { alertRows, ...done } = result;
  deps.events.publish({ type: 'visit_changed', visitId: done.visit.id });
  await deliverAlerts(deps.db, deps.adapters.notifier, deps.events, alertRows, {
    siteCode: site.code,
    tripNo: done.visit.visitNo,
    plate: null,
    at: now,
  });
  return done;
}

/** "Staff" button: log the plate and time. No card, no photos (decision V9). */
export async function logStaff(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  input: { camera: 'entry' | 'exit'; plate: string; plateReadId: string | null },
) {
  const plate = normalizePlate(input.plate);
  if (plate === '') throw new ServiceError(400, 'PLATE_EMPTY');
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    if (input.plateReadId) {
      await tx
        .update(plateReads)
        .set({ handledAt: now, confirmedPlate: plate })
        .where(
          and(
            eq(plateReads.siteId, site.id),
            eq(plateReads.id, input.plateReadId),
            isNull(plateReads.tripId),
            isNull(plateReads.handledAt),
          ),
        );
    }
    const [row] = await tx
      .insert(staffEntries)
      .values({
        siteId: site.id,
        camera: input.camera,
        plate,
        plateReadId: input.plateReadId,
        at: now,
        loggedBy: userId,
      })
      .returning();
    await audit(tx, {
      siteId: site.id,
      userId,
      action: input.camera === 'entry' ? 'staff_in' : 'staff_out',
      entity: 'staff_entry',
      entityId: row!.id,
      after: { plate },
      at: now,
    });
    return { id: row!.id, plate, at: now };
  });
}

// --- Gate out ----------------------------------------------------------------------

type VisitRow = typeof visits.$inferSelect;

async function visitExitView(db: DbOrTx, visit: VisitRow, at: Date) {
  const [host] = visit.hostId
    ? await db.select().from(hosts).where(eq(hosts.id, visit.hostId))
    : [];
  const [card] = visit.cardId
    ? await db.select().from(cards).where(eq(cards.id, visit.cardId))
    : [];
  return {
    id: visit.id,
    visitNo: visit.visitNo,
    type: visit.type,
    name: visit.name,
    company: visit.company,
    groupSize: visit.groupSize,
    host: host?.name ?? null,
    plate: visit.plate,
    cardNo: card?.cardNo ?? null,
    gateInAt: visit.gateInAt,
    expectedUntil: visit.expectedUntil,
    /** Colour if they leave now and hand the card back. */
    status: visitExitStatus({ cardReturned: true, expectedUntil: visit.expectedUntil, at }),
  };
}

export type VisitExitView = Awaited<ReturnType<typeof visitExitView>>;

async function onSiteVisit(db: DbOrTx, site: Site, visitId: string) {
  const [visit] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.siteId, site.id), eq(visits.id, visitId)));
  if (!visit) throw notFound('VISIT_NOT_FOUND');
  if (visit.status !== 'on_site') throw conflict('NOT_ON_SITE');
  return visit;
}

/** Exit screen: everyone inside on a visit, newest first. */
export async function visitsOnSite(deps: ServiceDeps, site: Site) {
  const rows = await deps.db
    .select()
    .from(visits)
    .where(and(eq(visits.siteId, site.id), eq(visits.status, 'on_site')))
    .orderBy(desc(visits.gateInAt));
  const at = deps.now();
  return Promise.all(rows.map((v) => visitExitView(deps.db, v, at)));
}

export async function visitExitById(deps: ServiceDeps, site: Site, visitId: string) {
  return visitExitView(deps.db, await onSiteVisit(deps.db, site, visitId), deps.now());
}

export async function visitExitByCard(deps: ServiceDeps, site: Site, rawCardNo: string) {
  const [card] = await deps.db
    .select()
    .from(cards)
    .where(and(eq(cards.siteId, site.id), eq(cards.cardNo, normalizeCardNo(rawCardNo))));
  if (!card) throw notFound('CARD_UNKNOWN');
  if (card.status !== 'issued' || !card.currentVisitId) throw conflict('CARD_NOT_ON_VISIT');
  return visitExitById(deps, site, card.currentVisitId);
}

export interface VisitGateOutInput {
  visitId: string;
  /** The card handed back, or null when the guard taps "No card". */
  cardNo: string | null;
  /** Exit camera read of their car, if any. */
  plateReadId: string | null;
}

export async function visitGateOut(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  input: VisitGateOutInput,
) {
  const now = deps.now();
  const result = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gate:' + site.id}))`);
    const visit = await onSiteVisit(tx, site, input.visitId);
    const [card] = visit.cardId
      ? await tx.select().from(cards).where(eq(cards.id, visit.cardId))
      : [];

    let cardReturned = false;
    if (input.cardNo !== null) {
      const [handed] = await tx
        .select()
        .from(cards)
        .where(and(eq(cards.siteId, site.id), eq(cards.cardNo, normalizeCardNo(input.cardNo))));
      if (!handed) throw notFound('CARD_UNKNOWN');
      const collected = collectCard(
        { cardNo: handed.cardNo, status: handed.status, currentTripId: handed.currentVisitId },
        visit.id,
      );
      if (!collected.ok) throw conflict(collected.error);
      await tx
        .update(cards)
        .set({ status: 'free', currentVisitId: null })
        .where(eq(cards.id, handed.id));
      cardReturned = true;
    } else if (card) {
      const lost = markCardLost(
        { cardNo: card.cardNo, status: card.status, currentTripId: card.currentVisitId },
        visit.id,
      );
      if (lost.ok) {
        await tx
          .update(cards)
          .set({ status: 'lost', currentVisitId: null })
          .where(eq(cards.id, card.id));
      }
    }

    const status = visitExitStatus({ cardReturned, expectedUntil: visit.expectedUntil, at: now });

    if (input.plateReadId) {
      await tx
        .update(plateReads)
        .set({ handledAt: now, confirmedPlate: visit.plate })
        .where(
          and(
            eq(plateReads.siteId, site.id),
            eq(plateReads.id, input.plateReadId),
            isNull(plateReads.tripId),
            isNull(plateReads.handledAt),
          ),
        );
    }

    await tx
      .update(visits)
      .set({
        status: 'closed',
        gateOutAt: now,
        gateOutBy: userId,
        exitLevel: status.level,
        exitReasons: status.reasons,
        cardReturned,
      })
      .where(eq(visits.id, visit.id));

    const alertRows = await recordAlerts(tx, site.id, null, status.reasons, now, visit.id);
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'visit_out',
      entity: 'visit',
      entityId: visit.id,
      after: {
        level: status.level,
        reasons: status.reasons.map((r) => r.type),
        cardReturned,
        cardNo: card?.cardNo ?? null,
      },
      at: now,
    });
    return { visit, status, cardReturned, alertRows };
  });

  deps.events.publish({ type: 'visit_changed', visitId: result.visit.id });
  await deliverAlerts(deps.db, deps.adapters.notifier, deps.events, result.alertRows, {
    siteCode: site.code,
    tripNo: result.visit.visitNo,
    plate: result.visit.plate,
    at: now,
  });
  return {
    visit: {
      id: result.visit.id,
      visitNo: result.visit.visitNo,
      type: result.visit.type,
      name: result.visit.name,
      groupSize: result.visit.groupSize,
    },
    status: result.status,
    cardReturned: result.cardReturned,
  };
}

// --- Headcount and muster (decision V8) -------------------------------------------------

/** Everyone inside now: one driver per truck, the stated group size per visit. */
export async function onSiteRoll(db: DbOrTx, siteId: string): Promise<MusterRollEntry[]> {
  const truckRows = await db
    .select({
      id: trips.id,
      plate: trips.plateIn,
      company: transporters.name,
      cardNo: cards.cardNo,
    })
    .from(trips)
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .leftJoin(cards, eq(cards.id, trips.cardId))
    .where(and(eq(trips.siteId, siteId), eq(trips.status, 'on_site')))
    .orderBy(asc(trips.plateIn));
  const visitRows = await db
    .select({ v: visits, host: hosts.name, cardNo: cards.cardNo })
    .from(visits)
    .leftJoin(hosts, eq(hosts.id, visits.hostId))
    .leftJoin(cards, eq(cards.id, visits.cardId))
    .where(and(eq(visits.siteId, siteId), eq(visits.status, 'on_site')))
    .orderBy(asc(visits.name));
  return [
    ...visitRows.map((r) => ({
      id: r.v.id,
      kind: r.v.type,
      people: r.v.groupSize,
      label: r.v.name,
      company: r.v.company,
      host: r.host,
      cardNo: r.cardNo,
    })),
    ...truckRows.map((t) => ({
      id: t.id,
      kind: 'truck' as const,
      people: 1,
      label: t.plate,
      company: t.company,
      host: null,
      cardNo: t.cardNo,
    })),
  ];
}

export async function peopleOnSite(deps: ServiceDeps, site: Site) {
  const roll = await onSiteRoll(deps.db, site.id);
  return { headcount: headcount(roll), roll };
}

async function musterView(db: DbOrTx, muster: typeof musters.$inferSelect) {
  const marks = await db.select().from(musterMarks).where(eq(musterMarks.musterId, muster.id));
  const safe = new Set(marks.map((m) => m.entryId));
  const progress = musterProgress(muster.roll, safe);
  return {
    id: muster.id,
    startedAt: muster.startedAt,
    endedAt: muster.endedAt,
    roll: muster.roll.map((e) => ({ ...e, safe: safe.has(e.id) })),
    people: progress.people,
    safePeople: progress.safePeople,
    groups: progress.groups,
    safeGroups: progress.safeGroups,
  };
}

/** The muster in progress, or null. */
export async function currentMuster(deps: ServiceDeps, site: Site) {
  const [m] = await deps.db
    .select()
    .from(musters)
    .where(and(eq(musters.siteId, site.id), isNull(musters.endedAt)))
    .orderBy(desc(musters.startedAt))
    .limit(1);
  return m ? musterView(deps.db, m) : null;
}

/** Start a roll call. The roll is fixed now; one muster at a time. */
export async function startMuster(deps: ServiceDeps, site: Site, userId: string) {
  const now = deps.now();
  const id = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'muster:' + site.id}))`);
    const [open] = await tx
      .select({ id: musters.id })
      .from(musters)
      .where(and(eq(musters.siteId, site.id), isNull(musters.endedAt)));
    if (open) return open.id;
    const roll = await onSiteRoll(tx, site.id);
    const [m] = await tx
      .insert(musters)
      .values({ siteId: site.id, startedAt: now, startedBy: userId, roll })
      .returning();
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'muster_start',
      entity: 'muster',
      entityId: m!.id,
      after: { groups: roll.length, people: headcount(roll).total },
      at: now,
    });
    return m!.id;
  });
  deps.events.publish({ type: 'muster_changed', musterId: id });
  return currentMuster(deps, site);
}

export async function markMuster(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  musterId: string,
  entryId: string,
  safe: boolean,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(musters)
      .where(and(eq(musters.siteId, site.id), eq(musters.id, musterId)));
    if (!m) throw notFound('MUSTER_NOT_FOUND');
    if (m.endedAt) throw conflict('MUSTER_ENDED');
    if (!m.roll.some((e) => e.id === entryId)) throw notFound('NOT_ON_ROLL');
    if (safe) {
      await tx
        .insert(musterMarks)
        .values({ siteId: site.id, musterId, entryId, markedAt: now, markedBy: userId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(musterMarks)
        .where(and(eq(musterMarks.musterId, musterId), eq(musterMarks.entryId, entryId)));
    }
    await audit(tx, {
      siteId: site.id,
      userId,
      action: safe ? 'muster_safe' : 'muster_unmark',
      entity: 'muster',
      entityId: musterId,
      after: { entryId },
      at: now,
    });
  });
  deps.events.publish({ type: 'muster_changed', musterId });
  return currentMuster(deps, site);
}

export async function endMuster(deps: ServiceDeps, site: Site, userId: string, musterId: string) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [m] = await tx
      .update(musters)
      .set({ endedAt: now, endedBy: userId })
      .where(and(eq(musters.siteId, site.id), eq(musters.id, musterId), isNull(musters.endedAt)))
      .returning();
    if (!m) throw conflict('MUSTER_ENDED');
    const view = await musterView(tx, m);
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'muster_end',
      entity: 'muster',
      entityId: musterId,
      after: { people: view.people, safePeople: view.safePeople },
      at: now,
    });
  });
  deps.events.publish({ type: 'muster_changed', musterId });
  return { ok: true };
}

/**
 * Checker (docs/SPEC.md "Checker screen detail"): open a truck from a card tap
 * or the waiting list, see the latest SDO lines (re-read live from SAP), tick
 * or count pieces, take photos, Approve or Reject with a reason.
 */
import {
  diffSdoLines,
  evaluateLineChecks,
  expectedPieces,
  normalizeCardNo,
  raise,
  type RaisedAlert,
  type RejectReason,
  type SdoLineChange,
} from '@vms/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  alerts,
  cards,
  checkerDecisions,
  photos,
  transporters,
  trips,
  tripSdos,
  users,
  weighTickets,
} from '../db/schema.js';
import { deliverAlerts, recordAlerts, type AlertRow } from './alerts.js';
import { audit, type DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { conflict, notFound, ServiceError } from './errors.js';
import { queueDoUdfs, tripLinkedDos } from './dos.js';
import { cachedSdos, cacheSdo } from './sdoCache.js';
import type { Site } from './sites.js';

/** How long the checker screen waits for SAP before showing the cached SDO. */
export const LIVE_SDO_TIMEOUT_MS = 4000;

// --- Waiting list ------------------------------------------------------------------

export interface QueueItem {
  id: string;
  tripNo: string;
  plate: string;
  transporterName: string | null;
  sdoNos: string[];
  gateInAt: Date;
  weighedIn: boolean;
  /** 'reject' = the truck went back to loading and needs a re-check. */
  lastDecision: 'reject' | null;
}

/** Outbound trucks on site with SDOs and no approval yet. */
export async function checkerQueue(deps: ServiceDeps, site: Site): Promise<QueueItem[]> {
  const { db } = deps;
  const rows = await db
    .select({
      id: trips.id,
      tripNo: trips.tripNo,
      plate: trips.plateIn,
      transporterName: transporters.name,
      gateInAt: trips.gateInAt,
    })
    .from(trips)
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .where(and(eq(trips.siteId, site.id), eq(trips.status, 'on_site'), eq(trips.type, 'outbound')))
    .orderBy(asc(trips.gateInAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [links, decisions, tickets] = await Promise.all([
    db.select().from(tripSdos).where(inArray(tripSdos.tripId, ids)),
    db
      .select({ tripId: checkerDecisions.tripId, decision: checkerDecisions.decision })
      .from(checkerDecisions)
      .where(inArray(checkerDecisions.tripId, ids))
      .orderBy(asc(checkerDecisions.decidedAt)),
    db
      .select({ tripId: weighTickets.tripId })
      .from(weighTickets)
      .where(inArray(weighTickets.tripId, ids)),
  ]);
  return rows.flatMap((r) => {
    const sdoNos = links.filter((l) => l.tripId === r.id).map((l) => l.sdoNo);
    const last = decisions.filter((d) => d.tripId === r.id).at(-1)?.decision ?? null;
    if (sdoNos.length === 0 || last === 'approve') return [];
    return [
      {
        ...r,
        sdoNos,
        weighedIn: tickets.some((t) => t.tripId === r.id),
        lastDecision: last,
      },
    ];
  });
}

/** The on-site trip a tapped card belongs to. */
export async function tripByCard(deps: ServiceDeps, site: Site, rawCardNo: string) {
  const [row] = await deps.db
    .select({ tripId: cards.currentTripId })
    .from(cards)
    .where(
      and(
        eq(cards.siteId, site.id),
        eq(cards.cardNo, normalizeCardNo(rawCardNo)),
        eq(cards.status, 'issued'),
      ),
    );
  if (!row?.tripId) throw notFound('CARD_NOT_ON_TRIP');
  return { tripId: row.tripId };
}

// --- One truck -----------------------------------------------------------------------

export interface CheckSdo {
  sdoNo: string;
  customerName: string | null;
  /** Version the checker saw; sent back with the decision. */
  version: string | null;
  changed: boolean;
  changes: SdoLineChange[];
  /** DOs on this truck copied from this SDO. */
  doNos: string[];
  lines: {
    lineNo: number;
    size: string;
    spec: string;
    length: string;
    /** On the SDO. */
    pieces: number;
    /** On this truck: from its DO when it has one, else the SDO. */
    expected: number;
    from: 'do' | 'sdo';
  }[];
}

export interface CheckView {
  id: string;
  tripNo: string;
  plate: string;
  transporterName: string | null;
  gateInAt: Date;
  /** True when SAP did not answer in time and cached SDOs are shown. */
  offline: boolean;
  sdos: CheckSdo[];
  lastDecision: {
    decision: 'approve' | 'reject';
    reason: RejectReason | null;
    decidedAt: Date;
    checkerName: string;
  } | null;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SAP timeout')), ms)),
  ]);

async function onSiteOutbound(db: DbOrTx, site: Site, tripId: string) {
  const [row] = await db
    .select({ trip: trips, transporterName: transporters.name })
    .from(trips)
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .where(and(eq(trips.siteId, site.id), eq(trips.id, tripId)));
  if (!row) throw notFound('TRIP_NOT_FOUND');
  if (row.trip.status !== 'on_site') throw conflict('TRIP_CLOSED');
  if (row.trip.type !== 'outbound') throw conflict('NOT_OUTBOUND');
  return row;
}

/**
 * Re-read the truck's SDOs from SAP (the latest version is what gets checked),
 * falling back to the cache when SAP is slow or down. An SDO that differs from
 * when it was linked gets an amber SDO_CHANGED alert (screen only), once per version.
 */
export async function checkView(deps: ServiceDeps, site: Site, tripId: string): Promise<CheckView> {
  const { db } = deps;
  const { trip, transporterName } = await onSiteOutbound(db, site, tripId);
  const now = deps.now();
  const links = await db
    .select()
    .from(tripSdos)
    .where(eq(tripSdos.tripId, tripId))
    .orderBy(asc(tripSdos.linkedAt), asc(tripSdos.sdoNo));

  let offline = false;
  try {
    const live = await withTimeout(
      Promise.all(links.map((l) => deps.adapters.sap.getSdo(l.sdoNo))),
      LIVE_SDO_TIMEOUT_MS,
    );
    await db.transaction(async (tx) => {
      for (const sdo of live) if (sdo) await cacheSdo(tx, site.id, sdo, now);
    });
  } catch {
    offline = true;
  }

  const cache = await cachedSdos(
    db,
    site.id,
    links.map((l) => l.sdoNo),
  );
  const linkedDos = await tripLinkedDos(db, site.id, tripId);
  const newAlerts: AlertRow[] = [];
  const sdos: CheckSdo[] = [];
  for (const link of links) {
    const c = cache.get(link.sdoNo);
    const lines = (c?.lines ?? []).map((l) => ({
      lineNo: l.lineNo,
      itemCode: l.itemCode,
      size: l.size,
      spec: l.spec,
      length: l.length,
      pieces: l.pieces,
    }));
    const changed = !!c && !!link.sdoVersionAtLink && c.version !== link.sdoVersionAtLink;
    if (changed) {
      const [already] = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.tripId, tripId),
            eq(alerts.type, 'SDO_CHANGED'),
            sql`${alerts.detail}->>'sdoNo' = ${link.sdoNo}`,
            sql`${alerts.detail}->>'version' = ${c.version}`,
          ),
        );
      if (!already) {
        newAlerts.push(
          ...(await recordAlerts(
            db,
            site.id,
            tripId,
            [raise('SDO_CHANGED', { sdoNo: link.sdoNo, version: c.version })],
            now,
          )),
        );
      }
    }
    sdos.push({
      sdoNo: link.sdoNo,
      customerName: c?.customerName ?? null,
      version: c?.version ?? null,
      changed,
      changes: changed && link.linesAtLink ? diffSdoLines(link.linesAtLink, lines) : [],
      doNos: linkedDos
        .filter((d) => d.lines.some((x) => x.baseSdoNo === link.sdoNo))
        .map((d) => d.doNo),
      lines: lines.map(({ itemCode: _, ...l }) => {
        const e = expectedPieces(link.sdoNo, l.lineNo, l.pieces, linkedDos);
        return { ...l, expected: e.pieces, from: e.from };
      }),
    });
  }
  await deliverAlerts(db, deps.adapters.notifier, deps.events, newAlerts, {
    siteCode: site.code,
    tripNo: trip.tripNo,
    plate: trip.plateIn,
    at: now,
  });

  const [last] = await db
    .select({
      decision: checkerDecisions.decision,
      reason: checkerDecisions.reason,
      decidedAt: checkerDecisions.decidedAt,
      checkerName: users.displayName,
    })
    .from(checkerDecisions)
    .innerJoin(users, eq(users.id, checkerDecisions.checkerId))
    .where(eq(checkerDecisions.tripId, tripId))
    .orderBy(desc(checkerDecisions.decidedAt))
    .limit(1);

  return {
    id: trip.id,
    tripNo: trip.tripNo,
    plate: trip.plateIn,
    transporterName,
    gateInAt: trip.gateInAt,
    offline,
    sdos,
    lastDecision: last ?? null,
  };
}

// --- Decision -----------------------------------------------------------------------

export interface DecisionInput {
  decision: 'approve' | 'reject';
  reason: RejectReason | null;
  /** SDO versions shown to the checker; a change since then must be re-checked. */
  versions: Record<string, string>;
  lines: { sdoNo: string; lineNo: number; actualPieces: number }[];
  photoIds: string[];
}

export async function decide(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  input: DecisionInput,
) {
  if (input.decision === 'reject' && !input.reason) throw new ServiceError(400, 'REASON_REQUIRED');
  if (input.decision === 'approve' && input.reason)
    throw new ServiceError(400, 'NO_REASON_ON_APPROVE');
  const now = deps.now();

  const result = await deps.db.transaction(async (tx) => {
    // One decision at a time per truck (two checkers on one truck).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'check:' + tripId}))`);
    const { trip } = await onSiteOutbound(tx, site, tripId);
    const links = await tx.select().from(tripSdos).where(eq(tripSdos.tripId, tripId));
    if (links.length === 0) throw conflict('NO_SDO');
    const cache = await cachedSdos(
      tx,
      site.id,
      links.map((l) => l.sdoNo),
    );
    for (const l of links) {
      if (input.versions[l.sdoNo] !== cache.get(l.sdoNo)?.version)
        throw conflict('SDO_CHANGED_AGAIN');
    }

    const linkedDos = await tripLinkedDos(tx, site.id, tripId);
    const expected = links.flatMap((l) =>
      (cache.get(l.sdoNo)?.lines ?? []).map((x) => ({
        sdoNo: l.sdoNo,
        lineNo: x.lineNo,
        pieces: expectedPieces(l.sdoNo, x.lineNo, x.pieces, linkedDos).pieces,
      })),
    );
    const checked = evaluateLineChecks(expected, input.lines);
    if (!checked.ok) throw new ServiceError(400, checked.error);

    const [decision] = await tx
      .insert(checkerDecisions)
      .values({
        siteId: site.id,
        tripId,
        checkerId: userId,
        decidedAt: now,
        decision: input.decision,
        reason: input.reason,
        lineChecks: checked.lines,
        sdoSnapshot: Object.fromEntries(
          links.map((l) => [l.sdoNo, cache.get(l.sdoNo)?.lines ?? []]),
        ),
      })
      .returning();

    if (input.photoIds.length > 0) {
      await tx
        .update(photos)
        .set({ tripId, checkerDecisionId: decision!.id })
        .where(
          and(
            eq(photos.siteId, site.id),
            inArray(photos.id, input.photoIds),
            eq(photos.kind, 'load'),
            isNull(photos.checkerDecisionId),
          ),
        );
    }

    // Approval stamps checker name and time onto the DO(s) in SAP (queued).
    if (input.decision === 'approve') await queueDoUdfs(tx, site.id, tripId, now);

    const raised: RaisedAlert[] =
      input.decision === 'reject' ? [raise('CHECKER_REJECTED', { reason: input.reason! })] : [];
    const alertRows = await recordAlerts(tx, site.id, tripId, raised, now);

    await audit(tx, {
      siteId: site.id,
      userId,
      action: input.decision === 'approve' ? 'checker_approve' : 'checker_reject',
      entity: 'trip',
      entityId: tripId,
      after: {
        reason: input.reason,
        differences: checked.differences,
        photos: input.photoIds.length,
      },
      at: now,
    });
    return { trip, decision: decision!, differences: checked.differences, alertRows };
  });

  deps.events.publish({ type: 'trip_changed', tripId });
  await deliverAlerts(deps.db, deps.adapters.notifier, deps.events, result.alertRows, {
    siteCode: site.code,
    tripNo: result.trip.tripNo,
    plate: result.trip.plateIn,
    at: now,
  });
  return {
    decision: result.decision.decision,
    decidedAt: result.decision.decidedAt,
    differences: result.differences,
  };
}

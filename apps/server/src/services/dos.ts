/**
 * DO capture and SAP write-back (docs/SPEC.md "SAP B1 integration").
 * - DOs are found through the SDO reference that "Copy To" puts on each DO
 *   line, copied into do_cache/do_lines, and linked to the truck they belong
 *   to (assignDos: only when exactly one truck fits; otherwise the clerk).
 * - Trip data goes back to SAP only as UDFs on the DO (plate, WB ticket,
 *   checker, gate in/out), through the sap_writes queue: the gate never waits
 *   on SAP, and the idempotency key (CWIS ticket number + DO + content) means
 *   a retry or a repeat can never write twice.
 */
import type { DoUdfs, SapDo } from '@vms/adapters';
import { assignDos, selectDosForTrip, type DeliveryOrder, type DoLine } from '@vms/domain';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  checkerDecisions,
  doCache,
  doLines,
  sapWrites,
  trips,
  tripDos,
  tripSdos,
  users,
  weighTickets,
} from '../db/schema.js';
import { audit, type DbOrTx } from './audit.js';
import { retryDelayMs } from './retry.js';
import type { ServiceDeps } from './deps.js';
import { conflict, notFound } from './errors.js';
import type { Site } from './sites.js';

export interface CachedDoLine extends DoLine {
  itemCode: string;
  pieces: number;
}

export interface CachedDo extends DeliveryOrder {
  customerCode: string;
  lines: CachedDoLine[];
}

// --- DO cache --------------------------------------------------------------------------

export async function cacheDos(db: DbOrTx, siteId: string, dos: readonly SapDo[], now: Date) {
  for (const d of dos) {
    const values = { customerCode: d.customerCode, sapCreatedAt: d.createdAt, fetchedAt: now };
    await db
      .insert(doCache)
      .values({ siteId, doNo: d.doNo, ...values })
      .onConflictDoUpdate({ target: [doCache.siteId, doCache.doNo], set: values });
    await db.delete(doLines).where(and(eq(doLines.siteId, siteId), eq(doLines.doNo, d.doNo)));
    if (d.lines.length > 0) {
      await db.insert(doLines).values(d.lines.map((l) => ({ siteId, doNo: d.doNo, ...l })));
    }
  }
}

/** Cached DOs, by number or by the SDOs they were copied from. */
export async function cachedDos(
  db: DbOrTx,
  siteId: string,
  by: { doNos: readonly string[] } | { sdoNos: readonly string[] },
): Promise<CachedDo[]> {
  let doNos: string[];
  if ('doNos' in by) {
    doNos = [...by.doNos];
  } else {
    if (by.sdoNos.length === 0) return [];
    const refs = await db
      .selectDistinct({ doNo: doLines.doNo })
      .from(doLines)
      .where(and(eq(doLines.siteId, siteId), inArray(doLines.baseSdoNo, [...by.sdoNos])));
    doNos = refs.map((r) => r.doNo);
  }
  if (doNos.length === 0) return [];
  const [headers, lines] = await Promise.all([
    db
      .select()
      .from(doCache)
      .where(and(eq(doCache.siteId, siteId), inArray(doCache.doNo, doNos)))
      .orderBy(asc(doCache.doNo)),
    db
      .select()
      .from(doLines)
      .where(and(eq(doLines.siteId, siteId), inArray(doLines.doNo, doNos)))
      .orderBy(asc(doLines.lineNo)),
  ]);
  return headers.map((h) => ({
    doNo: h.doNo,
    customerCode: h.customerCode,
    createdAt: h.sapCreatedAt,
    lines: lines
      .filter((l) => l.doNo === h.doNo)
      .map((l) => ({
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        pieces: l.pieces,
        baseSdoNo: l.baseSdoNo,
        baseLineNo: l.baseLineNo,
      })),
  }));
}

/** DOs currently linked to a trip, with their lines. */
export async function tripLinkedDos(db: DbOrTx, siteId: string, tripId: string) {
  const links = await db
    .select({ doNo: tripDos.doNo })
    .from(tripDos)
    .where(and(eq(tripDos.tripId, tripId), eq(tripDos.state, 'linked')));
  return cachedDos(db, siteId, { doNos: links.map((l) => l.doNo) });
}

// --- Discovery -------------------------------------------------------------------------

/**
 * Find DOs for every outbound truck on site and link the unambiguous ones.
 * Throws if SAP is unreachable (the job retries). Returns what changed.
 */
export async function discoverDos(deps: ServiceDeps, site: Site) {
  const { db } = deps;
  const now = deps.now();
  const open = await db
    .select({ id: trips.id, gateInAt: trips.gateInAt })
    .from(trips)
    .where(and(eq(trips.siteId, site.id), eq(trips.status, 'on_site'), eq(trips.type, 'outbound')));
  if (open.length === 0) return { linked: [], ambiguous: [] };
  const ids = open.map((t) => t.id);
  const links = await db.select().from(tripSdos).where(inArray(tripSdos.tripId, ids));
  const sdoNos = [...new Set(links.map((l) => l.sdoNo))];
  if (sdoNos.length === 0) return { linked: [], ambiguous: [] };

  const sapDos = await deps.adapters.sap.getDosForSdos(sdoNos);

  const result = await db.transaction(async (tx) => {
    // One discovery at a time, so two runs never race for the same DO.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'dos:' + site.id}))`);
    await cacheDos(tx, site.id, sapDos, now);

    const rows = await tx.select().from(tripDos).where(eq(tripDos.siteId, site.id));
    const claims = new Map(rows.filter((r) => r.state === 'linked').map((r) => [r.doNo, r.tripId]));
    const plan = assignDos(
      open.map((t) => ({
        tripId: t.id,
        gateInAt: t.gateInAt,
        sdoNos: links.filter((l) => l.tripId === t.id).map((l) => l.sdoNo),
        manualUnlinks: rows
          .filter((r) => r.tripId === t.id && r.state === 'unlinked')
          .map((r) => r.doNo),
      })),
      sapDos,
      claims,
    );

    for (const a of plan.assign) {
      await tx.insert(tripDos).values({
        siteId: site.id,
        tripId: a.tripId,
        doNo: a.doNo,
        source: 'auto',
        changedAt: now,
      });
      await audit(tx, {
        siteId: site.id,
        userId: null,
        action: 'link_do',
        entity: 'trip',
        entityId: a.tripId,
        after: { doNo: a.doNo, source: 'auto' },
        at: now,
      });
    }
    for (const tripId of new Set(plan.assign.map((a) => a.tripId))) {
      await queueDoUdfs(tx, site.id, tripId, now);
    }
    return plan;
  });

  for (const tripId of new Set(result.assign.map((a) => a.tripId))) {
    deps.events.publish({ type: 'trip_changed', tripId });
  }
  return { linked: result.assign, ambiguous: result.ambiguous };
}

// --- What the clerk and checker see -----------------------------------------------------

export type DoCandidateReason = 'before_gate_in' | 'other_truck' | 'unlinked' | 'needs_clerk';

export async function tripDoView(db: DbOrTx, siteId: string, tripId: string) {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) throw notFound('TRIP_NOT_FOUND');
  const sdoNos = (
    await db.select({ sdoNo: tripSdos.sdoNo }).from(tripSdos).where(eq(tripSdos.tripId, tripId))
  ).map((s) => s.sdoNo);
  const related = await cachedDos(db, siteId, { sdoNos });
  const rows = related.length
    ? await db
        .select({
          doNo: tripDos.doNo,
          tripId: tripDos.tripId,
          state: tripDos.state,
          source: tripDos.source,
          tripNo: trips.tripNo,
        })
        .from(tripDos)
        .innerJoin(trips, eq(trips.id, tripDos.tripId))
        .where(
          and(
            eq(tripDos.siteId, siteId),
            inArray(
              tripDos.doNo,
              related.map((d) => d.doNo),
            ),
          ),
        )
    : [];
  const writes = related.length
    ? await db
        .select()
        .from(sapWrites)
        .where(
          and(
            eq(sapWrites.siteId, siteId),
            eq(sapWrites.tripId, tripId),
            ne(sapWrites.status, 'superseded'),
          ),
        )
        .orderBy(desc(sapWrites.createdAt))
    : [];

  const mine = rows.filter((r) => r.tripId === tripId && r.state === 'linked');
  const linkedDos = related.filter((d) => mine.some((m) => m.doNo === d.doNo));
  const coverage = selectDosForTrip({
    tripId,
    gateInAt: trip.gateInAt,
    sdoNos,
    dos: linkedDos,
    claims: new Map(),
    manualLinks: linkedDos.map((d) => d.doNo),
  });

  const view = (d: CachedDo) => ({
    doNo: d.doNo,
    createdAt: d.createdAt,
    lines: d.lines.map((l) => ({
      lineNo: l.lineNo,
      itemCode: l.itemCode,
      pieces: l.pieces,
      sdoNo: l.baseSdoNo,
      sdoLineNo: l.baseLineNo,
    })),
  });

  return {
    linked: linkedDos.map((d) => {
      const w = writes.find((x) => x.doNo === d.doNo);
      return {
        ...view(d),
        source: mine.find((m) => m.doNo === d.doNo)!.source,
        sap: w ? { status: w.status, attempts: w.attempts, lastError: w.lastError } : null,
      };
    }),
    candidates: related
      .filter((d) => !mine.some((m) => m.doNo === d.doNo))
      .map((d) => {
        const other = rows.find((r) => r.doNo === d.doNo && r.state === 'linked');
        const unlinkedHere = rows.some(
          (r) => r.doNo === d.doNo && r.tripId === tripId && r.state === 'unlinked',
        );
        const reason: DoCandidateReason = other
          ? 'other_truck'
          : unlinkedHere
            ? 'unlinked'
            : d.createdAt.getTime() < trip.gateInAt.getTime()
              ? 'before_gate_in'
              : 'needs_clerk';
        return { ...view(d), reason, otherTripNo: other?.tripNo ?? null };
      }),
    sdosWithoutDo: coverage.sdosWithoutDo,
    unlinkedSdosOnDos: coverage.unlinkedSdosOnDos,
  };
}

// --- Clerk link / unlink -----------------------------------------------------------------

export async function linkDo(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  doNo: string,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'dos:' + site.id}))`);
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.siteId, site.id), eq(trips.id, tripId)));
    if (!trip) throw notFound('TRIP_NOT_FOUND');
    if (trip.status !== 'on_site') throw conflict('TRIP_CLOSED');
    const [d] = await cachedDos(tx, site.id, { doNos: [doNo] });
    if (!d) throw notFound('DO_NOT_FOUND');
    const [claim] = await tx
      .select()
      .from(tripDos)
      .where(and(eq(tripDos.siteId, site.id), eq(tripDos.doNo, doNo), eq(tripDos.state, 'linked')));
    if (claim && claim.tripId !== tripId) throw conflict('DO_ON_OTHER_TRIP');
    if (claim) return;
    await tx
      .insert(tripDos)
      .values({
        siteId: site.id,
        tripId,
        doNo,
        source: 'clerk',
        state: 'linked',
        changedBy: userId,
        changedAt: now,
      })
      .onConflictDoUpdate({
        target: [tripDos.tripId, tripDos.doNo],
        set: { source: 'clerk', state: 'linked', changedBy: userId, changedAt: now },
      });
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'link_do',
      entity: 'trip',
      entityId: tripId,
      after: { doNo, source: 'clerk' },
      at: now,
    });
    await queueDoUdfs(tx, site.id, tripId, now);
  });
  deps.events.publish({ type: 'trip_changed', tripId });
}

export async function unlinkDo(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  tripId: string,
  doNo: string,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const changed = await tx
      .update(tripDos)
      .set({ state: 'unlinked', source: 'clerk', changedBy: userId, changedAt: now })
      .where(
        and(
          eq(tripDos.siteId, site.id),
          eq(tripDos.tripId, tripId),
          eq(tripDos.doNo, doNo),
          eq(tripDos.state, 'linked'),
        ),
      )
      .returning();
    if (changed.length === 0) throw notFound('DO_NOT_LINKED');
    // Anything not yet sent for this DO from this trip is dropped. UDFs already
    // written stay in SAP (the VMS never clears SAP data); the audit log shows the unlink.
    await tx
      .update(sapWrites)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(sapWrites.tripId, tripId),
          eq(sapWrites.doNo, doNo),
          eq(sapWrites.status, 'pending'),
        ),
      );
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'unlink_do',
      entity: 'trip',
      entityId: tripId,
      before: { doNo },
      at: now,
    });
  });
  deps.events.publish({ type: 'trip_changed', tripId });
}

// --- SAP write-back queue ------------------------------------------------------------------

type StoredUdfs = { [K in keyof DoUdfs]: string };

/** The UDF values a trip's DOs should carry right now (only what is known). */
async function desiredUdfs(
  db: DbOrTx,
  tripId: string,
): Promise<{ udfs: StoredUdfs; ticketKey: string }> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) throw notFound('TRIP_NOT_FOUND');
  const tickets = await db
    .select({ ticketNo: weighTickets.ticketNo })
    .from(weighTickets)
    .where(eq(weighTickets.tripId, tripId))
    .orderBy(asc(weighTickets.ticketNo));
  const [approved] = await db
    .select({
      name: users.displayName,
      at: checkerDecisions.decidedAt,
      decision: checkerDecisions.decision,
    })
    .from(checkerDecisions)
    .innerJoin(users, eq(users.id, checkerDecisions.checkerId))
    .where(eq(checkerDecisions.tripId, tripId))
    .orderBy(desc(checkerDecisions.decidedAt))
    .limit(1);

  const ticketNos = tickets.map((t) => t.ticketNo);
  const udfs: StoredUdfs = { plate: trip.plateIn, gateInAt: trip.gateInAt.toISOString() };
  if (ticketNos.length) udfs.wbTicket = ticketNos.join(',');
  if (approved?.decision === 'approve') {
    udfs.checkerName = approved.name;
    udfs.checkedAt = approved.at.toISOString();
  }
  if (trip.gateOutAt) udfs.gateOutAt = trip.gateOutAt.toISOString();
  // The CWIS ticket number is the idempotency key; before weighing, the trip number stands in.
  return { udfs, ticketKey: ticketNos.join(',') || trip.tripNo };
}

const fingerprint = (udfs: StoredUdfs) =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(udfs).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex')
    .slice(0, 16);

/**
 * Queue the trip's current UDF values for each of its DOs. The same values
 * are never queued twice (unique key); a newer set replaces any older one
 * still waiting for the same DO.
 */
export async function queueDoUdfs(
  db: DbOrTx,
  siteId: string,
  tripId: string,
  now: Date,
): Promise<number> {
  const linked = await db
    .select({ doNo: tripDos.doNo })
    .from(tripDos)
    .where(and(eq(tripDos.tripId, tripId), eq(tripDos.state, 'linked')));
  if (linked.length === 0) return 0;
  const { udfs, ticketKey } = await desiredUdfs(db, tripId);
  const fp = fingerprint(udfs);
  let queued = 0;
  for (const { doNo } of linked) {
    const idempotencyKey = `${ticketKey}:${doNo}:${fp}`;
    const inserted = await db
      .insert(sapWrites)
      .values({ siteId, tripId, doNo, idempotencyKey, udfs, nextAttemptAt: now, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: sapWrites.id });
    if (inserted.length === 0) continue;
    queued++;
    await db
      .update(sapWrites)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(sapWrites.siteId, siteId),
          eq(sapWrites.doNo, doNo),
          eq(sapWrites.status, 'pending'),
          ne(sapWrites.id, inserted[0]!.id),
        ),
      );
  }
  return queued;
}

const reviveUdfs = (u: StoredUdfs): DoUdfs => ({
  ...(u.plate !== undefined && { plate: u.plate }),
  ...(u.wbTicket !== undefined && { wbTicket: u.wbTicket }),
  ...(u.checkerName !== undefined && { checkerName: u.checkerName }),
  ...(u.checkedAt !== undefined && { checkedAt: new Date(u.checkedAt) }),
  ...(u.gateInAt !== undefined && { gateInAt: new Date(u.gateInAt) }),
  ...(u.gateOutAt !== undefined && { gateOutAt: new Date(u.gateOutAt) }),
});

/** Send due UDF writes to SAP, oldest first; failures retry with back-off. */
export async function sendSapWrites(deps: ServiceDeps, site: Site, limit = 50): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select()
    .from(sapWrites)
    .where(
      and(
        eq(sapWrites.siteId, site.id),
        eq(sapWrites.status, 'pending'),
        lte(sapWrites.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(sapWrites.createdAt))
    .limit(limit);
  let sent = 0;
  const touched = new Set<string>();
  for (const w of due) {
    if (w.tripId) touched.add(w.tripId);
    try {
      await deps.adapters.sap.writeDoUdfs(
        w.doNo,
        reviveUdfs(w.udfs as StoredUdfs),
        w.idempotencyKey,
      );
      await deps.db
        .update(sapWrites)
        .set({ status: 'done', doneAt: now, attempts: w.attempts + 1, lastError: null })
        .where(eq(sapWrites.id, w.id));
      sent++;
    } catch (err) {
      const attempts = w.attempts + 1;
      await deps.db
        .update(sapWrites)
        .set({
          attempts,
          lastError: (err as Error).message,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
        })
        .where(eq(sapWrites.id, w.id));
    }
  }
  // The office shows each DO's SAP status.
  for (const tripId of touched) deps.events.publish({ type: 'trip_changed', tripId });
  return sent;
}

/**
 * Visitors and contractors at the gate (decisions V3, V6–V9): gate in with an
 * invite or as a walk-in, one card per group, and the "Staff" plate log.
 * Nobody is refused: problems are recorded and alerted.
 */
import {
  inviteState,
  issueCard,
  normalizeCardNo,
  normalizePlate,
  validGroupSize,
  visitGateInAlerts,
  type CardError,
  type RaisedAlert,
  type VisitType,
} from '@vms/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cards, hosts, invites, photos, plateReads, staffEntries, visits } from '../db/schema.js';
import { siteDate, siteDateTime } from '../time.js';
import { deliverAlerts, recordAlerts } from './alerts.js';
import { audit, type DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { ServiceError } from './errors.js';
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

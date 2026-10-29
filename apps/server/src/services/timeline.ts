/**
 * One truck's whole journey, in order: gate in, SDO match, weighing, DO,
 * SAP/CWIS updates, check, alerts, gate out. Built from the records each step
 * already keeps, so it is the audit trail in readable form.
 */
import { ALERTS, type AlertType } from '@vms/domain';
import { aliasedTable, and, asc, eq, ne } from 'drizzle-orm';
import {
  alerts,
  cards,
  checkerDecisions,
  cwisPushes,
  photos,
  plateReads,
  preRegistrations,
  sapWrites,
  transporters,
  trips,
  tripDos,
  tripSdos,
  users,
  weighTickets,
} from '../db/schema.js';
import type { DbOrTx } from './audit.js';
import { notFound } from './errors.js';
import type { Site } from './sites.js';

export type TimelineKind =
  | 'gate_in'
  | 'sdo'
  | 'cwis'
  | 'weigh_in'
  | 'weigh_out'
  | 'do'
  | 'sap'
  | 'check'
  | 'alert'
  | 'alert_cleared'
  | 'gate_out';

export interface TimelineEvent {
  at: Date;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  /** Colour for the dot: ok (green), warn (amber), bad (red), info, muted. */
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted';
  actor: string | null;
}

const REASONS: Record<string, string> = {
  wrong_item: 'wrong item',
  wrong_quantity: 'wrong quantity',
  damaged: 'damaged',
  other: 'other',
};

const UDF_NAMES: Record<string, string> = {
  plate: 'plate',
  wbTicket: 'WB ticket',
  checkerName: 'checker',
  checkedAt: 'check time',
  gateInAt: 'gate in',
  gateOutAt: 'gate out',
};

export async function tripTimeline(db: DbOrTx, site: Site, tripId: string) {
  const guardIn = aliasedTable(users, 'guard_in');
  const guardOut = aliasedTable(users, 'guard_out');
  const [row] = await db
    .select({
      trip: trips,
      transporterName: transporters.name,
      cardNo: cards.cardNo,
      inBy: guardIn.displayName,
      outBy: guardOut.displayName,
      preRegDate: preRegistrations.expectedDate,
    })
    .from(trips)
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .leftJoin(cards, eq(cards.id, trips.cardId))
    .leftJoin(guardIn, eq(guardIn.id, trips.gateInBy))
    .leftJoin(guardOut, eq(guardOut.id, trips.gateOutBy))
    .leftJoin(preRegistrations, eq(preRegistrations.id, trips.preRegistrationId))
    .where(and(eq(trips.siteId, site.id), eq(trips.id, tripId)));
  if (!row) throw notFound('TRIP_NOT_FOUND');
  const { trip } = row;

  const linker = aliasedTable(users, 'linker');
  const clearer = aliasedTable(users, 'clearer');
  const [reads, gatePhotos, sdos, tickets, dos, writes, pushes, checks, tripAlerts] =
    await Promise.all([
      db
        .select()
        .from(plateReads)
        .where(eq(plateReads.tripId, tripId))
        .orderBy(asc(plateReads.readAt)),
      db.select({ kind: photos.kind }).from(photos).where(eq(photos.tripId, tripId)),
      db
        .select({ s: tripSdos, by: linker.displayName })
        .from(tripSdos)
        .leftJoin(linker, eq(linker.id, tripSdos.linkedBy))
        .where(eq(tripSdos.tripId, tripId)),
      db.select().from(weighTickets).where(eq(weighTickets.tripId, tripId)),
      db
        .select({ d: tripDos, by: linker.displayName })
        .from(tripDos)
        .leftJoin(linker, eq(linker.id, tripDos.changedBy))
        .where(eq(tripDos.tripId, tripId)),
      db
        .select()
        .from(sapWrites)
        .where(and(eq(sapWrites.tripId, tripId), ne(sapWrites.status, 'superseded'))),
      db.select().from(cwisPushes).where(eq(cwisPushes.tripId, tripId)),
      db
        .select({ c: checkerDecisions, by: users.displayName })
        .from(checkerDecisions)
        .innerJoin(users, eq(users.id, checkerDecisions.checkerId))
        .where(eq(checkerDecisions.tripId, tripId)),
      db
        .select({ a: alerts, by: clearer.displayName })
        .from(alerts)
        .leftJoin(clearer, eq(clearer.id, alerts.clearedBy))
        .where(eq(alerts.tripId, tripId)),
    ]);

  const events: TimelineEvent[] = [];
  const add = (e: TimelineEvent) => events.push(e);

  const entryRead = reads.find((r) => r.camera === 'entry');
  const photoCount = gatePhotos.filter((p) => p.kind === 'ic' || p.kind === 'document').length;
  add({
    at: trip.gateInAt,
    kind: 'gate_in',
    title: `Gate in · ${trip.type === 'outbound' ? 'Collect (pipes)' : 'Deliver (coil)'}`,
    detail: [
      entryRead
        ? entryRead.corrected
          ? `camera read ${entryRead.plateText}, corrected to ${trip.plateIn}`
          : `camera read ${trip.plateIn}`
        : 'plate entered by guard',
      row.cardNo ? `card ${row.cardNo}` : null,
      `${photoCount} photo${photoCount === 1 ? '' : 's'}`,
      row.transporterName,
      row.preRegDate ? `pre-registered for ${row.preRegDate}` : 'not pre-registered',
    ]
      .filter(Boolean)
      .join(' · '),
    tone: 'info',
    actor: row.inBy,
  });

  for (const { s, by } of sdos) {
    add({
      at: s.linkedAt,
      kind: 'sdo',
      title: `SDO ${s.sdoNo} matched`,
      detail: s.source === 'pre_registration' ? 'from pre-registration' : 'by the clerk',
      tone: 'info',
      actor: s.source === 'clerk' ? by : 'System',
    });
  }

  const sentPushes = pushes.filter((p) => p.doneAt);
  if (sentPushes.length > 0) {
    const first = sentPushes.reduce((a, b) => (a.doneAt! < b.doneAt! ? a : b));
    add({
      at: first.doneAt!,
      kind: 'cwis',
      title: 'Details sent to CWIS',
      detail: `plate, card, company and SDOs for the weighbridge${sentPushes.length > 1 ? ` (updated ${sentPushes.length - 1}×)` : ''}`,
      tone: 'muted',
      actor: 'System',
    });
  }

  for (const t of tickets) {
    const plateNote =
      t.plate.replace(/\s/g, '').toUpperCase() !== trip.plateIn ? ` · CWIS plate ${t.plate}` : '';
    if (t.weighInAt) {
      add({
        at: t.weighInAt,
        kind: 'weigh_in',
        title: `Weighed in · ticket ${t.ticketNo}`,
        detail: `${t.sdoNos.length ? `SDO ${t.sdoNos.join(', ')}` : 'no SDO'}${plateNote}`,
        tone: plateNote ? 'warn' : 'info',
        actor: 'Weighbridge',
      });
    }
    if (t.weighOutAt) {
      add({
        at: t.weighOutAt,
        kind: 'weigh_out',
        title: `Weighed out · ticket ${t.ticketNo}`,
        detail: null,
        tone: 'info',
        actor: 'Weighbridge',
      });
    }
  }

  for (const { d, by } of dos) {
    add({
      at: d.changedAt,
      kind: 'do',
      title: d.state === 'linked' ? `DO ${d.doNo} found` : `DO ${d.doNo} unlinked`,
      detail:
        d.state === 'linked'
          ? d.source === 'auto'
            ? 'from SAP, copied from this truck’s SDO'
            : 'linked by the clerk'
          : 'by the clerk',
      tone: d.state === 'linked' ? 'ok' : 'muted',
      actor: d.source === 'auto' ? 'System' : by,
    });
  }

  for (const w of writes) {
    const fields = Object.keys(w.udfs as Record<string, unknown>)
      .map((k) => UDF_NAMES[k] ?? k)
      .join(', ');
    if (w.status === 'done' && w.doneAt) {
      add({
        at: w.doneAt,
        kind: 'sap',
        title: `SAP updated · DO ${w.doNo}`,
        detail: fields,
        tone: 'muted',
        actor: 'System',
      });
    } else if (w.status === 'pending') {
      add({
        at: w.createdAt,
        kind: 'sap',
        title: `Waiting to update SAP · DO ${w.doNo}`,
        detail: w.attempts > 0 ? `${w.attempts} tries so far: ${w.lastError ?? ''}` : fields,
        tone: w.attempts > 0 ? 'warn' : 'muted',
        actor: 'System',
      });
    }
  }

  for (const { c, by } of checks) {
    const differences = c.lineChecks.filter((l) => !l.ok);
    add({
      at: c.decidedAt,
      kind: 'check',
      title:
        c.decision === 'approve'
          ? 'Load approved'
          : `Load rejected · ${REASONS[c.reason ?? 'other']}`,
      detail: [
        `${c.lineChecks.length} line${c.lineChecks.length === 1 ? '' : 's'} checked`,
        differences.length
          ? differences
              .map(
                (d) =>
                  `SDO ${d.sdoNo} line ${d.lineNo + 1}: ${d.actualPieces} of ${d.expectedPieces}`,
              )
              .join('; ')
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      tone: c.decision === 'approve' ? 'ok' : 'bad',
      actor: by,
    });
  }

  for (const { a, by } of tripAlerts) {
    const label = ALERTS[a.type as AlertType]?.label ?? a.type;
    const detail = a.detail ? Object.values(a.detail as Record<string, string>).join(' · ') : null;
    add({
      at: a.raisedAt,
      kind: 'alert',
      title: a.level === 'logged' ? `Noted: ${label}` : `Alert: ${label}`,
      detail,
      tone: a.level === 'red' ? 'bad' : a.level === 'amber' ? 'warn' : 'muted',
      actor: a.notify.length ? `Supervisor told` : null,
    });
    if (a.clearedAt) {
      add({
        at: a.clearedAt,
        kind: 'alert_cleared',
        title: `Alert cleared: ${label}`,
        detail: a.clearReason,
        tone: 'muted',
        actor: by,
      });
    }
  }

  if (trip.gateOutAt) {
    const level = trip.exitLevel ?? 'green';
    add({
      at: trip.gateOutAt,
      kind: 'gate_out',
      title: `Gate out · ${level === 'green' ? 'all done' : level === 'amber' ? 'with checks' : 'with problems'}`,
      detail: [
        trip.cardReturned ? 'card returned' : 'card NOT returned',
        `${Math.round((trip.gateOutAt.getTime() - trip.gateInAt.getTime()) / 60_000)} min inside`,
      ].join(' · '),
      tone: level === 'green' ? 'ok' : level === 'amber' ? 'warn' : 'bad',
      actor: row.outBy,
    });
  }

  // Same moment: keep the natural order (gate in first, gate out last).
  const order: TimelineKind[] = [
    'gate_in',
    'sdo',
    'cwis',
    'weigh_in',
    'do',
    'sap',
    'check',
    'weigh_out',
    'alert',
    'alert_cleared',
    'gate_out',
  ];
  events.sort(
    (a, b) => a.at.getTime() - b.at.getTime() || order.indexOf(a.kind) - order.indexOf(b.kind),
  );

  return {
    id: trip.id,
    tripNo: trip.tripNo,
    plate: trip.plateIn,
    type: trip.type,
    status: trip.status,
    transporterName: row.transporterName,
    gateInAt: trip.gateInAt,
    gateOutAt: trip.gateOutAt,
    exitLevel: trip.exitLevel,
    events,
  };
}

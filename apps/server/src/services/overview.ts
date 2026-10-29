/**
 * Live overview (docs/SPEC.md "Screens by role" > Management, first version):
 * trucks inside now with their stage, today's in/out and time inside, exits
 * by colour, open alerts, and whether SAP and CWIS are keeping up.
 */
import { and, eq, inArray, isNotNull, min, sql, count } from 'drizzle-orm';
import { cwisPushes, sapWrites, trips } from '../db/schema.js';
import { siteDate } from '../time.js';
import { openAlerts, tripsOnSite, type TripSummary } from './clerk.js';
import type { ServiceDeps } from './deps.js';
import { tripExitStatus } from './gateOut.js';
import type { Site } from './sites.js';

export type Stage =
  | 'Not matched'
  | 'Waiting weigh-in'
  | 'Rejected'
  | 'Waiting check'
  | 'Waiting DO'
  | 'Waiting weigh-out'
  | 'Ready to go';

/** Where a truck inside is in its flow (outbound: match, weigh, check, DO; inbound: weigh). */
export function stageOf(t: Pick<TripSummary, 'type' | 'stage'>): Stage {
  const s = t.stage;
  if (t.type === 'inbound') {
    if (!s.weighedIn) return 'Waiting weigh-in';
    if (!s.weighedOut) return 'Waiting weigh-out';
    return 'Ready to go';
  }
  if (!s.matched) return 'Not matched';
  if (!s.weighedIn) return 'Waiting weigh-in';
  if (s.checked === 'reject') return 'Rejected';
  if (s.checked === null) return 'Waiting check';
  if (s.doCount === 0) return 'Waiting DO';
  if (!s.weighedOut) return 'Waiting weigh-out';
  return 'Ready to go';
}

export async function overview(deps: ServiceDeps, site: Site) {
  const { db } = deps;
  const now = deps.now();
  const today = siteDate(now, site.timezone);
  const onDay = (col: typeof trips.gateInAt | typeof trips.gateOutAt) =>
    sql`(${col} at time zone ${site.timezone})::date = ${today}::date`;

  const inside = await tripsOnSite(deps, site);
  const rows = inside.length
    ? await db
        .select()
        .from(trips)
        .where(
          inArray(
            trips.id,
            inside.map((t) => t.id),
          ),
        )
    : [];
  const insideView = await Promise.all(
    inside.map(async (t) => {
      const status = await tripExitStatus(
        db,
        site.id,
        rows.find((r) => r.id === t.id)!,
        true,
      );
      return {
        id: t.id,
        tripNo: t.tripNo,
        plate: t.plate,
        type: t.type,
        transporterName: t.transporterName,
        sdoNos: t.sdoNos,
        minutesInside: Math.max(
          0,
          Math.round((now.getTime() - new Date(t.gateInAt).getTime()) / 60_000),
        ),
        stage: stageOf(t),
        /** Colour the truck would get at the exit right now. */
        level: status.level,
        reasons: status.reasons.filter((r) => r.level !== 'logged').map((r) => r.label),
        openAlert: t.alertLevel,
      };
    }),
  );
  insideView.sort((a, b) => b.minutesInside - a.minutesInside);

  const [inToday] = await db
    .select({ n: count() })
    .from(trips)
    .where(and(eq(trips.siteId, site.id), onDay(trips.gateInAt)));
  const leftToday = await db
    .select({ level: trips.exitLevel, gateInAt: trips.gateInAt, gateOutAt: trips.gateOutAt })
    .from(trips)
    .where(and(eq(trips.siteId, site.id), isNotNull(trips.gateOutAt), onDay(trips.gateOutAt)));
  const minutes = leftToday.map((t) => (t.gateOutAt!.getTime() - t.gateInAt.getTime()) / 60_000);

  const [sap] = await db
    .select({ pending: count(), oldest: min(sapWrites.createdAt) })
    .from(sapWrites)
    .where(and(eq(sapWrites.siteId, site.id), eq(sapWrites.status, 'pending')));
  const [cwis] = await db
    .select({ pending: count(), oldest: min(cwisPushes.createdAt) })
    .from(cwisPushes)
    .where(and(eq(cwisPushes.siteId, site.id), eq(cwisPushes.status, 'pending')));

  const stages: Record<Stage, number> = {
    'Not matched': 0,
    'Waiting weigh-in': 0,
    Rejected: 0,
    'Waiting check': 0,
    'Waiting DO': 0,
    'Waiting weigh-out': 0,
    'Ready to go': 0,
  };
  for (const t of insideView) stages[t.stage]++;

  return {
    at: now,
    date: today,
    today: {
      in: inToday?.n ?? 0,
      out: leftToday.length,
      inside: insideView.length,
      avgMinutesInside: minutes.length
        ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)
        : null,
      exits: {
        green: leftToday.filter((t) => t.level === 'green').length,
        amber: leftToday.filter((t) => t.level === 'amber').length,
        red: leftToday.filter((t) => t.level === 'red').length,
      },
    },
    stages,
    inside: insideView,
    openAlerts: (await openAlerts(deps, site)).slice(0, 10),
    integrations: {
      sapWaiting: sap?.pending ?? 0,
      sapOldestWaitingAt: sap?.oldest ?? null,
      cwisWaiting: cwis?.pending ?? 0,
      cwisOldestWaitingAt: cwis?.oldest ?? null,
    },
  };
}

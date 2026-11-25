/**
 * Long stay (decision G4): raise "Long stay" (amber) and "Too long inside"
 * (red) once each for a truck still inside past the site's limits. Alerts
 * only; the truck is never stopped.
 */
import { longStayAlertsDue, raise, type AlertType } from '@vms/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { alerts, trips } from '../db/schema.js';
import { deliverAlerts, recordAlerts } from './alerts.js';
import type { ServiceDeps } from './deps.js';
import type { Site } from './sites.js';

/** Check trucks inside; returns how many alerts were raised. */
export async function checkLongStays(deps: ServiceDeps, site: Site): Promise<number> {
  const { db } = deps;
  const now = deps.now();
  const inside = await db
    .select({ id: trips.id, tripNo: trips.tripNo, plate: trips.plateIn, gateInAt: trips.gateInAt })
    .from(trips)
    .where(and(eq(trips.siteId, site.id), eq(trips.status, 'on_site')));
  if (inside.length === 0) return 0;
  const existing = await db
    .select({ tripId: alerts.tripId, type: alerts.type })
    .from(alerts)
    .where(
      and(
        inArray(
          alerts.tripId,
          inside.map((t) => t.id),
        ),
        inArray(alerts.type, ['LONG_STAY', 'LONG_STAY_RED']),
      ),
    );
  let raised = 0;
  for (const t of inside) {
    const minutes = (now.getTime() - t.gateInAt.getTime()) / 60_000;
    const already = existing.filter((a) => a.tripId === t.id).map((a) => a.type as AlertType);
    const due = longStayAlertsDue(minutes, deps.config.longStay, already);
    if (due.length === 0) continue;
    const hours = `${Math.floor(minutes / 60)}h ${String(Math.floor(minutes % 60)).padStart(2, '0')}m`;
    const rows = await recordAlerts(
      db,
      site.id,
      t.id,
      due.map((type) => raise(type, { inside: hours })),
      now,
    );
    await deliverAlerts(db, deps.adapters.notifier, deps.events, rows, {
      siteCode: site.code,
      tripNo: t.tripNo,
      plate: t.plate,
      at: now,
    });
    deps.events.publish({ type: 'trip_changed', tripId: t.id });
    raised += rows.length;
  }
  return raised;
}

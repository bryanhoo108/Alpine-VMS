import type { Notifier } from '@vms/adapters';
import { raise, type AlertType, type RaisedAlert } from '@vms/domain';
import { eq } from 'drizzle-orm';
import { alerts } from '../db/schema.js';
import type { EventBus } from '../events.js';
import type { DbOrTx } from './audit.js';

export type AlertRow = typeof alerts.$inferSelect;

/** Store alerts for a trip or visit. Call inside its transaction; deliver after commit. */
export async function recordAlerts(
  db: DbOrTx,
  siteId: string,
  tripId: string | null,
  raised: readonly RaisedAlert[],
  at: Date,
  visitId: string | null = null,
): Promise<AlertRow[]> {
  if (raised.length === 0) return [];
  return db
    .insert(alerts)
    .values(
      raised.map((a) => ({
        siteId,
        tripId,
        visitId,
        type: a.type,
        level: a.level,
        detail: a.detail ?? null,
        notify: [...a.notify],
        raisedAt: at,
      })),
    )
    .returning();
}

/** After commit: tell the supervisor where needed, and push to screens. */
export async function deliverAlerts(
  db: DbOrTx,
  notifier: Notifier,
  events: EventBus,
  rows: readonly AlertRow[],
  ctx: { siteCode: string; tripNo: string | null; plate: string | null; at: Date },
): Promise<void> {
  for (const row of rows) {
    events.publish({ type: 'alert', alertId: row.id, level: row.level });
    if (row.notify.length === 0) continue;
    await notifier.notify({
      siteCode: ctx.siteCode,
      alert: raise(
        row.type as AlertType,
        (row.detail as Record<string, string> | null) ?? undefined,
      ),
      tripNo: ctx.tripNo,
      plate: ctx.plate,
      raisedAt: row.raisedAt,
    });
    await db.update(alerts).set({ notifiedAt: ctx.at }).where(eq(alerts.id, row.id));
  }
}

/**
 * Nightly reconciliation (docs/SPEC.md "SAP B1 integration > Reliability"):
 * exits with no DO, and DOs with no exit, for one site-local day.
 */
import { selectDosForTrip } from '@vms/domain';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { doCache, trips, tripDos, tripSdos } from '../db/schema.js';
import type { ServiceDeps } from './deps.js';
import { tripLinkedDos } from './dos.js';
import type { Site } from './sites.js';

export async function reconcile(deps: ServiceDeps, site: Site, date: string) {
  const { db } = deps;
  const tz = site.timezone;
  const onDay = (col: typeof trips.gateOutAt | typeof doCache.sapCreatedAt) =>
    sql`(${col} at time zone ${tz})::date = ${date}::date`;

  const exits = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.siteId, site.id),
        eq(trips.type, 'outbound'),
        isNotNull(trips.gateOutAt),
        onDay(trips.gateOutAt),
      ),
    )
    .orderBy(asc(trips.gateOutAt));
  const exitsWithoutDo = [];
  for (const t of exits) {
    const sdoNos = (
      await db.select({ sdoNo: tripSdos.sdoNo }).from(tripSdos).where(eq(tripSdos.tripId, t.id))
    ).map((s) => s.sdoNo);
    const dos = await tripLinkedDos(db, site.id, t.id);
    const { sdosWithoutDo } = selectDosForTrip({
      tripId: t.id,
      gateInAt: t.gateInAt,
      sdoNos,
      dos,
      claims: new Map(),
      manualLinks: dos.map((d) => d.doNo),
    });
    if (sdoNos.length === 0 || sdosWithoutDo.length > 0) {
      exitsWithoutDo.push({
        tripId: t.id,
        tripNo: t.tripNo,
        plate: t.plateIn,
        gateOutAt: t.gateOutAt,
        sdoNos,
        sdosWithoutDo: sdoNos.length === 0 ? [] : sdosWithoutDo,
      });
    }
  }

  // DOs made that day that no truck has taken out (not linked, or linked to a truck still inside).
  const dos = await db
    .select({
      doNo: doCache.doNo,
      createdAt: doCache.sapCreatedAt,
      customerCode: doCache.customerCode,
    })
    .from(doCache)
    .where(and(eq(doCache.siteId, site.id), onDay(doCache.sapCreatedAt)))
    .orderBy(asc(doCache.doNo));
  const exited = await db
    .select({ doNo: tripDos.doNo })
    .from(tripDos)
    .innerJoin(trips, eq(trips.id, tripDos.tripId))
    .where(
      and(eq(tripDos.siteId, site.id), eq(tripDos.state, 'linked'), isNotNull(trips.gateOutAt)),
    );
  const out = new Set(exited.map((e) => e.doNo));
  return { date, exitsWithoutDo, dosWithoutExit: dos.filter((d) => !out.has(d.doNo)) };
}

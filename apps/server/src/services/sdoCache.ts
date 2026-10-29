/**
 * Local copy of open SDOs from SAP (docs/SPEC.md "SAP B1 integration": cached
 * and refreshed every few minutes). Screens read the cache, so the clerk can
 * keep matching when SAP is down. The checker re-reads the live SDO (step 5).
 */
import type { SapSdo } from '@vms/adapters';
import { sdoVersion } from '@vms/domain';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { sdoCache, sdoLines, tripSdos, type SdoLineSnapshot } from '../db/schema.js';
import type { DbOrTx } from './audit.js';
import { OVERLAP_MS } from './cwis.js';
import type { ServiceDeps } from './deps.js';
import type { Site } from './sites.js';

/** Store one SDO (header and lines) as SAP has it now. */
export async function cacheSdo(db: DbOrTx, siteId: string, sdo: SapSdo, now: Date) {
  const values = {
    customerCode: sdo.customerCode,
    customerName: sdo.customerName,
    status: sdo.status,
    docDate: sdo.docDate,
    sapUpdatedAt: sdo.updatedAt,
    version: sdoVersion(sdo.lines),
    fetchedAt: now,
  };
  await db
    .insert(sdoCache)
    .values({ siteId, sdoNo: sdo.sdoNo, ...values })
    .onConflictDoUpdate({ target: [sdoCache.siteId, sdoCache.sdoNo], set: values });
  await db.delete(sdoLines).where(and(eq(sdoLines.siteId, siteId), eq(sdoLines.sdoNo, sdo.sdoNo)));
  if (sdo.lines.length > 0) {
    await db.insert(sdoLines).values(sdo.lines.map((l) => ({ siteId, sdoNo: sdo.sdoNo, ...l })));
  }
}

/**
 * Refresh the cache. Incremental runs fetch only SDOs SAP changed since the
 * newest one we hold; a full run also marks SDOs that are no longer open.
 * Throws if SAP is unreachable (the job tries again next time).
 */
export async function refreshSdoCache(
  deps: ServiceDeps,
  site: Site,
  opts: { full: boolean },
): Promise<{ updated: number; closed: number }> {
  const { db } = deps;
  const now = deps.now();
  let since: Date | undefined;
  if (!opts.full) {
    const [newest] = await db
      .select({ at: sdoCache.sapUpdatedAt })
      .from(sdoCache)
      .where(eq(sdoCache.siteId, site.id))
      .orderBy(desc(sdoCache.sapUpdatedAt))
      .limit(1);
    since = newest?.at;
  }
  // Overlap by a second so an SDO changed in the same second is not missed.
  const sdos = await deps.adapters.sap.listOpenSdos(
    since ? { updatedSince: new Date(since.getTime() - OVERLAP_MS) } : {},
  );

  let closed = 0;
  await db.transaction(async (tx) => {
    for (const sdo of sdos) await cacheSdo(tx, site.id, sdo, now);
    if (opts.full) {
      const open = sdos.map((s) => s.sdoNo);
      const gone = await tx
        .update(sdoCache)
        .set({ status: 'closed', fetchedAt: now })
        .where(
          and(
            eq(sdoCache.siteId, site.id),
            eq(sdoCache.status, 'open'),
            open.length > 0 ? notInArray(sdoCache.sdoNo, open) : sql`true`,
          ),
        )
        .returning({ sdoNo: sdoCache.sdoNo });
      closed = gone.length;
    }
    // Links made before the SDO was cached get their version now, so
    // "SDO changed" compares against what the SDO looked like at linking.
    await fillMissingVersions(tx, site.id);
  });
  return { updated: sdos.length, closed };
}

export async function fillMissingVersions(db: DbOrTx, siteId: string) {
  await db.execute(sql`
    update ${tripSdos} ts set
      sdo_version_at_link = c.version,
      lines_at_link = (
        select coalesce(json_agg(json_build_object(
          'lineNo', l.line_no, 'itemCode', l.item_code, 'size', l.size,
          'spec', l.spec, 'length', l.length, 'pieces', l.pieces) order by l.line_no), '[]'::json)
        from ${sdoLines} l where l.site_id = c.site_id and l.sdo_no = c.sdo_no)
    from ${sdoCache} c
    where ts.site_id = ${siteId} and ts.sdo_version_at_link is null
      and c.site_id = ts.site_id and c.sdo_no = ts.sdo_no`);
}

/** The lines kept on a trip–SDO link, for showing what changed later. */
export function snapshotLines(sdo: CachedSdo): SdoLineSnapshot[] {
  return sdo.lines.map((l) => ({
    lineNo: l.lineNo,
    itemCode: l.itemCode,
    size: l.size,
    spec: l.spec,
    length: l.length,
    pieces: l.pieces,
  }));
}

/** Cached SDOs with their lines, keyed by number. */
export async function cachedSdos(db: DbOrTx, siteId: string, sdoNos?: readonly string[]) {
  if (sdoNos && sdoNos.length === 0) return new Map<string, CachedSdo>();
  const headers = await db
    .select()
    .from(sdoCache)
    .where(
      and(eq(sdoCache.siteId, siteId), sdoNos ? inArray(sdoCache.sdoNo, [...sdoNos]) : undefined),
    );
  const lines = await db
    .select()
    .from(sdoLines)
    .where(
      and(eq(sdoLines.siteId, siteId), sdoNos ? inArray(sdoLines.sdoNo, [...sdoNos]) : undefined),
    );
  const map = new Map<string, CachedSdo>();
  for (const h of headers) {
    map.set(h.sdoNo, {
      ...h,
      lines: lines.filter((l) => l.sdoNo === h.sdoNo).sort((a, b) => a.lineNo - b.lineNo),
    });
  }
  return map;
}

export type CachedSdo = typeof sdoCache.$inferSelect & { lines: (typeof sdoLines.$inferSelect)[] };

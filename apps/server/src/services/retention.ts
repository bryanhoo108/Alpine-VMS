/**
 * PDPA retention (CLAUDE.md "Data and privacy"): IC photos are deleted once
 * their delete-after date passes (IC_PHOTO_RETENTION_DAYS, set at upload).
 * The file goes; the row stays, marked deleted, so the trip history shows a
 * photo was taken without keeping the image. Full IC numbers read from the
 * photos (decision Q2a) go after the same period; the last 4 digits stay.
 */
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { persons, photos, visits } from '../db/schema.js';
import type { FileStore } from '../files.js';
import { audit } from './audit.js';

export async function purgeExpiredPhotos(
  db: Db,
  files: FileStore,
  siteId: string,
  now: Date,
): Promise<number> {
  const due = await db
    .select({ id: photos.id, path: photos.path })
    .from(photos)
    .where(and(eq(photos.siteId, siteId), isNull(photos.deletedAt), lte(photos.deleteAfter, now)))
    .limit(500);
  for (const p of due) {
    await files.remove(p.path);
    await db
      .update(photos)
      .set({ deletedAt: now, icEncrypted: null, icName: null })
      .where(eq(photos.id, p.id));
  }
  if (due.length > 0) {
    await audit(db, {
      siteId,
      userId: null,
      action: 'photo_retention',
      entity: 'photo',
      entityId: `${due.length} photos`,
      after: { deleted: due.map((p) => p.id) },
      at: now,
    });
  }
  return due.length;
}

/** Full IC numbers older than the retention period are cleared (last 4 digits stay). */
export async function purgeExpiredIcNumbers(
  db: Db,
  siteId: string,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const before = new Date(now.getTime() - retentionDays * 86_400_000);
  const p = await db
    .update(persons)
    .set({ icEncrypted: null })
    .where(
      and(
        eq(persons.siteId, siteId),
        isNotNull(persons.icEncrypted),
        lte(persons.createdAt, before),
      ),
    )
    .returning({ id: persons.id });
  const v = await db
    .update(visits)
    .set({ icEncrypted: null })
    .where(
      and(eq(visits.siteId, siteId), isNotNull(visits.icEncrypted), lte(visits.gateInAt, before)),
    )
    .returning({ id: visits.id });
  const cleared = p.length + v.length;
  if (cleared > 0) {
    await audit(db, {
      siteId,
      userId: null,
      action: 'ic_number_retention',
      entity: 'ic_number',
      entityId: `${cleared} IC numbers`,
      after: { persons: p.length, visits: v.length },
      at: now,
    });
  }
  return cleared;
}

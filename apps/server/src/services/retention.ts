/**
 * PDPA retention (CLAUDE.md "Data and privacy"): IC photos are deleted once
 * their delete-after date passes (IC_PHOTO_RETENTION_DAYS, set at upload).
 * The file goes; the row stays, marked deleted, so the trip history shows a
 * photo was taken without keeping the image.
 */
import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { photos } from '../db/schema.js';
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
    await db.update(photos).set({ deletedAt: now }).where(eq(photos.id, p.id));
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

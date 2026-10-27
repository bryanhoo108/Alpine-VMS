import type { PlateEvent } from '@vms/adapters';
import { normalizePlate } from '@vms/domain';
import { photos, plateReads } from '../db/schema.js';
import type { EventBus } from '../events.js';
import type { FileStore } from '../files.js';
import type { DbOrTx } from './audit.js';

/** Store a camera read (and its photo) and tell the gate screens. */
export async function recordPlateRead(
  deps: { db: DbOrTx; files: FileStore; events: EventBus },
  siteId: string,
  event: PlateEvent,
) {
  let photoId: string | null = null;
  if (event.photo) {
    const path = await deps.files.save(event.photo.data, event.photo.contentType, event.readAt);
    const [photo] = await deps.db
      .insert(photos)
      .values({
        siteId,
        kind: 'plate',
        path,
        contentType: event.photo.contentType,
        takenAt: event.readAt,
      })
      .returning({ id: photos.id });
    photoId = photo!.id;
  }
  const [row] = await deps.db
    .insert(plateReads)
    .values({
      siteId,
      camera: event.camera,
      plateText: normalizePlate(event.plateText),
      confidence: event.confidence,
      photoId,
      readAt: event.readAt,
    })
    .returning();
  deps.events.publish({ type: 'plate_read', camera: event.camera, plateReadId: row!.id });
  return row!;
}

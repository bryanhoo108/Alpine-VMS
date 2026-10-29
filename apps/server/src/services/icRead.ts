/**
 * Reading the IC photo at the gate (decision Q2a). The guard sees the last 4
 * digits and the name to confirm; the full number goes from the photo into
 * encrypted storage and is never sent to a screen.
 */
import { maskIc, readMyKad, type MyKadRead } from '@vms/domain';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { photos } from '../db/schema.js';
import type { FileStore } from '../files.js';
import { encryptIc } from '../icCrypto.js';
import type { IcReader, ReadArea } from '../ocr.js';
import type { DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { notFound, ServiceError } from './errors.js';
import type { Site } from './sites.js';

/**
 * Areas to read, in order, until a valid IC number is found: the left part
 * of the card as taken, upside down, then slightly turned either way; then
 * the whole photo. Most photos need one or two.
 */
const AREAS: ReadArea[] = [
  { angle: 0, part: 0.62 },
  { angle: 180, part: 0.62 },
  { angle: -8, part: 0.62 },
  { angle: 8, part: 0.62 },
  // A card not inside the outline (or an older, uncropped photo).
  { angle: 0, part: 1 },
  { angle: -8, part: 1 },
  { angle: 8, part: 1 },
  { angle: 180, part: 1 },
];

/**
 * Stop trying after this long. Each try is about 1 s of CPU here; the free
 * Render demo has a tenth of a CPU, so a few tries there take this long.
 */
export const READ_BUDGET_MS = 40_000;

export async function readUntilFound(
  reader: IcReader,
  image: Buffer,
  budgetMs = READ_BUDGET_MS,
): Promise<MyKadRead> {
  const until = Date.now() + budgetMs;
  let firstFound: MyKadRead | null = null;
  for (const area of AREAS) {
    const read = readMyKad(await reader.text(image, area));
    if (read.icNumber && read.name) return read;
    // Number but no name: one more try may get the name too.
    if (read.icNumber && firstFound) return firstFound;
    if (read.icNumber) firstFound = read;
    if (Date.now() > until) break;
  }
  return firstFound ?? { icNumber: null, name: null };
}

export interface IcReadView {
  found: boolean;
  /** "••••••-••-5678", or null when no number was found. */
  masked: string | null;
  last4: string | null;
  name: string | null;
}

export async function readIcPhoto(
  deps: ServiceDeps & { files: FileStore; icReader: IcReader },
  site: Site,
  photoId: string,
): Promise<IcReadView> {
  const [photo] = await deps.db
    .select()
    .from(photos)
    .where(and(eq(photos.siteId, site.id), eq(photos.id, photoId), isNull(photos.deletedAt)));
  if (!photo) throw notFound('PHOTO_NOT_FOUND');
  if (photo.kind !== 'ic') throw new ServiceError(400, 'NOT_AN_IC_PHOTO');

  const read = await readUntilFound(deps.icReader, await deps.files.read(photo.path));
  const last4 = read.icNumber?.slice(-4) ?? null;
  const key = deps.config.icEncryptionKey;
  await deps.db
    .update(photos)
    .set({
      icLast4: last4,
      icName: read.name,
      icEncrypted: read.icNumber && key ? encryptIc(read.icNumber, key) : null,
      icReadAt: deps.now(),
    })
    .where(eq(photos.id, photo.id));
  return {
    found: read.icNumber !== null,
    masked: read.icNumber ? maskIc(read.icNumber) : null,
    last4,
    name: read.name,
  };
}

/** The newest IC read among a gate-in's photos, unless the guard tapped "Wrong". */
export async function icReadOf(
  db: DbOrTx,
  siteId: string,
  photoIds: readonly string[],
  rejected: boolean,
) {
  if (rejected || photoIds.length === 0) return null;
  const [p] = await db
    .select({ last4: photos.icLast4, name: photos.icName, encrypted: photos.icEncrypted })
    .from(photos)
    .where(
      and(
        eq(photos.siteId, siteId),
        inArray(photos.id, [...photoIds]),
        eq(photos.kind, 'ic'),
        isNotNull(photos.icLast4),
      ),
    )
    .orderBy(desc(photos.icReadAt))
    .limit(1);
  return p ?? null;
}

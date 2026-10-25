import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, photos } from '../src/db/schema.js';
import { FileStore } from '../src/files.js';
import { purgeExpiredPhotos } from '../src/services/retention.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
let guard: string;
beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
});
afterAll(async () => h?.close());

const upload = async (kind: 'ic' | 'document') =>
  (
    await h.app.inject({
      method: 'POST',
      url: `/api/photos?kind=${kind}`,
      headers: { cookie: guard, 'content-type': 'image/jpeg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7]),
    })
  ).json().id as string;

describe('IC photo retention (PDPA)', () => {
  it('deletes IC photo files after the retention period and keeps documents', async () => {
    const files = new FileStore(h.deps.config.filesDir);
    const ic = await upload('ic');
    const doc = await upload('document');
    const [icRow] = await h.t.db.select().from(photos).where(eq(photos.id, ic));
    const icFile = path.resolve(h.deps.config.filesDir, icRow!.path);
    expect(existsSync(icFile)).toBe(true);

    // Day 89: nothing yet.
    expect(
      await purgeExpiredPhotos(
        h.t.db,
        files,
        h.site.id,
        new Date(h.clock.now.getTime() + 89 * 86_400_000),
      ),
    ).toBe(0);

    // Day 91: the IC photo goes, the row stays marked deleted.
    const later = new Date(h.clock.now.getTime() + 91 * 86_400_000);
    expect(await purgeExpiredPhotos(h.t.db, files, h.site.id, later)).toBe(1);
    expect(existsSync(icFile)).toBe(false);
    const [after] = await h.t.db.select().from(photos).where(eq(photos.id, ic));
    expect(after!.deletedAt).toEqual(later);
    const [docRow] = await h.t.db.select().from(photos).where(eq(photos.id, doc));
    expect(docRow!.deletedAt).toBeNull();

    // No longer served, and the purge is in the audit log.
    expect(
      (await h.app.inject({ url: `/api/photos/${ic}`, headers: { cookie: guard } })).statusCode,
    ).toBe(404);
    const log = await h.t.db.select().from(auditLog).where(eq(auditLog.action, 'photo_retention'));
    expect(log).toHaveLength(1);

    // Running again does nothing.
    expect(await purgeExpiredPhotos(h.t.db, files, h.site.id, later)).toBe(0);
  });
});

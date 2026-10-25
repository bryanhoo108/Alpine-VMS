import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifySecret } from '../src/auth/secret.js';
import { addCards, addUser, checkSecret, initSite, setActive } from '../src/cli/admin.js';
import { cards, users } from '../src/db/schema.js';
import { createTestDb, type TestDatabase } from './helpers/testDb.js';

let t: TestDatabase;
let siteId: string;
beforeAll(async () => {
  t = await createTestDb();
  siteId = (await initSite(t.db, 'APM', 'Alpine Pipe Manufacturing, Shah Alam')).id;
});
afterAll(async () => t?.drop());

describe('admin setup (real site, no demo data)', () => {
  it('creates the site once', async () => {
    expect((await initSite(t.db, 'APM', 'Other name')).id).toBe(siteId);
  });

  it('PINs for guards and checkers, passwords for office roles', () => {
    expect(checkSecret('guard', '1234')).toBeNull();
    expect(checkSecret('guard', '12a4')).toMatch(/PIN/);
    expect(checkSecret('checker', '123')).toMatch(/PIN/);
    expect(checkSecret('clerk', 'short')).toMatch(/Password/);
    expect(checkSecret('supervisor', 'long enough pw')).toBeNull();
  });

  it('adds a user with a hashed PIN, and updates the same user again', async () => {
    await addUser(t.db, siteId, {
      username: 'g1',
      displayName: 'Guard 1',
      role: 'guard',
      secret: '5678',
    });
    await addUser(t.db, siteId, {
      username: 'g1',
      displayName: 'Guard One',
      role: 'guard',
      secret: '8765',
    });
    const [u] = await t.db.select().from(users).where(eq(users.username, 'g1'));
    expect(u).toMatchObject({ displayName: 'Guard One', passwordHash: null, active: true });
    expect(await verifySecret('8765', u!.pinHash!)).toBe(true);
  });

  it('refuses a weak secret', async () => {
    await expect(
      addUser(t.db, siteId, { username: 'c1', displayName: 'Clerk', role: 'clerk', secret: '123' }),
    ).rejects.toThrow(/Password/);
  });

  it('deactivates a user', async () => {
    await setActive(t.db, siteId, 'g1', false);
    const [u] = await t.db.select().from(users).where(eq(users.username, 'g1'));
    expect(u!.active).toBe(false);
    await expect(setActive(t.db, siteId, 'nobody', false)).rejects.toThrow();
  });

  it('adds real card numbers in any reader format, skipping repeats', async () => {
    expect(
      await addCards(t.db, siteId, '04:a1:b2:c3:d4:e5:f6\n04A1B2C3D4E5F7, 04a1b2c3d4e5f6'),
    ).toEqual({
      added: 2,
      skipped: 0,
    });
    expect(await addCards(t.db, siteId, '04A1B2C3D4E5F6')).toEqual({ added: 0, skipped: 1 });
    const all = await t.db.select().from(cards);
    expect(all.map((c) => c.cardNo).sort()).toEqual(['04A1B2C3D4E5F6', '04A1B2C3D4E5F7']);
  });
});

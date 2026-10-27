import { MockSapAdapter } from '@vms/adapters';
import { count, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifySecret } from '../src/auth/secret.js';
import {
  cards,
  preRegistrations,
  sites,
  transporters,
  tripDos,
  trips,
  users,
  vehicles,
  watchlist,
} from '../src/db/schema.js';
import { CARD_POOL_SIZE, seed } from '../src/db/seed.js';
import { createTestDb, type TestDatabase } from './helpers/testDb.js';

const NOW = new Date('2026-10-21T02:00:00Z'); // 10:00 in Shah Alam
const SEED = { siteCode: 'APM', demoPin: '9876', demoPassword: 'test-password', now: NOW };

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDb();
  await seed(t.db, new MockSapAdapter({ now: () => NOW }), SEED);
});
afterAll(async () => t?.drop());

const countOf = async (table: PgTable) => (await t.db.select({ n: count() }).from(table))[0]?.n;

describe('schema', () => {
  it('puts site_id on every table except sites', async () => {
    const rows = await t.db.execute<{ table_name: string }>(sql`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and t.table_name <> 'sites'
        and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'site_id')`);
    expect(rows.rows.map((r) => r.table_name)).toEqual([]);
  });

  it('lets a DO be claimed by only one trip', async () => {
    const [site] = await t.db.select().from(sites);
    const [guard] = await t.db.select().from(users).where(eq(users.username, 'guard.entry'));
    const [vehicle] = await t.db
      .insert(vehicles)
      .values({ siteId: site!.id, plate: 'TEST1' })
      .returning();
    const newTrip = async (tripNo: string) =>
      (
        await t.db
          .insert(trips)
          .values({
            siteId: site!.id,
            tripNo,
            type: 'outbound',
            vehicleId: vehicle!.id,
            plateIn: 'TEST1',
            gateInAt: NOW,
            gateInBy: guard!.id,
          })
          .returning()
      )[0]!;
    const a = await newTrip('T-TEST-1');
    const b = await newTrip('T-TEST-2');

    await t.db
      .insert(tripDos)
      .values({ siteId: site!.id, tripId: a.id, doNo: '8100', source: 'auto' });
    await expect(
      t.db.insert(tripDos).values({ siteId: site!.id, tripId: b.id, doNo: '8100', source: 'auto' }),
    ).rejects.toMatchObject({ cause: { constraint: 'trip_dos_one_claim' } });
    // Once unlinked from the first trip, the other trip may claim it.
    await t.db.update(tripDos).set({ state: 'unlinked' }).where(eq(tripDos.tripId, a.id));
    await t.db
      .insert(tripDos)
      .values({ siteId: site!.id, tripId: b.id, doNo: '8100', source: 'clerk' });
  });
});

describe('seed', () => {
  it('creates the site, demo users, card pool, transporters, pre-registrations and watchlist', async () => {
    expect(await countOf(sites)).toBe(1);
    expect(await countOf(users)).toBe(7);
    expect(await countOf(cards)).toBe(CARD_POOL_SIZE);
    expect(await countOf(transporters)).toBe(4);
    expect(await countOf(preRegistrations)).toBe(3);
    expect(await countOf(watchlist)).toBe(1);
  });

  it('dates pre-registrations in site time, including one late', async () => {
    const rows = await t.db.select().from(preRegistrations);
    expect(rows.map((r) => r.expectedDate).sort()).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-21',
    ]);
  });

  it('stores hashed secrets, PINs for guards and passwords for clerks', async () => {
    const [guard] = await t.db.select().from(users).where(eq(users.username, 'guard.entry'));
    const [clerk] = await t.db.select().from(users).where(eq(users.username, 'clerk'));
    expect(guard!.pinHash).not.toContain('9876');
    expect(await verifySecret('9876', guard!.pinHash!)).toBe(true);
    expect(await verifySecret('0000', guard!.pinHash!)).toBe(false);
    expect(guard!.passwordHash).toBeNull();
    expect(await verifySecret('test-password', clerk!.passwordHash!)).toBe(true);
  });

  it('can run again without duplicating anything', async () => {
    await seed(t.db, new MockSapAdapter({ now: () => NOW }), SEED);
    expect(await countOf(users)).toBe(7);
    expect(await countOf(cards)).toBe(CARD_POOL_SIZE);
    expect(await countOf(transporters)).toBe(4);
    expect(await countOf(preRegistrations)).toBe(3);
    expect(await countOf(watchlist)).toBe(1);
  });
});

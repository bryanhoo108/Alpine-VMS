/**
 * Sample data for development and demos: the APM site, demo users, a card
 * pool, transporters (from SAP), and a few pre-registrations and a watchlist
 * entry. Safe to run more than once. Demo PIN and password come from
 * environment variables; none are stored in the repo.
 */
import { createAdapters, adapterConfigFromEnv, type SapAdapter } from '@vms/adapters';
import { normalizePlate } from '@vms/domain';
import { count, eq } from 'drizzle-orm';
import { hashSecret } from '../auth/secret.js';
import { loadConfig } from '../config.js';
import { syncTransporters } from '../services/businessPartners.js';
import { addDays, siteDate } from '../time.js';
import { connect, runMigrations, type Db } from './client.js';
import { cards, preRegistrations, sites, transporters, users, watchlist } from './schema.js';

export const CARD_POOL_SIZE = 60;

/** Sample card serial numbers (7-byte NFC UIDs as hex). */
export const sampleCardNo = (i: number) =>
  `04A1B2C3${i.toString(16).toUpperCase().padStart(6, '0')}`;

const DEMO_USERS = [
  { username: 'guard.entry', displayName: 'Entry Guard', role: 'guard', secret: 'pin' },
  { username: 'guard.exit', displayName: 'Exit Guard', role: 'guard', secret: 'pin' },
  { username: 'checker1', displayName: 'Checker 1', role: 'checker', secret: 'pin' },
  { username: 'checker2', displayName: 'Checker 2', role: 'checker', secret: 'pin' },
  { username: 'clerk', displayName: 'Logistics Clerk', role: 'clerk', secret: 'password' },
  { username: 'supervisor', displayName: 'Supervisor', role: 'supervisor', secret: 'password' },
  { username: 'admin', displayName: 'Admin', role: 'admin', secret: 'password' },
] as const;

export interface SeedOptions {
  siteCode: string;
  demoPin: string;
  demoPassword: string;
  now: Date;
}

export async function seed(db: Db, sap: SapAdapter, opts: SeedOptions): Promise<void> {
  await db
    .insert(sites)
    .values({ code: opts.siteCode, name: 'Alpine Pipe Manufacturing, Shah Alam' })
    .onConflictDoNothing();
  const [site] = await db.select().from(sites).where(eq(sites.code, opts.siteCode));
  if (!site) throw new Error('site insert failed');

  const pinHash = await hashSecret(opts.demoPin);
  const passwordHash = await hashSecret(opts.demoPassword);
  await db
    .insert(users)
    .values(
      DEMO_USERS.map((u) => ({
        siteId: site.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        pinHash: u.secret === 'pin' ? pinHash : null,
        passwordHash: u.secret === 'password' ? passwordHash : null,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(cards)
    .values(
      Array.from({ length: CARD_POOL_SIZE }, (_, i) => ({
        siteId: site.id,
        cardNo: sampleCardNo(i + 1),
      })),
    )
    .onConflictDoNothing();

  await syncTransporters(db, sap, site.id);

  const [clerk] = await db.select().from(users).where(eq(users.username, 'clerk'));
  const [supervisor] = await db.select().from(users).where(eq(users.username, 'supervisor'));
  const [transporter] = await db
    .select()
    .from(transporters)
    .where(eq(transporters.sapBpCode, 'T0001'));
  if (!clerk || !supervisor || !transporter) throw new Error('demo users or transporters missing');

  const today = siteDate(opts.now, site.timezone);
  const [preRegCount] = await db
    .select({ n: count() })
    .from(preRegistrations)
    .where(eq(preRegistrations.siteId, site.id));
  if (preRegCount?.n === 0) {
    await db.insert(preRegistrations).values([
      {
        siteId: site.id,
        plate: normalizePlate('WXY 1234'),
        transporterId: transporter.id,
        expectedDate: today,
        sdoNos: ['5005'],
        note: 'Sample: due today',
        createdBy: clerk.id,
      },
      {
        siteId: site.id,
        plate: normalizePlate('BPN 2045'),
        transporterId: transporter.id,
        expectedDate: today,
        sdoNos: ['5009', '5010'],
        note: 'Sample: two SDOs on one truck',
        createdBy: clerk.id,
      },
      {
        siteId: site.id,
        plate: normalizePlate('BMK 7710'),
        transporterId: transporter.id,
        expectedDate: addDays(today, -1),
        sdoNos: ['5007'],
        note: 'Sample: late (was due yesterday)',
        createdBy: clerk.id,
      },
    ]);
  }

  const [watchCount] = await db
    .select({ n: count() })
    .from(watchlist)
    .where(eq(watchlist.siteId, site.id));
  if (watchCount?.n === 0) {
    await db.insert(watchlist).values({
      siteId: site.id,
      kind: 'plate',
      value: normalizePlate('BQL 1187'),
      reason: 'Sample entry for testing the red alert',
      addedBy: supervisor.id,
    });
  }
}

// Run from the command line: pnpm db:seed
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const demoPin = process.env.SEED_DEMO_PIN;
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!demoPin || !demoPassword) {
    throw new Error(
      'Set SEED_DEMO_PIN and SEED_DEMO_PASSWORD (see .env.example) to seed demo users',
    );
  }
  const database = connect(config.databaseUrl);
  try {
    await runMigrations(database.db);
    const adapters = createAdapters(adapterConfigFromEnv(process.env));
    await seed(database.db, adapters.sap, {
      siteCode: config.siteCode,
      demoPin,
      demoPassword,
      now: new Date(),
    });
    console.log('Seed done.');
  } finally {
    await database.close();
  }
}

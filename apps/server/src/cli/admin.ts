/**
 * Setting up a real site (no demo data): create the site, users and the RFID
 * card pool. Run on the server:
 *
 *   pnpm --filter @vms/server admin init-site --code APM --name "Alpine Pipe Manufacturing, Shah Alam"
 *   pnpm --filter @vms/server admin add-user --username guard.entry --name "Entry Guard" --role guard
 *   pnpm --filter @vms/server admin add-cards --file cards.txt
 *   pnpm --filter @vms/server admin list-users
 *
 * PINs and passwords are typed at a prompt (or given in VMS_NEW_SECRET for
 * scripted installs); they are never command-line arguments, so they do not
 * end up in shell history.
 */
import { adapterConfigFromEnv, createAdapters } from '@vms/adapters';
import { normalizeCardNo } from '@vms/domain';
import { and, asc, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { hashSecret } from '../auth/secret.js';
import { connect, runMigrations, type Db } from '../db/client.js';
import { cards, sites, users } from '../db/schema.js';
import { syncTransporters } from '../services/businessPartners.js';
import { getSite } from '../services/sites.js';

export const ROLES = ['guard', 'checker', 'clerk', 'supervisor', 'admin'] as const;
export type AdminRole = (typeof ROLES)[number];

/** Guards and checkers use a PIN (tap pad); office roles a password. */
export const usesPin = (role: AdminRole) => role === 'guard' || role === 'checker';

export function checkSecret(role: AdminRole, secret: string): string | null {
  if (usesPin(role)) return /^\d{4,8}$/.test(secret) ? null : 'PIN must be 4 to 8 digits';
  return secret.length >= 10 ? null : 'Password must be at least 10 characters';
}

export async function initSite(db: Db, code: string, name: string) {
  const [site] = await db.insert(sites).values({ code, name }).onConflictDoNothing().returning();
  return site ?? (await getSite(db, code));
}

export async function addUser(
  db: Db,
  siteId: string,
  u: { username: string; displayName: string; role: AdminRole; secret: string },
) {
  const problem = checkSecret(u.role, u.secret);
  if (problem) throw new Error(problem);
  const hash = await hashSecret(u.secret);
  await db
    .insert(users)
    .values({
      siteId,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      pinHash: usesPin(u.role) ? hash : null,
      passwordHash: usesPin(u.role) ? null : hash,
    })
    .onConflictDoUpdate({
      target: [users.siteId, users.username],
      set: {
        displayName: u.displayName,
        role: u.role,
        pinHash: usesPin(u.role) ? hash : null,
        passwordHash: usesPin(u.role) ? null : hash,
        active: true,
      },
    });
}

export async function setActive(db: Db, siteId: string, username: string, active: boolean) {
  const done = await db
    .update(users)
    .set({ active })
    .where(and(eq(users.siteId, siteId), eq(users.username, username)))
    .returning();
  if (done.length === 0) throw new Error(`no user ${username}`);
}

/** Add card numbers (one per line or space-separated); existing ones are left alone. */
export async function addCards(
  db: Db,
  siteId: string,
  raw: string,
): Promise<{ added: number; skipped: number }> {
  const numbers = [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map(normalizeCardNo)
        .filter((n) => n.length >= 4),
    ),
  ];
  if (numbers.length === 0) return { added: 0, skipped: 0 };
  const added = await db
    .insert(cards)
    .values(numbers.map((cardNo) => ({ siteId, cardNo })))
    .onConflictDoNothing()
    .returning();
  return { added: added.length, skipped: numbers.length - added.length };
}

async function prompt(question: string): Promise<string> {
  if (process.env.VMS_NEW_SECRET) return process.env.VMS_NEW_SECRET;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const USAGE = `Commands:
  init-site --code APM --name "Site name"
  add-user --username NAME --name "Display name" --role guard|checker|clerk|supervisor|admin
  set-secret --username NAME           (new PIN or password)
  deactivate-user --username NAME
  add-cards --file cards.txt | add-cards CARDNO CARDNO ...
  list-users`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      code: { type: 'string' },
      name: { type: 'string' },
      username: { type: 'string' },
      role: { type: 'string' },
      file: { type: 'string' },
    },
  });
  // Only the database settings: the admin tool needs no session key.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');
  const siteCode = process.env.SITE_CODE || 'APM';
  const database = connect(databaseUrl);
  const db = database.db;
  try {
    await runMigrations(db);
    if (command === 'init-site') {
      if (!values.code || !values.name) throw new Error(USAGE);
      const site = await initSite(db, values.code, values.name);
      const adapters = createAdapters(adapterConfigFromEnv(process.env));
      const n = await syncTransporters(db, adapters.sap, site.id).catch(() => 0);
      console.log(`Site ${site.code} ready. Transporters from SAP: ${n}.`);
      return;
    }
    const site = await getSite(db, siteCode);
    switch (command) {
      case 'add-user': {
        const role = values.role as AdminRole;
        if (!values.username || !values.name || !ROLES.includes(role)) throw new Error(USAGE);
        const secret = await prompt(
          usesPin(role) ? 'PIN (4-8 digits): ' : 'Password (10+ characters): ',
        );
        await addUser(db, site.id, {
          username: values.username,
          displayName: values.name,
          role,
          secret,
        });
        console.log(`User ${values.username} (${role}) saved.`);
        break;
      }
      case 'set-secret': {
        if (!values.username) throw new Error(USAGE);
        const [u] = await db
          .select()
          .from(users)
          .where(and(eq(users.siteId, site.id), eq(users.username, values.username)));
        if (!u) throw new Error(`no user ${values.username}`);
        const secret = await prompt(usesPin(u.role) ? 'New PIN: ' : 'New password: ');
        await addUser(db, site.id, {
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          secret,
        });
        console.log(`Secret for ${u.username} changed.`);
        break;
      }
      case 'deactivate-user': {
        if (!values.username) throw new Error(USAGE);
        await setActive(db, site.id, values.username, false);
        console.log(`User ${values.username} can no longer sign in.`);
        break;
      }
      case 'add-cards': {
        const raw = values.file ? await readFile(values.file, 'utf8') : positionals.join(' ');
        const r = await addCards(db, site.id, raw);
        console.log(`Cards added: ${r.added}, already there: ${r.skipped}.`);
        break;
      }
      case 'list-users': {
        const list = await db
          .select()
          .from(users)
          .where(eq(users.siteId, site.id))
          .orderBy(asc(users.username));
        for (const u of list)
          console.log(
            `${u.username}\t${u.role}\t${u.displayName}${u.active ? '' : '\t(inactive)'}`,
          );
        break;
      }
      default:
        throw new Error(USAGE);
    }
  } finally {
    await database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}

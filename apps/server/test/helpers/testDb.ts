import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { connect, runMigrations, type Database } from '../../src/db/client.js';

/** Server holding throwaway test databases. Override with TEST_DATABASE_URL. */
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export interface TestDatabase extends Database {
  url: string;
  drop(): Promise<void>;
}

/** Create a fresh, migrated database; drop() removes it. */
export async function createTestDb(): Promise<TestDatabase> {
  const name = `vms_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const database = connect(url.toString());
  await runMigrations(database.db);

  return {
    ...database,
    url: url.toString(),
    async drop() {
      await database.close();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

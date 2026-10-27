import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface AuditEntry {
  siteId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  at: Date;
}

export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    ...entry,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

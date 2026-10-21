import type { SapAdapter } from '@vms/adapters';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { transporters } from '../db/schema.js';

/** Copy SAP transporter business partners into `transporters` (insert or rename). */
export async function syncTransporters(db: Db, sap: SapAdapter, siteId: string): Promise<number> {
  const partners = (await sap.listBusinessPartners()).filter((p) => p.type === 'transporter');
  if (partners.length === 0) return 0;
  await db
    .insert(transporters)
    .values(partners.map((p) => ({ siteId, name: p.name, sapBpCode: p.code })))
    .onConflictDoUpdate({
      target: [transporters.siteId, transporters.sapBpCode],
      set: { name: sql`excluded.name` },
    });
  return partners.length;
}

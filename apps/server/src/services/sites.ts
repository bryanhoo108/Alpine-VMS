import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sites } from '../db/schema.js';

export type Site = typeof sites.$inferSelect;

export async function getSite(db: Db, code: string): Promise<Site> {
  const [site] = await db.select().from(sites).where(eq(sites.code, code));
  if (!site) throw new Error(`site ${code} not found; run the seed or check SITE_CODE`);
  return site;
}

/**
 * Full IC numbers are stored encrypted (decision Q2a): AES-256-GCM with a key
 * derived from IC_ENCRYPTION_KEY. Screens and the audit log only ever get the
 * last 4 digits. Without the key, only the last 4 digits are kept.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyOf = (secret: string) => createHash('sha256').update(`vms-ic:${secret}`).digest();

/** "v1.<iv>.<tag>.<data>", base64url parts. */
export function encryptIc(icNumber: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const data = Buffer.concat([cipher.update(icNumber, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptIc(stored: string, secret: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('unknown IC format');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

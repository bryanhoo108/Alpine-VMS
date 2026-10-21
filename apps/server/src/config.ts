export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  siteCode: string;
  filesDir: string;
  icPhotoRetentionDays: number;
  /** HMAC key for session cookies; at least 32 characters. */
  sessionSecret: string;
  /** Hours a sign-in lasts (a guard shift plus margin). */
  sessionHours: number;
  /** Built web app to serve (apps/web/dist); unset in development (Vite serves it). */
  webDir: string | null;
  /** If set, cameras must send it in the x-vms-token header. */
  lprWebhookToken: string | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`${name} must be a whole number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    host: env.HOST || '0.0.0.0',
    port: int(env, 'PORT', 8080),
    siteCode: env.SITE_CODE || 'APM',
    filesDir: env.FILES_DIR || './files',
    icPhotoRetentionDays: int(env, 'IC_PHOTO_RETENTION_DAYS', 90),
    sessionSecret,
    sessionHours: int(env, 'SESSION_HOURS', 14),
    webDir: env.WEB_DIR || null,
    lprWebhookToken: env.LPR_WEBHOOK_TOKEN || null,
  };
}

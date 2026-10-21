export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  siteCode: string;
  filesDir: string;
  icPhotoRetentionDays: number;
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
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    host: env.HOST || '0.0.0.0',
    port: int(env, 'PORT', 8080),
    siteCode: env.SITE_CODE || 'APM',
    filesDir: env.FILES_DIR || './files',
    icPhotoRetentionDays: int(env, 'IC_PHOTO_RETENTION_DAYS', 90),
  };
}

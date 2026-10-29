import { loadConfig } from '../../src/config.js';

export const testConfig = (databaseUrl: string, extra: NodeJS.ProcessEnv = {}) =>
  loadConfig({
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'test-session-secret-at-least-32-characters',
    FILES_DIR: `/tmp/claude-0/vms-test-files`,
    IC_ENCRYPTION_KEY: 'test-ic-encryption-key-at-least-32-chars',
    ...extra,
  });

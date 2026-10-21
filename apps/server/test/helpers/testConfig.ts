import { loadConfig } from '../../src/config.js';

export const testConfig = (databaseUrl: string, extra: NodeJS.ProcessEnv = {}) =>
  loadConfig({
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'test-session-secret-at-least-32-characters',
    FILES_DIR: `/tmp/claude-0/vms-test-files`,
    ...extra,
  });

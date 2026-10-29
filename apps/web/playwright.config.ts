import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The fake camera shows a fictional sample IC, so photos can be read like a real one. */
const FAKE_CAMERA = fileURLToPath(new URL('./e2e/fixtures/sample-ic.mjpeg', import.meta.url));

const PORT = 8090;

/**
 * Every guard and checker screen is checked at tablet size (landscape, the
 * real device) and phone size. CHROMIUM_PATH points at a preinstalled browser
 * when Playwright's own download is not available.
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
    permissions: ['camera'],
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${FAKE_CAMERA}`,
      ],
    },
  },
  projects: [
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, hasTouch: true },
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'pnpm --filter @vms/server exec tsx test/e2eServer.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

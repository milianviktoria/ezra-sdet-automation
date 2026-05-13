import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './src/utils/constants';

export default defineConfig({
  testDir: './src/tests',
  // workers: 1 enforces serial execution — shared staging cannot handle concurrent sessions.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  timeout: 90_000,
  expect: { timeout: 25_000 },

  globalTeardown: './setup/global.teardown.ts',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testDir: './setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      grep: /@smoke/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        headless: true,
        storageState: 'auth.json',
      },
    },
    {
      // Auth tests run without a pre-saved session — no dependency on setup project.
      name: 'auth',
      grep: /@auth/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        headless: true,
      },
    },
  ],
});

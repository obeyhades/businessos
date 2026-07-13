import { defineConfig } from '@playwright/test';

// Port 3000 is intentionally avoided; it may be occupied on dev machines.
const WEB_PORT = 3100;
const API_PORT = 3101;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @businessos/api dev',
      url: `${API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PORT: String(API_PORT),
        WEB_ORIGIN: WEB_URL,
        APP_BASE_URL: WEB_URL,
      },
    },
    {
      command: `pnpm --filter @businessos/web exec next dev -p ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: API_URL,
      },
    },
  ],
});

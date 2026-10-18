import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:8899'
  },
  webServer: process.env.HTMV_TEST_EXTERNAL_SERVER === '1' ? undefined : {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:8899',
    reuseExistingServer: true,
    timeout: 10000
  }
});

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Standalone installed-React fixture: no Next server, build or database.
export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e', import.meta.url)),
  testMatch: 'route-primary-initiation.spec.ts',
  outputDir: fileURLToPath(
    new URL('../../test-results/route-primary', import.meta.url),
  ),
  workers: 1,
  retries: 0,
  maxFailures: 1,
  globalTimeout: 120_000,
  forbidOnly: true,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'] },
});

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The same regression remains part of the ordinary E2E suite. This focused
// entry point needs only Chromium and the source stylesheet, never a backend.
export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e', import.meta.url)),
  testMatch: 'skip-link.spec.ts',
  outputDir: fileURLToPath(
    new URL('../../test-results/skip-link', import.meta.url),
  ),
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'] },
});

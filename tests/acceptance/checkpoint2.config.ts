import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import standard from '../../playwright.config';

// A fresh database is a precondition; retries cannot reuse a consumed empty state.
export default defineConfig({
  ...standard,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'fresh-empty.spec.ts',
  outputDir: 'test-results/checkpoint2-acceptance',
  retries: 0,
  use: { ...standard.use, trace: 'on' },
});

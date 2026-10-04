import { defineConfig, devices } from '@playwright/test';
import { e2eScheduling } from './scripts/e2e-scheduling';
const scheduling = e2eScheduling(process.env.E2E_FULL_SUITE === '1');
export default defineConfig({
  testDir: './tests/e2e',
  // Keep database-type drift artifacts outside Playwright's cleaned directory.
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  workers: scheduling.workers,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./scripts/e2e-performance-reporter.ts'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: scheduling.projects.map((project) => ({
    ...project,
    use: { ...devices['Desktop Chrome'] },
  })),
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1',
    url: 'http://localhost:3000/login',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

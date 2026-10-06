import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export function createVitestConfig(
  platform: NodeJS.Platform = process.platform,
  env: { CI?: string; VERCEL?: string } = {
    CI: process.env.CI,
    VERCEL: process.env.VERCEL,
  },
) {
  return defineConfig({
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      // Keep local Windows validation within a small host CPU/memory budget.
      ...(platform === 'win32' && !env.CI && !env.VERCEL
        ? { maxWorkers: 2 }
        : {}),
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx,mjs}'],
      clearMocks: true,
    },
  });
}
export default createVitestConfig();

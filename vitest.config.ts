import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    // Keep local Windows validation within a small host CPU/memory budget.
    ...(process.platform === 'win32' && !process.env.CI && !process.env.VERCEL
      ? { maxWorkers: 2 }
      : {}),
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx,mjs}'],
    clearMocks: true,
  },
});

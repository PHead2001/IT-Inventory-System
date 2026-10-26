import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
// Stable React 19.3 exports ViewTransition. jsdom lacks the browser snapshot
// API and layout, so this environment adapter preserves children only. It is
// not native snapshot evidence; production/browser gates are authoritative.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    ViewTransition: ({ children }: { children: import('react').ReactNode }) =>
      children,
  };
});
// jsdom has no layout observer; dnd-kit creates one at module initialization.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
afterEach(cleanup);

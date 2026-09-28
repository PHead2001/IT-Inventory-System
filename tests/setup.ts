import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
// jsdom has no layout observer; dnd-kit creates one at module initialization.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
afterEach(cleanup);

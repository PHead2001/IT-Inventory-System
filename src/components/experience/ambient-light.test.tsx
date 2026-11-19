import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AmbientLight } from './ambient-light';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('./motion-preference', () => ({
  useEffectiveReducedMotion: () => motion.reduced,
}));
afterEach(() => {
  motion.reduced = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('pauses the shared decorative host when hidden, offscreen or effectively reduced', () => {
  let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const view = render(<AmbientLight blueprint />);
  const host = view.container.querySelector('.experience-ambient')!;
  expect(host).toHaveAttribute('data-active', 'true');
  expect(host.querySelectorAll('.experience-blueprint')).toHaveLength(1);
  act(() => {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(host).toHaveAttribute('data-active', 'false');
  act(() => {
    visibility.mockReturnValue('visible');
    intersect([{ isIntersecting: false }]);
  });
  expect(host).toHaveAttribute('data-active', 'false');
  act(() => intersect([{ isIntersecting: true }]));
  expect(host).toHaveAttribute('data-active', 'true');
  motion.reduced = true;
  view.rerender(<AmbientLight blueprint />);
  expect(host).toHaveAttribute('data-active', 'false');
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

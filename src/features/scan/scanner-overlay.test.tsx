import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  invalidateAssignmentCallbacks,
} from './assign-batch';
import { ScannerOverlay, useDecodedLock } from './scanner-overlay';
import type { DecoderGeometry } from './decoder-geometry';
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => true,
}));
const video = createRef<HTMLVideoElement>();
it('admits every scanner animation only for a current full-motion owner, including synchronous withdrawal before React flags catch up', () => {
  // Authoritative selector admission proof only; jsdom does not run CSS animations.
  const style = document.createElement('style');
  style.textContent = readFileSync(
    'src/features/scan/scanner-overlay.module.css',
    'utf8',
  ).replace(/:global\(([^)]+)\)/g, '$1');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const laser = document.createElement('span');
  laser.className = 'laser';
  overlay.append(laser);
  document.head.append(style);
  document.body.append(overlay);
  const previousMotion = document.documentElement.dataset.motion;
  try {
    const rules = Array.from(style.sheet!.cssRules)
      .filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
      .filter((rule) =>
        /^(lock-flash|sweep)\b/.test(rule.style.getPropertyValue('animation')),
      );
    expect(rules).toHaveLength(2);
    const admitted = () =>
      rules.filter(
        (rule) =>
          overlay.matches(rule.selectorText) ||
          (overlay.contains(laser) && laser.matches(rule.selectorText)),
      );
    for (const state of ['locked', 'searching']) {
      if (state === 'searching') overlay.append(laser);
      else laser.remove();
      overlay.dataset.state = state;
      overlay.dataset.current = 'true';
      overlay.dataset.reduced = 'false';
      document.documentElement.dataset.motion = 'full';
      expect(admitted()).toHaveLength(1);
      overlay.dataset.current = 'false';
      expect(admitted()).toHaveLength(0);
      delete overlay.dataset.current;
      expect(admitted()).toHaveLength(0);
      overlay.dataset.current = 'true';
      // The root changes synchronously while React's local flag is still false.
      document.documentElement.dataset.motion = 'reduced';
      expect(admitted()).toHaveLength(0);
      delete document.documentElement.dataset.motion;
      expect(admitted()).toHaveLength(0);
      document.documentElement.dataset.motion = 'full';
      overlay.dataset.reduced = 'true';
      expect(admitted()).toHaveLength(0);
    }
  } finally {
    if (previousMotion === undefined)
      delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = previousMotion;
    overlay.remove();
    style.remove();
  }
});
const corners: DecoderGeometry = {
  width: 400,
  height: 200,
  corners: true,
  points: [
    { x: 100, y: 50 },
    { x: 300, y: 50 },
    { x: 300, y: 150 },
    { x: 100, y: 150 },
  ],
};
function managed(
  state: 'searching' | 'locked' | 'inspecting',
  geometry?: DecoderGeometry,
) {
  return (
    <PrivacyReadinessContext.Provider
      value={{
        ready: true,
        generation: 'verified',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      <video ref={video} />
      <ScannerOverlay video={video} state={state} geometry={geometry} />
    </PrivacyReadinessContext.Provider>
  );
}
it('shows recognizable fixed framing and static search/lock/inspection states with actual corner projection', () => {
  vi.spyOn(HTMLVideoElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { width: 200, height: 200 } as DOMRect,
  );
  const view = render(managed('searching'));
  expect(screen.getByRole('status')).toHaveTextContent('Searching');
  expect(view.container.querySelector('path')).toHaveAttribute(
    'd',
    expect.stringContaining('M22 35'),
  );
  view.rerender(managed('locked', corners));
  expect(screen.getByRole('status')).toHaveTextContent('Label decoded');
  expect(view.container.querySelector('polygon')).toHaveAttribute(
    'points',
    '25,37.5 75,37.5 75,62.5 25,62.5',
  );
  expect(view.container.querySelector('path')?.getAttribute('d')).toContain(
    'V37.5',
  );
  expect(view.container.querySelector('[data-state]')).toHaveAttribute(
    'data-reduced',
    'true',
  );
  view.rerender(managed('inspecting'));
  expect(screen.getByRole('status')).toHaveTextContent('Inspecting equipment');
  vi.restoreAllMocks();
});
it('keeps ZXing finder landmarks open and never invents a full QR outline', () => {
  vi.spyOn(HTMLVideoElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { width: 200, height: 200 } as DOMRect,
  );
  const view = render(
    managed('locked', {
      ...corners,
      corners: false,
      points: corners.points.slice(0, 3),
    }),
  );
  expect(view.container.querySelector('polygon')).toBeNull();
  expect(view.container.querySelectorAll('circle')).toHaveLength(3);
  expect(view.container.querySelector('path')?.getAttribute('d')).toContain(
    'M22 35',
  );
  view.rerender(
    managed('locked', {
      ...corners,
      corners: false,
      points: corners.points.slice(0, 2),
    }),
  );
  expect(view.container.querySelector('line')).not.toBeNull();
  act(() => invalidateAssignmentCallbacks());
  expect(view.container.querySelector('[data-current]')).toHaveAttribute(
    'data-current',
    'false',
  );
  expect(screen.queryByRole('status')).toBeNull();
  vi.restoreAllMocks();
});
it('retires the short decorative lock without delaying application state or retaining a timer on unmount', () => {
  vi.useFakeTimers();
  let lock!: ReturnType<typeof useDecodedLock>;
  function Probe() {
    lock = useDecodedLock();
    return <span>{lock.locked ? 'locked' : 'inspect'}</span>;
  }
  const view = render(<Probe />);
  act(() => lock.begin());
  expect(screen.getByText('locked')).toBeVisible();
  act(() => vi.advanceTimersByTime(130));
  expect(screen.getByText('inspect')).toBeVisible();
  act(() => lock.begin());
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it.each(['root', 'os'])(
  'does not schedule a decorative lock during a synchronous %s Reduced gap or from a retired callback',
  (mode) => {
    vi.useFakeTimers();
    let os = false;
    vi.stubGlobal('matchMedia', () => ({
      matches: os,
      addEventListener() {},
      removeEventListener() {},
    }));
    document.documentElement.dataset.motion = 'full';
    let lock!: ReturnType<typeof useDecodedLock>;
    function Probe() {
      lock = useDecodedLock();
      return <span>{lock.locked ? 'locked' : 'inspect'}</span>;
    }
    const view = render(<Probe />);
    if (mode === 'root') document.documentElement.dataset.motion = 'reduced';
    else os = true;
    act(() => lock.begin());
    expect(screen.getByText('inspect')).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    act(() => lock.begin());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  },
);

it('cancels an in-flight decorative lock when hidden and never resumes it on return', () => {
  vi.useFakeTimers();
  document.documentElement.dataset.motion = 'full';
  let lock!: ReturnType<typeof useDecodedLock>;
  function Probe() {
    lock = useDecodedLock();
    return <span>{lock.locked ? 'locked' : 'inspect'}</span>;
  }
  const view = render(<Probe />);
  try {
    act(() => lock.begin());
    expect(screen.getByText('locked')).toBeVisible();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByText('inspect')).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByText('inspect')).toBeVisible();
  } finally {
    view.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

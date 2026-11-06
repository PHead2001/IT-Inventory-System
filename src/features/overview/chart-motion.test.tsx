import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { RouteMotionProvider } from '@/components/experience/route-motion';
import { ThemePreferenceProvider } from '@/components/experience/theme-preference';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { ChartGraphic } from './chart-motion';

const effects = vi.hoisted(() => ({
  animate: vi.fn(),
  stops: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('motion/mini', () => ({ animate: effects.animate }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));

let frames: Map<number, FrameRequestCallback>,
  serial = 0;
function tree(identity = 'snapshot-one', ready = true) {
  return (
    <PrivacyReadinessContext.Provider
      value={{
        ready,
        visible: ready,
        generation: 'chart-test',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <ThemePreferenceProvider scope="overview:chart-test">
        <RouteMotionProvider actorId="test-actor">
          <ProtectedPrivacyContent>
            <ChartGraphic identity={identity}>
              <svg aria-hidden="true">
                <path
                  data-testid="line"
                  data-chart-mark="line"
                  pathLength="1"
                  d="M8,72 L292,8"
                  style={{
                    strokeDasharray: '3 2',
                    strokeDashoffset: '0.25',
                    transform: 'translateX(2px)',
                  }}
                />
                <rect
                  data-testid="bar"
                  data-chart-mark="bar"
                  x="3"
                  y="8"
                  width="15"
                  height="68"
                  style={{
                    transform: 'translateX(3px)',
                    transformOrigin: '10% 20%',
                    transformBox: 'view-box',
                  }}
                />
                <circle cx="8" cy="72" r="2.5" />
              </svg>
            </ChartGraphic>
            <table>
              <caption>Exact daily values</caption>
              <tbody>
                <tr>
                  <td>9007199254740993</td>
                  <td>Not available</td>
                </tr>
              </tbody>
            </table>
          </ProtectedPrivacyContent>
        </RouteMotionProvider>
      </ThemePreferenceProvider>
    </PrivacyReadinessContext.Provider>
  );
}
function paint(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(time)));
}
function expectStatic() {
  expect(screen.getByTestId('line')).toHaveStyle({
    strokeDasharray: '3 2',
    strokeDashoffset: '0.25',
    transform: 'translateX(2px)',
  });
  expect(screen.getByTestId('bar')).toHaveStyle({
    transform: 'translateX(3px)',
    transformOrigin: '10% 20%',
    transformBox: 'view-box',
  });
  expect(screen.getByRole('table')).toHaveTextContent(
    '9007199254740993Not available',
  );
}
beforeEach(() => {
  frames = new Map();
  serial = 0;
  effects.stops = [];
  effects.animate.mockReset().mockImplementation(() => {
    const cancel = vi.fn();
    effects.stops.push(cancel);
    return { cancel };
  });
  sessionStorage.clear();
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('CSS', { supports: () => false });
  Object.defineProperty(SVGElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
  document.documentElement.dataset.motion = 'full';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (SVGElement.prototype as Partial<SVGElement>).animate;
  delete document.documentElement.dataset.motion;
});

it('reveals only real decorative marks for 500ms and preserves exact values, gaps and SVG coordinates', async () => {
  render(tree());
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(2));
  expect(effects.animate.mock.calls[0]![1]).toEqual({
    strokeDashoffset: [1, 0],
  });
  expect(effects.animate.mock.calls[1]![1]).toEqual({
    transform: ['scaleY(0)', 'scaleY(1)'],
  });
  expect(effects.animate.mock.calls[0]![2]).toMatchObject({ duration: 0.5 });
  expect(effects.animate.mock.calls[0]![0]).toBe(screen.getByTestId('line'));
  expect(effects.animate.mock.calls[1]![0]).toBe(screen.getByTestId('bar'));
  expect(screen.getByTestId('line').isConnected).toBe(true);
  expect(screen.getByTestId('line')).toHaveAttribute('d', 'M8,72 L292,8');
  expect(screen.getByTestId('bar')).toHaveAttribute('height', '68');
  expect(screen.getByRole('table')).toHaveTextContent(
    '9007199254740993Not available',
  );
  paint(500);
  expectStatic();
  effects.stops.forEach((cancel) => expect(cancel).toHaveBeenCalledOnce());
});

it('keeps initial Reduced, its unchanged Full readmission and unchanged refresh identity static', async () => {
  document.documentElement.dataset.motion = 'reduced';
  const view = render(tree());
  expectStatic();
  expect(effects.animate).not.toHaveBeenCalled();
  await act(async () => {
    document.documentElement.dataset.motion = 'full';
  });
  view.rerender(tree());
  expect(effects.animate).not.toHaveBeenCalled();
  expectStatic();
  view.rerender(tree('snapshot-two'));
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(2));
  paint(500);
  view.rerender(tree('snapshot-two'));
  expect(effects.animate).toHaveBeenCalledTimes(2);
  expectStatic();
});

it('restores complete static geometry if the native SVG animation is unsupported', async () => {
  effects.animate.mockImplementation(() => {
    throw new Error('Unsupported SVG effect');
  });
  render(tree());
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(2));
  expectStatic();
});

it('seeds changed data during Reduced and animates only a later new Full snapshot', async () => {
  document.documentElement.dataset.motion = 'reduced';
  const view = render(tree());
  view.rerender(tree('snapshot-two'));
  expect(effects.animate).not.toHaveBeenCalled();
  expectStatic();
  await act(async () => {
    document.documentElement.dataset.motion = 'full';
  });
  view.rerender(tree('snapshot-two'));
  expect(effects.animate).not.toHaveBeenCalled();
  expectStatic();
  view.rerender(tree('snapshot-three'));
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(2));
  paint(500);
  expectStatic();
});

it('retains the real admission reseed fence through Full withdrawal, unchanged re-verification and later new chart content', async () => {
  const view = render(tree());
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(2));
  const line = screen.getByTestId('line');
  const released = [...frames.values()];
  const stops = [...effects.stops];
  view.rerender(tree('snapshot-one', false));
  stops.forEach((cancel) => expect(cancel).toHaveBeenCalledOnce());
  expect(line.style.strokeDasharray).toBe('3 2');
  expect(line.style.strokeDashoffset).toBe('0.25');
  view.rerender(tree());
  await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
  expect(screen.getByTestId('line')).toBe(line);
  expect(effects.animate).toHaveBeenCalledTimes(2);
  expectStatic();
  act(() => released.forEach((callback) => callback(100)));
  expectStatic();
  view.rerender(tree('snapshot-two'));
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(4));
  paint(500);
  expectStatic();
});

it('seeds a first mounted hidden chart and reveals only later visible content', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('hidden');
  const view = render(tree());
  const line = screen.getByTestId('line');
  expect(line.isConnected).toBe(true);
  expectStatic();
  expect(effects.animate).not.toHaveBeenCalled();
  await act(async () => {
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  view.rerender(tree());
  expect(screen.getByTestId('line')).toBe(line);
  expect(effects.animate).not.toHaveBeenCalled();
  expectStatic();
  view.rerender(tree('snapshot-two'));
  await waitFor(() => expect(effects.animate).toHaveBeenCalledTimes(2));
  paint(500);
  expectStatic();
});

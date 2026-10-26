import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRef, useLayoutEffect, type ReactNode } from 'react';
import { RecordTitle } from './record-transition';
import { TransitionCaptureBoundary } from '@/components/forms/transition-capture-boundary';
import { holdTransitionCapture } from '../../../tests/helpers/transition-capture';
import { RouteContentIdentityContext } from './route-content-identity';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';

const motion = vi.hoisted(() => ({
  enabled: true,
  current: (): boolean => true,
  validNow: (): boolean => true,
  intent: {
    kind: 'quantity',
    id: 'cable',
    name: 'inventory-title-test',
    detailPath: '/inventory/quantity/cable',
    listHref: '/inventory',
  },
  titleArrival: {
    sourceKey: '/inventory',
    destinationKey: '/inventory/quantity/cable',
    epoch: 1,
  } as { sourceKey: string; destinationKey: string; epoch: number } | null,
}));
vi.mock('./route-motion', () => ({ useRouteMotion: () => motion }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  ViewTransition: ({ children }: { children: ReactNode }) => children,
}));

let top = -364;
let measuredTop: number | undefined;
const scroll = vi.fn((options: ScrollToOptions) => {
  top -= options.top ?? 0;
});
function CaptureAfterLayout({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    measuredTop = screen
      .getByRole('heading', { hidden: true })
      .getBoundingClientRect().top;
  });
  return children;
}
function content(ready = true, route = '/inventory/quantity/cable') {
  return (
    <PrivacyReadinessContext
      value={{
        ready,
        visible: true,
        generation: 'verified',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RouteContentIdentityContext
        value={{
          pathname: route.split('?')[0],
          listHref: route,
          rawRouteKey: route,
        }}
      >
        <CaptureAfterLayout>
          <RecordTitle record={{ kind: 'quantity', id: 'cable' }}>
            Cable
          </RecordTitle>
        </CaptureAfterLayout>
      </RouteContentIdentityContext>
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  top = -364;
  measuredTop = undefined;
  scroll.mockClear();
  motion.enabled = true;
  motion.current = () => true;
  motion.validNow = () => true;
  motion.titleArrival = {
    sourceKey: '/inventory',
    destinationKey: '/inventory/quantity/cable',
    epoch: 1,
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({
      top,
      bottom: top + 104,
      left: 0,
      right: 200,
      width: 200,
      height: 104,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  );
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
    length: 1,
  } as DOMRectList);
  vi.stubGlobal('innerHeight', 480);
  vi.stubGlobal('scrollBy', scroll);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reveals the authorized incoming forward H1 in layout before capture without focusing it', () => {
  const view = render(content());
  expect(scroll).toHaveBeenCalledWith({ top: -364, behavior: 'instant' });
  expect(measuredTop).toBe(0);
  expect(document.activeElement).not.toBe(screen.getByRole('heading'));
  top = -364;
  view.rerender(content());
  expect(scroll).toHaveBeenCalledTimes(1);
});
it('leaves an already visible heading and ordinary scrolling untouched', () => {
  top = 20;
  render(content());
  expect(scroll).not.toHaveBeenCalled();
});
it('reveals the incoming title while its exact capture boundary stays inert', async () => {
  const capture = holdTransitionCapture(false);
  const page = render(
    <TransitionCaptureBoundary>
      <p>Source</p>
    </TransitionCaptureBoundary>,
  );
  capture.begin();
  // jsdom's inert property does not reflect the attribute like the browser's.
  screen.getByText('Source').closest('fieldset')!.setAttribute('inert', '');
  try {
    page.rerender(
      <TransitionCaptureBoundary>{content()}</TransitionCaptureBoundary>,
    );
    expect(screen.getByRole('heading').closest('fieldset')!.inert).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ top: -364, behavior: 'instant' });
    expect(measuredTop).toBe(0);
  } finally {
    page.unmount();
    await act(capture.release);
    capture.dispose();
  }
});
it.each(['inert parent', 'hidden parent', 'previously inert capture boundary'])(
  'does not reveal through %s during capture',
  async (mode) => {
    const capture = holdTransitionCapture(false);
    const page = render(
      <div>
        <TransitionCaptureBoundary>
          <p>Source</p>
        </TransitionCaptureBoundary>
      </div>,
    );
    const parent = screen
      .getByText('Source')
      .closest('fieldset')!.parentElement!;
    const fieldset = screen.getByText('Source').closest('fieldset')!;
    if (mode === 'inert parent') parent.inert = true;
    if (mode === 'hidden parent') parent.hidden = true;
    if (mode === 'previously inert capture boundary') fieldset.inert = true;
    capture.begin();
    try {
      page.rerender(
        <div>
          <TransitionCaptureBoundary>{content()}</TransitionCaptureBoundary>
        </div>,
      );
      expect(scroll).not.toHaveBeenCalled();
      await act(capture.release);
      if (mode === 'previously inert capture boundary')
        expect(fieldset.inert).toBe(true);
    } finally {
      page.unmount();
      await act(capture.release);
      capture.dispose();
    }
  },
);
it('preserves the caller heading ref used for multiline measurement', () => {
  const ref = createRef<HTMLHeadingElement>();
  render(
    <RecordTitle ref={ref} record={{ kind: 'quantity', id: 'cable' }}>
      Cable
    </RecordTitle>,
  );
  expect(ref.current).toBe(screen.getByRole('heading'));
  expect(scroll).not.toHaveBeenCalled();
});
it('reveals the heading below an actually fixed header and respects scroll margin', () => {
  const header = document.createElement('header');
  header.className = 'experience-header';
  header.style.position = 'fixed';
  header.getBoundingClientRect = () => ({ top: 0, bottom: 72 }) as DOMRect;
  document.body.append(header);
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
    const style = original(node);
    if (node.tagName === 'H1')
      Object.defineProperty(style, 'scrollMarginTop', { value: '12px' });
    return style;
  });
  render(content());
  expect(measuredTop).toBe(84);
  header.remove();
});
it.each([
  'unready',
  'native',
  'reverse',
  'reduced',
  'stale',
  'invalid',
  'wrong-query',
])('does not scroll for %s', (mode) => {
  if (mode === 'native') motion.titleArrival = null;
  if (mode === 'reverse')
    motion.titleArrival = {
      sourceKey: '/inventory/quantity/cable',
      destinationKey: '/inventory',
      epoch: 1,
    };
  if (mode === 'reduced') motion.enabled = false;
  if (mode === 'stale') motion.current = () => false;
  if (mode === 'invalid') motion.validNow = () => false;
  render(
    content(
      mode !== 'unready',
      mode === 'wrong-query' ? '/inventory/quantity/cable?other=1' : undefined,
    ),
  );
  expect(scroll).not.toHaveBeenCalled();
});

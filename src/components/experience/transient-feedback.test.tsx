import { RouteMotionProvider } from './route-motion';
import { MotionPreference } from './motion-preference';
import { StrictMode, useRef, useLayoutEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import {
  TransientFeedbackProvider,
  useTransientFeedbackOwner,
} from './transient-feedback';
import type { FeedbackTicket } from './transient-feedback-state';

vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory',
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
vi.mock('motion', () => ({ animate: vi.fn(() => ({ cancel: vi.fn() })) }));
let visibility = 'visible';
let owner: ReturnType<typeof useTransientFeedbackOwner>;
let ticket: FeedbackTicket | null;
const privacy = (generation = 'verified', ready = true) => ({
  ready,
  visible: ready,
  generation,
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function Consumer() {
  const host = useRef<HTMLButtonElement>(null);
  const feedback = useTransientFeedbackOwner(host);
  useLayoutEffect(() => {
    owner = feedback;
  });
  const operation = useRef(0);
  return (
    <button
      ref={host}
      onClick={() => {
        const retry = String(++operation.current);
        const captured = owner.begin(retry);
        owner.confirm(captured, retry, {
          kind: 'details-saved',
          eventId: retry,
        });
      }}
    >
      Save
    </button>
  );
}
function App({
  generation = 'verified',
  ready = true,
  actor = 'A',
  consumer = true,
  disclosed,
}: {
  generation?: string;
  ready?: boolean;
  actor?: string;
  consumer?: boolean;
  disclosed?: boolean;
}) {
  return (
    <PrivacyReadinessContext value={privacy(generation, ready)}>
      <MotionPreference>
        <RouteMotionProvider actorId="actor">
          <TransientFeedbackProvider
            actorId={actor}
            backend="https://backend.example"
          >
            <div>
              {disclosed === undefined ? (
                consumer && <Consumer />
              ) : (
                <details open={disclosed}>
                  <summary>Operation</summary>
                  {consumer && <Consumer />}
                </details>
              )}
            </div>
          </TransientFeedbackProvider>
        </RouteMotionProvider>
      </MotionPreference>
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 120, 32),
  ] as unknown as DOMRectList);
  visibility = 'visible';
  document.documentElement.dataset.motion = 'reduced';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('admits a static Reduced confirmation with a polite status and no autofocus', () => {
  render(<App />);
  const save = screen.getByRole('button', { name: 'Save' });
  save.focus();
  fireEvent.click(save);
  expect(screen.getByRole('status')).toHaveTextContent('Details saved.');
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect(document.activeElement).toBe(save);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole('status')).toBeNull();
});
it('pauses remaining visible time independently for hover and focus', () => {
  render(<App />);
  fireEvent.click(screen.getByText('Save'));
  act(() => vi.advanceTimersByTime(2000));
  const dismiss = screen.getByRole('button', { name: 'Dismiss' });
  const card = dismiss.parentElement!;
  fireEvent.pointerEnter(card);
  act(() => {
    dismiss.focus();
    vi.advanceTimersByTime(7000);
  });
  fireEvent.pointerLeave(card);
  act(() => vi.advanceTimersByTime(7000));
  expect(screen.getByRole('status')).toBeVisible();
  act(() => screen.getByText('Save').focus());
  act(() => vi.advanceTimersByTime(2999));
  expect(screen.getByRole('status')).toBeVisible();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole('status')).toBeNull();
});
it('limits visible confirmations to three and consumes the dropped operation', () => {
  render(<App />);
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Save'));
  expect(screen.getAllByRole('status')).toHaveLength(3);
  fireEvent.click(screen.getAllByText('Dismiss')[0]);
  expect(screen.getAllByRole('status')).toHaveLength(2);
});
it('handles Escape only inside a focused toast and returns working focus', () => {
  render(<App />);
  const save = screen.getByText('Save');
  save.focus();
  fireEvent.click(save);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('status')).toBeVisible();
  const dismiss = screen.getByText('Dismiss');
  dismiss.focus();
  fireEvent.keyDown(dismiss, { key: 'Escape' });
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.activeElement).toBe(save);
});
it.each(['unmanaged', 'denied'] as const)('has no %s fallback', (kind) => {
  render(
    <App
      generation={kind === 'unmanaged' ? 'unmanaged' : 'managed'}
      ready={kind !== 'denied'}
    />,
  );
  fireEvent.click(screen.getByText('Save'));
  expect(screen.queryByRole('status')).toBeNull();
});
it.each(['revocation', 'epoch', 'document'] as const)(
  'synchronously hides, clears and retires on %s withdrawal',
  (kind) => {
    const view = render(<App />);
    fireEvent.click(screen.getByText('Save'));
    ticket = owner.begin('late');
    act(() => {
      if (kind === 'revocation') revokePrivatePresentation();
      if (kind === 'epoch') invalidateAssignmentCallbacks();
      if (kind === 'document') {
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      }
      const viewport = view.container.querySelector(
        '[data-transient-feedback]',
      )!;
      expect(viewport).toHaveAttribute('hidden');
      expect(viewport).toHaveAttribute('inert');
      expect(viewport.textContent).not.toContain('Details saved.');
    });
    visibility = 'visible';
    view.rerender(<App key="fresh" generation="fresh" />);
    act(() =>
      owner.confirm(ticket, 'late', { kind: 'details-saved', eventId: 'late' }),
    );
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByRole('status')).toBeVisible();
  },
);
it('rejects actor A-B-A tickets and owner disposal/remount tickets', () => {
  const view = render(<App />);
  ticket = owner.begin('late');
  view.rerender(<App actor="B" />);
  view.rerender(<App actor="A" />);
  act(() =>
    owner.confirm(ticket, 'late', { kind: 'details-saved', eventId: 'late' }),
  );
  expect(screen.queryByRole('status')).toBeNull();
  ticket = owner.begin('late');
  view.rerender(<App consumer={false} />);
  view.rerender(<App />);
  act(() =>
    owner.confirm(ticket, 'late', { kind: 'details-saved', eventId: 'late' }),
  );
  expect(screen.queryByRole('status')).toBeNull();
});
it('StrictMode and provider remount never replay a completed operation', () => {
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  fireEvent.click(screen.getByText('Save'));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  ticket = owner.begin('late');
  const old = owner;
  view.unmount();
  render(<App />);
  act(() =>
    old.confirm(ticket, 'late', { kind: 'details-saved', eventId: 'late' }),
  );
  expect(screen.queryByRole('status')).toBeNull();
});
it('retains only an inert silent Full exit and removes it at the original 250 ms deadline', () => {
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
  const view = render(<App />);
  fireEvent.click(screen.getByText('Save'));
  const card = view.container.querySelector('[data-spring-presence="toast"]')!;
  fireEvent.click(screen.getByText('Dismiss'));
  expect(card).toHaveAttribute('inert');
  expect(card).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('status')).toBeNull();
  // One bounded exit deadline plus its admission-check RAF; no lifetime timer.
  expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  act(() => vi.advanceTimersByTime(249));
  expect(card.isConnected).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(card.isConnected).toBe(false);
  Reflect.deleteProperty(Element.prototype, 'animate');
});
it('withdraws a collapsed native operation owner and never revives its tickets or confirmations', async () => {
  const view = render(<App disclosed />);
  fireEvent.click(screen.getByText('Save'));
  ticket = owner.begin('late');
  const details = view.container.querySelector('details')!;
  await act(async () => {
    details.open = false;
    await Promise.resolve();
  });
  expect(screen.queryByRole('status')).toBeNull();
  // jsdom schedules the native details toggle separately from application timers.
  act(() => vi.advanceTimersByTime(0));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => {
    details.open = true;
    await Promise.resolve();
  });
  act(() =>
    owner.confirm(ticket, 'late', { kind: 'details-saved', eventId: 'late' }),
  );
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByText('Save'));
  expect(screen.getByRole('status')).toBeVisible();
});

it('falls back to main content when a connected enabled return target refuses focus', () => {
  render(
    <>
      <main id="main-content" tabIndex={-1} />
      <App />
    </>,
  );
  const save = screen.getByRole('button', { name: 'Save' });
  save.focus();
  fireEvent.click(save);
  const focus = vi.spyOn(save, 'focus').mockImplementation(() => {});
  const dismiss = screen.getByRole('button', { name: 'Dismiss' });
  dismiss.focus();
  fireEvent.keyDown(dismiss, { key: 'Escape' });
  expect(focus).toHaveBeenCalledOnce();
  expect(document.getElementById('main-content')).toHaveFocus();
  expect(screen.queryByRole('status')).toBeNull();
});

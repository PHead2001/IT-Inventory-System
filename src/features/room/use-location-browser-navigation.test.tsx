import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoutePendingContext } from '@/components/experience/route-pending';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { useLocationBrowserNavigation } from './use-location-browser-navigation';
import { emptyLocationBrowserState } from './location-browser-state';

const runtime = vi.hoisted(() => ({
  replace: vi.fn(),
  observe: null as ((href: string) => void) | null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: runtime.replace }),
}));
vi.mock('@/components/experience/route-pending', async () => {
  const { createContext } = await import('react');
  return {
    RoutePendingContext: createContext(null),
    useRouteTransition: () => [false, (callback: () => void) => callback()],
  };
});
const locations = [
  {
    id: 'shelf',
    code: 'ITC-S1A',
    name: 'Shelf',
    breadcrumb: 'Closet / Shelf',
    parentId: null,
    active: true,
    can_hold_inventory: true,
  },
];
const snapshot = { epoch: 0, pending: false };
const scope = {
  state: {
    subscribe: () => () => {},
    snapshot: () => snapshot,
    current: () => true,
  },
  observeNavigation: (callback: (href: string) => void) => {
    runtime.observe = callback;
    return () => {
      runtime.observe = null;
    };
  },
};
const initial = emptyLocationBrowserState();
function Browser() {
  const { draft, change } = useLocationBrowserNavigation(
    initial,
    locations,
    '/locations',
  );
  return (
    <>
      <input
        aria-label="Location search"
        value={draft.query}
        onChange={(event) => change({ query: event.target.value }, true)}
      />
      <button onClick={() => change({ selectedCode: 'ITC-S1A' })}>
        Select shelf
      </button>
    </>
  );
}
function fixture(ready = true) {
  return (
    <PrivacyReadinessContext
      value={{
        ready,
        visible: ready,
        generation: 'verified',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RoutePendingContext value={scope as never}>
        <Browser />
      </RoutePendingContext>
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  runtime.replace.mockClear();
  history.replaceState(null, '', '/locations');
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: new EventTarget(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'navigation');
});

it.each(['canceled traverse', 'hash-only Back'])(
  '%s cancels old debounce and preserves fresh search/select with unchanged raw key and mounted controls',
  (kind) => {
    render(fixture());
    const input = screen.getByRole('textbox', { name: 'Location search' });
    fireEvent.change(input, { target: { value: 'old pending search' } });
    act(() => {
      if (kind === 'canceled traverse') {
        const event = new Event('navigate', { cancelable: true });
        Object.defineProperty(event, 'navigationType', { value: 'traverse' });
        window.navigation!.dispatchEvent(event);
        event.preventDefault();
      } else {
        history.replaceState(null, '', '/locations#restored-row');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      vi.advanceTimersByTime(1000);
    });
    expect(runtime.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Location search' })).toBe(
      input,
    );
    fireEvent.change(input, { target: { value: 'fresh' } });
    act(() => vi.advanceTimersByTime(300));
    expect(runtime.replace).toHaveBeenLastCalledWith('/locations?q=fresh', {
      scroll: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select shelf' }));
    expect(runtime.replace).toHaveBeenLastCalledWith(
      '/locations?q=fresh&selected=ITC-S1A',
      { scroll: false },
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(runtime.replace).toHaveBeenCalledTimes(2);
  },
);

it.each(['accepted cross-path navigation', 'privacy withdrawal'])(
  '%s stays withdrawn despite a later native cancellation event',
  (kind) => {
    const page = render(fixture());
    if (kind === 'privacy withdrawal') page.rerender(fixture(false));
    else act(() => runtime.observe!('/history'));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'stale' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select shelf' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(runtime.replace).not.toHaveBeenCalled();
  },
);

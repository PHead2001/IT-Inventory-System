import { act, fireEvent, render, screen } from '@testing-library/react';
import { Activity } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoutePendingContext } from '@/components/experience/route-pending';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import { useLocationBrowserNavigation } from './use-location-browser-navigation';
import { emptyLocationBrowserState } from './location-browser-state';
import type { LocationBrowserState } from './location-browser-state';

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
function Browser({
  state = initial,
  rawKey = '/locations',
}: {
  state?: LocationBrowserState;
  rawKey?: string;
}) {
  const { draft, change, leave } = useLocationBrowserNavigation(
    state,
    locations,
    rawKey,
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
      <button onClick={leave}>Leave browser</button>
    </>
  );
}
function fixture(
  ready = true,
  options: {
    visible?: boolean;
    generation?: string;
    revocationRevision?: number;
    verifiedEpoch?: number;
    state?: LocationBrowserState;
    rawKey?: string;
    owner?: typeof scope;
  } = {},
) {
  return (
    <PrivacyReadinessContext
      value={{
        ready,
        visible: options.visible ?? ready,
        generation: options.generation ?? 'verified',
        revocationRevision:
          options.revocationRevision ?? readPrivacyRevocationRevision(),
        verifiedEpoch: options.verifiedEpoch ?? assignmentEpoch(),
      }}
    >
      <RoutePendingContext value={(options.owner ?? scope) as never}>
        <Browser state={options.state} rawKey={options.rawKey} />
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

it('retains rapid local edits during an original visible recheck, ignores older replies, and resumes only the coalesced unsent draft', () => {
  const page = render(fixture());
  fireEvent.click(screen.getByRole('button', { name: 'Select shelf' }));
  page.rerender(fixture(false, { visible: true }));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'She' } });
  act(() => vi.advanceTimersByTime(100));
  fireEvent.change(input, { target: { value: 'Shelf latest' } });
  act(() => vi.advanceTimersByTime(300));
  page.rerender(
    fixture(false, {
      visible: true,
      state: { ...initial, selectedCode: 'ITC-S1A' },
      rawKey: '/locations?selected=ITC-S1A',
    }),
  );
  expect(input).toHaveValue('Shelf latest');
  expect(runtime.replace).toHaveBeenCalledTimes(1);
  page.rerender(fixture());
  expect(runtime.replace).toHaveBeenLastCalledWith(
    '/locations?q=Shelf+latest&selected=ITC-S1A',
    { scroll: false },
  );
  expect(runtime.replace).toHaveBeenCalledTimes(2);
  page.rerender(
    fixture(true, {
      state: { ...initial, selectedCode: 'ITC-S1A' },
      rawKey: '/locations?selected=ITC-S1A',
    }),
  );
  expect(input).toHaveValue('Shelf latest');
  act(() => vi.advanceTimersByTime(1000));
  expect(runtime.replace).toHaveBeenCalledTimes(2);
});

it('never grants visible-only controls that have no previously fresh admission', () => {
  const page = render(fixture(false, { visible: true }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'unverified' },
  });
  expect(screen.getByRole('textbox')).toHaveValue('');
  page.rerender(fixture());
  act(() => vi.advanceTimersByTime(1000));
  expect(runtime.replace).not.toHaveBeenCalled();
});

it.each([
  'withdrawal',
  'revision',
  'epoch',
  'generation',
  'provider',
  'cross-path',
  'unmount',
])(
  '%s cancels retained unsent work without replaying it on a later fresh render',
  (kind) => {
    const page = render(fixture());
    page.rerender(fixture(false, { visible: true }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'queued' },
    });
    expect(screen.getByRole('textbox')).toHaveValue('queued');
    if (kind === 'cross-path') act(() => runtime.observe!('/history'));
    else if (kind === 'unmount') page.unmount();
    else if (kind === 'epoch') {
      act(() => invalidateAssignmentCallbacks());
      page.rerender(fixture(false, { visible: true }));
    } else
      page.rerender(
        fixture(false, {
          visible: kind !== 'withdrawal',
          ...(kind === 'revision'
            ? { revocationRevision: readPrivacyRevocationRevision() + 1 }
            : {}),
          ...(kind === 'generation' ? { generation: 'replacement' } : {}),
          ...(kind === 'provider' ? { owner: { ...scope } } : {}),
        }),
      );
    if (kind !== 'unmount') page.rerender(fixture());
    act(() => vi.advanceTimersByTime(1000));
    expect(runtime.replace).not.toHaveBeenCalled();
    if (kind === 'cross-path') {
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'departed' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Select shelf' }));
      act(() => vi.advanceTimersByTime(300));
      expect(runtime.replace).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox')).toHaveValue('queued');
    }
  },
);

it('native cancellation drops a retained expired debounce and allows later fresh edits', () => {
  const page = render(fixture());
  page.rerender(fixture(false, { visible: true }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'canceled' },
  });
  expect(screen.getByRole('textbox')).toHaveValue('canceled');
  act(() => vi.advanceTimersByTime(300));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  page.rerender(fixture());
  act(() => vi.advanceTimersByTime(1000));
  expect(runtime.replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fresh' } });
  act(() => vi.advanceTimersByTime(300));
  expect(runtime.replace).toHaveBeenCalledExactlyOnceWith(
    '/locations?q=fresh',
    { scroll: false },
  );
});

it('a newly fresh epoch cannot replay retained work even without an intermediate blocked render', () => {
  const page = render(fixture());
  page.rerender(fixture(false, { visible: true }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'old epoch' },
  });
  act(() => vi.advanceTimersByTime(300));
  act(() => invalidateAssignmentCallbacks());
  page.rerender(fixture());
  expect(runtime.replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'new epoch' },
  });
  act(() => vi.advanceTimersByTime(300));
  expect(runtime.replace).toHaveBeenCalledExactlyOnceWith(
    '/locations?q=new+epoch',
    { scroll: false },
  );
});

it('an initially unknown generation acquires its first grant only at fresh admission', () => {
  const page = render(fixture(false, { visible: true, generation: '' }));
  page.rerender(fixture());
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'verified' },
  });
  act(() => vi.advanceTimersByTime(300));
  expect(runtime.replace).toHaveBeenCalledExactlyOnceWith(
    '/locations?q=verified',
    { scroll: false },
  );
});

it.each(['observer', 'onLeave'])(
  '%s departure survives fresh rerenders but real Activity reactivation admits new input',
  (kind) => {
    const page = render(<Activity mode="visible">{fixture()}</Activity>);
    const input = screen.getByRole('textbox');
    if (kind === 'observer') act(() => runtime.observe!('/history'));
    else fireEvent.click(screen.getByRole('button', { name: 'Leave browser' }));
    page.rerender(<Activity mode="visible">{fixture()}</Activity>);
    fireEvent.change(input, { target: { value: 'departed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select shelf' }));
    act(() => vi.advanceTimersByTime(300));
    expect(input).toHaveValue('');
    expect(runtime.replace).not.toHaveBeenCalled();
    page.rerender(<Activity mode="hidden">{fixture()}</Activity>);
    page.rerender(<Activity mode="visible">{fixture()}</Activity>);
    expect(screen.getByRole('textbox')).toBe(input);
    fireEvent.change(input, { target: { value: 'reactivated' } });
    act(() => vi.advanceTimersByTime(300));
    expect(runtime.replace).toHaveBeenCalledExactlyOnceWith(
      '/locations?q=reactivated',
      { scroll: false },
    );
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

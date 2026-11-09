import { createRoutePresentationLifetime } from '@/components/experience/route-presentation-lifetime';
import { bindRouteActionResults } from '@/components/experience/route-action-result';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HistoryFilters as ActualFilters } from './history-filters';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
function HistoryFilters(
  props: Omit<
    React.ComponentProps<typeof ActualFilters>,
    'memberId' | 'backend'
  >,
) {
  return (
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'history-test',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      <ActualFilters
        {...props}
        memberId="test-actor"
        backend="https://backend.test"
      />
    </PrivacyReadinessContext>
  );
}
import { historyEventNames } from '../history-summary';
const m = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  people: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => m }));
vi.mock('../history-actions', () => ({ searchHistoryActors: m.people }));
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const actors = [
  {
    actor_id: id,
    actor_name: 'Alex',
    first_recorded_at: '2026-01-01T12:00:00Z',
    same_name_count: 2,
    name_ordinal: 1,
  },
  {
    actor_id: other,
    actor_name: 'Alex',
    first_recorded_at: '2026-02-01T12:00:00Z',
    same_name_count: 2,
    name_ordinal: 2,
  },
];
const base = {
  locations: [],
  actors,
  actorTotal: 2,
  record: null,
  clearHref: '/history',
};
beforeEach(() => {
  m.people.mockResolvedValue({ rows: actors, total: 2 });
});
it.each([
  [
    'quantity',
    ['location_corrected', 'retired', 'site_assigned', 'site_retired'],
  ],
  ['asset', ['received', 'adjusted', 'archived', 'site_issued']],
] as const)(
  'disables incompatible event options for %s',
  (type, unavailable) => {
    render(<HistoryFilters {...base} params={{ type }} />);
    const typedLabels: Record<string, string> =
      type === 'quantity'
        ? {
            site_corrected: 'Site count corrected',
            site_written_off: 'Quantity written off at site',
          }
        : {
            site_written_off: 'Asset written off at site',
            site_retired: 'Asset retired at site',
          };
    for (const [eventType, label] of Object.entries(historyEventNames)) {
      const option = screen.getByRole('option', {
        name: typedLabels[eventType] ?? label,
      });
      expect(option).toHaveProperty(
        'disabled',
        unavailable.some((event) => event === eventType),
      );
    }
    expect(
      screen.getByRole('option', { name: 'Movements' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('option', { name: 'All events' }),
    ).not.toBeDisabled();
  },
);
it('keeps all-types custody labels generic and changes compatible labels with record kind', () => {
  const view = render(<HistoryFilters {...base} params={{}} />);
  fireEvent.click(screen.getByText('More filters'));
  expect(
    screen.getByRole('option', { name: 'Written off at site' }),
  ).toBeEnabled();
  view.rerender(<HistoryFilters {...base} params={{ type: 'quantity' }} />);
  expect(
    screen.getByRole('option', { name: 'Quantity written off at site' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('option', { name: 'Site count corrected' }),
  ).toBeEnabled();
  view.rerender(<HistoryFilters {...base} params={{ type: 'asset' }} />);
  expect(
    screen.getByRole('option', { name: 'Asset written off at site' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('option', { name: 'Site custody corrected' }),
  ).toBeEnabled();
  expect(screen.getByRole('option', { name: 'Issued to site' })).toBeDisabled();
});
it('retains an incompatible selection after changing tracking type until explicitly cleared', () => {
  render(
    <HistoryFilters
      {...base}
      params={{ type: 'quantity', eventType: 'received', actor: id }}
    />,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Tracking type' }), {
    target: { value: 'asset' },
  });
  expect(screen.getByRole('combobox', { name: 'Event type' })).toHaveValue(
    'received',
  );
  expect(screen.getByRole('combobox', { name: 'Event type' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/);
  expect(m.push).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('link', { name: 'Export history CSV' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear event type' }));
  expect(screen.getByRole('combobox', { name: 'Event type' })).toHaveValue(
    'all',
  );
  expect(m.push).toHaveBeenCalledExactlyOnceWith(
    '/history?type=asset&actor=' + id,
    { scroll: false },
  );
});
it('keeps an incompatible direct URL selection visible and recoverable', () => {
  render(
    <HistoryFilters
      {...base}
      params={{ type: 'quantity', eventType: 'retired' }}
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Event type' })).toHaveValue(
    'retired',
  );
  expect(screen.getByRole('option', { name: 'Asset retired' })).toBeDisabled();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Clear event type' }),
  ).toBeVisible();
});
it('labels canonical UTC instants separately from the preset zone', () => {
  render(
    <HistoryFilters
      {...base}
      params={{
        from: '2026-11-02T06:00:00.123456Z',
        until: '2026-11-09T06:00:00Z',
        zone: 'America/Chicago',
      }}
    />,
  );
  expect(
    screen.getByText(
      /Applied instants \(UTC; preset \/ display zone: America\/Chicago\)/,
    ),
  ).toHaveTextContent('2026-11-02T06:00:00.123456Z inclusive');
});
it('answers person plus last-week movements with two choices and writes fixed instants', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  const { unmount } = render(
    <HistoryFilters {...base} params={{ zone: 'UTC' }} />,
  );
  try {
    fireEvent.change(screen.getByRole('combobox', { name: 'Person' }), {
      target: { value: id },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Activity range' }), {
      target: { value: 'movements-lastweek' },
    });
    const href = m.push.mock.calls.at(-1)![0];
    const query = new URL(href, 'https://example.test').searchParams;
    expect(query.get('actor')).toBe(id);
    expect(query.get('eventType')).toBe('movements');
    expect(query.get('from')).toBe('2026-10-26T00:00:00.000Z');
    expect(query.get('until')).toBe('2026-11-02T00:00:00.000Z');
    expect(
      screen.queryByRole('link', { name: 'Export history CSV' }),
    ).not.toBeInTheDocument();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
it('debounces A/B/A edits, retains the latest draft through stale commits and blocks stale export', () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(
    <HistoryFilters {...base} params={{ q: 'original' }} />,
  );
  try {
    const input = screen.getByRole('textbox', { name: 'Item or tag search' });
    for (const q of ['A', 'B', 'A']) {
      fireEvent.change(input, { target: { value: q } });
      act(() => vi.advanceTimersByTime(100));
    }
    expect(m.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(m.replace).toHaveBeenCalledExactlyOnceWith('/history?q=A', {
      scroll: false,
    });
    rerender(<HistoryFilters {...base} params={{ q: 'B' }} />);
    expect(input).toHaveValue('A');
    expect(
      screen.queryByRole('link', { name: 'Export history CSV' }),
    ).not.toBeInTheDocument();
    rerender(<HistoryFilters {...base} params={{ q: 'A' }} />);
    expect(
      screen.getByRole('link', { name: 'Export history CSV' }),
    ).toHaveAttribute('href', expect.stringContaining('q=A'));
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
it('restores Back state and cancels old typing, while keeping the record kind locked', () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <HistoryFilters
      {...base}
      record={{ id, name: 'Adapters', kind: 'quantity' }}
      params={{ type: 'quantity', entityId: id, q: 'before' }}
    />,
  );
  try {
    expect(
      screen.getByRole('combobox', { name: 'Tracking type' }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Item or tag search' }),
      { target: { value: 'pending' } },
    );
    window.history.replaceState(
      null,
      '',
      '/history?type=quantity&entityId=' + id + '&q=back',
    );
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(
      screen.getByRole('textbox', { name: 'Item or tag search' }),
    ).toHaveValue('back');
    act(() => vi.advanceTimersByTime(500));
    expect(m.replace).not.toHaveBeenCalled();
  } finally {
    unmount();
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
  }
});
it('shows invalid range errors without navigating or offering stale export', () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <HistoryFilters {...base} params={{ from: 'invalid' }} />,
  );
  try {
    expect(screen.getByRole('alert')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Export history CSV' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Person' }), {
      target: { value: id },
    });
    act(() => vi.advanceTimersByTime(300));
    expect(m.push).not.toHaveBeenCalled();
    expect(m.replace).not.toHaveBeenCalled();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
it('new same-name actor options do not retarget the selected identity', () => {
  const { rerender } = render(
    <HistoryFilters {...base} params={{ actor: id }} />,
  );
  rerender(
    <HistoryFilters
      {...base}
      actors={[
        ...actors,
        {
          ...actors[1],
          actor_id: '00000000-0000-4000-8000-000000000003',
          name_ordinal: 3,
        },
      ]}
      params={{ actor: id }}
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Person' })).toHaveValue(id);
  expect(
    screen.getAllByRole('option', { name: /Alex.*first activity/ }),
  ).toHaveLength(3);
});
it('keeps latest people search options when an earlier response finishes later', async () => {
  vi.useFakeTimers();
  let oldResult:
    ((value: { rows: typeof actors; total: number }) => void) | undefined;
  let newResult:
    ((value: { rows: typeof actors; total: number }) => void) | undefined;
  m.people
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResult = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          newResult = resolve;
        }),
    );
  const { unmount } = render(
    <HistoryFilters {...base} params={{ actor: id }} />,
  );
  try {
    fireEvent.click(screen.getByText('Find a person in history'));
    const input = screen.getByRole('textbox', { name: 'Person name' });
    fireEvent.change(input, { target: { value: 'old' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.change(input, { target: { value: 'new' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      newResult?.({ rows: [{ ...actors[0], actor_name: 'Newest' }], total: 1 });
    });
    await act(async () => {
      oldResult?.({ rows: [{ ...actors[0], actor_name: 'Stale' }], total: 1 });
    });
    expect(screen.getByRole('option', { name: /Newest/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /Stale/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Person' })).toHaveValue(id);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
it('deliberate pagination cancels unsent text without changing the record scope', () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <>
      <HistoryFilters
        {...base}
        record={{ id, name: 'Adapters', kind: 'quantity' }}
        params={{ entityId: id, type: 'quantity', q: 'applied' }}
      />
      <a
        href={'/history?type=quantity&entityId=' + id + '&q=applied&page=2'}
        onClick={(e) => e.preventDefault()}
      >
        Next page
      </a>
    </>,
  );
  try {
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Item or tag search' }),
      { target: { value: 'unsent' } },
    );
    fireEvent.click(screen.getByRole('link', { name: 'Next page' }));
    expect(
      screen.getByRole('textbox', { name: 'Item or tag search' }),
    ).toHaveValue('applied');
    expect(
      screen.getByRole('combobox', { name: 'Tracking type' }),
    ).toBeDisabled();
    act(() => vi.advanceTimersByTime(500));
    expect(m.replace).not.toHaveBeenCalled();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
it('restores server people on clear and treats a repeated search as a new cancellable request', async () => {
  vi.useFakeTimers();
  let resolveCancelled:
    ((value: { rows: typeof actors; total: number }) => void) | undefined;
  m.people
    .mockResolvedValueOnce({
      rows: [{ ...actors[0], actor_name: 'Earlier search' }],
      total: 1,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCancelled = resolve;
        }),
    );
  const { unmount } = render(
    <HistoryFilters {...base} params={{ actor: id }} />,
  );
  try {
    fireEvent.click(screen.getByText('Find a person in history'));
    const input = screen.getByRole('textbox', { name: 'Person name' });
    fireEvent.change(input, { target: { value: 'A' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(
      screen.getByRole('option', { name: /Earlier search/ }),
    ).toBeVisible();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByRole('option', { name: /Earlier search/ })).toBeNull();
    expect(
      screen.getAllByRole('option', { name: /Alex.*first activity/ }),
    ).toHaveLength(2);
    fireEvent.change(input, { target: { value: 'A' } });
    expect(screen.getByText('Finding people…')).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(m.people).toHaveBeenCalledTimes(2);
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {
      resolveCancelled?.({
        rows: [{ ...actors[0], actor_name: 'Cancelled search' }],
        total: 1,
      });
    });
    expect(
      screen.queryByRole('option', { name: /Cancelled search/ }),
    ).toBeNull();
    expect(screen.queryByText('Finding people…')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Person' })).toHaveValue(id);
    expect(
      screen.getAllByRole('option', { name: /Alex.*first activity/ }),
    ).toHaveLength(2);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

const managed = (generation: string, ready = true) => ({
  ready,
  visible: ready,
  generation,
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function retained(
  generation: string,
  memberId = 'actor-A',
  backend = 'https://backend.test',
  ready = true,
) {
  return (
    <PrivacyReadinessContext value={managed(generation, ready)}>
      <ActualFilters
        {...base}
        params={{}}
        memberId={memberId}
        backend={backend}
      />
    </PrivacyReadinessContext>
  );
}
it('does not admit unmanaged controls or issue private actor reads', async () => {
  vi.useFakeTimers();
  const view = render(
    <ActualFilters
      {...base}
      params={{ q: 'private' }}
      memberId="actor-A"
      backend="https://backend.test"
    />,
  );
  try {
    expect(screen.queryByRole('combobox', { name: 'Person' })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(m.people).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
it.each(['generation'] as const)(
  'retires queued typing and late people after %s A/B/A without reviving old callbacks',
  async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    m.people.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(retained('generation-A'));
    try {
      fireEvent.click(screen.getByText('More filters'));
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Item or tag search' }),
        { target: { value: 'retired draft' } },
      );
      fireEvent.click(screen.getByText('Find a person in history'));
      fireEvent.change(screen.getByRole('textbox', { name: 'Person name' }), {
        target: { value: 'private search' },
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(m.people).toHaveBeenCalledTimes(1);
      m.replace.mockClear();
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Item or tag search' }),
        { target: { value: 'unsent after read' } },
      );
      view.rerender(
        retained('generation-B', 'actor-A', 'https://backend.test'),
      );
      view.rerender(retained('generation-A'));
      await act(async () => {
        finish({
          rows: [{ ...actors[0], actor_name: 'Retired secret' }],
          total: 1,
        });
        vi.advanceTimersByTime(500);
      });
      expect(
        screen.queryByRole('option', { name: /Retired secret/ }),
      ).toBeNull();
      expect(
        screen.getByRole('textbox', { name: 'Item or tag search' }),
      ).toHaveValue('');
      expect(m.replace).not.toHaveBeenCalled();
      view.rerender(
        <PrivacyReadinessContext value={managed('generation-A')}>
          <ActualFilters
            {...base}
            params={{ q: 'fresh applied' }}
            memberId="actor-A"
            backend="https://backend.test"
          />
        </PrivacyReadinessContext>,
      );
      expect(
        screen.getByRole('textbox', { name: 'Item or tag search' }),
      ).toHaveValue('fresh applied');
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  },
);
it.each(['actor', 'backend'] as const)(
  'permanently retires the mounted %s owner across A/B/A and admits a fresh verified page owner',
  async (change) => {
    vi.useFakeTimers();
    let finishOld!: (value: unknown) => void;
    m.people.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    let view = render(retained('generation-A'));
    try {
      fireEvent.click(screen.getByText('More filters'));
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Item or tag search' }),
        { target: { value: 'retired draft' } },
      );
      fireEvent.click(screen.getByText('Find a person in history'));
      fireEvent.change(screen.getByRole('textbox', { name: 'Person name' }), {
        target: { value: 'private search' },
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(m.people).toHaveBeenCalledTimes(1);
      m.replace.mockClear();
      const retiredInput = screen.getByRole('textbox', {
        name: 'Item or tag search',
      });
      fireEvent.change(retiredInput, {
        target: { value: 'unsent after read' },
      });
      const expectWithdrawn = () => {
        expect(
          screen.queryByRole('textbox', { name: 'Item or tag search' }),
        ).toBeNull();
        expect(screen.queryByRole('combobox', { name: 'Person' })).toBeNull();
        expect(
          screen.queryByRole('textbox', { name: 'Person name' }),
        ).toBeNull();
        expect(
          screen.queryByRole('link', { name: 'Export history CSV' }),
        ).toBeNull();
        expect(
          screen.queryByRole('option', { name: /Retired secret/ }),
        ).toBeNull();
      };
      view.rerender(
        retained(
          'generation-A',
          change === 'actor' ? 'actor-B' : 'actor-A',
          change === 'backend'
            ? 'https://other-backend.test'
            : 'https://backend.test',
        ),
      );
      expectWithdrawn();
      view.rerender(retained('generation-A'));
      expectWithdrawn();
      // Returning to A cannot revive the retired mounted owner or its queued edit.
      fireEvent.change(retiredInput, { target: { value: 'retired callback' } });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expectWithdrawn();
      expect(m.replace).not.toHaveBeenCalled();
      expect(m.push).not.toHaveBeenCalled();
      expect(m.people).toHaveBeenCalledTimes(1);

      view.unmount();
      const oldEpoch = assignmentEpoch();
      const oldRevision = readPrivacyRevocationRevision();
      act(() => revokePrivatePresentation());
      expect(assignmentEpoch()).toBeGreaterThan(oldEpoch);
      expect(readPrivacyRevocationRevision()).toBeGreaterThan(oldRevision);
      // Model the page/gate remount after fresh verification, not an auto-keyed control.
      view = render(
        <PrivacyReadinessContext value={managed('generation-fresh')}>
          <ActualFilters
            {...base}
            params={{ q: 'fresh applied' }}
            memberId="actor-A"
            backend="https://backend.test"
          />
        </PrivacyReadinessContext>,
      );
      const currentInput = screen.getByRole('textbox', {
        name: 'Item or tag search',
      });
      expect(currentInput).toHaveValue('fresh applied');
      expect(screen.getByRole('combobox', { name: 'Person' })).toBeVisible();
      fireEvent.change(currentInput, { target: { value: 'current draft' } });
      fireEvent.click(screen.getByText('Find a person in history'));
      fireEvent.change(screen.getByRole('textbox', { name: 'Person name' }), {
        target: { value: 'current search' },
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(m.people).toHaveBeenCalledTimes(2);
      await act(async () => {
        finishOld({
          rows: [{ ...actors[0], actor_name: 'Retired secret' }],
          total: 1,
        });
        vi.advanceTimersByTime(500);
      });
      expect(
        screen.queryByRole('option', { name: /Retired secret/ }),
      ).toBeNull();
      expect(
        screen.getAllByRole('option', { name: /Alex.*first activity/ }),
      ).toHaveLength(2);
      expect(currentInput).toHaveValue('current draft');
      expect(screen.getByRole('textbox', { name: 'Person name' })).toHaveValue(
        'current search',
      );
      expect(m.replace).toHaveBeenCalledExactlyOnceWith(
        '/history?q=current+draft',
        {
          scroll: false,
        },
      );
      expect(m.push).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  },
);
it('withdraws private controls on revocation and ignores a late rejection after unmount', async () => {
  vi.useFakeTimers();
  let reject!: (value: unknown) => void;
  m.people.mockImplementationOnce(
    () =>
      new Promise((_resolve, failed) => {
        reject = failed;
      }),
  );
  const view = render(retained('generation-A'));
  try {
    fireEvent.click(screen.getByText('Find a person in history'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Person name' }), {
      target: { value: 'search' },
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    view.rerender(
      retained('generation-A', 'actor-A', 'https://backend.test', false),
    );
    expect(screen.queryByRole('combobox', { name: 'Person' })).toBeNull();
    view.unmount();
    await act(async () => {
      reject(new Error('late'));
      vi.advanceTimersByTime(500);
    });
    expect(m.push).not.toHaveBeenCalled();
    expect(m.replace).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it.each([
  ['forbidden', false],
  ['forbidden', true],
  ['actor_changed', false],
  ['actor_changed', true],
] as const)(
  'routes only a current owned %s denial through existing presentation suppression (retired=%s)',
  async (code, retired) => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    m.people.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const invalidate = vi.fn();
    const unbind = bindHistoryDenials(invalidate);
    const view = render(retained('generation-A'));
    try {
      fireEvent.click(screen.getByText('Find a person in history'));
      fireEvent.change(screen.getByRole('textbox', { name: 'Person name' }), {
        target: { value: 'Alex' },
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      if (retired) view.rerender(retained('generation-B'));
      await act(async () => {
        finish({ ok: false, code });
      });
      expect(invalidate).toHaveBeenCalledTimes(retired ? 0 : 1);
      if (retired)
        expect(screen.getByRole('combobox', { name: 'Person' })).toBeVisible();
      else
        expect(screen.queryByRole('combobox', { name: 'Person' })).toBeNull();
    } finally {
      unbind();
      view.unmount();
      vi.useRealTimers();
    }
  },
);

it('keeps error/help associations local when two current filter instances coexist', () => {
  render(
    <>
      <HistoryFilters
        {...base}
        params={{ type: 'quantity', eventType: 'retired' }}
      />
      <HistoryFilters
        {...base}
        params={{ type: 'quantity', eventType: 'retired' }}
      />
    </>,
  );
  const controls = screen.getAllByRole('combobox', { name: 'Event type' });
  const references = controls.map((control) =>
    control.getAttribute('aria-describedby'),
  );
  expect(new Set(references).size).toBe(2);
  for (const reference of references)
    expect(document.getElementById(reference!)?.textContent).toMatch(
      /unavailable/,
    );
});

function bindHistoryDenials(invalidate: () => void) {
  const lifetime = createRoutePresentationLifetime();
  const source = Symbol('history-test-presentation');
  const unmount = lifetime.mount(source);
  const unbind = bindRouteActionResults(
    invalidate,
    undefined,
    () => () => true,
    (current) => lifetime.capture(source, current, () => true),
  );
  return () => {
    unbind();
    unmount();
  };
}
it.each([
  ['query', 'forbidden'],
  ['query', 'actor_changed'],
  ['page', 'forbidden'],
  ['page', 'actor_changed'],
] as const)(
  'a superseded %s request cannot suppress its same-scope successor on %s',
  async (replacement, code) => {
    vi.useFakeTimers();
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    m.people
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      );
    const invalidate = vi.fn();
    const unbind = bindHistoryDenials(invalidate);
    const view = render(
      <HistoryFilters {...base} actorTotal={101} params={{}} />,
    );
    try {
      fireEvent.click(screen.getByText('Find a person in history'));
      const input = screen.getByRole('textbox', { name: 'Person name' });
      fireEvent.change(input, { target: { value: 'Alex' } });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(m.people).toHaveBeenCalledTimes(1);
      if (replacement === 'query')
        fireEvent.change(input, { target: { value: 'Successor' } });
      else fireEvent.click(screen.getByRole('button', { name: 'More people' }));
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(m.people).toHaveBeenCalledTimes(2);
      expect(m.people.mock.calls[1].slice(0, 3)).toEqual([
        replacement === 'query' ? 'Successor' : 'Alex',
        null,
        replacement === 'query' ? 1 : 2,
      ]);
      await act(async () => {
        finishOld({ ok: false, code });
      });
      expect(invalidate).not.toHaveBeenCalled();
      expect(screen.getByRole('combobox', { name: 'Person' })).toBeVisible();
      expect(input).toHaveValue(replacement === 'query' ? 'Successor' : 'Alex');
      await act(async () => {
        finishNew({
          rows: [{ ...actors[0], actor_name: 'Current successor' }],
          total: 1,
        });
      });
      expect(
        screen.getByRole('option', { name: /Current successor/ }),
      ).toBeVisible();
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      unbind();
      view.unmount();
      vi.useRealTimers();
    }
  },
);

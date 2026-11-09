import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { InventoryViewControls as ActualControls } from './view-controls';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
function InventoryViewControls(
  props: React.ComponentProps<typeof ActualControls>,
) {
  return (
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'view-controls-test',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      <ActualControls {...props} />
    </PrivacyReadinessContext>
  );
}
import { SearchForm } from './search-form';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  emptySavedViews,
  encodeSavedViews,
  savedViewStorageKey,
} from '../view-preferences';
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const props = {
  memberId: id(1),
  backend: 'https://inventory.supabase.co',
  columns: [
    {
      id: id(2),
      label: 'Count',
      category: 'Cables',
      type: 'integer',
      legacy: false,
      ordinal: null,
    },
  ],
  truncated: false,
};
const key = savedViewStorageKey(props.memberId, props.backend);
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('URL settings win over browser defaults and Back restores controls without another default redirect', async () => {
  localStorage.setItem(
    key,
    encodeSavedViews({
      ...emptySavedViews(),
      preferences: { view: 'holdings', density: 'compact', columns: [id(2)] },
    }),
  );
  const { rerender } = render(
    <InventoryViewControls {...props} params={{ view: 'items' }} />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('combobox', { name: 'Inventory view' })).toHaveValue(
    'items',
  );
  expect(navigation.replace).not.toHaveBeenCalled();
  rerender(
    <InventoryViewControls
      {...props}
      params={{ view: 'holdings', density: 'compact', columns: id(2) }}
    />,
  );
  expect(
    screen.getByRole('combobox', { name: 'Inventory density' }),
  ).toHaveValue('compact');
  fireEvent.click(screen.getByText(/^Custom columns/));
  expect(
    screen.getByRole('checkbox', { name: 'Count · Cables' }),
  ).toBeChecked();
  rerender(<InventoryViewControls {...props} params={{}} />);
  expect(screen.getByRole('combobox', { name: 'Inventory view' })).toHaveValue(
    'items',
  );
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('a deliberate view change cancels stale A/B/A search typing, resets page and retains applied filters', async () => {
  vi.useFakeTimers();
  const params = { q: 'A', page: '2', view: 'items' };
  const { unmount } = render(
    <>
      <SearchForm params={params} categories={[]} locations={[]} sites={[]} />
      <InventoryViewControls {...props} params={params} />
    </>,
  );
  try {
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search inventory' }),
      { target: { value: 'B' } },
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Inventory view' }), {
      target: { value: 'holdings' },
    });
    expect(navigation.push).toHaveBeenLastCalledWith(
      '/inventory?q=A&view=holdings&density=comfortable',
      { scroll: false },
    );
    expect(
      screen.getByRole('textbox', { name: 'Search inventory' }),
    ).toHaveValue('A');
    act(() => vi.advanceTimersByTime(500));
    expect(navigation.replace).not.toHaveBeenCalled();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
it('saves, renames and removes only personal allowlisted settings; storage failure is visible', async () => {
  render(
    <InventoryViewControls
      {...props}
      params={{ q: 'Cable', density: 'compact' }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
    target: { value: 'Cable picking' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
  const stored = JSON.parse(localStorage.getItem(key)!);
  expect(stored.views[0].params).toEqual({
    q: 'Cable',
    view: 'items',
    density: 'compact',
  });
  expect(Object.keys(stored)).toEqual(['version', 'preferences', 'views']);
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
    target: { value: 'Renamed view' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Rename view' }));
  expect(JSON.parse(localStorage.getItem(key)!).views[0].name).toBe(
    'Renamed view',
  );
  const remove = screen.getByRole('button', {
    name: 'Remove view Renamed view',
  });
  expect(remove).toHaveClass('text-[var(--danger)]');
  fireEvent.click(remove);
  expect(JSON.parse(localStorage.getItem(key)!).views).toEqual([]);
  const failure = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('Browser storage unavailable');
    });
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
    target: { value: 'New saved view' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Browser storage unavailable',
  );
  failure.mockRestore();
});
it.each(['actor', 'backend'])(
  'defers personal restoration until verification and rejects another %s scope',
  (kind) => {
    localStorage.setItem(
      key,
      encodeSavedViews({
        ...emptySavedViews(),
        preferences: { view: 'holdings', density: 'compact', columns: [] },
      }),
    );
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const { rerender } = render(
      <PrivacyReadinessContext.Provider
        value={{ ready: false, generation: 'blocked' }}
      >
        <ActualControls {...props} params={{}} />
      </PrivacyReadinessContext.Provider>,
    );
    expect(read).not.toHaveBeenCalled();
    rerender(
      <PrivacyReadinessContext.Provider
        value={{ ready: true, generation: 'verified' }}
      >
        <ActualControls
          {...props}
          memberId={kind === 'actor' ? id(3) : props.memberId}
          backend={
            kind === 'backend' ? 'https://other-backend.test' : props.backend
          }
          params={{}}
        />
      </PrivacyReadinessContext.Provider>,
    );
    // Scope drift is deliberately fail-closed; a verified new page mounts a fresh gate.
    expect(
      screen.queryByRole('combobox', { name: 'Inventory view' }),
    ).toBeNull();
    read.mockRestore();
  },
);
it('location views retain their authoritative path scope when a saved filter points elsewhere', async () => {
  localStorage.setItem(
    key,
    encodeSavedViews({
      ...emptySavedViews(),
      views: [
        {
          id: id(4),
          name: 'Other room',
          params: { location: 'OTHER', view: 'holdings', density: 'compact' },
        },
      ],
    }),
  );
  render(
    <InventoryViewControls
      {...props}
      params={{ location: 'ITC' }}
      action="/locations/ITC"
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Saved inventory view' }),
    { target: { value: id(4) } },
  );
  expect(navigation.push).toHaveBeenCalledWith(
    '/locations/ITC?location=ITC&view=holdings&density=compact',
    { scroll: false },
  );
});

const liveGrant = (generation = 'owned-views') => ({
  ready: true,
  visible: true,
  generation,
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
const rawControls = (
  privacy: React.ComponentProps<typeof PrivacyReadinessContext>['value'],
  params: Record<string, string | undefined> = { view: 'items' },
) => (
  <PrivacyReadinessContext value={privacy}>
    <ActualControls {...props} params={params} />
  </PrivacyReadinessContext>
);
it.each(['unmanaged', 'missing epoch', 'stale epoch', 'stale revocation'])(
  'never reads personal views under %s readiness',
  async (kind) => {
    const privacy = {
      ...liveGrant(),
      ...(kind === 'unmanaged'
        ? { generation: 'unmanaged' }
        : kind === 'missing epoch'
          ? { verifiedEpoch: undefined }
          : kind === 'stale epoch'
            ? { verifiedEpoch: assignmentEpoch() - 1 }
            : { revocationRevision: readPrivacyRevocationRevision() - 1 }),
    };
    const read = vi.spyOn(Storage.prototype, 'getItem');
    render(rawControls(privacy));
    await act(async () => {
      await Promise.resolve();
    });
    expect(read.mock.calls.filter(([name]) => name === key)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save view' })).toBeDisabled();
  },
);
it('withdraws queued restoration before its storage read and admits only a new verified generation', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem');
  let view!: ReturnType<typeof render>;
  act(() => {
    view = render(rawControls(liveGrant()));
    revokePrivatePresentation();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(read.mock.calls.filter(([name]) => name === key)).toHaveLength(0);
  view.rerender(rawControls(liveGrant('successor')));
  await act(async () => {
    await Promise.resolve();
  });
  expect(read.mock.calls.filter(([name]) => name === key)).toHaveLength(1);
});
it('clears retained saved names and rejects old handlers at revocation without touching another actor or backend key', async () => {
  const saved = {
    ...emptySavedViews(),
    views: [
      {
        id: id(4),
        name: 'Private cable view',
        params: { view: 'items' as const, density: 'comfortable' as const },
      },
    ],
  };
  localStorage.setItem(key, encodeSavedViews(saved));
  const otherKey = savedViewStorageKey(id(7), 'https://other-backend.test');
  localStorage.setItem(otherKey, encodeSavedViews(saved));
  const view = render(rawControls(liveGrant()));
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    screen.getByRole('option', { name: 'Private cable view' }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
    target: { value: 'Late save' },
  });
  const save = screen.getByRole('button', { name: 'Save view' });
  const write = vi.spyOn(Storage.prototype, 'setItem');
  act(() => revokePrivatePresentation());
  fireEvent.click(save);
  expect(
    screen.queryByRole('option', { name: 'Private cable view' }),
  ).toBeNull();
  expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('');
  expect(write).not.toHaveBeenCalled();
  expect(localStorage.getItem(otherKey)).toBe(encodeSavedViews(saved));
  view.rerender(rawControls(liveGrant('new-owned-lifetime')));
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    screen.getByRole('option', { name: 'Private cable view' }),
  ).toBeInTheDocument();
  expect(navigation.push).not.toHaveBeenCalled();
});
it('cannot publish a storage result that retires its generation during the read', async () => {
  const text = encodeSavedViews({
    ...emptySavedViews(),
    views: [
      {
        id: id(4),
        name: 'Retired name',
        params: { view: 'items', density: 'comfortable' },
      },
    ],
  });
  const original = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
    this: Storage,
    name,
  ) {
    if (name === key) {
      revokePrivatePresentation();
      return text;
    }
    return original.call(this, name);
  });
  render(rawControls(liveGrant()));
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('option', { name: 'Retired name' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Save view' })).toBeDisabled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('restores an implicit browser default only once and lets committed Back parameters remain authoritative', async () => {
  localStorage.setItem(
    key,
    encodeSavedViews({
      ...emptySavedViews(),
      preferences: { view: 'holdings', density: 'compact', columns: [] },
    }),
  );
  const view = render(
    <InventoryViewControls {...props} params={{ q: 'Cable', page: '8' }} />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
    '/inventory?q=Cable&view=holdings&density=compact',
    { scroll: false },
  );
  view.rerender(
    <InventoryViewControls
      {...props}
      params={{ q: 'Cable', view: 'holdings', density: 'compact' }}
    />,
  );
  view.rerender(<InventoryViewControls {...props} params={{ q: 'Cable' }} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('combobox', { name: 'Inventory view' })).toHaveValue(
    'items',
  );
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

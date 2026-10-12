import {
  Suspense,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createRoutePendingState } from '@/components/experience/route-pending-state';
import { createRoutePendingOwners } from '@/components/experience/route-pending-owners';
import {
  RoutePendingContext,
  RouteProgress,
  RouteTransitionRunner,
} from '@/components/experience/route-pending';
import { SettingsPanel } from './settings-panel';

const runtime = vi.hoisted(() => ({ refresh: vi.fn(), submit: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: runtime.refresh }),
}));
vi.mock('./actions', () => ({
  submitConfiguration: runtime.submit,
  reviewCategoryRemoval: vi.fn(),
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => true,
}));

it('keeps committed category feedback alongside a genuine pending refresh and retires its announcer only after reveal', async () => {
  let finishRefresh!: () => void;
  let refreshed = false;
  const refresh = new Promise<void>((resolve) => {
    finishRefresh = () => {
      refreshed = true;
      resolve();
    };
  });
  const state = createRoutePendingState();
  runtime.submit.mockResolvedValue({ ok: true, result: { changed: true } });
  function ReadRefresh({ requested }: { requested: boolean }) {
    if (requested && !refreshed) throw refresh;
    return (
      <p>{requested ? 'Refreshed category list' : 'Original category list'}</p>
    );
  }
  function Harness() {
    const [requested, setRequested] = useState(false);
    const [owners] = useState(createRoutePendingOwners);
    const mounted = useSyncExternalStore(
      owners.subscribe,
      owners.snapshot,
      owners.snapshot,
    );
    const pending = useSyncExternalStore(
      state.subscribe,
      state.snapshot,
      state.snapshot,
    );
    const scope = useMemo(
      () => ({ state, owners, terminal: () => state.cancel() }),
      [owners],
    );
    useLayoutEffect(() => {
      runtime.refresh.mockImplementation(() => setRequested(true));
    }, []);
    return (
      <RoutePendingContext value={scope}>
        {mounted.map((owner) => (
          <RouteTransitionRunner
            key={`${owner.id}:${pending.epoch}`}
            scope={scope}
            epoch={pending.epoch}
            owner={owner}
          />
        ))}
        <RouteProgress />
        <Suspense fallback={<p>Refreshing category list</p>}>
          <SettingsPanel
            mode="categories"
            categories={
              requested
                ? [
                    {
                      id: '00000000-0000-4000-8000-000000000001',
                      name: 'Adapters',
                      code: 'ADAPTERS',
                      active: true,
                      sort_order: 0,
                      version: '1',
                      removed_at: null,
                    },
                  ]
                : []
            }
            canManage
          />
          <ReadRefresh requested={requested} />
        </Suspense>
      </RoutePendingContext>
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Adapters' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
  const committed = await screen.findByText('Category added: Adapters.');
  await waitFor(() => expect(state.snapshot().pending).toBe(true));
  expect(committed).toHaveAttribute('role', 'status');
  // The former unscoped browser lookup cannot select this committed receipt.
  expect(() => screen.getByRole('status')).toThrow(/multiple elements/i);
  expect(screen.getByText('Opening requested content…')).toHaveAttribute(
    'role',
    'status',
  );
  expect(screen.getAllByRole('status')).toHaveLength(2);
  expect(screen.getByText('Original category list')).toBeVisible();
  expect(runtime.refresh).toHaveBeenCalledOnce();
  await act(async () => {
    finishRefresh();
    await refresh;
  });
  await screen.findByText('Refreshed category list');
  expect(
    within(screen.getByRole('list', { name: 'Categories' })).getByText(
      'Adapters',
      { exact: true },
    ),
  ).toBeVisible();
  await waitFor(() => expect(state.snapshot().pending).toBe(false));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Category added: Adapters.',
  );
  expect(document.querySelector('.experience-route-progress')).toHaveAttribute(
    'data-visible',
    'false',
  );
});

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { revokePrivatePresentation } from '@/features/scan/assign-batch';
import { RoomCameraSnapshotProvider } from './scene/camera-snapshot-provider';
import { SpacesWorkspace } from './spaces-workspace';
import { spaces } from './spaces';
import type { RoomOccupancy } from './occupancy-contract';

const runtime = vi.hoisted(() => ({ read: vi.fn(), identity: vi.fn() }));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/room',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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
const paints: Array<RoomOccupancy | undefined> = [];
vi.mock('next/dynamic', () => ({
  default: () =>
    function Scene({
      locationOccupancy,
    }: {
      locationOccupancy?: RoomOccupancy;
    }) {
      useLayoutEffect(() => {
        paints.push(locationOccupancy);
      });
      return (
        <output data-testid="scene-counts">
          {JSON.stringify(locationOccupancy ?? null)}
        </output>
      );
    },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const backend = 'https://backend.example';
const owner = {
  actorId: 'test-user',
  backend,
  role: 'staff',
  canManageConfiguration: true,
};
const locations = [
  {
    id: 'root',
    code: 'ITC',
    name: 'IT Closet',
    breadcrumb: 'IT Closet',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
  {
    id: 'drawer',
    code: 'ITC-D01',
    name: 'Drawer 1',
    breadcrumb: 'IT Closet / Drawer 1',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
];
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  paints.length = 0;
  history.replaceState(null, '', '/room?location=ITC-D01');
  runtime.read.mockReset().mockResolvedValue({ status: 'absent' });
  runtime.identity
    .mockReset()
    .mockResolvedValue({ status: 'match', generation: { status: 'absent' } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

it.each(['accepted', 'pending'] as const)(
  'retires %s full-room G1 on revocation and requires fresh G2 after same-owner privacy Retry',
  async (firstState) => {
    const requests: Array<{
      url: string;
      signal: AbortSignal;
      work: ReturnType<typeof deferred<unknown>>;
    }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        if (url.startsWith('/api/room/occupancy?')) {
          const work = deferred<unknown>();
          requests.push({ url, signal: init.signal as AbortSignal, work });
          return work.promise; // Deliberately ignores abort to exercise late delivery.
        }
        return Promise.resolve({ ok: false });
      }),
    );
    const reply = async (index: number, units: string) => {
      const generation = new URL(
        requests[index].url,
        location.origin,
      ).searchParams.get('generation')!;
      await act(async () => {
        requests[index].work.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            identity: {
              userId: owner.actorId,
              environment: location.origin,
              backend,
              generation,
              spaceId: 'it-closet',
              filter: 'type=all;status=active',
            },
            counts: {
              'ITC-D01': {
                quantity_product_count: '1',
                quantity_unit_count: units,
                asset_count: '2',
              },
            },
          }),
        });
        await requests[index].work.promise;
      });
      return generation;
    };
    render(
      <ProtectedPrivacyBoundary
        serverGeneration={{ status: 'absent' }}
        binding={owner}
      >
        <RoomCameraSnapshotProvider actorId={owner.actorId} backend={backend}>
          <ProtectedPrivacyContent>
            <SpacesWorkspace
              locations={locations}
              userId={owner.actorId}
              backend={backend}
              initialSpace={spaces[0]}
              initialCode="ITC-D01"
            />
          </ProtectedPrivacyContent>
        </RoomCameraSnapshotProvider>
      </ProtectedPrivacyBoundary>,
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    const viewer = screen.getByTestId('room-viewer');
    const scene = screen.getByTestId('scene-counts');
    const firstGeneration = new URL(
      requests[0].url,
      location.origin,
    ).searchParams.get('generation')!;
    if (firstState === 'accepted') {
      await reply(0, '31');
      expect(viewer).toHaveAttribute(
        'data-occupancy-generation',
        firstGeneration,
      );
    }
    runtime.read.mockResolvedValue({ status: 'invalid' });
    act(() => revokePrivatePresentation());
    await screen.findByRole('button', { name: 'Retry privacy cleanup' });
    expect(screen.getByTestId('room-viewer')).toBe(viewer); // Retained business owner.
    expect(requests[0].signal.aborted).toBe(true);
    expect(viewer).toHaveAttribute('data-occupancy-generation', '');
    expect(scene).toHaveTextContent('null');
    const afterRevoke = paints.length;
    const recovery = deferred<{ status: 'absent' }>();
    runtime.read.mockReturnValue(recovery.promise);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry privacy cleanup' }));
    expect(requests).toHaveLength(1);
    await act(async () => {
      recovery.resolve({ status: 'absent' });
      await recovery.promise;
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(screen.getByTestId('room-viewer')).toBe(viewer);
    expect(viewer).toHaveAttribute('data-occupancy-status', 'loading');
    expect(viewer).toHaveAttribute('data-occupancy-generation', '');
    expect(scene).toHaveTextContent('null');
    if (firstState === 'pending') await reply(0, '31');
    expect(viewer).toHaveAttribute('data-occupancy-generation', '');
    expect(
      paints.slice(afterRevoke).every((counts) => counts === undefined),
    ).toBe(true);
    const secondGeneration = await reply(1, '47');
    expect(secondGeneration).not.toBe(firstGeneration);
    expect(viewer).toHaveAttribute(
      'data-occupancy-generation',
      secondGeneration,
    );
    expect(viewer).toHaveAttribute('data-occupancy-status', 'ready');
    expect(scene).toHaveTextContent('"quantity_unit_count":"47"');
    expect(
      paints
        .slice(afterRevoke)
        .every(
          (counts) => !counts || counts['ITC-D01'].quantity_unit_count === '47',
        ),
    ).toBe(true);
  },
);

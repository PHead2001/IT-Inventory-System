import {
  act,
  render as renderTree,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import { spaces } from './spaces';
import type { CameraView } from './scene/camera-view';
import { Activity, useEffect, useState } from 'react';
import { RouteReadyContext } from '@/components/experience/route-ready';
import { createRouteReadiness } from '@/components/experience/route-readiness';
import { createRoutePendingState } from '@/components/experience/route-pending-state';

const focusCallbacks: Array<(code: string | null) => void> = [];
const roomReferences: object[] = [];

vi.mock('next/dynamic', () => ({
  default: () =>
    function Scene(props: {
      showCounts?: boolean;
      onCountsChange?: (show: boolean) => void;
      locationOccupancy?: import('./occupancy-contract').RoomOccupancy;
      selectedCode: string | null;
      highlightedCodes: string[];
      onSelect: (code: string) => void;
      focusRequest: { requestId: number; preserveView?: boolean };
      focusOnRestore: boolean;
      initialView?: CameraView | null;
      onViewChange?: (view: CameraView) => void;
      onFocusComplete?: (code: string | null) => void;
      onFocusCancel?: () => void;
      onFailure?: (message: string) => void;
      onReady?: () => void;
      room: object;
    }) {
      const { onReady } = props;
      useEffect(() => {
        onReady?.();
      }, [onReady]);
      if (props.onFocusComplete) focusCallbacks.push(props.onFocusComplete);
      roomReferences.push(props.room);
      return (
        <div
          data-testid="scene-selection"
          data-counts={JSON.stringify(props.locationOccupancy ?? null)}
          data-optional-counts={String(props.showCounts)}
          data-code={props.selectedCode ?? ''}
          data-highlights={JSON.stringify(props.highlightedCodes)}
          data-focus={props.focusRequest.requestId}
          data-preserve-view={String(props.focusRequest.preserveView)}
          data-focus-on-restore={String(props.focusOnRestore)}
          data-initial-view={JSON.stringify(props.initialView ?? null)}
        >
          <button onClick={() => props.onCountsChange?.(!props.showCounts)}>
            Toggle item counts
          </button>
          <button onClick={() => props.onSelect('ITC-B')}>
            Choose B in scene
          </button>
          <button onClick={() => props.onSelect('ITC-A')}>
            Choose A in scene
          </button>
          <button onClick={() => props.onSelect('ITC-S1A')}>
            Choose shelf 1A in scene
          </button>
          <button onClick={() => props.onFailure?.('Graphics failed.')}>
            Fail room
          </button>
          <button onClick={() => props.onFocusCancel?.()}>Cancel focus</button>
          <button
            onClick={() =>
              props.onViewChange?.({
                position: [155, 175, 205],
                target: [20, 30, 40],
                zoom: 2,
                mode: 'free',
              })
            }
          >
            Record camera view
          </button>
        </div>
      );
    },
}));
vi.mock('../inventory/components/read-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  InventoryRows: ({ rows }: { rows: { name: string }[] }) => (
    <div>{rows.map((row) => row.name).join(', ')}</div>
  ),
}));
import { SpacesWorkspace } from './spaces-workspace';
import { RoomCameraSnapshotProvider } from './scene/camera-snapshot-provider';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';

// Production full-room reads require the protected layout's verified authority.
function render(ui: Parameters<typeof renderTree>[0]) {
  return renderTree(ui, {
    wrapper: ({ children }) => (
      <PrivacyReadinessContext
        value={{
          ready: true,
          visible: true,
          generation: 'workspace-test',
          revocationRevision: readPrivacyRevocationRevision(),
          verifiedEpoch: assignmentEpoch(),
        }}
      >
        <RoomCameraSnapshotProvider
          actorId="test-user"
          backend="https://backend.example"
        >
          {children}
        </RoomCameraSnapshotProvider>
      </PrivacyReadinessContext>
    ),
  });
}

const locations: LocationRef[] = [
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
    id: 'a',
    code: 'ITC-A',
    name: 'A',
    breadcrumb: 'IT Closet / A',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'b',
    code: 'ITC-B',
    name: 'B',
    breadcrumb: 'IT Closet / B',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'rack',
    code: 'ITC-RACK',
    name: 'Server Rack',
    breadcrumb: 'IT Closet / Server Rack',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'red',
    code: 'ITC-RED',
    name: 'Red Container',
    breadcrumb: 'IT Closet / Red Container',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'office',
    code: 'ITO',
    name: 'IT Office',
    breadcrumb: 'IT Office',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
  {
    id: 'shelf-1a',
    code: 'ITC-S1A',
    name: 'Shelf 1A',
    breadcrumb: 'IT Closet / Shelf 1A',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'drawer-1',
    code: 'ITC-D01',
    name: 'Drawer 1',
    breadcrumb: 'IT Closet / Drawer 1',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
];
function response(name: string, code = 'ITC-A', page = 1, total = 1) {
  return {
    ok: true,
    redirected: false,
    headers: { get: () => 'application/json' },
    json: async () => ({
      identity: {
        userId: 'test-user',
        environment: window.location.origin,
        spaceId: code.startsWith('ITO') ? 'it-office' : 'it-closet',
        locationCode: code,
        filter: 'type=all;status=active',
        page,
      },
      result: {
        rows: [
          {
            kind: 'quantity',
            id: 'row',
            name,
            categoryName: 'Cables',
            status: 'active',
          },
        ],
        total,
        page,
        pageSize: 25,
      },
    }),
  };
}
beforeEach(() => {
  window.localStorage.clear();
  focusCallbacks.length = 0;
  roomReferences.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
it('uses browser-only guidance without a map, including singular destination and group', () => {
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={[
        ...locations,
        {
          id: 'office-general',
          code: 'ITO-GENERAL',
          name: 'General Storage',
          breadcrumb: 'IT Office / General Storage',
          active: true,
          can_hold_inventory: true,
          parentId: 'office',
        },
      ]}
      userId="test-user"
      initialSpace={spaces[1]}
      initialCode={null}
    />,
  );
  expect(
    screen.getByText(
      /1 inventory destination across 1 group\. Choose a location in the location browser/,
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(/Choose a location in the map or browser/),
  ).not.toBeInTheDocument();
});
it('shows an empty destination with one count and no empty pager', async () => {
  const empty = response('', 'ITC-A', 1, 0);
  const json = await empty.json();
  json.result.rows = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ...empty, json: async () => json }),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  await screen.findByText('No active inventory here.');
  const inventory = within(
    screen.getByRole('region', { name: 'Location inventory' }),
  );
  const accessibleCount = inventory.getByText('0 matching rows', {
    selector: '[data-count-final]',
  });
  expect(accessibleCount).toHaveAttribute('aria-live', 'polite');
  expect(
    accessibleCount.closest('[aria-hidden="true"], [hidden], [inert]'),
  ).toBeNull();
  const visibleCount = inventory.getByText('0 matching rows', {
    selector: '[data-count-visual]',
  });
  expect(visibleCount).toBeVisible();
  expect(visibleCount).toHaveAttribute('aria-hidden', 'true');
  expect(
    screen.queryByRole('navigation', { name: 'Pagination' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Include all statuses' }),
  ).toHaveAttribute('href', '/locations/ITC-A?status=all');
});
it('recovers an invalid contents page with replacement, keeping location and an honest loading state', async () => {
  window.history.replaceState(
    null,
    '',
    '/room?space=it-closet&location=ITC-A&page=99',
  );
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      const page = Number(
        new URL(url, window.location.origin).searchParams.get('page'),
      );
      const answer = response(
        page === 2 ? 'Last available page' : '',
        'ITC-A',
        page,
        26,
      );
      return answer;
    }),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
      initialPage={99}
    />,
  );
  await screen.findByText('Last available page');
  expect(requests).toHaveLength(2);
  expect(window.location.search).toBe('?space=it-closet&location=ITC-A&page=2');
  expect(screen.getByText('Page 2 of 2')).toBeVisible();
  expect(
    screen.queryByText('No active inventory here.'),
  ).not.toBeInTheDocument();
});
it('refers to the browser when the map is hidden or failed and restores map guidance on retry', async () => {
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Hide room' }));
  expect(
    screen.getByText(/Choose a location in the location browser/),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Show room' }));
  await user.click(screen.getByRole('button', { name: 'Fail room' }));
  expect(
    screen.getByText(/Choose a location in the location browser/),
  ).toBeVisible();
  expect(
    screen.queryByText(/Choose a location in the map or browser/),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry room' }));
  expect(
    screen.getByText(/Choose a location in the map or browser/),
  ).toBeVisible();
});

it('replaces the room selection instruction immediately and restores it after clearing', async () => {
  let resolveContents!: (value: ReturnType<typeof response>) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise((resolve) => (resolveContents = resolve))),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  expect(
    screen.getByText('Select a location in the map or browser'),
  ).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Choose shelf 1A in scene' }),
  );
  expect(screen.getByText('Selected: Shelf 1A')).toBeVisible();
  expect(
    document.querySelector('[data-loading-shape="contents"]'),
  ).toBeInTheDocument();
  expect(screen.getByText('Loading contents for Shelf 1A…')).toHaveClass(
    'sr-only',
  );
  const contentsAnnouncement = screen.getByText(
    'Loading contents for Shelf 1A…',
  );
  expect(contentsAnnouncement).toHaveAttribute('role', 'status');
  expect(
    screen.getByRole('region', { name: 'Location inventory' }),
  ).not.toContainElement(contentsAnnouncement);
  expect(
    screen
      .getByText('Loading contents for Shelf 1A…')
      .closest('[aria-busy="true"]'),
  ).toBeNull();
  expect(
    screen.queryByText('Select a location in the map or browser'),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Location inventory' }),
  ).toHaveAttribute('aria-busy', 'true');
  resolveContents(response('Shelf stock', 'ITC-S1A'));
  await screen.findByText('Shelf stock');
  expect(
    document.querySelector('[data-loading-shape="contents"]'),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Location inventory' }),
  ).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByText('Selected: Shelf 1A')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(
    screen.getByText('Select a location in the map or browser'),
  ).toBeVisible();
  expect(screen.queryByText('Selected: Shelf 1A')).not.toBeInTheDocument();
});

it('keeps the selected logical label through graphics fallback and browser selection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-S1A"
    />,
  );
  expect(screen.getByText('Selected: Shelf 1A')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Fail room' }));
  expect(screen.getByText('Room view unavailable')).toBeVisible();
  expect(screen.getByText('Selected: Shelf 1A')).toBeVisible();
  expect(
    screen.queryByText('Select a location in the location browser'),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getAllByRole('button', { name: 'Shelf 1A ITC-S1A' })[0],
  );
  expect(screen.getByText('Room view unavailable')).toBeVisible();
  expect(screen.getByText('Selected: Shelf 1A')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(
    screen.getByText('Select a location in the location browser'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Expand IT Closet' }));
  await user.click(
    screen.getAllByRole('button', { name: 'Drawer 1 ITC-D01' })[0],
  );
  expect(screen.getByText('Selected: Drawer 1')).toBeVisible();
  expect(
    screen.queryByText(
      /Select a location in the (map or browser|location browser)/,
    ),
  ).not.toBeInTheDocument();
});

it('highlights immediately and ignores slow A/B/A contents responses', async () => {
  const pending: {
    code: string;
    resolve: (value: ReturnType<typeof response>) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          pending.push({
            code: new URL(url, window.location.origin).searchParams.get(
              'location',
            )!,
            resolve,
          });
        }),
    ),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'Choose B in scene' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-B',
  );
  await user.click(screen.getByRole('button', { name: 'Choose A in scene' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-A',
  );
  await waitFor(() => expect(pending).toHaveLength(3));
  pending[2].resolve(response('Current A'));
  await screen.findByText('Current A');
  pending[0].resolve(response('Old A'));
  pending[1].resolve(response('Old B'));
  expect(screen.queryByText('Old A')).not.toBeInTheDocument();
  expect(screen.queryByText('Old B')).not.toBeInTheDocument();
});

it('switches to inventory-only office and keeps browser usable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Office stock', 'ITO')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  await user.selectOptions(screen.getByLabelText('Space'), 'it-office');
  expect(
    screen.getByText(
      'This space has no measured map yet. Browse its logical locations and inventory here.',
    ),
  ).toBeVisible();
  expect(screen.queryByTestId('room-viewer')).not.toBeInTheDocument();
  await user.click(screen.getAllByRole('button', { name: /IT Office ITO/ })[0]);
  await screen.findByText('Office stock');
});

it('restores the compatible modeled-space camera after hiding and switching spaces', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Record camera view' }));
  const saved = JSON.parse(
    screen.getByTestId('room-viewer').getAttribute('data-camera-view')!,
  );
  expect(saved).toMatchObject({ zoom: 2, mode: 'free' });
  await user.click(screen.getByRole('button', { name: 'Hide room' }));
  await user.click(screen.getByRole('button', { name: 'Show room' }));
  expect(
    JSON.parse(
      screen.getByTestId('scene-selection').getAttribute('data-initial-view')!,
    ),
  ).toEqual(saved);
  await user.selectOptions(screen.getByLabelText('Space'), 'it-office');
  expect(screen.queryByTestId('room-viewer')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Space'), 'it-closet');
  expect(
    JSON.parse(
      screen.getByTestId('scene-selection').getAttribute('data-initial-view')!,
    ),
  ).toEqual(saved);
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'false',
  );
});

it('retains the exact compatible camera across the configured one-entry route unmount and Back remount', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock')),
  );
  const user = userEvent.setup();
  function OneEntryRouter() {
    const [room, setRoom] = useState(true);
    return (
      <div>
        <button onClick={() => setRoom(!room)}>
          {room ? 'Navigate Inventory' : 'Browser Back to room'}
        </button>
        {room ? (
          <SpacesWorkspace
            backend="https://backend.example"
            locations={locations}
            userId="test-user"
            initialSpace={spaces[0]}
            initialCode={null}
          />
        ) : (
          <h1>Inventory</h1>
        )}
      </div>
    );
  }
  render(
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'camera-test',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RoomCameraSnapshotProvider
        actorId="test-user"
        backend="https://backend.example"
      >
        <OneEntryRouter />
      </RoomCameraSnapshotProvider>
    </PrivacyReadinessContext>,
  );
  await user.click(screen.getByRole('button', { name: 'Record camera view' }));
  const saved = screen
    .getByTestId('room-viewer')
    .getAttribute('data-camera-view');
  expect(JSON.parse(saved!)).toMatchObject({ zoom: 2, mode: 'free' });
  await user.click(screen.getByRole('button', { name: 'Navigate Inventory' }));
  expect(screen.queryByTestId('room-viewer')).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Browser Back to room' }),
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-initial-view',
    saved!,
  );
  expect(screen.getByTestId('room-viewer')).toHaveAttribute(
    'data-camera-view',
    saved!,
  );
});

it('keeps new location focus pending across graphics recovery, then preserves the restored view', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock', 'ITC-D01')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-S1A"
    />,
  );
  act(() => focusCallbacks.at(-1)!('ITC-S1A'));
  await user.click(screen.getByRole('button', { name: 'Record camera view' }));
  const saved = screen
    .getByTestId('room-viewer')
    .getAttribute('data-camera-view');
  await user.click(screen.getByRole('button', { name: 'Fail room' }));
  expect(screen.getByText('Room view unavailable')).toBeVisible();
  await user.click(
    screen.getAllByRole('button', { name: 'Drawer 1 ITC-D01' })[0],
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-initial-view',
    saved,
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'true',
  );
  act(() => focusCallbacks.at(-1)!('ITC-D01'));
  expect(screen.getByTestId('room-viewer')).toHaveAttribute(
    'data-focused-code',
    'ITC-D01',
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'false',
  );
  await user.click(screen.getByRole('button', { name: 'Hide room' }));
  await user.click(screen.getByRole('button', { name: 'Show room' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-initial-view',
    saved,
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'false',
  );
});

it('clears an unfinished focus on manual cancellation and hiding the room', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock', 'ITC-S1A')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-S1A"
    />,
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Cancel focus' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'false',
  );
  await user.click(
    screen.getByRole('button', { name: 'Choose shelf 1A in scene' }),
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Hide room' }));
  await user.click(screen.getByRole('button', { name: 'Show room' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'false',
  );
});

it('keeps the same room definition when an SSR-equivalent space becomes canonical', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock', 'ITC-B')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={{ ...spaces[0] }}
      initialCode="ITC-A"
    />,
  );
  const initialRoom = roomReferences.at(-1);
  await user.click(screen.getByRole('button', { name: 'Record camera view' }));
  const saved = screen
    .getByTestId('room-viewer')
    .getAttribute('data-camera-view');
  await user.click(screen.getByRole('button', { name: 'Choose B in scene' }));
  expect(roomReferences.at(-1)).toBe(initialRoom);
  expect(screen.getByTestId('room-viewer')).toHaveAttribute(
    'data-camera-view',
    saved,
  );
  act(() => focusCallbacks.at(-1)!('ITC-B'));
  expect(screen.getByTestId('room-viewer')).toHaveAttribute(
    'data-focused-code',
    'ITC-B',
  );
});

it('counts only completed focus for the current actor and space', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  const viewer = screen.getByTestId('room-viewer');
  const staleCompletion = focusCallbacks.at(-1)!;
  act(() => staleCompletion('ITC-A'));
  expect(viewer).toHaveAttribute('data-focused-code', 'ITC-A');
  expect(viewer).toHaveAttribute('data-focus-count', '1');
  await user.click(screen.getByRole('button', { name: 'Choose A in scene' }));
  expect(viewer).toHaveAttribute('data-focused-code', '');
  expect(viewer).toHaveAttribute('data-focus-count', '1');
  act(() => staleCompletion('ITC-A'));
  expect(viewer).toHaveAttribute('data-focus-count', '1');
  act(() => focusCallbacks.at(-1)!('ITC-A'));
  expect(viewer).toHaveAttribute('data-focus-count', '2');
  await user.selectOptions(screen.getByLabelText('Space'), 'it-office');
  await user.selectOptions(screen.getByLabelText('Space'), 'it-closet');
  const returnedViewer = screen.getByTestId('room-viewer');
  expect(returnedViewer).toHaveAttribute('data-focus-count', '0');
  await user.click(screen.getByRole('button', { name: 'Choose A in scene' }));
  expect(returnedViewer).toHaveAttribute('data-selected-code', 'ITC-A');
  act(() => staleCompletion('ITC-A'));
  expect(returnedViewer).toHaveAttribute('data-focus-count', '0');
  act(() => focusCallbacks.at(-1)!('ITC-A'));
  expect(returnedViewer).toHaveAttribute('data-focused-code', 'ITC-A');
  expect(returnedViewer).toHaveAttribute('data-focus-count', '1');
});

it('restores URL selection on Back and refocuses a repeated selection', async () => {
  window.history.replaceState(null, '', '/room?location=ITC-A');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Choose A in scene' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus',
    '1',
  );
  await user.click(screen.getByRole('button', { name: 'Choose B in scene' }));
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-B',
  );
  window.history.replaceState(null, '', '/room?space=it-closet&location=ITC-A');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() =>
    expect(screen.getByTestId('scene-selection')).toHaveAttribute(
      'data-code',
      'ITC-A',
    ),
  );
});

it('preserves camera history intent while restoring the modeled selection and reveal', async () => {
  window.history.replaceState(null, '', '/room?location=ITC-S1A');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Stock', 'ITC-S1A')),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-S1A"
    />,
  );
  act(() => focusCallbacks.at(-1)!('ITC-S1A'));
  await user.click(
    screen.getAllByRole('button', { name: 'Drawer 1 ITC-D01' })[0],
  );
  act(() => focusCallbacks.at(-1)!('ITC-D01'));
  const beforeBack = Number(
    screen.getByTestId('scene-selection').getAttribute('data-focus'),
  );
  window.history.replaceState(
    null,
    '',
    '/room?space=it-closet&location=ITC-S1A',
  );
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  // Audit W14 preserves Back and existing per-space camera context. A history
  // restoration reuses that view; explicit Center selected still requests flight.
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'false',
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-preserve-view',
    'true',
  );
  expect(
    Number(screen.getByTestId('scene-selection').getAttribute('data-focus')),
  ).toBeGreaterThan(beforeBack);
});

it.each([
  { initialCode: null, code: 'ITC-RACK', name: 'Server Rack', reduced: false },
  {
    initialCode: 'ITC-RACK',
    code: 'ITC-RED',
    name: 'Red Container',
    reduced: false,
  },
  {
    initialCode: 'ITC-RACK',
    code: 'ITC-RED',
    name: 'Red Container',
    reduced: true,
  },
])(
  'reconciles missed native history on Activity reactivation: $initialCode → $code (Reduced $reduced)',
  async ({ initialCode, code, name, reduced }) => {
    const initialUrl =
      '/room?space=it-closet' + (initialCode ? '&location=' + initialCode : '');
    window.history.replaceState(null, '', initialUrl);
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url, window.location.origin).searchParams;
      return response(
        'Current ' + params.get('location'),
        params.get('location')!,
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const readiness = createRouteReadiness(
      'test-user',
      createRoutePendingState(),
      () => {},
    );
    const register = vi.spyOn(readiness, 'register');
    const workspace = (mode: 'visible' | 'hidden') => (
      <RouteReadyContext value={readiness}>
        <Activity mode={mode}>
          <SpacesWorkspace
            backend="https://backend.example"
            locations={locations}
            userId="test-user"
            initialSpace={spaces[0]}
            initialCode={initialCode}
            initialRouteKey={initialUrl}
          />
        </Activity>
      </RouteReadyContext>
    );
    const view = render(workspace('visible'));
    if (initialCode) await screen.findByText('Current ' + initialCode);
    act(() => focusCallbacks.at(-1)!(initialCode));
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Record camera view' }));
    const savedView = screen
      .getByTestId('scene-selection')
      .getAttribute('data-initial-view');
    const previousFocus = Number(
      screen.getByTestId('scene-selection').getAttribute('data-focus'),
    );
    const staleFocus = focusCallbacks.at(-1)!;
    view.rerender(workspace('hidden'));
    expect(screen.getByTestId('scene-selection')).not.toBeVisible();
    const previousCalls = fetcher.mock.calls.length;
    // Next's eager restore can dispatch before the retained room's effects return.
    act(() => {
      window.history.replaceState(null, '', '/settings');
      window.localStorage.setItem(
        'it-inventory-reduce-motion',
        String(reduced),
      );
      window.dispatchEvent(new Event('it-inventory-motion-change'));
      window.history.replaceState(
        null,
        '',
        '/room?space=it-closet&location=' + code,
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(fetcher).toHaveBeenCalledTimes(previousCalls);
    const restoredUrl = window.location.href;
    view.rerender(workspace('visible'));
    await screen.findByText('Current ' + code);
    expect(screen.getByText('Selected: ' + name)).toBeVisible();
    const scene = screen.getByTestId('scene-selection');
    expect(scene).toHaveAttribute('data-code', code);
    expect(scene).toHaveAttribute('data-highlights', JSON.stringify([code]));
    expect(scene).toHaveAttribute('data-initial-view', savedView);
    expect(scene).toHaveAttribute('data-focus-on-restore', 'false');
    expect(scene).toHaveAttribute('data-preserve-view', 'true');
    expect(Number(scene.getAttribute('data-focus'))).toBeGreaterThan(
      previousFocus,
    );
    act(() => staleFocus(initialCode));
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      '',
    );
    act(() => focusCallbacks.at(-1)!(code));
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      code,
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.stringContaining('location=' + code),
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    );
    expect(register).toHaveBeenLastCalledWith(
      expect.objectContaining({
        routeKey: '/room?location=' + code + '&space=it-closet',
      }),
    );
    expect(window.location.href).toBe(restoredUrl);
    expect(
      screen.getByRole('region', { name: 'Location inventory' }),
    ).toHaveAttribute('aria-busy', 'false');
  },
);

it('pages contents without remounting the room or delaying selection', async () => {
  window.history.replaceState(null, '', '/room?location=ITC-A');
  const fetcher = vi.fn(async (url: string) =>
    response(
      'Page stock',
      'ITC-A',
      Number(new URL(url, window.location.origin).searchParams.get('page')),
      30,
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  await screen.findByText('Page stock');
  const scene = screen.getByTestId('scene-selection');
  const focusBeforePage = scene.getAttribute('data-focus');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('Page 2 of 2')).toBeVisible());
  expect(screen.getByTestId('scene-selection')).toBe(scene);
  expect(scene).toHaveAttribute('data-focus', focusBeforePage);
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('page=2'),
    expect.objectContaining({ cache: 'no-store' }),
  );
  window.history.replaceState(null, '', '/room?location=ITC-A');
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(scene).toHaveAttribute('data-focus', focusBeforePage);
});

it('accepts the current URL over cached server props on remount and retires an interrupted contents request', async () => {
  window.history.replaceState(
    null,
    '',
    '/room?space=it-closet&location=ITC-RACK',
  );
  const pending: {
    code: string;
    signal: AbortSignal;
    resolve: (value: ReturnType<typeof response>) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options: { signal: AbortSignal }) => {
      // Selected count reads are independent of the contents lifecycle under
      // test. Keep them out of the owned interrupted-request queue.
      if (url.startsWith('/api/room/occupancy?'))
        return Promise.resolve({ ok: false });
      return new Promise((resolve) => {
        pending.push({
          code: new URL(url, window.location.origin).searchParams.get(
            'location',
          )!,
          signal: options.signal,
          resolve,
        });
      });
    }),
  );
  const workspace = (
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-RACK"
      initialRouteKey="/room?location=ITC-RACK&space=it-closet"
    />
  );
  const first = render(workspace);
  await waitFor(() => expect(pending).toHaveLength(1));
  first.unmount();
  expect(pending[0].signal.aborted).toBe(true);
  window.history.replaceState(
    null,
    '',
    '/room?space=it-closet&location=ITC-RED',
  );
  render(workspace);
  await waitFor(() => expect(pending.at(-1)?.code).toBe('ITC-RED'));
  act(() => pending.at(-1)!.resolve(response('Restored red stock', 'ITC-RED')));
  await screen.findByText('Restored red stock');
  await act(async () => {
    for (const request of pending.filter(
      (request) => request.code === 'ITC-RACK',
    ))
      request.resolve(response('Retired rack stock', 'ITC-RACK'));
  });
  expect(screen.queryByText('Retired rack stock')).not.toBeInTheDocument();
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-RED',
  );
  expect(
    screen.getByRole('region', { name: 'Location inventory' }),
  ).toHaveAttribute('aria-busy', 'false');
});

it('refreshes a restored contents page without refocusing a manually adjusted camera', async () => {
  window.history.replaceState(
    null,
    '',
    '/room?space=it-closet&location=ITC-RACK',
  );
  const fetcher = vi.fn(async (url: string) => {
    const page = Number(
      new URL(url, window.location.origin).searchParams.get('page'),
    );
    return response('Rack page ' + page, 'ITC-RACK', page, 30);
  });
  vi.stubGlobal('fetch', fetcher);
  const workspace = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <SpacesWorkspace
        backend="https://backend.example"
        locations={locations}
        userId="test-user"
        initialSpace={spaces[0]}
        initialCode="ITC-RACK"
      />
    </Activity>
  );
  const view = render(workspace('visible'));
  await screen.findByText('Rack page 1');
  act(() => focusCallbacks.at(-1)!('ITC-RACK'));
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Record camera view' }));
  const scene = screen.getByTestId('scene-selection');
  const saved = scene.getAttribute('data-initial-view');
  const focus = scene.getAttribute('data-focus');
  view.rerender(workspace('hidden'));
  act(() => {
    window.history.replaceState(
      null,
      '',
      '/room?space=it-closet&location=ITC-RACK&page=2',
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  view.rerender(workspace('visible'));
  await screen.findByText('Rack page 2');
  expect(screen.getByText('Page 2 of 2')).toBeVisible();
  expect(scene).toHaveAttribute('data-focus', focus);
  expect(scene).toHaveAttribute('data-focus-on-restore', 'false');
  expect(scene).toHaveAttribute('data-initial-view', saved);
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('page=2'),
    expect.objectContaining({ cache: 'no-store' }),
  );
});

it.each([
  {
    from: '/room?space=missing',
    to: '/room?space=it-closet',
    initial: 'The requested space is unavailable. Showing IT Closet instead.',
    expected: null,
  },
  {
    from: '/room?space=it-closet',
    to: '/room?space=missing',
    initial: null,
    expected: 'The requested space is unavailable. Showing IT Closet instead.',
  },
  {
    from: '/room?space=it-closet',
    to: '/room?space=it-closet&location=ITC-MISSING',
    initial: null,
    expected:
      'The requested location is unavailable in this space. Choose a location below.',
  },
  {
    from: '/room?space=it-closet&location=ITC-MISSING',
    to: '/room?space=it-closet',
    initial:
      'The requested location is unavailable in this space. Choose a location below.',
    expected: null,
  },
])(
  'reconciles fallback notices on retained history: $from → $to',
  async ({ from, to, initial, expected }) => {
    window.history.replaceState(null, '', from);
    const workspace = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <SpacesWorkspace
          backend="https://backend.example"
          locations={locations}
          userId="test-user"
          initialSpace={spaces[0]}
          initialCode={null}
          initialRouteKey={from}
          initialNotice={initial}
        />
      </Activity>
    );
    const view = render(workspace('visible'));
    if (initial) await screen.findByText(initial);
    view.rerender(workspace('hidden'));
    act(() => {
      window.history.replaceState(null, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    view.rerender(workspace('visible'));
    if (expected) expect(await screen.findByText(expected)).toBeVisible();
    else
      await waitFor(() =>
        expect(
          screen.queryByText(/The requested (space|location) is unavailable/),
        ).not.toBeInTheDocument(),
      );
    expect(screen.getByLabelText('Space')).toHaveValue('it-closet');
    expect(window.location.pathname + window.location.search).toBe(to);
  },
);

it('ignores another route history event while the room is departing', async () => {
  window.history.replaceState(null, '', '/room?location=ITC-RACK');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Rack stock', 'ITC-RACK')),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-RACK"
    />,
  );
  await screen.findByText('Rack stock');
  act(() => {
    window.history.replaceState(null, '', '/settings?location=ITC-RED');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-RACK',
  );
  expect(screen.getByText('Rack stock')).toBeVisible();
});

it.each(['/room', '/room?space=it-closet'])(
  'preserves a panned camera without synthesizing focus when the same saved space reactivates at %s',
  async (url) => {
    window.history.replaceState(null, '', url);
    const preferenceKey = 'inventory-space:test-user:' + window.location.origin;
    window.localStorage.setItem(preferenceKey, 'it-closet');
    const workspace = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <SpacesWorkspace
          backend="https://backend.example"
          locations={locations}
          userId="test-user"
          initialSpace={spaces[0]}
          initialCode={null}
          initialRouteKey={url}
        />
      </Activity>
    );
    const view = render(workspace('visible'));
    // Flush initial URL/preference restoration before recording manual intent.
    await act(async () => {});
    act(() => focusCallbacks.at(-1)!(null));
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Record camera view' }));
    const scene = screen.getByTestId('scene-selection');
    const savedView = scene.getAttribute('data-initial-view');
    expect(JSON.parse(savedView!)).toEqual({
      position: [155, 175, 205],
      target: [20, 30, 40],
      zoom: 2,
      mode: 'free',
    });
    const focus = scene.getAttribute('data-focus');
    expect(focus).toBe('0');
    const completed = screen
      .getByTestId('room-viewer')
      .getAttribute('data-focus-count');
    expect(window.localStorage.getItem(preferenceKey)).toBe('it-closet');
    view.rerender(workspace('hidden'));
    expect(scene).not.toBeVisible();
    act(() => {
      window.history.replaceState(null, '', '/inventory');
      window.history.replaceState(null, '', url);
      // Native Back can precede the reactivated page's listener.
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    view.rerender(workspace('visible'));
    await act(async () => {});
    expect(scene).toBeVisible();
    // A new null-code request makes CameraRig fit the room over the saved pan.
    expect(scene).toHaveAttribute('data-focus', focus!);
    expect(scene).toHaveAttribute('data-focus-on-restore', 'false');
    expect(scene).toHaveAttribute('data-initial-view', savedView!);
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-camera-view',
      savedView!,
    );
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focus-count',
      completed!,
    );
    expect(window.location.pathname + window.location.search).toBe(url);
  },
);

it.each([
  { initialSpace: spaces[0], saved: 'it-office', modeled: false },
  { initialSpace: spaces[1], saved: 'it-closet', modeled: true },
])(
  'restores a different saved space ($saved) on an initial bare room visit',
  async ({ initialSpace, saved, modeled }) => {
    window.history.replaceState(null, '', '/room');
    window.localStorage.setItem(
      'inventory-space:test-user:' + window.location.origin,
      saved,
    );
    render(
      <SpacesWorkspace
        backend="https://backend.example"
        locations={locations}
        userId="test-user"
        initialSpace={initialSpace}
        initialCode={null}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Space')).toHaveValue(saved),
    );
    if (modeled)
      expect(
        Number(
          screen.getByTestId('scene-selection').getAttribute('data-focus'),
        ),
      ).toBeGreaterThan(0);
    else expect(screen.queryByTestId('room-viewer')).not.toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/room');
  },
);

it('keeps an explicit location deep link ahead of a different saved space', async () => {
  window.history.replaceState(
    null,
    '',
    '/room?space=it-closet&location=ITC-RACK',
  );
  window.localStorage.setItem(
    'inventory-space:test-user:' + window.location.origin,
    'it-office',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Linked rack stock', 'ITC-RACK')),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-RACK"
    />,
  );
  await screen.findByText('Linked rack stock');
  expect(screen.getByLabelText('Space')).toHaveValue('it-closet');
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-RACK',
  );
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'true',
  );
});

it('reports an unavailable saved space without refocusing the current default', async () => {
  window.history.replaceState(null, '', '/room');
  window.localStorage.setItem(
    'inventory-space:test-user:' + window.location.origin,
    'missing',
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  expect(
    await screen.findByText(
      'The saved space is unavailable. Showing IT Closet instead.',
    ),
  ).toBeVisible();
  expect(screen.getByLabelText('Space')).toHaveValue('it-closet');
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus',
    '0',
  );
});

it('does not let a queued saved-space fallback replace a newer restored selection', async () => {
  window.history.replaceState(null, '', '/room');
  window.localStorage.setItem(
    'inventory-space:test-user:' + window.location.origin,
    'it-office',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response('Restored rack stock', 'ITC-RACK')),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  act(() => {
    window.history.replaceState(
      null,
      '',
      '/room?space=it-closet&location=ITC-RACK',
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await screen.findByText('Restored rack stock');
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-code',
    'ITC-RACK',
  );
  expect(screen.getByLabelText('Space')).toHaveValue('it-closet');
});

it('rejects a successful response for the wrong user or location', async () => {
  window.history.replaceState(null, '', '/room?location=ITC-A');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ...response('Wrong stock'),
      json: async () => ({
        identity: {
          userId: 'another-user',
          environment: window.location.origin,
          spaceId: 'it-closet',
          locationCode: 'ITC-B',
          filter: 'type=all;status=active',
          page: 1,
        },
        result: {
          rows: [
            {
              kind: 'quantity',
              id: 'row',
              name: 'Wrong stock',
              categoryName: 'Cables',
              status: 'active',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        },
      }),
    })),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Inventory response identity did not match',
  );
  expect(screen.queryByText('Wrong stock')).not.toBeInTheDocument();
});

it('explains a transport failure and retries the same selection', async () => {
  window.history.replaceState(null, '', '/room?location=ITC-A');
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue(response('Recovered stock'));
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Inventory could not be loaded.',
  );
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry contents' }));
  await screen.findByText('Recovered stock');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('announces deferred occupancy outside busy geometry and replaces it with failure guidance', async () => {
  let fail!: (error: Error) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    ),
  );
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode={null}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Toggle item counts' }));
  const announcement = await screen.findByText('Refreshing location counts…');
  expect(announcement.closest('[aria-busy="true"]')).toBeNull();
  expect(
    document.querySelector(
      '[data-loading-shape="occupancy"] [aria-busy="true"]',
    ),
  ).toBeInTheDocument();
  await act(async () => fail(new Error('private occupancy detail')));
  await screen.findByText('Item counts unavailable. Refresh to try again.');
  expect(
    document.querySelector('[data-loading-shape="occupancy"]'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Refreshing location counts…'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('private occupancy detail'),
  ).not.toBeInTheDocument();
});
it('binds the occupancy witness to the same committed selection and hides the old generation while the next read is pending', async () => {
  const requests: { url: string; resolve: (value: unknown) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.startsWith('/api/room/occupancy?'))
        return new Promise((resolve) => requests.push({ url, resolve }));
      const code = new URL(url, location.origin).searchParams.get('location')!;
      return Promise.resolve(response('Current stock', code));
    }),
  );
  const user = userEvent.setup();
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-D01"
    />,
  );
  const viewer = screen.getByTestId('room-viewer');
  expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
  expect(viewer).toHaveAttribute('data-occupancy-status', 'loading');
  expect(viewer).toHaveAttribute('data-occupancy-generation', '');
  const finish = async (index: number) => {
    const generation = new URL(
      requests[index].url,
      location.origin,
    ).searchParams.get('generation');
    await act(async () =>
      requests[index].resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          identity: {
            userId: 'test-user',
            environment: location.origin,
            backend: 'https://backend.example',
            generation,
            spaceId: 'it-closet',
            filter: 'type=all;status=active',
          },
          counts: {
            'ITC-D01': {
              quantity_product_count: '1',
              quantity_unit_count: '31',
              asset_count: '0',
            },
            'ITC-S1A': {
              quantity_product_count: '2',
              quantity_unit_count: '44',
              asset_count: '3',
            },
          },
        }),
      }),
    );
    return generation!;
  };
  const first = await finish(0);
  expect(viewer).toHaveAttribute('data-occupancy-status', 'ready');
  expect(viewer).toHaveAttribute('data-occupancy-generation', first);
  await user.click(
    screen.getByRole('button', { name: 'Choose shelf 1A in scene' }),
  );
  expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  expect(viewer).toHaveAttribute('data-occupancy-status', 'loading');
  expect(viewer).toHaveAttribute('data-occupancy-generation', '');
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-counts',
    'null',
  );
  const next = await finish(1);
  expect(next).not.toBe(first);
  expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  expect(viewer).toHaveAttribute('data-occupancy-status', 'ready');
  expect(viewer).toHaveAttribute('data-occupancy-generation', next);
});

it('loads selected reveal counts with the optional overlay off and refreshes both snapshots on return', async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/room/occupancy?'))
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          identity: {
            userId: 'test-user',
            environment: window.location.origin,
            backend: 'https://backend.example',
            generation: new URL(url, window.location.origin).searchParams.get(
              'generation',
            ),
            spaceId: 'it-closet',
            filter: 'type=all;status=active',
          },
          counts: {
            'ITC-D01': {
              quantity_product_count: '1',
              quantity_unit_count: '31',
              asset_count: '2',
            },
          },
        }),
      });
    return Promise.resolve(response('Cable', 'ITC-D01'));
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <SpacesWorkspace
      backend="https://backend.example"
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-D01"
    />,
  );
  await screen.findByText('Cable');
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes('/occupancy?')),
  ).toHaveLength(1);
  // Audit W13 requires the opened selected target's count independently of the
  // optional all-location overlay. The overlay still starts and stays off.
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-optional-counts',
    'false',
  );
  await user.click(screen.getByRole('button', { name: 'Toggle item counts' }));
  await waitFor(() =>
    expect(screen.getByTestId('scene-selection')).toHaveAttribute(
      'data-counts',
      '{"ITC-D01":{"quantity_product_count":"1","quantity_unit_count":"31","asset_count":"2"}}',
    ),
  );
  const before = fetcher.mock.calls.length;
  act(() => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await waitFor(() => expect(fetcher.mock.calls.length).toBe(before + 2));
  const countsExplanation = await screen.findByText(
    /Counts show quantity items with stock and active individual assets at each storage location\./,
  );
  expect(countsExplanation).toHaveAttribute('role', 'status');
  expect(countsExplanation).toBeVisible();
  expect(countsExplanation).toHaveTextContent(
    'Badges mark occupied locations.',
  );
  expect(countsExplanation).toHaveTextContent(
    'Select a location on the map or in the location browser to see its distinct products, units and individual assets.',
  );
  expect(countsExplanation).toHaveTextContent(
    'Hidden locations remain in the browser; counts are a snapshot.',
  );
  expect(countsExplanation).not.toHaveTextContent(/Focus or select a marker/i);
  await user.click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(fetcher.mock.calls.length).toBe(before + 4));
  await user.click(screen.getByRole('button', { name: 'Toggle item counts' }));
  await waitFor(() =>
    expect(screen.getByTestId('scene-selection')).toHaveAttribute(
      'data-counts',
      '{"ITC-D01":{"quantity_product_count":"1","quantity_unit_count":"31","asset_count":"2"}}',
    ),
  );
  expect(countsExplanation).not.toBeInTheDocument();
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-optional-counts',
    'false',
  );
  expect(
    screen.queryByText(
      'Counts show quantity items with stock and active individual assets at each storage location.',
    ),
  ).not.toBeInTheDocument();
});

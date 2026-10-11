import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import { spaces } from './spaces';
import type { CameraView } from './scene/camera-view';

const focusCallbacks: Array<(code: string | null) => void> = [];
const roomReferences: object[] = [];

vi.mock('next/dynamic', () => ({
  default: () =>
    function Scene(props: {
      showCounts?: boolean;
      onCountsChange?: (show: boolean) => void;
      locationOccupancy?: import('./occupancy-contract').RoomOccupancy;
      selectedCode: string | null;
      onSelect: (code: string) => void;
      focusRequest: { requestId: number };
      focusOnRestore: boolean;
      initialView?: CameraView | null;
      onViewChange?: (view: CameraView) => void;
      onFocusComplete?: (code: string | null) => void;
      onFocusCancel?: () => void;
      onFailure?: (message: string) => void;
      room: object;
    }) {
      if (props.onFocusComplete) focusCallbacks.push(props.onFocusComplete);
      roomReferences.push(props.room);
      return (
        <div
          data-testid="scene-selection"
          data-counts={JSON.stringify(props.locationOccupancy ?? null)}
          data-code={props.selectedCode ?? ''}
          data-focus={props.focusRequest.requestId}
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
          <button onClick={props.onFocusCancel}>Cancel focus</button>
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
  expect(screen.getByText('0 matching rows')).toBeVisible();
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
    screen.queryByText('Select a location in the map or browser'),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Location inventory' }),
  ).toHaveAttribute('aria-busy', 'true');
  resolveContents(response('Shelf stock', 'ITC-S1A'));
  await screen.findByText('Shelf stock');
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

it('replays focus for a modeled location reached through browser history', async () => {
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
  expect(screen.getByTestId('scene-selection')).toHaveAttribute(
    'data-focus-on-restore',
    'true',
  );
  expect(
    Number(screen.getByTestId('scene-selection').getAttribute('data-focus')),
  ).toBeGreaterThan(beforeBack);
});

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

it('loads counts only when enabled and refreshes counts and contents together on return', async () => {
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
  ).toHaveLength(0);
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
  await screen.findByText(/counts are a snapshot/);
  await user.click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(fetcher.mock.calls.length).toBe(before + 4));
});

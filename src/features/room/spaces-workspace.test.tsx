import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import { spaces } from './spaces';
import type { CameraView } from './scene/camera-view';

vi.mock('next/dynamic', () => ({
  default: () =>
    function Scene(props: {
      selectedCode: string | null;
      onSelect: (code: string) => void;
      focusRequest: { requestId: number };
      initialView?: CameraView | null;
      onViewChange?: (view: CameraView) => void;
    }) {
      return (
        <div
          data-testid="scene-selection"
          data-code={props.selectedCode ?? ''}
          data-focus={props.focusRequest.requestId}
          data-initial-view={JSON.stringify(props.initialView ?? null)}
        >
          <button onClick={() => props.onSelect('ITC-B')}>
            Choose B in scene
          </button>
          <button onClick={() => props.onSelect('ITC-A')}>
            Choose A in scene
          </button>
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
vi.mock('../inventory/components/read-ui', () => ({
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
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
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
      locations={locations}
      userId="test-user"
      initialSpace={spaces[0]}
      initialCode="ITC-A"
    />,
  );
  await screen.findByText('Page stock');
  const scene = screen.getByTestId('scene-selection');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(screen.getByText('30 results · Page 2 of 2')).toBeVisible(),
  );
  expect(screen.getByTestId('scene-selection')).toBe(scene);
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('page=2'),
    expect.objectContaining({ cache: 'no-store' }),
  );
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

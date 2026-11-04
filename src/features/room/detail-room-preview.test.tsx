import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { DetailRoomPreview } from './detail-room-preview';
import { buildRoomBindings } from './bindings';
import { spaceRoom, spaces } from './spaces';
import { hasModeledRoomBinding } from './room-map-model';
import type { ComponentProps } from 'react';
import type { DetailRoomPreviewClient } from './detail-room-preview-client';
const chunks = vi.hoisted(() => ({ pending: false }));
import type { LocationRef } from '../inventory/contracts-ui';
vi.mock('server-only', () => ({}));
vi.mock('next/dynamic', () => ({
  default:
    (_loader: unknown, options: { loading(): import('react').ReactNode }) =>
    ({ code, selectionMode }: { code: string; selectionMode?: string }) =>
      chunks.pending ? (
        options.loading()
      ) : (
        <p data-selection-mode={selectionMode}>Map for {code}</p>
      ),
}));
vi.mock('./show-in-room', () => ({
  ShowInRoom: () => <a href="/room">Show in room</a>,
}));
const location: LocationRef = {
  id: 'drawer',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'Closet / Drawer 1',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
it('projects every canonical modeled binding and rejects unmodeled ancestry without sending geometry to the client', () => {
  const codes = [
    ...new Set(
      spaces.flatMap((space) => {
        const room = spaceRoom(space);
        return room
          ? buildRoomBindings(room).map((binding) => binding.code)
          : [];
      }),
    ),
  ];
  const locations = codes.map((code) => ({ ...location, id: code, code }));
  const unmodeled = { ...location, id: 'extra', code: 'ITC-EXTRA' };
  const unknownRoot = {
    ...location,
    id: 'office',
    code: 'ITO',
    parentId: null,
  };
  const misleading = {
    ...location,
    id: 'spoof',
    code: 'ITC-D01',
    parentId: unknownRoot.id,
  };
  const choices = codes.map((code) => ({ code, label: code }));
  const client = DetailRoomPreview({
    locations: [...locations, unmodeled],
    choices: [...choices, { code: unmodeled.code, label: 'Extra' }],
  });
  const clientChoices = (
    client.props as ComponentProps<typeof DetailRoomPreviewClient>
  ).choices;
  expect(client.props.locations).toEqual([...locations, unmodeled]);
  for (const choice of clientChoices) {
    expect(choice.modeled).toBe(
      hasModeledRoomBinding([...locations, unmodeled], choice.code),
    );
    expect(Object.keys(choice).sort()).toEqual([
      'code',
      'label',
      'modeled',
      'roomLink',
    ]);
  }
  expect(clientChoices.filter((choice) => choice.modeled)).toHaveLength(
    codes.length,
  );
  expect(clientChoices.at(-1)?.modeled).toBe(false);
  const mismatch = DetailRoomPreview({
    locations: [unknownRoot, misleading],
    choices: [{ code: misleading.code, label: 'Recorded' }],
  });
  expect(mismatch.props.choices[0].modeled).toBe(false);
});

it('server rendering preserves a truthful pending compact slot even without an observer, and unmodeled context stays compact', () => {
  const modeled = renderToString(
    <DetailRoomPreview
      locations={[location]}
      choices={[{ code: location.code, label: location.name }]}
    />,
  );
  expect(modeled).toContain('data-loading-shape="compact-room"');
  expect(modeled).toContain('aria-busy="true"');
  expect(modeled).not.toContain('Map for');
  const unmodeled = { ...location, code: 'ITC-EXTRA' };
  const compact = renderToString(
    <DetailRoomPreview
      locations={[unmodeled]}
      choices={[{ code: unmodeled.code, label: unmodeled.name }]}
    />,
  );
  expect(compact).toContain('This location has no modeled map');
  expect(compact).not.toContain('compactPreviewSlot');
  expect(compact).not.toContain('data-loading-shape');
});
it('requires an explicit choice for several positive balances and mounts only one preview', async () => {
  const other = { ...location, id: 'other', code: 'ITC-D02', name: 'Drawer 2' };
  render(
    <DetailRoomPreview
      locations={[location, other]}
      choices={[
        { code: location.code, label: 'Drawer 1 · 2 units' },
        { code: other.code, label: 'Drawer 2 · 3 units' },
      ]}
    />,
  );
  expect(screen.queryByText(/^Map for/)).toBeNull();
  await userEvent
    .setup()
    .selectOptions(screen.getByRole('combobox'), other.code);
  expect(screen.getAllByText(/^Map for/)).toHaveLength(1);
  expect(screen.getByText('Map for ITC-D02')).toBeInTheDocument();
  expect(screen.getByText('Map for ITC-D02')).toHaveAttribute(
    'data-selection-mode',
    'preview',
  );
});
it('renders assigned and inactive context without promising current custody', () => {
  const view = render(
    <DetailRoomPreview
      locations={[location]}
      choices={[]}
      context="Assigned to a site; no storage map."
    />,
  );
  expect(screen.queryByText(/^Map for/)).toBeNull();
  expect(
    screen.getByText('Assigned to a site; no storage map.'),
  ).toBeInTheDocument();
  view.rerender(
    <DetailRoomPreview
      locations={[{ ...location, active: false }]}
      choices={[{ code: location.code, label: 'Drawer 1' }]}
    />,
  );
  expect(screen.getByText(/Inactive location/)).toBeInTheDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  chunks.pending = false;
});
it('does not persist an implicit sole balance when another recorded location appears', () => {
  const other = { ...location, id: 'other', code: 'ITC-D02' };
  const view = render(
    <DetailRoomPreview
      locations={[location, other]}
      choices={[{ code: location.code, label: 'One' }]}
    />,
  );
  expect(screen.getByText('Map for ITC-D01')).toBeInTheDocument();
  view.rerender(
    <DetailRoomPreview
      locations={[location, other]}
      choices={[
        { code: location.code, label: 'One' },
        { code: other.code, label: 'Two' },
      ]}
    />,
  );
  expect(screen.queryByText(/^Map for/)).toBeNull();
  expect(screen.getByRole('combobox')).toHaveValue('');
});
it('retains a valid explicit choice but forgets a removed choice even if it later returns', async () => {
  const other = { ...location, id: 'other', code: 'ITC-D02' };
  const choices = [
    { code: location.code, label: 'One' },
    { code: other.code, label: 'Two' },
  ];
  const view = render(
    <DetailRoomPreview locations={[location, other]} choices={choices} />,
  );
  await userEvent
    .setup()
    .selectOptions(screen.getByRole('combobox'), other.code);
  view.rerender(
    <DetailRoomPreview
      locations={[location, other]}
      choices={[...choices].reverse()}
    />,
  );
  expect(screen.getByText('Map for ITC-D02')).toBeInTheDocument();
  view.rerender(
    <DetailRoomPreview locations={[location, other]} choices={[choices[0]]} />,
  );
  view.rerender(
    <DetailRoomPreview locations={[location, other]} choices={choices} />,
  );
  expect(screen.queryByText(/^Map for/)).toBeNull();
});
it('reserves the selected preview slot while the map remains offscreen', () => {
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const view = render(
    <DetailRoomPreview
      locations={[location]}
      choices={[{ code: location.code, label: 'One' }]}
    />,
  );
  const slot = view.container.querySelector('[class*="compactPreviewSlot"]');
  expect(slot).not.toBeNull();
  expect(screen.queryByText(/^Map for/)).toBeNull();
  act(() =>
    intersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(screen.getByText('Map for ITC-D01')).toBeInTheDocument();
  expect(view.container.querySelector('[class*="compactPreviewSlot"]')).toBe(
    slot,
  );
});

it('retains the preview while its page owns the single room navigation action', () => {
  render(
    <DetailRoomPreview
      locations={[location]}
      choices={[{ code: location.code, label: 'Drawer 1' }]}
      showRoomLink={false}
    />,
  );
  expect(screen.getByText('Map for ITC-D01')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Show in room' })).toBeNull();
});

it('uses the same actual-label compact shell while the outer embedded chunk is cold', () => {
  chunks.pending = true;
  const named = {
    ...location,
    name: 'Fictional very long recorded modeled location name that wraps across phone lines',
  };
  const view = render(
    <DetailRoomPreview
      locations={[named]}
      choices={[{ code: named.code, label: named.name }]}
    />,
  );
  expect(
    view.container.querySelector('[data-loading-shape="compact-room"]'),
  ).not.toBeNull();
  expect(
    screen.getByText(`Selected location: ${named.name} (${named.code})`),
  ).toBeInTheDocument();
  expect(screen.queryByText(/^Map for/)).toBeNull();
  chunks.pending = false;
  view.rerender(
    <DetailRoomPreview
      locations={[named]}
      choices={[{ code: named.code, label: named.name }]}
    />,
  );
  expect(screen.getByText('Map for ITC-D01')).toBeInTheDocument();
});

it.each(['ITO-GENERAL', 'ITC-EXTRA'])(
  'renders short unmodeled context without loading a chunk or reserving the compact canvas: %s',
  (code) => {
    chunks.pending = true;
    const root = {
      ...location,
      id: 'root',
      code: code.startsWith('ITO') ? 'ITO' : 'ITC',
      name: 'Space',
      parentId: null,
      can_hold_inventory: false,
    };
    const unmodeled = { ...location, id: 'unmodeled', code, parentId: root.id };
    const view = render(
      <DetailRoomPreview
        locations={[root, unmodeled]}
        choices={[{ code, label: 'Recorded context' }]}
      />,
    );
    expect(
      screen.getByText(/This location has no modeled map/),
    ).toBeInTheDocument();
    expect(
      view.container.querySelector('[class*="compactPreviewSlot"]'),
    ).toBeNull();
    expect(
      view.container.querySelector('[data-loading-shape="compact-room"]'),
    ).toBeNull();
    expect(screen.queryByText(/^Map for/)).toBeNull();
  },
);

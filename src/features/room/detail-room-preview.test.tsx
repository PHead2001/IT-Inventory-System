import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailRoomPreview } from './detail-room-preview';
import type { LocationRef } from '../inventory/contracts-ui';
vi.mock('next/dynamic', () => ({
  default:
    () =>
    ({ code, selectionMode }: { code: string; selectionMode?: string }) => (
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

afterEach(() => vi.unstubAllGlobals());
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

import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailRoomPreview } from './detail-room-preview';
import type { LocationRef } from '../inventory/contracts-ui';
vi.mock('next/dynamic', () => ({
  default:
    () =>
    ({ code }: { code: string }) => <p>Map for {code}</p>,
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

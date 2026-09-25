import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ShowInRoom } from './show-in-room';
import { InventoryRows } from '../inventory/components/read-ui';
import type { InventoryResult, LocationRef } from '../inventory/contracts-ui';

const location: LocationRef = {
  id: 'database-location-uuid',
  code: 'ITC-S1A',
  name: '1A',
  breadcrumb: 'IT Closet / Left Storage / Shelf 1 / 1A',
  parentId: 'database-shelf-uuid',
  active: true,
  can_hold_inventory: true,
};
const row: InventoryResult = {
  id: 'database-item-uuid',
  kind: 'quantity',
  name: 'Cable',
  categoryName: 'Cables',
  status: 'active',
  location,
  quantity: 3,
  assetTag: null,
  serialNumber: null,
  recordedTotal: 3,
  reorderThreshold: null,
  stockState: 'disabled',
};

it('links by stable code with an accessible location-specific name', () => {
  render(<ShowInRoom code="ITC-D12" />);
  const link = screen.getByRole('link', { name: 'Show ITC-D12 in room' });
  expect(link).toHaveAttribute('href', '/room?location=ITC-D12');
  expect(link).toHaveTextContent('Show in room');
});

it('adds room navigation to located search results using the location code, never a UUID', () => {
  render(<InventoryRows rows={[row]} />);
  expect(
    screen.getByRole('link', { name: 'Show ITC-S1A in room' }),
  ).toHaveAttribute('href', '/room?location=ITC-S1A');
  expect(screen.getByRole('link', { name: 'Cable' })).toHaveAttribute(
    'href',
    '/inventory/quantity/database-item-uuid',
  );
});

it('preserves unlocated definitions without fabricating a room link', () => {
  render(<InventoryRows rows={[{ ...row, location: null, quantity: null }]} />);
  expect(
    screen.getByText(
      'No positive stock or active site holding — unlocated definition',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('link', { name: /in room/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Cable' })).toBeVisible();
});

it('does not direct unmodeled office or site custody into closet geometry', () => {
  render(<ShowInRoom code="ITO-GENERAL" />);
  expect(screen.getByText('No room model for this location')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: /in room/i }),
  ).not.toBeInTheDocument();
});

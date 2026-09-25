import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { HistoryList, InventoryRows } from './read-ui';
const location = {
  id: 'location',
  code: 'ITC-S4B',
  name: '4B',
  breadcrumb: 'IT Closet / Shelf 4 / 4B',
  active: true,
  can_hold_inventory: true,
  parentId: null,
};
it('exposes stable location links on search results with independent conventional and room destinations', () => {
  render(
    <InventoryRows
      rows={[
        {
          kind: 'quantity',
          id: 'item',
          name: 'Cable',
          categoryName: 'Cables',
          status: 'active',
          location,
          quantity: 4,
          assetTag: null,
          serialNumber: null,
          recordedTotal: 4,
          reorderThreshold: null,
          stockState: 'disabled',
        },
      ]}
    />,
  );
  expect(
    screen.getByRole('link', { name: /IT Closet.*ITC-S4B/ }),
  ).toHaveAttribute('href', '/locations/ITC-S4B');
  expect(screen.getByText('4 units')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Show ITC-S4B in room' }),
  ).toHaveAttribute('href', '/room?location=ITC-S4B');
});
it('labels item-wide low stock while retaining the location holding quantity', () => {
  render(
    <InventoryRows
      rows={[
        {
          kind: 'quantity',
          id: 'item',
          name: 'Cable',
          categoryName: 'Cables',
          status: 'active',
          location,
          quantity: 2,
          assetTag: null,
          serialNumber: null,
          recordedTotal: 3,
          reorderThreshold: 4,
          stockState: 'needs_restocking',
        },
      ]}
    />,
  );
  expect(screen.getByText('2 units')).toBeVisible();
  expect(
    screen.getByText(/Needs restocking · Item-wide total 3 \/ threshold 4/),
  ).toBeVisible();
});
it('shows record corrections as human readable history distinct from movement', () => {
  render(
    <HistoryList
      events={[
        {
          id: 'event',
          kind: 'asset',
          entityId: 'asset',
          entityName: 'Switch',
          eventType: 'location_corrected',
          at: '2026-09-05T12:00:00Z',
          actorName: 'IT Staff',
          reason: 'Found in drawer',
          lines: [],
          fromLocation: location,
          toLocation: {
            ...location,
            id: 'drawer',
            code: 'ITC-D01',
            name: 'Drawer 1',
            breadcrumb: 'IT Closet / Drawer 1',
          },
          metadataChanges: [],
          customMetadataPresent: true,
          customMetadataChanged: true,
        },
      ]}
    />,
  );
  expect(
    screen.getByRole('heading', { name: 'Recorded location corrected' }),
  ).toBeVisible();
  expect(screen.getByText('Reason: Found in drawer')).toBeVisible();
  expect(screen.queryByText('Physically moved')).not.toBeInTheDocument();
  expect(screen.getByText('From:')).toBeInTheDocument();
  expect(screen.getByText('To:')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: /Custom metadata changed/ }),
  ).toHaveAttribute('href', '/history?event=asset:event');
});

it('does not present legacy category metadata events as asset movement', () => {
  render(
    <HistoryList
      events={[
        {
          id: 'legacy-category-event',
          kind: 'asset',
          entityId: 'asset',
          entityName: 'Switch',
          eventType: 'metadata_updated',
          at: '2026-09-05T12:00:00Z',
          actorName: 'IT Staff',
          reason: 'Category removed: Old category',
          lines: [],
          fromLocation: location,
          toLocation: location,
          metadataChanges: [
            {
              field: 'Category',
              before: 'Old category',
              after: 'New category',
            },
          ],
          customMetadataPresent: false,
          customMetadataChanged: false,
        },
      ]}
    />,
  );
  expect(
    screen.getByRole('heading', { name: 'Metadata edited' }),
  ).toBeVisible();
  expect(screen.getByText('Old category → New category')).toBeVisible();
  expect(screen.queryByText('From:')).not.toBeInTheDocument();
  expect(screen.queryByText('To:')).not.toBeInTheDocument();
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  HistoryList,
  InventoryRows,
  Pagination,
  InventoryCount,
} from './read-ui';
const location = {
  id: 'location',
  code: 'ITC-S4B',
  name: '4B',
  breadcrumb: 'IT Closet / Shelf 4 / 4B',
  active: true,
  can_hold_inventory: true,
  parentId: null,
};
it('identifies one local unit separately from overall available and assigned stock', () => {
  render(
    <InventoryRows
      returnTo="/inventory?q=Cable&status=all&page=2"
      rows={[
        {
          kind: 'quantity',
          id: 'item',
          name: 'Cable',
          categoryName: 'Cables',
          status: 'active',
          location,
          quantity: 1,
          assetTag: null,
          serialNumber: null,
          recordedTotal: 3,
          availableQuantity: '2',
          assignedQuantity: '1',
          ownedQuantity: '3',
          reorderThreshold: null,
          stockState: 'disabled',
        },
      ]}
    />,
  );
  expect(screen.getByText('At this location')).toBeVisible();
  expect(screen.getByText('1 unit')).toBeVisible();
  expect(screen.getByText(/Across all storage: 2 available/)).toBeVisible();
  expect(
    screen.getByText(/Overall totals: 1 assigned · 3 recorded/),
  ).toBeVisible();
  const record = screen.getByRole('link', { name: 'Cable' });
  expect(record.closest('li')).toHaveAttribute('id', 'inventory-row-1');
  expect(
    new URL(
      record.getAttribute('href')!,
      'https://inventory.test',
    ).searchParams.get('returnTo'),
  ).toBe('/inventory?q=Cable&status=all&page=2#inventory-row-1');
});
it('omits empty pagination and does not repeat the result count in nonempty pagination', () => {
  const { rerender } = render(
    <Pagination
      result={{ rows: [], total: 0, page: 1, pageSize: 25 }}
      base="/inventory"
      params={{}}
    />,
  );
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  rerender(
    <Pagination
      result={{ rows: [], total: 26, page: 1, pageSize: 25 }}
      base="/inventory"
      params={{ status: 'all', q: 'Cable' }}
    />,
  );
  expect(screen.getByText('Page 1 of 2')).toBeVisible();
  expect(screen.queryByText(/26 results/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
    'href',
    '/inventory?status=all&q=Cable&page=2',
  );
});
it('labels holding and distinct definition counts as page-local, with full matching rows separately', () => {
  const row = {
    kind: 'quantity' as const,
    id: 'same',
    name: 'Cable',
    categoryName: 'Cables',
    status: 'active',
    location,
    quantity: 1,
    assetTag: null,
    serialNumber: null,
    recordedTotal: 2,
    reorderThreshold: null,
    stockState: 'disabled' as const,
  };
  render(
    <InventoryCount
      result={{
        rows: [row, { ...row, location: { ...location, id: 'second' } }],
        total: 52,
        page: 2,
        pageSize: 25,
      }}
    />,
  );
  expect(screen.getByText('52 matching rows')).toBeVisible();
  expect(
    screen.getByText(/On this page: 2 quantity holdings · 1 quantity item/),
  ).toBeVisible();
});
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
    screen.getByText(
      /Needs restocking · Available in storage 3 \/ threshold 4/,
    ),
  ).toBeVisible();
});
it('shows per-definition photo and PDF counts without inventing file counts for other rows', () => {
  const base = {
    categoryName: 'Equipment',
    status: 'active' as const,
    location,
    quantity: null,
    assetTag: null,
    serialNumber: null,
    recordedTotal: null,
    reorderThreshold: null,
    stockState: null,
  };
  render(
    <InventoryRows
      rows={[
        { ...base, kind: 'asset', id: 'asset-a', name: 'Camera' },
        { ...base, kind: 'asset', id: 'asset-b', name: 'Router' },
        { ...base, kind: 'quantity', id: 'item-c', name: 'Adapters' },
      ]}
      fileSummaries={[
        {
          kind: 'asset',
          id: 'asset-a',
          thumbnail_path: null,
          photo_name: null,
          photo_count: 1,
          document_count: 2,
        },
        {
          kind: 'quantity',
          id: 'item-c',
          thumbnail_path: null,
          photo_name: null,
          photo_count: 3,
          document_count: 0,
        },
      ]}
    />,
  );
  const cameraFiles = screen.getByRole('group', { name: 'Files for Camera' });
  expect(within(cameraFiles).getByText('1 photo')).toBeVisible();
  expect(within(cameraFiles).getByText('2 PDFs')).toBeVisible();
  const adapterFiles = screen.getByRole('group', {
    name: 'Files for Adapters',
  });
  expect(within(adapterFiles).getByText('3 photos')).toBeVisible();
  expect(within(adapterFiles).getByText('0 PDFs')).toBeVisible();
  expect(
    screen.queryByRole('group', { name: 'Files for Router' }),
  ).not.toBeInTheDocument();
});
it('keeps separate holding quantities and provides a detail path for long custom data', () => {
  const longSummary = 'An unusually long field\n'.repeat(45);
  render(
    <InventoryRows
      rows={[2, 3].map((quantity, index) => ({
        kind: 'quantity' as const,
        id: 'item',
        name: 'Long identity '.repeat(12),
        categoryName: 'Cables',
        status: 'active',
        location: {
          ...location,
          id: `location-${index}`,
          code: `ITC-${index}`,
        },
        quantity,
        assetTag: null,
        serialNumber: null,
        recordedTotal: 5,
        availableQuantity: '5',
        assignedQuantity: '0',
        ownedQuantity: '5',
        reorderThreshold: null,
        stockState: 'disabled' as const,
        customSummary: longSummary,
      }))}
    />,
  );
  expect(screen.getByText('2 units')).toBeVisible();
  expect(screen.getByText('3 units')).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Full details' })).toHaveLength(2);
  expect(
    screen.getAllByRole('link', { name: 'Full details' })[0],
  ).toHaveAttribute('href', '/inventory/quantity/item');
  expect(
    screen.getAllByText((_, element) => element?.textContent === longSummary),
  ).toHaveLength(2);
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
          assignment: null,
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
          assignment: null,
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

it('renders historical custody labels and quantity on the full item history page', () => {
  render(
    <HistoryList
      events={[
        {
          id: 'old-site-issue',
          kind: 'quantity',
          entityId: 'item',
          entityName: 'Cable',
          eventType: 'site_issued',
          at: '2026-09-05T12:00:00Z',
          actorName: 'IT Staff',
          reason: null,
          assignment: {
            eventId: 'assignment',
            kind: 'issued',
            from: {
              locationId: 'storage',
              siteId: null,
              label: 'Old closet label',
            },
            to: { locationId: null, siteId: 'site', label: 'Old site label' },
            quantity: 3,
            reference: 'Ticket 001',
          },
          lines: [],
          fromLocation: null,
          toLocation: null,
          metadataChanges: [],
          customMetadataPresent: false,
          customMetadataChanged: false,
        },
      ]}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Issued to site' })).toBeVisible();
  expect(
    screen.getByText('Custody: Old closet label → Old site label'),
  ).toBeVisible();
  expect(screen.getByText('Custody quantity: 3 units')).toBeVisible();
  expect(screen.getByText('Ticket number reference: Ticket 001')).toBeVisible();
  expect(
    screen.getByText('Custody: Old closet label → Old site label'),
  ).toHaveClass('[overflow-wrap:anywhere]');
});
it.each([false, true])(
  'keeps site count correction summaries and expanded details free of transfer claims (compact=%s)',
  (compact) => {
    render(
      <HistoryList
        compact={compact}
        events={[
          {
            id: 'site-count',
            kind: 'quantity',
            entityId: 'item',
            entityName: 'Cable',
            eventType: 'site_corrected',
            at: '2026-10-07T12:00:00Z',
            actorName: 'Staff',
            reason: 'Count checked',
            assignment: {
              eventId: 'correction',
              kind: 'corrected',
              from: {
                locationId: null,
                siteId: 'site',
                label: 'Historical site',
              },
              to: { locationId: null, siteId: null, label: null },
              quantity: 5,
              reference: 'COUNT-1',
            },
            lines: [],
            fromLocation: null,
            toLocation: null,
            metadataChanges: [],
            customMetadataPresent: false,
            customMetadataChanged: false,
          },
        ]}
      />,
    );
    const row = screen
      .getByRole('heading', { name: 'Site custody corrected' })
      .closest('li');
    expect(row).toHaveTextContent('Count corrected at Historical site');
    expect(row).toHaveTextContent(
      'Custody: Count corrected at Historical site',
    );
    expect(row).toHaveTextContent('Reason: Count checked');
    expect(row).toHaveTextContent('Ticket number reference: COUNT-1');
    expect(row).not.toHaveTextContent('→');
    expect(row).not.toHaveTextContent('No recorded destination');
    expect(row).not.toHaveTextContent('Custody quantity:');
    expect(row).not.toHaveTextContent('5 units');
  },
);

it('keeps created snapshots and bounded custom history accessible behind compact event details', () => {
  render(
    <HistoryList
      compact
      events={[
        {
          id: 'created-event',
          kind: 'asset',
          entityId: 'asset',
          entityName: 'Original name',
          eventType: 'created',
          at: '2026-09-05T12:00:00Z',
          actorName: 'Original actor',
          reason: null,
          assignment: null,
          lines: [],
          fromLocation: null,
          toLocation: location,
          metadataChanges: [
            { field: 'Serial number', before: null, after: 'Original serial' },
          ],
          customMetadataPresent: true,
          customMetadataChanged: false,
        },
      ]}
    />,
  );
  expect(screen.getByText('Record created')).toBeVisible();
  expect(screen.getByText(/Original serial/)).not.toBeVisible();
  fireEvent.click(screen.getByText('View event details'));
  expect(screen.getByText(/Original serial/)).toBeVisible();
  expect(
    screen.getByRole('link', { name: /custom metadata/i }),
  ).toHaveAttribute('href', '/history?event=asset:created-event');
});
it('shows the recorded movement amount and endpoints before compact details while keeping actor and time', () => {
  const destination = {
    ...location,
    id: 'destination',
    breadcrumb: 'IT Closet / Drawer 2',
  };
  render(
    <HistoryList
      compact
      events={[
        {
          id: 'move',
          kind: 'quantity',
          entityId: 'item',
          entityName: 'Adapters',
          eventType: 'moved',
          at: '2026-09-05T12:00:00Z',
          actorName: 'Recorded Staff',
          reason: 'Restocking',
          assignment: null,
          fromLocation: location,
          toLocation: destination,
          lines: [
            { location, delta: -2, before: 99, after: 97 },
            { location: destination, delta: 2, before: 5, after: 7 },
          ],
          metadataChanges: [],
          customMetadataPresent: false,
          customMetadataChanged: false,
        },
      ]}
    />,
  );
  expect(
    screen.getByText(
      `2 units · ${location.breadcrumb} → ${destination.breadcrumb} (current location labels)`,
    ),
  ).toBeVisible();
  expect(screen.getByText(/Recorded Staff/)).toBeVisible();
  expect(screen.getByText('Reason: Restocking')).not.toBeVisible();
  fireEvent.click(screen.getByText('View event details'));
  expect(screen.getByText('Reason: Restocking')).toBeVisible();
});

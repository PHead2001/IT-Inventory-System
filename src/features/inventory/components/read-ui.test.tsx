import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import styles from './inventory-visual.module.css';
import type { InventoryResult, HistoryEvent } from '../contracts-ui';
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
it('main-history entity links retain exact event return anchors while detail timelines remain ordinary', () => {
  const id = '00000000-0000-4000-8000-000000000001',
    eventId = '00000000-0000-4000-8000-000000000002';
  const event: HistoryEvent = {
    id: eventId,
    kind: 'quantity',
    entityId: id,
    entityName: 'Scoped cable',
    eventType: 'created',
    at: '2026-10-13T10:00:00Z',
    actorName: 'Staff',
    reason: null,
    assignment: null,
    lines: [],
    fromLocation: null,
    toLocation: null,
    metadataChanges: [],
    customMetadataPresent: false,
    customMetadataChanged: false,
  };
  const page = render(
    <HistoryList
      events={[event]}
      returnTo="/history?type=quantity&location=ITC&page=2"
    />,
  );
  const link = screen.getByRole('link', { name: 'Scoped cable' });
  expect(link.closest('li')).toHaveAttribute(
    'id',
    'history-event-quantity-' + eventId,
  );
  expect(
    new URL(
      link.getAttribute('href')!,
      'https://inventory.invalid',
    ).searchParams.get('returnTo'),
  ).toBe(
    `/history?type=quantity&location=ITC&page=2#history-event-quantity-${eventId}`,
  );
  page.rerender(<HistoryList events={[event]} linkToEvent />);
  expect(screen.getByRole('link', { name: 'Scoped cable' })).toHaveAttribute(
    'href',
    '/inventory/quantity/' + id,
  );
});
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

it.each([
  { kind: 'quantity' as const, truncated: false },
  { kind: 'quantity' as const, truncated: true },
  { kind: 'asset' as const, truncated: false },
  { kind: 'asset' as const, truncated: true },
])(
  'preserves filtered result scope and each row anchor on $kind custom details with truncated=$truncated',
  ({ kind, truncated }) => {
    const returnTo = '/inventory?q=Cable&status=all&page=3';
    const rows = [0, 1].map((index) => ({
      kind,
      id: `record-${index}`,
      name: 'Cable',
      categoryName: 'Equipment',
      status: 'active',
      location: { ...location, id: `location-${index}` },
      quantity: kind === 'quantity' ? 2 : null,
      assetTag: null,
      serialNumber: null,
      recordedTotal: null,
      reorderThreshold: null,
      stockState: null,
      customPreview: {
        answers: [
          {
            label: 'Owner',
            type: 'text' as const,
            displayValue: 'IT',
            truncated: false,
          },
        ],
        truncated,
      },
    }));
    const { rerender } = render(
      <InventoryRows rows={rows} returnTo={returnTo} />,
    );
    const label = truncated ? 'View all details' : 'Full details';
    const pathname = `/inventory/${kind === 'quantity' ? 'quantity' : 'assets'}/record`;
    screen.getAllByRole('listitem').forEach((row, index) => {
      const details = within(row).getByRole('link', { name: label });
      const primary = within(row).getByRole('link', { name: 'Cable' });
      const url = new URL(
        details.getAttribute('href')!,
        'https://inventory.test',
      );
      expect(url.pathname).toBe(`${pathname}-${index}`);
      expect(url.searchParams.get('returnTo')).toBe(
        `${returnTo}#inventory-row-${index + 1}`,
      );
      expect(details.getAttribute('href')).toBe(primary.getAttribute('href'));
      expect(row).toHaveAttribute('id', `inventory-row-${index + 1}`);
    });
    rerender(<InventoryRows rows={rows} />);
    screen.getAllByRole('listitem').forEach((row, index) => {
      expect(within(row).getByRole('link', { name: label })).toHaveAttribute(
        'href',
        `${pathname}-${index}`,
      );
      expect(row).not.toHaveAttribute('id');
    });
  },
);

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
    screen.getByText(/On this page: 2 quantity rows with stock/),
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
        customSummary: 'Internal revision decoration must not render',
        customPreview: {
          answers: [
            {
              label: 'Description',
              type: 'text',
              displayValue: longSummary,
              truncated: true,
            },
          ],
          truncated: true,
        },
      }))}
    />,
  );
  expect(screen.getByText('2 units')).toBeVisible();
  expect(screen.getByText('3 units')).toBeVisible();
  expect(
    screen.queryByText(/Internal revision decoration/),
  ).not.toBeInTheDocument();
  expect(
    screen.getAllByRole('link', { name: 'View all details' }),
  ).toHaveLength(2);
  expect(
    screen.getAllByRole('link', { name: 'View all details' })[0],
  ).toHaveAttribute('href', '/inventory/quantity/item');
  expect(
    screen.getAllByText(
      (_, element) =>
        element?.textContent === 'Description: ' + longSummary + '…' &&
        element.children.length === 0,
    ),
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
    screen.getByRole('heading', { name: 'Details updated' }),
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
      .getByRole('heading', { name: 'Site count corrected' })
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
  expect(screen.getByRole('heading', { name: 'Created' })).toBeVisible();
  expect(screen.queryByText('Record created')).not.toBeInTheDocument();
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
      linkToEvent
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
          fromLocation: null,
          toLocation: null,
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
      `2 units · ${location.breadcrumb} → ${destination.breadcrumb}`,
    ),
  ).toBeVisible();
  expect(screen.getByText(/Recorded Staff/)).toBeVisible();
  expect(screen.getByText('Reason: Restocking')).not.toBeVisible();
  fireEvent.click(screen.getByText('View event details'));
  expect(screen.getByText('Reason: Restocking')).toBeVisible();
  expect(
    screen.getByText(/Storage location labels are current reference labels/),
  ).not.toBeVisible();
  fireEvent.click(screen.getByText('Technical event details'));
  expect(
    screen.getByText(/Storage location labels are current reference labels/),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Open recorded event' }),
  ).toHaveAttribute('href', '/history/events/quantity/move');
});
it('adds useful changed fields and omits summaries that merely repeat event headings', () => {
  const base = {
    id: 'retired',
    kind: 'asset' as const,
    entityId: 'asset',
    entityName: 'Switch',
    eventType: 'retired',
    at: '2026-10-07T12:00:00Z',
    actorName: 'Staff',
    reason: 'End of service',
    assignment: null,
    fromLocation: null,
    toLocation: null,
    lines: [],
    metadataChanges: [],
    customMetadataPresent: false,
    customMetadataChanged: false,
  };
  render(
    <HistoryList
      compact
      events={[
        base,
        {
          ...base,
          id: 'details',
          eventType: 'metadata_updated',
          metadataChanges: [
            { field: 'Name', before: 'Switch', after: 'Core switch' },
          ],
        },
        { ...base, id: 'corrected', eventType: 'location_corrected' },
      ]}
    />,
  );
  expect(screen.getAllByText('Asset retired')).toHaveLength(1);
  expect(screen.getAllByText('Recorded location corrected')).toHaveLength(1);
  expect(screen.getByText('Changed: Name')).toBeVisible();
  expect(screen.queryByText('Record details updated')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Open recorded event' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByText('View event details')[0]);
  expect(screen.getAllByText('Reason: End of service')[0]).toBeVisible();
});

const scopedRow: InventoryResult = {
  kind: 'quantity' as const,
  id: 'scoped-item',
  name: 'Adapters',
  categoryName: 'Parts',
  status: 'active',
  location,
  quantity: 3,
  assetTag: null,
  serialNumber: null,
  recordedTotal: 7,
  availableQuantity: '7',
  assignedQuantity: '2',
  ownedQuantity: '9',
  reorderThreshold: null,
  stockState: 'disabled',
};
it('omits only the current location from scoped rows while retaining child locations, sites and overall totals', () => {
  const child = {
    ...location,
    id: 'child',
    code: 'ITC-S4C',
    name: '4C',
    breadcrumb: 'IT Closet / Shelf 4 / 4C',
  };
  render(
    <InventoryRows
      currentLocationId={location.id}
      rows={[
        scopedRow,
        { ...scopedRow, location: child, quantity: 4 },
        {
          ...scopedRow,
          location: null,
          site: {
            id: 'site',
            code: 'A',
            name: 'Example Property',
          },
          quantity: 2,
        },
      ]}
    />,
  );
  const rows = screen.getAllByRole('listitem');
  expect(rows[0].querySelector(`.${styles.rowGrid}`)).toHaveClass(
    styles.rowGridWithoutLocation,
  );
  expect(rows[1].querySelector(`.${styles.rowGrid}`)).not.toHaveClass(
    styles.rowGridWithoutLocation,
  );
  expect(rows[2].querySelector(`.${styles.rowGrid}`)).not.toHaveClass(
    styles.rowGridWithoutLocation,
  );
  expect(
    within(rows[0]).queryByText('Storage / custody'),
  ).not.toBeInTheDocument();
  expect(
    within(rows[0]).queryByRole('link', { name: /ITC-S4B/ }),
  ).not.toBeInTheDocument();
  expect(within(rows[0]).getByText('3 units')).toBeVisible();
  expect(
    within(rows[0]).getByText('Overall totals: 2 assigned · 9 recorded'),
  ).toBeVisible();
  expect(
    within(rows[1]).getByRole('link', {
      name: 'IT Closet / Shelf 4 / 4C (ITC-S4C)',
    }),
  ).toHaveAttribute('href', '/locations/ITC-S4C');
  expect(
    within(rows[2]).getByRole('link', { name: /Assigned to Example Property/ }),
  ).toHaveAttribute('href', '/sites/A');
});
it('keeps informative aggregate counts while suppressing redundant one-row location counts', () => {
  const view = render(
    <InventoryCount
      compact
      result={{ rows: [scopedRow], total: 1, page: 1, pageSize: 25 }}
    />,
  );
  expect(screen.getByText('1 matching row')).toBeVisible();
  expect(
    screen.queryByText(/On this page|Distinct quantity products/),
  ).not.toBeInTheDocument();
  view.rerender(
    <InventoryCount
      compact
      result={{
        rows: [
          scopedRow,
          { ...scopedRow, location: { ...location, id: 'child' } },
        ],
        total: 2,
        page: 1,
        pageSize: 25,
      }}
    />,
  );
  expect(
    screen.getByText(/On this page: 2 quantity rows with stock/),
  ).toBeVisible();
  expect(
    screen.getByText(/Distinct quantity products on this page: 1/),
  ).toBeVisible();
  view.rerender(
    <InventoryCount
      compact
      result={{
        rows: [scopedRow, { ...scopedRow, id: 'different-item' }],
        total: 2,
        page: 1,
        pageSize: 25,
      }}
    />,
  );
  expect(
    screen.queryByText(/Distinct quantity products/),
  ).not.toBeInTheDocument();
});

it('keeps page-local counts when a location has more results beyond a single-row page', () => {
  render(
    <InventoryCount
      compact
      result={{ rows: [scopedRow], total: 26, page: 2, pageSize: 25 }}
    />,
  );
  expect(screen.getByText('26 matching rows')).toBeVisible();
  expect(
    screen.getByText(/On this page: 1 quantity row with stock/),
  ).toBeVisible();
});

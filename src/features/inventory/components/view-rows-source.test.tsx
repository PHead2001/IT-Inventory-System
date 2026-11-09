import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type {
  InventorySource,
  HoldingIdentity,
} from '@/components/experience/route-motion-state';
import { InventoryViewRows } from './view-rows';
const captured: Array<{
  source?: InventorySource;
  holding?: HoldingIdentity | null;
}> = [];
vi.mock('@/components/experience/record-transition', () => ({
  InventoryRecordLink: ({
    children,
    source,
    holding,
    href,
  }: {
    children: React.ReactNode;
    source?: InventorySource;
    holding?: HoldingIdentity | null;
    href: string;
  }) => {
    captured.push({ source, holding });
    return <a href={href}>{children}</a>;
  },
}));
vi.mock('@/features/room/show-in-room', () => ({ ShowInRoom: () => null }));
const id = '00000000-0000-4000-8000-000000000001';
const row = {
  kind: 'quantity' as const,
  id,
  name: 'Cable',
  categoryName: 'Cables',
  status: 'active',
  location: null,
  quantity: 0,
  assetTag: null,
  serialNumber: null,
  recordedTotal: null,
  reorderThreshold: null,
  stockState: null,
};
it.each([0, 1, 3])(
  'keeps an item aggregate source with %s holdings without inventing a holding',
  (count) => {
    captured.length = 0;
    const view = render(
      <InventoryViewRows
        result={{
          rows: [
            {
              row,
              holdings: Array.from({ length: count }, (_, index) => ({
                ...row,
                location: {
                  id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
                  code: `ITC-S1${String.fromCharCode(65 + index)}`,
                  name: `Shelf 1${String.fromCharCode(65 + index)}`,
                  breadcrumb: `IT Closet / Shelf 1${String.fromCharCode(65 + index)}`,
                  active: true,
                  can_hold_inventory: true,
                  parentId: null,
                },
                quantity: 1,
              })),
              scopedStorage: String(count),
              scopedSite: '0',
              holdingCount: count,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          unit: 'item',
          holdingRows: count,
        }}
        preferences={{ view: 'items', density: 'comfortable', columns: [] }}
        returnTo="/inventory?view=items&density=comfortable"
      />,
    );
    expect(captured.at(-1)).toEqual({
      source: { kind: 'inventory-aggregate' },
      holding: undefined,
    });
    expect(
      screen.getByRole('link', { name: 'Cable' }).closest('li'),
    ).toHaveClass('experience-spotlight');
    view.unmount();
  },
);
it.each(['items', 'holdings'] as const)(
  'binds location title %s to the explicit view and exact location',
  (mode) => {
    captured.length = 0;
    const view = render(
      <InventoryViewRows
        result={{
          rows: [
            {
              row,
              holdings: [row],
              scopedStorage: '0',
              scopedSite: '0',
              holdingCount: 1,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          unit: mode === 'items' ? 'item' : 'holding row',
          holdingRows: 1,
        }}
        preferences={{ view: mode, density: 'comfortable', columns: [] }}
        currentLocationCode="ITC-S4B"
        returnTo={'/locations/ITC-S4B?density=comfortable&view=' + mode}
      />,
    );
    expect(captured.at(-1)).toEqual({
      source: {
        kind: 'location-inventory',
        locationCode: 'ITC-S4B',
        occurrence:
          mode === 'items'
            ? { kind: 'aggregate' }
            : { kind: 'holding', holding: { domain: 'unplaced' } },
      },
      holding: undefined,
    });
    view.unmount();
  },
);

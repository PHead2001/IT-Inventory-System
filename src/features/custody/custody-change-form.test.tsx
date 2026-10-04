import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustodyChangeForm } from './custody-change-form';
import { submitCustody } from './actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ submitCustody: vi.fn() }));
vi.mock('@/features/locations/location-picker', () => ({
  LocationPicker: ({
    label,
    onValueChange,
  }: {
    label: string;
    onValueChange: (value: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onValueChange('00000000-0000-4000-8000-000000000003')}
    >
      {label}
    </button>
  ),
}));
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const location = {
  id: id(2),
  code: 'ITO-GENERAL',
  name: 'General Storage / Unsorted',
  breadcrumb: 'IT Office / General Storage / Unsorted',
  active: true,
  can_hold_inventory: true,
  parentId: id(9),
};
const site = {
  id: id(4),
  code: 'PROPERTY-A',
  name: 'Example Property',
  notes: null,
  active: true,
  version: '1',
};
const otherSite = {
  ...site,
  id: id(5),
  code: 'PROPERTY-B',
  name: 'Other Property',
};
beforeEach(() => vi.mocked(submitCustody).mockReset());

it('explains absent sites and disables only the unavailable assignment', () => {
  render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[]}
      currentLocation={location}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Assign asset to a site' }),
  ).toBeDisabled();
  expect(screen.getByText(/No sites are configured/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /site settings/i })).toBeNull();
  expect(submitCustody).not.toHaveBeenCalled();
});

it('offers existing site settings only to a maintainer and distinguishes inactive configuration', () => {
  const view = render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[]}
      currentLocation={location}
      canManageConfiguration
    />,
  );
  expect(
    screen.getByRole('link', { name: 'Open site settings' }),
  ).toHaveAttribute('href', '/settings/sites');
  view.rerender(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[{ ...site, active: false }]}
      currentLocation={location}
    />,
  );
  expect(screen.getByText(/No active sites/)).toBeVisible();
  expect(screen.queryByText(/No sites are configured/)).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open site settings' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Assign asset to a site' }),
  ).toBeDisabled();
});

it('distinguishes a transfer with no other destination and leaves an archived-site return available', () => {
  const view = render(
    <CustodyChangeForm
      kind="asset"
      action="transfer"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[site]}
      currentSite={site}
    />,
  );
  expect(screen.getByText(/No other active site/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Transfer between sites' }),
  ).toBeDisabled();
  view.rerender(
    <CustodyChangeForm
      kind="asset"
      action="return"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[{ ...site, active: false }]}
      currentSite={site}
    />,
  );
  expect(
    screen
      .getAllByRole('button', { name: 'Return to storage' })
      .find((button) => button.getAttribute('type') === 'submit'),
  ).toBeEnabled();
  expect(screen.queryByText(/No active sites/)).toBeNull();
});

it('assigns an asset from its authoritative storage source without duplicating a current drawer', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(1),
    version: '2',
    changed: true,
  });
  render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[site]}
      currentLocation={location}
    />,
  );
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: site.id },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Assign asset to a site' }),
  );
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'asset_site_change',
    payload: {
      action: 'assign',
      asset_id: id(1),
      expected_version: '1',
      source_location_id: location.id,
      destination_site_id: site.id,
    },
  });
  const payload = (
    vi.mocked(submitCustody).mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }
  ).payload;
  expect(payload).not.toHaveProperty('destination_location_id');
});

it('transfers only the specified site-held quantity with stable version and no storage delta', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(1),
    version: '8',
    changed: true,
  });
  const holding = {
    site_id: site.id,
    site_code: site.code,
    site_name: site.name,
    site_active: true,
    inventory_kind: 'quantity' as const,
    entity_id: id(1),
    name: 'Adapters',
    category_name: 'Parts',
    manufacturer: null,
    model: null,
    quantity: 3,
    asset_tag: null,
    serial_number: null,
  };
  render(
    <CustodyChangeForm
      kind="quantity"
      action="transfer"
      entityId={id(1)}
      version="7"
      locations={[location]}
      sites={[site, otherSite]}
      siteHoldings={[holding]}
    />,
  );
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: otherSite.id },
  });
  fireEvent.change(screen.getByLabelText('Units'), { target: { value: '2' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Transfer between sites' }),
  );
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  const payload = (
    vi.mocked(submitCustody).mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }
  ).payload;
  expect(payload).toMatchObject({
    action: 'transfer',
    item_id: id(1),
    expected_version: '7',
    source_site_id: site.id,
    destination_site_id: otherSite.id,
    quantity: 2,
  });
  expect(payload).not.toHaveProperty('source_location_id');
  expect(payload).not.toHaveProperty('destination_location_id');
});

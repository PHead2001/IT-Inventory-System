import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustodyChangeForm } from './custody-change-form';
import { submitCustody } from './actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ submitCustody: vi.fn() }));

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const rack = {
  id: id(1),
  code: 'ITC-RACK',
  name: 'Server Rack',
  breadcrumb: 'IT Closet / Server Rack',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
const drawer = {
  ...rack,
  id: id(2),
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'IT Closet / Drawer 1',
};
const site = {
  id: id(3),
  code: 'PROPERTY-A',
  name: 'Fictional Property',
  notes: null,
  active: true,
  version: '1',
};

beforeEach(() => vi.mocked(submitCustody).mockReset());

it('real source picker accepts the asset current storage location without quantity balances and excludes other locations', async () => {
  const user = userEvent.setup();
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(4),
    version: '8',
    changed: true,
  });
  render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(4)}
      version="7"
      locations={[rack, drawer]}
      sites={[site]}
      currentLocation={rack}
    />,
  );
  const source = screen.getByLabelText('Storage source', { exact: true });
  expect(source).toHaveTextContent('Server Rack');
  expect(source).toHaveAttribute('aria-invalid', 'false');
  expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  await user.click(source);
  const search = screen.getByRole('combobox', { name: 'Search locations' });
  await user.type(search, 'ITC-D01');
  expect(
    screen.queryByRole('option', { name: /Drawer 1/ }),
  ).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'ITC-RACK');
  expect(
    await screen.findByRole('option', { name: /Server Rack/ }),
  ).toBeVisible();
  await user.keyboard('{Escape}');
  await user.selectOptions(screen.getByLabelText('Destination site'), site.id);
  await user.click(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  );
  expect(submitCustody).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Confirm assign asset to a site' }),
  );
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    payload: {
      asset_id: id(4),
      expected_version: '7',
      source_location_id: rack.id,
      destination_site_id: site.id,
    },
  });
});

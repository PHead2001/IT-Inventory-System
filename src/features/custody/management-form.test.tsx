import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocationManagementForm, SiteManagementForm } from './management-form';
import { submitCustody } from './actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ submitCustody: vi.fn() }));
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const room = {
  id: id(1),
  code: 'ITO',
  name: 'IT Office',
  parent_id: null,
  kind: 'room',
  can_hold_inventory: false,
  active: true,
  sort_order: 0,
  version: '1',
};
const area = {
  id: id(2),
  code: 'ITO-GENERAL',
  name: 'General Storage / Unsorted',
  parent_id: room.id,
  kind: 'storage_area',
  can_hold_inventory: true,
  active: true,
  sort_order: 1,
  version: '1',
};
beforeEach(() => vi.mocked(submitCustody).mockReset());

it('suggests a site code from its name and submits that visible suggestion', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: false,
    code: 'P1007',
    message: 'That permanent code is already in use.',
  });
  render(<SiteManagementForm />);
  const name = screen.getByLabelText('Name');
  const code = screen.getByLabelText('Permanent code', { exact: true });
  expect(
    name.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.change(name, { target: { value: 'Oak Creek Apartments' } });
  expect(code).toHaveValue('OAK-CREEK-APARTMENTS');
  fireEvent.submit(
    screen
      .getByRole('heading', { name: 'Add property / site' })
      .closest('form')!,
  );

  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'site_create',
    payload: { code: 'OAK-CREEK-APARTMENTS', name: 'Oak Creek Apartments' },
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'That permanent code is already in use.',
  );
});

it('keeps a nonempty manual code through name edits and restores the suggestion when cleared', () => {
  render(<SiteManagementForm />);
  const name = screen.getByLabelText('Name');
  const code = screen.getByLabelText('Permanent code', { exact: true });
  fireEvent.change(name, { target: { value: 'Oak Creek Apartments' } });
  fireEvent.change(code, { target: { value: 'CUSTOM-42' } });
  fireEvent.change(name, { target: { value: 'Renamed Property' } });
  expect(code).toHaveValue('CUSTOM-42');

  fireEvent.change(code, { target: { value: '' } });
  expect(code).toHaveValue('RENAMED-PROPERTY');
});

it('leaves an invalid name without a suggestion so a valid code must be entered manually', () => {
  render(<SiteManagementForm />);
  const code = screen.getByLabelText('Permanent code', { exact: true });
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: '123 Oak Creek' },
  });
  expect(code).toHaveValue('');
  expect(code).toBeRequired();
  fireEvent.change(code, { target: { value: 'SITE-123' } });
  expect(code).toHaveValue('SITE-123');
});

it('deactivates an empty logical destination without erasing its future destination capability', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: area.id,
    version: '2',
    changed: true,
  });
  render(<LocationManagementForm location={area} locations={[room, area]} />);
  fireEvent.click(screen.getByLabelText('Active location'));
  fireEvent.click(
    screen.getByLabelText(/All stock and assets have been moved/),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'location_update',
    payload: {
      location_id: area.id,
      expected_version: '1',
      active: false,
      can_hold_inventory: true,
    },
  });
});

it('does not offer modeled closet parent, kind, capability, or active changes', () => {
  const modeled = { ...area, code: 'ITC-S1A' };
  render(
    <LocationManagementForm location={modeled} locations={[room, modeled]} />,
  );
  expect(screen.getByLabelText('Parent location')).toBeDisabled();
  expect(screen.getByLabelText('Kind')).toBeDisabled();
  expect(screen.getByLabelText('Can hold inventory')).toBeDisabled();
  expect(screen.getByLabelText('Active location')).toBeDisabled();
});

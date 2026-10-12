import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationPicker } from './location-picker';
import type { LocationRef } from '../inventory/contracts-ui';
vi.mock('next/dynamic', () => ({
  default:
    () =>
    ({ onUse, onClose }: { onUse(code: string): void; onClose(): void }) => (
      <div>
        <button type="button" onClick={() => onUse('ITC-D01')}>
          Use staged drawer
        </button>
        <button type="button" onClick={onClose}>
          Cancel map
        </button>
      </div>
    ),
}));
const location: LocationRef = {
  id: 'drawer-uuid',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'Closet / Drawer 1',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
it('map and tree fill the same UUID successful control without submitting or discarding other fields', async () => {
  const user = userEvent.setup(),
    change = vi.fn(),
    submit = vi.fn();
  const props = {
    locations: [location],
    mode: 'destination' as const,
    label: 'Destination',
    name: 'location',
    onValueChange: change,
  };
  const view = render(
    <form onSubmit={submit}>
      <input aria-label="Reason" defaultValue="Keep this draft" />
      <LocationPicker {...props} />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  await user.click(screen.getByRole('button', { name: 'Cancel map' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Reason')).toHaveValue('Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).toHaveBeenLastCalledWith(location.id);
  expect(
    new FormData(view.container.querySelector('form')!).get('location'),
  ).toBe(location.id);
  expect(submit).not.toHaveBeenCalled();
  view.unmount();
  render(<LocationPicker {...props} />);
  await user.click(screen.getByRole('combobox', { name: 'Destination' }));
  await user.click(screen.getByRole('treeitem', { name: /Drawer 1/ }));
  expect(change).toHaveBeenLastCalledWith(location.id);
});
it('confirmation rechecks refreshed eligibility and parent pending state', async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  const props = {
    locations: [location],
    mode: 'destination' as const,
    label: 'Destination',
    onValueChange: change,
  };
  const view = render(<LocationPicker {...props} />);
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  view.rerender(<LocationPicker {...props} excludeIds={[location.id]} />);
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).not.toHaveBeenCalled();
  view.rerender(<LocationPicker {...props} disabled />);
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).not.toHaveBeenCalled();
});

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SettingsLocationTree } from './settings-location-tree';

const root = {
  id: 'root',
  name: 'IT Closet',
  code: 'ITC',
  parent_id: null,
  sort_order: 0,
  active: true,
  can_hold_inventory: false,
  version: '1',
  kind: 'room',
};
const leaf = {
  ...root,
  id: 'drawer',
  name: 'Drawer 7',
  code: 'ITC-D07',
  parent_id: 'root',
  can_hold_inventory: true,
  kind: 'drawer',
};
it('shares hierarchy order, supports keyboard collapse and full-path search without changing codes', () => {
  render(<SettingsLocationTree locations={[leaf, root]} />);
  const rows = screen.getAllByRole('treeitem');
  expect(rows[0]).toHaveTextContent('IT Closet');
  expect(rows[1]).toHaveAttribute('aria-level', '2');
  fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
  expect(rows[1]).toHaveFocus();
  fireEvent.keyDown(rows[1], { key: 'ArrowLeft' });
  expect(rows[0]).toHaveFocus();
  fireEvent.keyDown(rows[0], { key: 'ArrowLeft' });
  expect(screen.getAllByRole('treeitem')).toHaveLength(1);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'IT Closet / Drawer' },
  });
  expect(screen.getByRole('link', { name: /Drawer 7/ })).toHaveAttribute(
    'href',
    '/settings/locations/ITC-D07',
  );
  expect(screen.getByText('1 matching locations')).toBeVisible();
});

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

it('uses one tree Tab stop while arrow keys expose children and pointer collapse returns focus to its treeitem', async () => {
  const user = userEvent.setup();
  render(
    <>
      <SettingsLocationTree locations={[root, leaf]} />
      <button>After locations</button>
    </>,
  );
  const parent = screen.getAllByRole('treeitem')[0];
  await user.tab();
  expect(screen.getByRole('searchbox')).toHaveFocus();
  await user.tab();
  expect(parent).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard('{ArrowRight}{ArrowRight}');
  expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After locations' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Collapse IT Closet' }));
  expect(parent).toHaveFocus();
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.queryByRole('treeitem', { name: /Drawer 7/ }),
  ).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After locations' })).toHaveFocus();
});

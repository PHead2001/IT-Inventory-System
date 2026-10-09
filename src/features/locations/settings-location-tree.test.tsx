import { fireEvent, render, screen, within } from '@testing-library/react';
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
  expect(within(rows[1]).getByRole('link')).toHaveFocus();
  fireEvent.keyDown(rows[1], { key: 'ArrowLeft' });
  expect(within(rows[0]).getByRole('link')).toHaveFocus();
  fireEvent.keyDown(rows[0], { key: 'ArrowLeft' });
  expect(screen.getAllByRole('treeitem')).toHaveLength(1);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'IT Closet / Drawer' },
  });
  expect(
    within(screen.getByRole('treeitem', { name: /Drawer 7/ })).getByRole(
      'link',
    ),
  ).toHaveAttribute('href', '/settings/locations/ITC-D07');
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
  expect(within(parent).getByRole('link')).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard('{ArrowRight}{ArrowRight}');
  expect(
    within(screen.getByRole('treeitem', { name: /Drawer 7/ })).getByRole(
      'link',
    ),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After locations' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Collapse IT Closet' }));
  expect(within(parent).getByRole('link')).toHaveFocus();
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.queryByRole('treeitem', { name: /Drawer 7/ }),
  ).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After locations' })).toHaveFocus();
});

const group = {
  ...root,
  id: 'group',
  name: 'Right Storage',
  code: 'ITC-R',
  parent_id: root.id,
};
const deepLeaf = { ...leaf, parent_id: group.id };
it('collapses below the first level and reveals search ancestors without losing the browsing expansion', () => {
  render(<SettingsLocationTree locations={[deepLeaf, group, root]} />);
  expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  expect(
    screen.getByRole('treeitem', { name: /^Right Storage/ }),
  ).toHaveAttribute('aria-expanded', 'false');
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'ITC-D07' },
  });
  expect(screen.getAllByRole('treeitem')).toHaveLength(3);
  expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toHaveAttribute(
    'aria-level',
    '3',
  );
  expect(
    screen.getByRole('treeitem', { name: /^Right Storage/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  expect(
    screen.queryByRole('treeitem', { name: /Drawer 7/ }),
  ).not.toBeInTheDocument();
});
it('reveals the selected location ancestors with a single selected tree Tab stop', async () => {
  const user = userEvent.setup();
  render(
    <SettingsLocationTree
      locations={[deepLeaf, group, root]}
      selectedCode="ITC-D07"
    />,
  );
  const selected = screen.getByRole('treeitem', { name: /Drawer 7/ });
  expect(selected).toHaveAttribute('aria-selected', 'true');
  expect(selected).not.toHaveAttribute('aria-current');
  await user.tab();
  await user.tab();
  expect(within(selected).getByRole('link')).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(
    within(screen.getByRole('treeitem', { name: /^Right Storage/ })).getByRole(
      'link',
    ),
  ).toHaveFocus();
});

it('keeps search branch controls truthful and search expansion separate from browsing', () => {
  render(<SettingsLocationTree locations={[deepLeaf, group, root]} />);
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'ITC-R' } });
  expect(
    screen.getByRole('treeitem', { name: /^Right Storage/ }),
  ).not.toHaveAttribute('aria-expanded');
  fireEvent.change(search, { target: { value: 'ITC-D07' } });
  const parent = screen.getByRole('treeitem', { name: /^Right Storage/ });
  within(parent).getByRole('link').focus();
  fireEvent.keyDown(parent, { key: 'ArrowLeft' });
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  expect(within(parent).getByRole('link')).toHaveFocus();
  expect(
    screen.queryByRole('treeitem', { name: /Drawer 7/ }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(parent, { key: 'ArrowRight' });
  expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toBeVisible();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  expect(
    screen.getByRole('treeitem', { name: /^Right Storage/ }),
  ).toHaveAttribute('aria-expanded', 'false');
});

it.each(['', 'ITC-D07'])(
  'owns disclosures inside named treeitems in browse/search (%s), preserving one native link Tab stop',
  async (query) => {
    const user = userEvent.setup();
    render(
      <>
        <SettingsLocationTree locations={[root, group, deepLeaf]} />
        <button>After tree</button>
      </>,
    );
    if (query) await user.type(screen.getByRole('searchbox'), query);
    const row = screen.getByRole('treeitem', { name: /^Right Storage/ });
    const disclosure = within(row).getByRole('button', {
      name: `${query ? 'Collapse' : 'Expand'} Right Storage`,
    });
    expect(disclosure.closest('[role="treeitem"]')).toBe(row);
    const link = within(row).getByRole('link');
    expect(link).toHaveAttribute('href', '/settings/locations/ITC-R');
    await user.click(disclosure);
    expect(link).toHaveFocus();
    expect(row).toHaveAttribute('aria-expanded', query ? 'false' : 'true');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(
      within(screen.getByRole('treeitem', { name: /Drawer 7/ })).getByRole(
        'link',
      ),
    ).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(link).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After tree' })).toHaveFocus();
  },
);

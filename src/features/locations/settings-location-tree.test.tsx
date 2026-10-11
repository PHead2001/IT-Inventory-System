import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
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

const group = {
  ...root,
  id: 'group',
  name: 'Right Storage',
  code: 'ITC-R',
  parent_id: root.id,
};
const deepLeaf = { ...leaf, parent_id: group.id };
it('enters a searched tree at its ancestor and reaches the match with arrows before native link activation', async () => {
  const user = userEvent.setup();
  render(<SettingsLocationTree locations={[root, leaf]} />);
  await user.type(screen.getByRole('searchbox'), 'ITC-D07');
  const ancestor = screen.getByRole('treeitem', { name: /^IT Closet/ });
  const match = screen.getByRole('treeitem', { name: /^Drawer 7/ });
  await user.tab();
  expect(ancestor).toHaveFocus();
  expect(match).toHaveAttribute('tabindex', '-1');
  await user.keyboard('{ArrowDown}');
  expect(match).toHaveFocus();
  expect(match).toHaveAttribute('tabindex', '0');
  expect(within(match).getByRole('link')).toHaveAttribute(
    'href',
    '/settings/locations/ITC-D07',
  );
});

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
  expect(selected).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(
    screen.getByRole('treeitem', { name: /^Right Storage/ }),
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
  parent.focus();
  fireEvent.keyDown(parent, { key: 'ArrowLeft' });
  expect(parent).toHaveAttribute('aria-expanded', 'false');
  expect(parent).toHaveFocus();
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
  'owns disclosures inside named treeitems in browse/search (%s), preserving one semantic tree Tab stop',
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
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute('aria-expanded', query ? 'false' : 'true');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(row).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After tree' })).toHaveFocus();
  },
);

it('keeps semantic focus and tree state together through arrows, Home/End and native Enter activation', async () => {
  const user = userEvent.setup();
  render(
    <SettingsLocationTree
      locations={[root, group, deepLeaf]}
      selectedCode="ITC-D07"
    />,
  );
  const parent = screen.getByRole('treeitem', { name: /^IT Closet/ });
  const branch = screen.getByRole('treeitem', { name: /^Right Storage/ });
  const selected = screen.getByRole('treeitem', { name: /^Drawer 7/ });
  const link = within(selected).getByRole('link');
  const activate = vi.fn((event: Event) => event.preventDefault());
  link.addEventListener('click', activate);
  await user.tab();
  await user.tab();
  expect(selected).toHaveFocus();
  expect(selected).toHaveAttribute('aria-level', '3');
  expect(selected).toHaveAttribute('aria-selected', 'true');
  expect(link).toHaveAttribute('tabindex', '-1');
  expect(
    screen.getAllByRole('treeitem').filter((row) => row.tabIndex === 0),
  ).toEqual([selected]);
  await user.keyboard('{ArrowLeft}');
  expect(branch).toHaveFocus();
  expect(branch).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Home}');
  expect(parent).toHaveFocus();
  await user.keyboard('{End}');
  expect(selected).toHaveFocus();
  expect(activate).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(activate).toHaveBeenCalledOnce();
  expect(selected).toHaveFocus();
  expect(link).toHaveAttribute('href', '/settings/locations/ITC-D07');
  // Descendant Enter keeps its ordinary native path rather than triggering
  // the row's synthetic activation a second time.
  fireEvent.keyDown(link, { key: 'Enter' });
  expect(activate).toHaveBeenCalledOnce();
});

it('preserves native anchor pointer, middle and modifier events while keeping its treeitem focused', async () => {
  const user = userEvent.setup();
  render(<SettingsLocationTree locations={[root, leaf]} />);
  const row = screen.getByRole('treeitem', { name: /^Drawer 7/ });
  const link = within(row).getByRole('link');
  const clicks: MouseEvent[] = [];
  const auxiliary: MouseEvent[] = [];
  link.addEventListener('click', (event) => {
    event.preventDefault();
    clicks.push(event);
  });
  link.addEventListener('auxclick', (event) => {
    event.preventDefault();
    auxiliary.push(event);
  });
  await user.click(link);
  expect(row).toHaveFocus();
  expect(clicks).toHaveLength(1);
  fireEvent.click(link, { ctrlKey: true });
  fireEvent.click(link, { metaKey: true });
  fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  expect(clicks.map((event) => [event.ctrlKey, event.metaKey])).toEqual([
    [false, false],
    [true, false],
    [false, true],
  ]);
  expect(auxiliary).toHaveLength(1);
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(clicks).toHaveLength(4);
  expect(clicks[3].ctrlKey).toBe(true);
  expect(link).toHaveAttribute('href', '/settings/locations/ITC-D07');
});

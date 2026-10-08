import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import { LocationPicker } from './location-picker';

const root: LocationRef = {
  id: 'root',
  code: 'ITC',
  name: 'IT Closet',
  breadcrumb: 'IT Closet',
  parentId: null,
  active: true,
  can_hold_inventory: false,
};
const drawer: LocationRef = {
  id: 'drawer',
  code: 'ITC-D07',
  name: 'Drawer 7',
  breadcrumb: 'IT Closet / Right Storage / Drawer 7',
  parentId: 'root',
  active: true,
  can_hold_inventory: true,
};
const secondDrawer: LocationRef = {
  ...drawer,
  id: 'drawer-10',
  code: 'ITC-D10',
  name: 'Drawer 10',
  breadcrumb: 'IT Closet / Right Storage / Drawer 10',
};
const right: LocationRef = {
  ...root,
  id: 'right',
  code: 'ITC-R',
  name: 'Right Storage',
  breadcrumb: 'IT Closet / Right Storage',
  parentId: 'root',
};
const nestedDrawer = { ...drawer, parentId: 'right' };
const nestedSecondDrawer = { ...secondDrawer, parentId: 'right' };
const thirdDrawer: LocationRef = {
  ...drawer,
  id: 'drawer-11',
  code: 'ITC-D11',
  name: 'Drawer 11',
};
const left: LocationRef = {
  ...right,
  id: 'left',
  code: 'ITC-L',
  name: 'Left Storage',
  breadcrumb: 'IT Closet / Left Storage',
};
const leftDrawer: LocationRef = {
  ...drawer,
  id: 'left-drawer',
  code: 'ITC-D01',
  name: 'Drawer 1',
  parentId: 'left',
  breadcrumb: 'IT Closet / Left Storage / Drawer 1',
};

describe('LocationPicker', () => {
  it('uses opaque tree DOM IDs while preserving keyboard aria relationships', async () => {
    const user = userEvent.setup();
    const uuid = '00000000-0000-4000-8000-000000000001';
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, { ...drawer, id: uuid }]}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const activeId = search.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toBe(
      screen.getByRole('treeitem', { name: /Drawer 7/ }),
    );
    expect(
      [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .join(' '),
    ).not.toContain(uuid);
  });
  it('searches and selects by keyboard without submitting the parent form; Escape returns focus', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <LocationPicker
          mode="browse"
          label="Location"
          locations={[root, drawer]}
          name="location"
          allowAll
        />
      </form>,
    );
    await user.click(screen.getByLabelText('Location'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    expect(search).toHaveFocus();
    await user.type(search, 'itc-d07{Enter}');
    expect(screen.getByLabelText('Location')).toHaveTextContent('Drawer 7');
    expect(document.querySelector('input[name="location"]')).toHaveValue(
      'ITC-D07',
    );
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Location'));
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Location')).toHaveFocus();
  });
  it('shows unavailable controlled values and leaves the draft unchanged', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, drawer]}
        value="drawer"
        onValueChange={changed}
        excludeIds={['drawer']}
        required
      />,
    );
    expect(screen.getByLabelText('Destination')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.getByLabelText('Destination')).toHaveTextContent('Drawer 7');
    await user.click(screen.getByLabelText('Destination'));
    expect(
      screen.queryByRole('treeitem', { name: /Drawer 7/ }),
    ).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });
  it('distinguishes All locations from the real root', async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        allowAll
        name="location"
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('treeitem', { name: /^IT Closet/ }));
    expect(document.querySelector('input[name="location"]')).toHaveValue('ITC');
    await user.click(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('treeitem', { name: /All locations/ }));
    expect(document.querySelector('input[name="location"]')).toHaveValue('');
  });
  it('does not select hidden results or submit the form while loading or failed', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const changed = vi.fn();
    const view = render(
      <form onSubmit={submit}>
        <LocationPicker
          mode="browse"
          label="Location"
          locations={[root, drawer]}
          onValueChange={changed}
          loading
        />
      </form>,
    );
    await user.click(screen.getByLabelText('Location'));
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    view.rerender(
      <form onSubmit={submit}>
        <LocationPicker
          mode="browse"
          label="Location"
          locations={[root, drawer]}
          onValueChange={changed}
          loadError="Locations could not be loaded"
        />
      </form>,
    );
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('clamps keyboard selection when available results shrink', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        onValueChange={changed}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    await user.keyboard('{ArrowDown}');
    view.rerender(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root]}
        onValueChange={changed}
      />,
    );
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledWith('ITC');
  });
  it('closes from any focused option with Escape and lets Tab leave the picker', async () => {
    const user = userEvent.setup();
    render(
      <>
        <LocationPicker
          mode="browse"
          label="Location"
          locations={[root, drawer]}
        />
        <button type="button">After picker</button>
      </>,
    );
    await user.click(screen.getByLabelText('Location'));
    await user.tab();
    expect(screen.getByRole('treeitem', { name: /^IT Closet/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Location')).toHaveFocus();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Location'));
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After picker' })).toHaveFocus();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
  it('shows compact tree rows and full breadcrumbs only in search results', async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, right, nestedDrawer]}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    await user.click(
      screen
        .getByRole('treeitem', { name: /Right Storage/ })
        .querySelector('[data-disclosure]')!,
    );
    expect(
      screen.getByRole('treeitem', {
        name: /Drawer 7, selectable location, ITC-D07/,
      }),
    ).toBeVisible();
    expect(screen.getByRole('tree')).not.toHaveTextContent(
      'IT Closet / Right Storage / Drawer 7',
    );
    await user.type(
      screen.getByRole('combobox', { name: 'Search locations' }),
      'D07',
    );
    expect(screen.getByRole('listbox')).toHaveTextContent(
      'IT Closet / Right Storage / Drawer 7',
    );
    await user.click(screen.getByRole('option', { name: /Drawer 7/ }));
    expect(screen.getByLabelText('Location')).toHaveTextContent('Drawer 7');
    expect(screen.getByLabelText('Location')).not.toHaveTextContent(
      'IT Closet / Right Storage',
    );
  });
  it('uses chevrons to disclose branches without selecting browse aggregates', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[nestedDrawer, right, root]}
        onValueChange={changed}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    expect(screen.getByText('Choose location')).toBeVisible();
    const room = screen.getByRole('treeitem', { name: /IT Closet/ });
    expect(room).toHaveAttribute('aria-expanded', 'true');
    await user.click(room.querySelector('[data-disclosure]')!);
    expect(room).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('treeitem', { name: /Right Storage/ }),
    ).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('treeitem', { name: /Right Storage/ }),
    ).toBeVisible();
    await user.click(room);
    expect(changed).toHaveBeenCalledWith('ITC');
  });
  it('keeps mutation ancestors as navigation rows and selects only eligible UUIDs', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[nestedDrawer, right, root]}
        onValueChange={changed}
        required
      />,
    );
    await user.click(screen.getByLabelText('Destination'));
    const room = screen.getByRole('treeitem', { name: /IT Closet/ });
    expect(room).toHaveAccessibleName(/group/);
    expect(room).not.toHaveAttribute('aria-selected');
    await user.click(room);
    expect(changed).not.toHaveBeenCalled();
    await user.click(room);
    await user.click(screen.getByRole('treeitem', { name: /Right Storage/ }));
    await user.click(screen.getByRole('treeitem', { name: /Drawer 7/ }));
    expect(changed).toHaveBeenCalledWith('drawer');
    await user.click(screen.getByLabelText('Destination'));
    expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toBeVisible();
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledOnce();
  });
  it('starts with storage branches collapsed and reopens the selected branch', async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, right, nestedDrawer, left, leftDrawer]}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    expect(screen.getByRole('treeitem', { name: /IT Closet/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      screen.getByRole('treeitem', { name: /Right Storage/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('treeitem', { name: /Left Storage/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('treeitem', { name: /Drawer 7/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen
        .getByRole('treeitem', { name: /Right Storage/ })
        .querySelector('[data-disclosure]')!,
    );
    await user.click(screen.getByRole('treeitem', { name: /Drawer 7/ }));
    await user.click(screen.getByLabelText('Location'));
    expect(
      screen.getByRole('treeitem', { name: /Right Storage/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('treeitem', { name: /Left Storage/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
  it('expands a selected path when locations finish loading after opening', async () => {
    const user = userEvent.setup();
    const view = render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[]}
        value="drawer"
        loading
      />,
    );
    await user.click(screen.getByLabelText('Destination'));
    view.rerender(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, right, nestedDrawer]}
        value="drawer"
      />,
    );
    expect(
      screen.getByRole('treeitem', { name: /Right Storage/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
  it('expands a newly available selected path during a populated open picker only once', async () => {
    const user = userEvent.setup();
    const initial = [root, right, nestedSecondDrawer, left, leftDrawer];
    const view = render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={initial}
        value="drawer"
      />,
    );
    await user.click(screen.getByLabelText('Destination'));
    expect(
      screen.getByRole('treeitem', { name: /Right Storage/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    view.rerender(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[...initial, nestedDrawer]}
        value="drawer"
      />,
    );
    const branch = screen.getByRole('treeitem', { name: /Right Storage/ });
    expect(branch).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /Drawer 7/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('treeitem', { name: /Left Storage/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    await user.click(branch.querySelector('[data-disclosure]')!);
    expect(branch).toHaveAttribute('aria-expanded', 'false');
    view.rerender(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[...initial, nestedDrawer]}
        value="drawer"
      />,
    );
    expect(branch).toHaveAttribute('aria-expanded', 'false');
  });
  it.each([
    {
      mode: 'destination' as const,
      excludeIds: ['right'],
      sourceIds: undefined,
    },
    { mode: 'source' as const, excludeIds: undefined, sourceIds: ['drawer'] },
  ])(
    'marks a capable but ineligible $mode ancestor as navigation only',
    async ({ mode, excludeIds, sourceIds }) => {
      const user = userEvent.setup();
      const changed = vi.fn();
      render(
        <LocationPicker
          mode={mode}
          label="Location"
          locations={[
            root,
            { ...right, can_hold_inventory: true },
            nestedDrawer,
          ]}
          excludeIds={excludeIds}
          sourceIds={sourceIds}
          onValueChange={changed}
        />,
      );
      await user.click(screen.getByLabelText('Location'));
      const branch = screen.getByRole('treeitem', { name: /Right Storage/ });
      expect(branch).toHaveAccessibleName(/navigation group/);
      expect(branch).not.toHaveAccessibleName(/selectable/);
      expect(branch).not.toHaveAttribute('aria-selected');
      expect(branch).toHaveTextContent('eligible locations');
      await user.click(branch);
      expect(changed).not.toHaveBeenCalled();
      await user.click(screen.getByRole('treeitem', { name: /Drawer 7/ }));
      expect(changed).toHaveBeenCalledWith('drawer');
    },
  );
  it('places the desktop panel inside the viewport when its trigger is near an edge', async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker mode="browse" label="Location" locations={[root]} />,
    );
    vi.spyOn(
      screen.getByLabelText('Location'),
      'getBoundingClientRect',
    ).mockReturnValue({
      left: 990,
      top: 696,
      bottom: 740,
      width: 240,
    } as DOMRect);
    vi.spyOn(
      screen.getByLabelText('Location').parentElement!,
      'getBoundingClientRect',
    ).mockReturnValue({ top: 670 } as DOMRect);
    await user.click(screen.getByLabelText('Location'));
    const panel = screen.getByRole('tree').parentElement!;
    await waitFor(() => {
      const left = parseFloat(panel.style.getPropertyValue('--picker-left'));
      const top = parseFloat(panel.style.getPropertyValue('--picker-top'));
      const width = parseFloat(panel.style.getPropertyValue('--picker-width'));
      const height = parseFloat(
        panel.style.getPropertyValue('--picker-height'),
      );
      expect(width).toBe(240);
      expect(left + width).toBeLessThanOrEqual(window.innerWidth - 16);
      expect(top + height).toBeLessThan(670);
    });
  });
  it('closes immediately when disabled and does not revive a previous popup', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        onValueChange={changed}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    const oldOption = screen.getByRole('treeitem', { name: /Drawer 7/ });
    view.rerender(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        onValueChange={changed}
        disabled
      />,
    );
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toBeDisabled();
    oldOption.click();
    expect(changed).not.toHaveBeenCalled();
    view.rerender(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        onValueChange={changed}
      />,
    );
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('treeitem', { name: /Drawer 7/ }));
    expect(changed).toHaveBeenCalledWith('ITC-D07');
  });
  it('puts active result semantics on the focused search combobox', async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Location' })).toBeVisible();
    await user.click(screen.getByLabelText('Location'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(search).toHaveAttribute('aria-autocomplete', 'none');
    expect(screen.getByRole('button', { name: 'Location' })).toBeVisible();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const activeId = search.getAttribute('aria-activedescendant');
    expect(activeId).toBe(
      screen.getByRole('treeitem', { name: /Drawer 7/ }).id,
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: 'Location' })).toHaveFocus();
  });
  it('reopens on the selected browse location and Enter leaves navigation unchanged', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        allowAll
        onValueChange={changed}
        name="location"
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('treeitem', { name: /Drawer 7/ }));
    expect(changed).toHaveBeenCalledOnce();
    await user.click(screen.getByLabelText('Location'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: /Drawer 7/ }).id,
    );
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledOnce();
    expect(document.querySelector('input[name="location"]')).toHaveValue(
      'ITC-D07',
    );
  });
  it('reopens on the selected destination and arrows can choose another', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, drawer, secondDrawer]}
        onValueChange={changed}
      />,
    );
    await user.click(screen.getByLabelText('Destination'));
    expect(
      screen.getByRole('combobox', { name: 'Search locations' }),
    ).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(changed).toHaveBeenLastCalledWith('drawer');
    await user.click(screen.getByLabelText('Destination'));
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Destination')).toHaveTextContent('Drawer 7');
    await user.click(screen.getByLabelText('Destination'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(changed).toHaveBeenLastCalledWith('drawer-10');
  });
  it('does not clear an unavailable selected code on opening Enter', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        allowAll
        value="MISSING"
        onValueChange={changed}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    expect(
      screen.getByRole('combobox', { name: 'Search locations' }),
    ).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Location' })).toHaveTextContent(
      'MISSING',
    );
  });
  it('reconciles a removed active tree row without changing the selected UUID', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, drawer, secondDrawer, thirdDrawer]}
        value="drawer"
        onValueChange={changed}
        name="destination"
      />,
    );
    await user.click(screen.getByLabelText('Destination'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    await user.keyboard('{ArrowDown}');
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: /Drawer 10/ }).id,
    );
    view.rerender(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, drawer, thirdDrawer]}
        value="drawer"
        onValueChange={changed}
        name="destination"
      />,
    );
    const fallback = screen.getByRole('treeitem', { name: /IT Closet/ });
    expect(search.getAttribute('aria-activedescendant')).toBe(fallback.id);
    expect(fallback).toHaveAttribute('tabindex', '0');
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector('input[name="destination"]')).toHaveValue(
      'drawer',
    );
    await user.tab();
    expect(fallback).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}{Enter}');
    expect(changed).toHaveBeenCalledWith('drawer-11');
  });
  it('reconciles a focused row removed by destination exclusions', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, drawer, secondDrawer]}
        value="drawer"
        onValueChange={changed}
      />,
    );
    await user.click(screen.getByLabelText('Destination'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /Drawer 10/ })).toHaveFocus();
    view.rerender(
      <LocationPicker
        mode="destination"
        label="Destination"
        locations={[root, drawer, secondDrawer]}
        value="drawer"
        excludeIds={['drawer-10']}
        onValueChange={changed}
      />,
    );
    const fallback = screen.getByRole('treeitem', { name: /IT Closet/ });
    expect(search).toHaveFocus();
    expect(search.getAttribute('aria-activedescendant')).toBe(fallback.id);
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    await user.tab();
    expect(fallback).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(changed).not.toHaveBeenCalled();
  });
  it('does not turn a removed browse selection into an implicit All choice', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root]}
        value="ITC"
        allowAll
        onValueChange={changed}
        name="location"
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: /IT Closet/ }).id,
    );
    view.rerender(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[]}
        value="ITC"
        allowAll
        onValueChange={changed}
        name="location"
      />,
    );
    expect(search).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector('input[name="location"]')).toHaveValue('ITC');
    await user.tab();
    expect(
      screen.getByRole('treeitem', { name: /All locations/ }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledWith('');
  });
});

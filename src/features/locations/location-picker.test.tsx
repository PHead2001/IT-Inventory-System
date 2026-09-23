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

describe('LocationPicker', () => {
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
      screen.queryByRole('option', { name: /Drawer 7/ }),
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
    await user.click(screen.getByRole('option', { name: /^IT Closet/ }));
    expect(document.querySelector('input[name="location"]')).toHaveValue('ITC');
    await user.click(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('option', { name: /All locations/ }));
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
    expect(screen.getByRole('option', { name: /^IT Closet/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Location')).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Location'));
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After picker' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('exposes full ancestry in each result name without hover', async () => {
    const user = userEvent.setup();
    render(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
      />,
    );
    await user.click(screen.getByLabelText('Location'));
    expect(
      screen.getByRole('option', {
        name: 'Drawer 7, IT Closet / Right Storage, ITC-D07',
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('option', { name: /Drawer 7/ }));
    expect(screen.getByLabelText('Location')).toHaveTextContent(
      'IT Closet / Right Storage',
    );
  });
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
      bottom: 740,
    } as DOMRect);
    await user.click(screen.getByLabelText('Location'));
    const panel = screen.getByRole('listbox').parentElement!;
    await waitFor(() => {
      expect(panel.style.getPropertyValue('--picker-left')).toBe('624px');
      expect(panel.style.getPropertyValue('--picker-top')).toBe('336px');
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
    const oldOption = screen.getByRole('option', { name: /Drawer 7/ });
    view.rerender(
      <LocationPicker
        mode="browse"
        label="Location"
        locations={[root, drawer]}
        onValueChange={changed}
        disabled
      />,
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('option', { name: /Drawer 7/ }));
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
    expect(search).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.getByRole('button', { name: 'Location' })).toBeVisible();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const activeId = search.getAttribute('aria-activedescendant');
    expect(activeId).toBe(screen.getByRole('option', { name: /Drawer 7/ }).id);
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
    await user.click(screen.getByRole('option', { name: /Drawer 7/ }));
    expect(changed).toHaveBeenCalledOnce();
    await user.click(screen.getByLabelText('Location'));
    const search = screen.getByRole('combobox', { name: 'Search locations' });
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: /Drawer 7/ }).id,
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
    await user.keyboard('{ArrowDown}{Enter}');
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
});

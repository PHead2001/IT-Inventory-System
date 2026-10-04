import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LocationBrowser } from './location-browser';
import type { LocationRef } from '../inventory/contracts-ui';

const root: LocationRef = {
  id: 'root',
  code: 'ITC',
  name: 'IT Closet',
  breadcrumb: 'IT Closet',
  parentId: null,
  active: true,
  can_hold_inventory: false,
};
const shelf: LocationRef = {
  ...root,
  id: 'shelf',
  code: 'ITC-S1A',
  name: 'Shelf 1A',
  breadcrumb: 'IT Closet / Shelf 1A',
  parentId: 'root',
  can_hold_inventory: true,
};
it('keeps normal codes on a separate intact line and gives long codes a separate keyboard scroll target', () => {
  const longCode = 'ITO-' + 'LONG'.repeat(24);
  render(
    <LocationBrowser
      locations={[{ ...root, code: longCode }]}
      selectedCode={null}
      onSelect={vi.fn()}
    />,
  );
  const codes = screen.getAllByLabelText('Full location code: ' + longCode);
  expect(codes).toHaveLength(2);
  for (const code of codes) {
    expect(code).toHaveAttribute('tabindex', '0');
    expect(code.closest('button')).toBeNull();
    expect(code).toHaveTextContent(longCode);
  }
});

it('focuses a stable visible navigation landmark and announces mobile Open and Back without focusing search', () => {
  const select = vi.fn();
  render(
    <LocationBrowser
      locations={[root, shelf]}
      selectedCode={null}
      onSelect={select}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Location browser' });
  fireEvent.click(screen.getByRole('button', { name: 'Open IT Closet' }));
  expect(nav).toHaveFocus();
  expect(nav.closest('.hidden')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Browsing IT Closet');
  fireEvent.click(screen.getByRole('button', { name: 'Back to spaces' }));
  expect(nav).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Browsing spaces');
  expect(select).not.toHaveBeenCalled();
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'Shelf' } });
  expect(screen.queryByRole('button', { name: 'Open IT Closet' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /Shelf 1A/ })[0]);
  expect(select).toHaveBeenCalledWith(shelf.code);
});

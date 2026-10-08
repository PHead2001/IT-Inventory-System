import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import NotFound from './not-found';
import InventoryNotFound from './(protected)/inventory/not-found';

it('makes root-only missing-page recovery discoverable through one main landmark', () => {
  render(<NotFound />);
  const main = screen.getByRole('main');
  expect(
    within(main).getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  expect(
    within(main).getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
});

it('keeps inventory recovery inside its existing protected main without nesting landmarks', () => {
  render(
    <main>
      <InventoryNotFound />
    </main>,
  );
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(
    within(screen.getByRole('main')).getByRole('heading', {
      name: 'Inventory record unavailable',
    }),
  ).toBeVisible();
});

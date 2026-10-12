import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => ({ path: '' }));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-inventory-document-path': request.path }),
}));
import NotFound, { generateMetadata } from './not-found';
import InventoryNotFound from './(protected)/inventory/not-found';

beforeEach(() => {
  request.path = '';
});
it('makes root-only missing-page recovery discoverable through one main landmark', async () => {
  render(await NotFound());
  const main = screen.getByRole('main');
  expect(
    within(main).getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  expect(
    within(main).getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
});
it.each(['/inventory/quantity/opaque.jpg', '/inventory/assets/missing'])(
  'keeps document fallback identity fixed for %s with one main and recovery link',
  async (path) => {
    request.path = path;
    render(await NotFound());
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: 'Inventory record unavailable' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Search inventory' }),
    ).toHaveAttribute('href', '/inventory');
    expect(await generateMetadata()).toEqual({
      title: { absolute: 'Inventory record unavailable · IT Inventory' },
    });
  },
);

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

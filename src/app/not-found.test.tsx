import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => ({ path: '' }));
const membership = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: membership,
}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-inventory-document-path': request.path }),
}));
import NotFound, { generateMetadata } from './not-found';
import InventoryNotFound, {
  generateMetadata as inventoryMetadata,
} from './(protected)/inventory/not-found';
import ProtectedNotFound from './(protected)/not-found';

beforeEach(() => {
  request.path = '';
  membership.mockReset().mockResolvedValue(undefined);
});
it.each(['', '/missing.jpg', '/missing.svg', '/_next/static/missing.js'])(
  'keeps generic root recovery public with one main for %s',
  async (path) => {
    request.path = path;
    render(await NotFound());
    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    expect(
      within(main).getByRole('link', { name: 'Search inventory' }),
    ).toHaveAttribute('href', '/inventory');
    expect(await generateMetadata()).toEqual({
      title: { absolute: 'Page not found · IT Inventory' },
    });
    expect(membership).not.toHaveBeenCalled();
  },
);
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

it('keeps inventory recovery inside its existing protected main without nesting landmarks', async () => {
  render(<main>{await InventoryNotFound()}</main>);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(
    within(screen.getByRole('main')).getByRole('heading', {
      name: 'Inventory record unavailable',
    }),
  ).toBeVisible();
});

it.each([
  ['root inventory body', NotFound],
  ['root inventory metadata', generateMetadata],
  ['inventory body', InventoryNotFound],
  ['inventory metadata', inventoryMetadata],
  ['protected body', ProtectedNotFound],
] as const)(
  'awaits membership before returning %s',
  async (_name, fallback) => {
    request.path = '/inventory/quantity/missing.jpg';
    let admit!: () => void;
    membership.mockImplementationOnce(
      () => new Promise<void>((resolve) => (admit = resolve)),
    );
    let settled = false;
    const result = fallback().then((value) => {
      settled = true;
      return value;
    });
    // Root fallbacks first await the trusted document-path read.
    await Promise.resolve();
    await Promise.resolve();
    expect(membership).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    admit();
    await result;
    expect(settled).toBe(true);
  },
);

it.each([
  ['root inventory body', NotFound],
  ['root inventory metadata', generateMetadata],
  ['inventory body', InventoryNotFound],
  ['inventory metadata', inventoryMetadata],
  ['protected body', ProtectedNotFound],
] as const)(
  'propagates login and membership denials before returning %s',
  async (_name, fallback) => {
    request.path = '/inventory/assets/missing.jpg';
    for (const destination of ['/login', '/access-denied']) {
      const denial = new Error('REDIRECT:' + destination);
      membership.mockRejectedValueOnce(denial);
      await expect(fallback()).rejects.toBe(denial);
    }
    expect(document.querySelector('#unavailable-heading')).toBeNull();
  },
);

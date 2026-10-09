import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const guard = vi.hoisted(() => ({ site: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({ member: { role: 'staff', user_id: 'actor' } }),
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSite: guard.site.mockImplementation(async () => ({
    id: 'site',
    name: 'Private office name',
    code: 'PRIVATE-CODE',
    active: true,
  })),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getCategories: async () => [],
  getLocations: async () => [],
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: async () => ({}),
}));
vi.mock('@/features/metadata/metadata-form', () => ({
  MetadataForm: () => <form aria-label="Opening holdings" />,
}));
import * as opening from './page';
import { metadata as ancestorMetadata } from '../../layout';
it.each([
  ['quantity', 'quantity item'],
  ['asset', 'individual asset'],
])(
  'opening %s identifies the task privately instead of inheriting the site details title',
  async (kind, label) => {
    render(
      await opening.default({
        params: Promise.resolve({ code: 'PRIVATE-CODE', kind }),
      }),
    );
    expect(
      screen.getByRole('heading', {
        name: `Record existing ${label} at Private office name`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Opening holdings' }),
    ).toBeInTheDocument();
    const metadata = await opening.generateMetadata({
      params: Promise.resolve({ code: 'PRIVATE-CODE', kind }),
    });
    expect(metadata.title).toEqual({
      absolute: `Record existing ${label} at Private office name · IT Inventory`,
    });
    expect(metadata.title).not.toEqual(ancestorMetadata.title);
    expect(JSON.stringify(metadata)).not.toMatch(/PRIVATE-CODE/);
  },
);
it('rejects an unsupported opening kind before reading its private site', async () => {
  guard.site.mockClear();
  await expect(
    opening.generateMetadata({
      params: Promise.resolve({ code: 'PRIVATE-CODE', kind: 'unsupported' }),
    }),
  ).rejects.toThrow('NOT_FOUND');
  expect(guard.site).not.toHaveBeenCalled();
});
it('propagates denied caller authorization instead of returning a private site title', async () => {
  const denied = new Error('LOGIN_REDIRECT');
  guard.site.mockRejectedValueOnce(denied);
  await expect(
    opening.generateMetadata({
      params: Promise.resolve({ code: 'PRIVATE-CODE', kind: 'asset' }),
    }),
  ).rejects.toBe(denied);
});
vi.mock('server-only', () => ({}));

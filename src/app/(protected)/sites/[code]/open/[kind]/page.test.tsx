import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({ member: { role: 'staff', user_id: 'actor' } }),
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSite: async () => ({
    id: 'site',
    name: 'Private office name',
    code: 'PRIVATE-CODE',
    active: true,
  }),
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
    expect(opening.metadata.title).toEqual({
      absolute: 'Record site holdings · IT Inventory',
    });
    expect(opening.metadata.title).not.toEqual(ancestorMetadata.title);
    expect(JSON.stringify(opening.metadata)).not.toMatch(
      /Private office name|PRIVATE-CODE/,
    );
  },
);

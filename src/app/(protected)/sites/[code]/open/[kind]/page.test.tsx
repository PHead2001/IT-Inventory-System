import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const guard = vi.hoisted(() => ({ site: vi.fn(), member: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: guard.member,
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
import {
  createPrivateDocumentTitleController,
  PrivateDocumentTitleContext,
} from '@/components/auth/private-document-title';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
beforeEach(() => {
  guard.member.mockResolvedValue({
    member: { role: 'staff', user_id: 'actor' },
  });
  guard.site.mockResolvedValue({
    id: 'site',
    name: 'Private office name',
    code: 'PRIVATE-CODE',
    active: true,
  });
});
it.each([
  ['quantity', 'quantity item'],
  ['asset', 'individual asset'],
])(
  'opening %s identifies the task privately instead of inheriting the site details title',
  async (kind, label) => {
    const titleOwner = createPrivateDocumentTitleController();
    const retire = titleOwner.mount();
    titleOwner.accept({
      navigation: `/sites/PRIVATE-CODE/open/${kind}?`,
      binding: 'actor',
      revocation: readPrivacyRevocationRevision(),
      callbacks: assignmentEpoch(),
    });
    const view = render(
      <PrivateDocumentTitleContext value={titleOwner}>
        {await opening.default({
          params: Promise.resolve({ code: 'PRIVATE-CODE', kind }),
        })}
      </PrivateDocumentTitleContext>,
    );
    expect(
      screen.getByRole('heading', {
        name: `Record existing ${label} at Private office name`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Opening holdings' }),
    ).toBeInTheDocument();
    expect(document.title).toBe(
      `Record existing ${label} at Private office name · IT Inventory`,
    );
    const metadata = opening.generateMetadata();
    expect(metadata.title).toEqual({
      absolute: 'Record existing equipment · IT Inventory',
    });
    expect(metadata.title).not.toEqual(ancestorMetadata.title);
    expect(JSON.stringify(metadata)).not.toMatch(
      /PRIVATE-CODE|Private office name/,
    );
    view.unmount();
    retire();
  },
);
it('rejects an unsupported opening kind before reading its private site', async () => {
  guard.site.mockClear();
  await expect(
    opening.default({
      params: Promise.resolve({ code: 'PRIVATE-CODE', kind: 'unsupported' }),
    }),
  ).rejects.toThrow('NOT_FOUND');
  expect(guard.site).not.toHaveBeenCalled();
});
it('propagates denied caller authorization instead of returning a private site title', async () => {
  const denied = new Error('LOGIN_REDIRECT');
  guard.site.mockRejectedValueOnce(denied);
  await expect(
    opening.default({
      params: Promise.resolve({ code: 'PRIVATE-CODE', kind: 'asset' }),
    }),
  ).rejects.toBe(denied);
});
vi.mock('server-only', () => ({}));

it.each([
  { role: 'viewer', active: true },
  { role: 'staff', active: false },
])(
  'does not register a private opening title for denied page %j',
  async ({ role, active }) => {
    guard.member.mockResolvedValue({ member: { role, user_id: 'actor' } });
    guard.site.mockResolvedValue({ name: 'Private office name', active });
    const owner = createPrivateDocumentTitleController();
    const retire = owner.mount();
    owner.accept({
      navigation: '/sites/PRIVATE-CODE/open/asset?',
      binding: 'actor',
      revocation: readPrivacyRevocationRevision(),
      callbacks: assignmentEpoch(),
    });
    document.title = opening.generateMetadata().title.absolute;
    const view = render(
      <PrivateDocumentTitleContext value={owner}>
        {await opening.default({
          params: Promise.resolve({ code: 'PRIVATE-CODE', kind: 'asset' }),
        })}
      </PrivateDocumentTitleContext>,
    );
    expect(
      screen.queryByRole('form', { name: 'Opening holdings' }),
    ).not.toBeInTheDocument();
    expect(document.title).toBe('Record existing equipment · IT Inventory');
    view.unmount();
    retire();
  },
);

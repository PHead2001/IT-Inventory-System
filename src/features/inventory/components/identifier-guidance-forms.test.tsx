import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { MutationForm } from './mutation-form';
import type { MetadataForm as PublishedForm } from '@/features/metadata/contracts';
const mocks = vi.hoisted(() => ({ check: vi.fn(), submit: vi.fn() }));
vi.mock('@/features/inventory/asset-tag.actions', () => ({
  checkAssetTag: mocks.check,
}));
vi.mock('@/features/inventory/actions', () => ({
  submitInventory: mocks.submit,
  findDuplicateSerials: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/custody/actions', () => ({ submitCustody: vi.fn() }));
vi.mock('@/features/metadata/form-fetch.actions', () => ({
  fetchCategoryForm: vi.fn(),
}));
vi.mock('@/features/metadata/record-refresh.actions', () => ({
  refreshMetadataRecord: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const id = '70000000-0000-4000-8000-000000000001';
const categoryId = '70000000-0000-4000-8000-000000000002';
const revision = '70000000-0000-4000-8000-000000000003';
const asset = {
  id,
  name: 'Edited device',
  categoryId,
  categoryName: 'Equipment',
  version: 7,
  status: 'active' as const,
  assetTag: 'Original',
  serialNumber: null,
  description: null,
  manufacturer: null,
  model: null,
  validatedFormRevisionId: revision,
  customValues: {},
};
const categories = [{ id: categoryId, name: 'Equipment', active: true }];
const form: PublishedForm = {
  category_id: categoryId,
  published_revision_id: revision,
  published_number: '1',
  draft_id: null,
  draft_version: null,
  draft_definition: null,
  published_definition: {
    fields: [],
    layout: [
      {
        id: categoryId,
        label: 'Equipment details',
        controls: [
          { id: revision, kind: 'builtin', builtin: 'asset_tag', width: 12 },
        ],
      },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.check.mockResolvedValue({
    id: revision,
    name: 'Conflicting active device',
    status: 'active',
    asset_tag: 'EnteredCase',
  });
});
it.each(['published', 'mutation'])(
  'the %s form checks on blur, excludes self, preserves spelling and does not submit',
  async (kind) => {
    render(
      kind === 'published' ? (
        <MetadataForm
          kind="asset"
          asset={asset}
          categories={categories}
          locations={[]}
          forms={{ [categoryId]: form }}
          actorId={id}
          recoveryBackend="http://127.0.0.1:54321"
        />
      ) : (
        <MutationForm
          operation="asset_update"
          asset={asset}
          categories={categories}
          locations={[]}
          actorId={id}
        />
      ),
    );
    const input = await screen.findByLabelText(
      kind === 'published' ? 'Asset tag' : 'Asset tag (optional)',
    );
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '  EnteredCase  ' } });
    expect(mocks.check).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(
      await screen.findByRole('link', { name: 'Conflicting active device' }),
    ).toBeVisible();
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('  EnteredCase  ', id);
    expect(input).toHaveValue('  EnteredCase  ');
    expect(screen.getByRole('status')).toHaveTextContent('(active)');
    expect(screen.getByRole('status')).not.toHaveTextContent('retired');
    expect(input).toHaveAccessibleDescription(/Asset tag already used/);
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Different' } });
    expect(
      screen.queryByRole('link', { name: 'Conflicting active device' }),
    ).not.toBeInTheDocument();
  },
);

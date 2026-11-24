import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { QuantityItem } from '@/features/inventory/contracts-ui';
import QuantityThresholdPage, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  readQuantityPage: vi.fn(),
  getCategories: vi.fn(),
  getLocations: vi.fn(),
  getPublishedForms: vi.fn(),
  metadataForm: vi.fn(() => <form aria-label="Quantity metadata" />),
  notFound: vi.fn(() => {
    throw new Error('Not found');
  }),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
vi.mock('../read.server', () => ({ readQuantityPage: mocks.readQuantityPage }));
vi.mock('@/features/inventory/queries.server', () => ({
  getCategories: mocks.getCategories,
  getLocations: mocks.getLocations,
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: mocks.getPublishedForms,
}));
vi.mock('@/features/metadata/metadata-form', () => ({
  MetadataForm: mocks.metadataForm,
}));

const item: QuantityItem = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Display adapter',
  categoryId: '00000000-0000-4000-8000-000000000002',
  categoryName: 'Adapters',
  description: null,
  manufacturer: null,
  model: null,
  version: 5,
  archived: false,
  reorderThreshold: null,
  itemCode: null,
};
const actorId = '00000000-0000-4000-8000-000000000003';
const categories = [{ id: item.categoryId, name: 'Adapters', active: true }];
const params = Promise.resolve({ id: item.id });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMember.mockResolvedValue({
    member: { role: 'staff', user_id: actorId },
  });
  mocks.readQuantityPage.mockResolvedValue({ item });
  mocks.getCategories.mockResolvedValue(categories);
  mocks.getLocations.mockResolvedValue([]);
  mocks.getPublishedForms.mockResolvedValue({});
});

it('gives staff the existing quantity editor with the named item and original version', async () => {
  render(
    await QuantityThresholdPage({
      params,
      searchParams: Promise.resolve({
        task: 'metadata',
        reorder_threshold: '8',
      }),
    }),
  );
  expect(generateMetadata().title.absolute).toBe(
    'Set reorder threshold · IT Inventory',
  );
  expect(
    screen.getByRole('heading', {
      name: 'Set reorder threshold for Display adapter',
    }),
  ).toBeVisible();
  expect(screen.getByRole('form', { name: 'Quantity metadata' })).toBeVisible();
  expect(mocks.readQuantityPage).toHaveBeenCalledWith(item.id);
  expect(mocks.getPublishedForms).toHaveBeenCalledWith([item.categoryId]);
  expect(mocks.metadataForm).toHaveBeenCalledWith(
    expect.objectContaining({
      actorId,
      kind: 'quantity',
      item,
      categories,
      locations: [],
      forms: {},
      thresholdSetup: true,
    }),
    undefined,
  );
});

it('shows viewers read-only access without loading the record or editor data', async () => {
  mocks.requireMember.mockResolvedValue({
    member: { role: 'viewer', user_id: actorId },
  });
  render(await QuantityThresholdPage({ params }));
  expect(
    screen.getByText('Staff membership is required to set reorder thresholds.'),
  ).toBeVisible();
  expect(mocks.readQuantityPage).not.toHaveBeenCalled();
  expect(mocks.getCategories).not.toHaveBeenCalled();
  expect(mocks.getLocations).not.toHaveBeenCalled();
  expect(mocks.getPublishedForms).not.toHaveBeenCalled();
  expect(mocks.metadataForm).not.toHaveBeenCalled();
});

it.each([
  ['archived', { item: { ...item, archived: true } }],
  ['missing', null],
])(
  'rejects %s quantities before loading the editor',
  async (_state, detail) => {
    mocks.readQuantityPage.mockResolvedValue(detail);
    await expect(QuantityThresholdPage({ params })).rejects.toThrow(
      'Not found',
    );
    expect(mocks.getCategories).not.toHaveBeenCalled();
    expect(mocks.getLocations).not.toHaveBeenCalled();
    expect(mocks.getPublishedForms).not.toHaveBeenCalled();
    expect(mocks.metadataForm).not.toHaveBeenCalled();
  },
);

it('preserves protected authentication refusal without loading inventory', async () => {
  mocks.requireMember.mockRejectedValueOnce(new Error('Access denied'));
  await expect(QuantityThresholdPage({ params })).rejects.toThrow(
    'Access denied',
  );
  expect(mocks.readQuantityPage).not.toHaveBeenCalled();
  expect(mocks.metadataForm).not.toHaveBeenCalled();
});

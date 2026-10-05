import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DetailTasks } from './detail-tasks';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../actions', () => ({
  submitInventory: vi.fn(),
  findDuplicateSerials: vi.fn(),
}));
vi.mock('@/features/metadata/metadata-form', () => ({
  MetadataForm: () => null,
}));
vi.mock('@/features/custody/custody-change-form', () => ({
  CustodyChangeForm: () => null,
}));
const item = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Cable',
  description: null,
  categoryId: 'category',
  categoryName: 'Cables',
  manufacturer: null,
  model: null,
  version: 1,
  archived: true,
  itemCode: null,
  reorderThreshold: null,
};
const props = {
  actorId: 'actor',
  canManageConfiguration: false,
  item,
  categories: [],
  locations: [],
  sites: [],
  forms: {},
};
it('retains the last available archive review after restore and a subsequent lifecycle refresh', () => {
  const view = render(<DetailTasks {...props} archiveReview={null} />);
  expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
  const review = {
    item_id: item.id,
    version: '2',
    archived: false,
    removed_total: '4',
    locations: [],
  };
  view.rerender(
    <DetailTasks
      {...props}
      item={{ ...item, archived: false, version: 2 }}
      archiveReview={review}
    />,
  );
  fireEvent.click(screen.getByText('Lifecycle & consequential actions'));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Archive quantity item and clear stock',
    }),
  );
  expect(screen.getByText('4 units to remove')).toBeVisible();
  view.rerender(
    <DetailTasks
      {...props}
      item={{ ...item, version: 3 }}
      archiveReview={null}
    />,
  );
  expect(
    screen.getByRole('form', { name: 'Archive quantity item and clear stock' }),
  ).toBeInTheDocument();
  expect(screen.getByText('4 units to remove')).toBeVisible();
});

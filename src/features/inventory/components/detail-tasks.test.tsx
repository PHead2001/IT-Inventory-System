import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DetailTasks } from './detail-tasks';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => null,
}));
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
it('explains physical asset movement on the primary launcher before a task is chosen', () => {
  render(
    <DetailTasks
      {...props}
      item={undefined}
      asset={{
        ...item,
        name: 'Laptop',
        status: 'active',
        assetTag: 'LAP-01',
        serialNumber: null,
      }}
    />,
  );
  const move = screen.getByRole('button', { name: 'Move asset' });
  expect(
    screen.getByText(
      'Move asset: Physically relocate this asset to another storage location.',
    ),
  ).toBeVisible();
  expect(move).toHaveAccessibleDescription(
    'Move asset: Physically relocate this asset to another storage location.',
  );
  expect(screen.queryByRole('form')).toBeNull();
  expect(move).toHaveAttribute('aria-pressed', 'false');
});
it('retains the reviewed archive version and counts inside a withdrawn, inaccessible task', () => {
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
  fireEvent.click(screen.getByText('Retire or archive'));
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
  const retained = screen.getByRole('form', {
    name: 'Archive quantity item and clear stock',
    hidden: true,
  });
  expect(retained).toBeInTheDocument();
  expect(retained).not.toBeVisible();
  const boundary = retained.closest('fieldset');
  expect(boundary).toHaveAttribute('hidden');
  expect(boundary).toHaveAttribute('inert');
  expect(boundary).toBeDisabled();
  expect(screen.getByText('4 units to remove')).toBeInTheDocument();
  expect(screen.getByText('4 units to remove')).not.toBeVisible();

  // A version-3 refresh must not replace the retained version-2 review.
  view.rerender(
    <DetailTasks
      {...props}
      item={{ ...item, version: 3 }}
      archiveReview={{
        ...review,
        version: '3',
        archived: true,
        removed_total: '9',
      }}
    />,
  );
  expect(screen.getByText('4 units to remove')).toBeInTheDocument();
  expect(screen.queryByText('9 units to remove')).toBeNull();
  expect(
    screen.getByText(
      'This quantity item changed. Load and review the latest per-location counts before archiving.',
    ),
  ).not.toBeVisible();
  expect(retained).not.toBeVisible();
});

const correctionSite = {
  id: '00000000-0000-4000-8000-000000000002',
  code: 'OFFICE',
  name: 'Office',
  notes: null,
  active: true,
  version: '1',
};
it('explains quantity storage and site corrections before selecting either task', () => {
  render(
    <DetailTasks
      {...props}
      item={{ ...item, archived: false }}
      sites={[correctionSite]}
      siteHoldings={[
        {
          site_id: correctionSite.id,
          site_code: correctionSite.code,
          site_name: correctionSite.name,
          site_active: true,
          inventory_kind: 'quantity',
          entity_id: item.id,
          name: item.name,
          category_name: item.categoryName,
          manufacturer: null,
          model: null,
          quantity: 2,
          asset_tag: null,
          serial_number: null,
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByText('Other tasks'));
  const count = screen.getByRole('button', { name: 'Correct physical count' });
  const site = screen.getByRole('button', {
    name: 'Correct recorded site holding',
  });
  const countHelp =
    'Correct physical count: Correct the recorded storage quantity to the count you observed, without moving stock between locations.';
  const siteHelp =
    'Correct recorded site holding: Correct the recorded quantity already at a site, without issuing, returning or transferring stock.';
  expect(screen.getByText(countHelp)).toBeVisible();
  expect(screen.getByText(siteHelp)).toBeVisible();
  expect(count).toHaveAccessibleDescription(countHelp);
  expect(site).toHaveAccessibleDescription(siteHelp);
  expect(count).toHaveAttribute('aria-pressed', 'false');
  expect(site).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('form')).toBeNull();
});
it.each([false, true])(
  'explains an asset recorded-location or site correction before selection (at site: %s)',
  (atSite) => {
    render(
      <DetailTasks
        {...props}
        item={undefined}
        asset={{
          ...item,
          status: 'active',
          assetTag: null,
          serialNumber: null,
        }}
        currentSite={atSite ? correctionSite : null}
        sites={[correctionSite]}
      />,
    );
    fireEvent.click(screen.getByText('Other tasks'));
    const label = atSite
      ? 'Correct recorded site custody'
      : 'Correct recorded location';
    const help = atSite
      ? 'Correct which site is recorded for this asset, without physically transferring equipment.'
      : 'Update the recorded location without physically moving equipment.';
    const button = screen.getByRole('button', { name: label });
    expect(screen.getByText(label + ': ' + help)).toBeVisible();
    expect(button).toHaveAccessibleDescription(label + ': ' + help);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('form')).toBeNull();
  },
);

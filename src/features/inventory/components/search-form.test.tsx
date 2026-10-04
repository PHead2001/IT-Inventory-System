import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SearchForm } from './search-form';

const category = { id: 'category-1', name: 'Cables', active: true };
const location = {
  id: 'location-1',
  code: 'ITC-1A',
  name: 'Shelf 1A',
  breadcrumb: 'IT Closet / Shelf 1A',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
const site = {
  id: 'site-1',
  code: 'HQ',
  name: 'Headquarters',
  notes: null,
  active: true,
  version: '1',
};

it('marks only the diagnostic client island with a fixed, value-free name', () => {
  const mark = vi
    .spyOn(performance, 'mark')
    .mockImplementation(() => ({}) as PerformanceMark);
  const props = {
    params: { q: 'private query text' },
    categories: [category],
    locations: [location],
    sites: [site],
  };
  const { rerender, unmount } = render(<SearchForm {...props} />);
  expect(mark).not.toHaveBeenCalled();
  rerender(<SearchForm {...props} diagnosticsEnabled />);
  expect(mark).toHaveBeenCalledExactlyOnceWith(
    'itinv:auth:search-island-effect',
  );
  rerender(<SearchForm {...props} diagnosticsEnabled={false} />);
  expect(mark).toHaveBeenCalledTimes(1);
  unmount();
  mark.mockRestore();
});

it('keeps search controls usable when the optional browser mark fails', async () => {
  const mark = vi.spyOn(performance, 'mark').mockImplementation(() => {
    throw new Error('performance marks unavailable');
  });
  render(
    <SearchForm
      params={{}}
      categories={[category]}
      locations={[location]}
      sites={[site]}
      diagnosticsEnabled
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'More filters' }));
  expect(screen.getByRole('button', { name: 'Fewer filters' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  mark.mockRestore();
});

it('keeps advanced filter values mounted and removes only the chosen URL filter', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <SearchForm
      params={{
        q: 'adapter',
        type: 'quantity',
        status: 'historical',
        page: '3',
      }}
      categories={[category]}
      locations={[location]}
      sites={[site]}
    />,
  );
  const more = screen.getByRole('button', { name: 'More filters' });
  await user.click(more);
  const categorySelect = screen.getByRole('combobox', { name: 'Category' });
  await user.selectOptions(categorySelect, 'category-1');
  await user.click(screen.getByRole('button', { name: 'Fewer filters' }));
  expect(categorySelect).toHaveValue('category-1');
  expect(container.querySelector('#inventory-more-filters')).toHaveAttribute(
    'inert',
  );
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Search inventory' }) as HTMLFormElement,
    ).get('category'),
  ).toBe('category-1');
  await user.click(screen.getByRole('button', { name: 'More filters' }));
  expect(categorySelect).toHaveValue('category-1');
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Search inventory' }) as HTMLFormElement,
    ).get('category'),
  ).toBe('category-1');

  const chips = screen.getByRole('navigation', {
    name: 'Active inventory filters',
  });
  const remove = within(chips).getByRole('link', {
    name: 'Remove Search: adapter filter',
  });
  expect(remove).toHaveAttribute(
    'href',
    '/inventory?type=quantity&status=historical',
  );
  expect(screen.getByRole('combobox', { name: 'Property/site' })).toHaveValue(
    '',
  );
});

it('does not present ignored URL defaults as active filters', () => {
  const { container } = render(
    <SearchForm
      params={{
        type: 'all',
        lowStock: 'false',
        status: 'unexpected',
        q: '   ',
      }}
      categories={[category]}
      locations={[location]}
      sites={[site]}
    />,
  );
  expect(
    screen.queryByRole('navigation', { name: 'Active inventory filters' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'More filters' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.getByRole('combobox', { name: 'Tracking type' })).toHaveValue(
    '',
  );
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue(
    'active',
  );
  expect(container.querySelector('input[name="lowStock"]')).not.toBeChecked();
});

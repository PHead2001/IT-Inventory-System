import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SearchForm } from './search-form';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

it.each([
  { href: '/api/exports/inventory?q=applied', download: undefined },
  { href: '/saved-export.csv', download: '' },
])(
  'preserves pending search synchronization when downloading $href',
  ({ href, download }) => {
    vi.useFakeTimers();
    navigation.replace.mockClear();
    navigation.push.mockClear();
    const props = { categories: [], locations: [], sites: [] };
    const view = (params: Record<string, string | undefined>) => (
      <>
        <SearchForm {...props} params={params} />
        <a
          href={href}
          download={download}
          onClick={(event) => event.preventDefault()}
        >
          Export applied rows
        </a>
      </>
    );
    const { rerender, unmount } = render(view({ q: 'applied' }));
    try {
      const query = screen.getByRole('textbox', { name: 'Search inventory' });
      fireEvent.change(query, { target: { value: 'pending draft' } });
      act(() => vi.advanceTimersByTime(100));
      const exportLink = screen.getByRole('link', {
        name: 'Export applied rows',
      });
      fireEvent.click(exportLink);
      expect(exportLink).toHaveAttribute('href', href);
      // A prior request may finish while the download leaves this page mounted.
      rerender(view({ q: 'earlier response' }));
      expect(query).toHaveValue('pending draft');
      act(() => vi.advanceTimersByTime(150));
      expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
        '/inventory?q=pending+draft',
        { scroll: false },
      );
      expect(navigation.push).not.toHaveBeenCalled();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  },
);

it('cancels unsent typing when a chip, pagination or Clear filters commits another search', () => {
  vi.useFakeTimers();
  navigation.replace.mockClear();
  navigation.push.mockClear();
  const { unmount } = render(
    <>
      <SearchForm
        params={{ q: 'applied', status: 'historical' }}
        categories={[]}
        locations={[]}
        sites={[]}
      />
      <a href="/inventory?q=applied&status=historical&page=2">Next page</a>
      <a href="/inventory">Clear filters</a>
    </>,
  );
  const query = screen.getByRole('textbox', { name: 'Search inventory' });
  fireEvent.change(query, { target: { value: 'unsent' } });
  fireEvent.click(
    screen.getByRole('link', {
      name: 'Remove Status: Archived / retired filter',
    }),
  );
  expect(navigation.push).toHaveBeenLastCalledWith('/inventory?q=applied', {
    scroll: false,
  });
  expect(query).toHaveValue('applied');
  act(() => vi.advanceTimersByTime(300));
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.change(query, { target: { value: 'another draft' } });
  fireEvent.click(screen.getByRole('link', { name: 'Next page' }));
  expect(query).toHaveValue('applied');
  act(() => vi.advanceTimersByTime(300));
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.change(query, { target: { value: 'third draft' } });
  fireEvent.click(screen.getByRole('link', { name: 'Clear filters' }));
  expect(query).toHaveValue('');
  act(() => vi.advanceTimersByTime(300));
  expect(navigation.replace).not.toHaveBeenCalled();
  unmount();
  vi.useRealTimers();
});
it('preserves this tab draft when a filter link is opened with a modifier', () => {
  vi.useFakeTimers();
  navigation.replace.mockClear();
  navigation.push.mockClear();
  const { unmount } = render(
    <SearchForm
      params={{ status: 'historical' }}
      categories={[]}
      locations={[]}
      sites={[]}
    />,
  );
  const query = screen.getByRole('textbox', { name: 'Search inventory' });
  fireEvent.change(query, { target: { value: 'draft' } });
  fireEvent.click(
    screen.getByRole('link', {
      name: 'Remove Status: Archived / retired filter',
    }),
    { ctrlKey: true },
  );
  expect(navigation.push).not.toHaveBeenCalled();
  expect(query).toHaveValue('draft');
  act(() => vi.advanceTimersByTime(250));
  expect(navigation.replace).toHaveBeenCalledWith(
    '/inventory?q=draft&status=historical',
    { scroll: false },
  );
  unmount();
  vi.useRealTimers();
});

it('debounces rapid A/B/A typing and clear, but submits immediately without a duplicate request', () => {
  vi.useFakeTimers();
  navigation.replace.mockClear();
  navigation.push.mockClear();
  const { unmount } = render(
    <SearchForm
      params={{ page: '3' }}
      categories={[]}
      locations={[]}
      sites={[]}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Search inventory' });
  fireEvent.change(input, { target: { value: 'A' } });
  act(() => vi.advanceTimersByTime(100));
  fireEvent.change(input, { target: { value: 'B' } });
  fireEvent.change(input, { target: { value: 'A' } });
  act(() => vi.advanceTimersByTime(249));
  expect(navigation.replace).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/inventory?q=A', {
    scroll: false,
  });
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Search inventory' }));
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/inventory', {
    scroll: false,
  });
  act(() => vi.advanceTimersByTime(300));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  unmount();
  vi.useRealTimers();
});

it('waits for composition, preserves later typing across an earlier response, and restores history', () => {
  vi.useFakeTimers();
  navigation.replace.mockClear();
  const props = { categories: [], locations: [], sites: [] };
  const { rerender, unmount } = render(
    <SearchForm {...props} params={{ q: 'old' }} />,
  );
  const input = screen.getByRole('textbox', { name: 'Search inventory' });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'composed' } });
  act(() => vi.advanceTimersByTime(500));
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  act(() => vi.advanceTimersByTime(250));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: 'newer' } });
  rerender(<SearchForm {...props} params={{ q: 'composed' }} />);
  expect(input).toHaveValue('newer');
  act(() => vi.advanceTimersByTime(250));
  expect(navigation.replace).toHaveBeenLastCalledWith('/inventory?q=newer', {
    scroll: false,
  });
  window.history.replaceState(null, '', '/inventory?q=history&type=asset');
  fireEvent.popState(window);
  expect(input).toHaveValue('history');
  expect(screen.getByRole('combobox', { name: 'Tracking type' })).toHaveValue(
    'asset',
  );
  expect(screen.getByRole('textbox', { name: 'Search inventory' })).toBe(input);
  unmount();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

const category = {
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Cables',
  active: true,
};
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
  await user.selectOptions(
    categorySelect,
    '00000000-0000-4000-8000-000000000101',
  );
  await user.click(screen.getByRole('button', { name: 'Fewer filters' }));
  expect(categorySelect).toHaveValue('00000000-0000-4000-8000-000000000101');
  expect(container.querySelector('#inventory-more-filters')).toHaveAttribute(
    'inert',
  );
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Search inventory' }) as HTMLFormElement,
    ).get('category'),
  ).toBe('00000000-0000-4000-8000-000000000101');
  await user.click(screen.getByRole('button', { name: 'More filters' }));
  expect(categorySelect).toHaveValue('00000000-0000-4000-8000-000000000101');
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Search inventory' }) as HTMLFormElement,
    ).get('category'),
  ).toBe('00000000-0000-4000-8000-000000000101');

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

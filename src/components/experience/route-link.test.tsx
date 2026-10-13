import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import Link from './route-link';

const next = vi.hoisted(() => ({ props: vi.fn(), navigation: vi.fn() }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    href,
    prefetch,
    onNavigate,
    children,
    scroll,
    ...props
  }: Omit<ComponentProps<'a'>, 'href'> & {
    href: string | { pathname?: string };
    prefetch?: boolean | null;
    scroll?: boolean;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => {
    next.props({ href, prefetch });
    if (scroll !== undefined) expect(scroll).toBe(false);
    return (
      <a
        {...props}
        href={typeof href === 'string' ? href : href.pathname}
        onClick={(event) => {
          props.onClick?.(event);
          event.preventDefault();
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
          let prevented = false;
          onNavigate?.({
            preventDefault: () => {
              prevented = true;
            },
          });
          if (!prevented) next.navigation(href);
        }}
      >
        {children}
      </a>
    );
  },
}));

beforeEach(() => {
  next.props.mockClear();
  next.navigation.mockClear();
});

const quantity = '/inventory/quantity/70000000-0000-4000-8000-000000000001';
it.each([
  '/inventory',
  '/inventory?q=cable&type=quantity#inventory-row-2',
  quantity,
  quantity + '?returnTo=%2Finventory%3Fq%3Dcable%23inventory-row-2',
  '/inventory/assets/70000000-0000-4000-8000-000000000002#details',
  { pathname: '/inventory', query: { q: 'cable' }, hash: 'inventory-row-2' },
  { pathname: quantity, query: { returnTo: '/inventory#inventory-row-2' } },
])(
  'suppresses every caller prefetch override for inventory destination %j',
  (href) => {
    const view = render(
      <Link href={href} prefetch={true}>
        Record
      </Link>,
    );
    expect(next.props).toHaveBeenLastCalledWith({ href, prefetch: false });
    view.rerender(
      <Link href={href} prefetch={null}>
        Record
      </Link>,
    );
    expect(next.props).toHaveBeenLastCalledWith({ href, prefetch: false });
  },
);

it('keeps inventory prefetch disabled when navigation hover or keyboard intent re-enables ordinary partial prefetch', () => {
  function IntentLink() {
    const [intent, setIntent] = useState(false);
    return (
      <Link
        href="/inventory"
        prefetch={intent ? null : false}
        onMouseEnter={() => setIntent(true)}
        onFocus={() => setIntent(true)}
      >
        Inventory
      </Link>
    );
  }
  const view = render(<IntentLink />);
  fireEvent.mouseEnter(screen.getByRole('link', { name: 'Inventory' }));
  expect(next.props).toHaveBeenLastCalledWith({
    href: '/inventory',
    prefetch: false,
  });
  view.unmount();
  render(<IntentLink />);
  fireEvent.focus(screen.getByRole('link', { name: 'Inventory' }));
  expect(next.props).toHaveBeenLastCalledWith({
    href: '/inventory',
    prefetch: false,
  });
});

it.each([
  '/inventory/quantity/new',
  '/inventory/assets/new?returnTo=%2Finventory',
  '/inventory/quantity/%6eew',
  '/inventory/quantity/%ZZ',
  '/inventory/quantity/id/extra',
  '/locations/ITC-S1A',
  '/history',
  '/inventory-other',
  'https://external.test/inventory',
  '//external.test/inventory/quantity/id',
  '/\\external.test/inventory',
  { pathname: '/inventory', host: 'external.test' },
])(
  'preserves the original prefetch behavior for creation, malformed, other or external destination %j',
  (href) => {
    render(
      <Link href={href} prefetch={null}>
        Other destination
      </Link>,
    );
    expect(next.props).toHaveBeenLastCalledWith({ href, prefetch: null });
  },
);

it('preserves navigation guards and modifier gestures while retaining exact href, hash and scroll configuration', () => {
  const href = quantity + '?returnTo=%2Finventory%23inventory-row-2#details';
  const guard = vi.fn((event: { preventDefault: () => void }) =>
    event.preventDefault(),
  );
  const view = render(
    <Link href={href} scroll={false} onNavigate={guard}>
      Record
    </Link>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Record' }));
  expect(guard).toHaveBeenCalledOnce();
  expect(next.navigation).not.toHaveBeenCalled();
  view.rerender(
    <Link href={href} scroll={false} onNavigate={guard}>
      Record
    </Link>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Record' }), {
    ctrlKey: true,
  });
  expect(guard).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Record' })).toHaveAttribute(
    'href',
    href,
  );
  view.rerender(
    <Link href={href} scroll={false}>
      Record
    </Link>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Record' }));
  expect(next.navigation).toHaveBeenCalledExactlyOnceWith(href);
});

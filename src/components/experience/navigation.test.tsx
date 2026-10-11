import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Navigation } from './navigation';

const route = vi.hoisted(() => ({ pathname: '/dashboard' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
afterEach(() => {
  window.localStorage.removeItem('it-inventory-reduce-motion');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
  );
});

describe('workspace navigation', () => {
  beforeEach(() => {
    route.pathname = '/dashboard';
  });

  it('marks nested routes active without depending on query strings', () => {
    route.pathname = '/inventory/quantity/example';
    render(<Navigation />);
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Spaces & maps' })).toHaveAttribute(
      'href',
      '/room',
    );
  });

  it('keeps route links usable while the pathname is unavailable', () => {
    route.pathname = null;
    render(<Navigation />);
    expect(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'href',
      '/inventory',
    );
    expect(screen.getByRole('link', { name: 'Inventory' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('keeps navigation and its menu together without a global motion control', () => {
    render(<Navigation />);
    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    });
    const stack = navigation.parentElement;
    expect(stack).toHaveClass('experience-nav-stack');
    expect(
      screen.queryByRole('switch', { name: 'Reduce motion in this browser' }),
    ).not.toBeInTheDocument();
    expect(stack).toContainElement(
      screen.getByRole('button', { name: 'Menu' }),
    );
  });

  it('offers one compact mobile menu control with native route links', async () => {
    const user = userEvent.setup();
    render(<Navigation />);
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    await user.click(menu);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const scan = screen.getByRole('link', { name: 'Scan' });
    scan.addEventListener('click', (event) => event.preventDefault());
    await user.click(scan);
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

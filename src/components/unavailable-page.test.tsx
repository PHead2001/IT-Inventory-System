import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const nextRecoveryLink = vi.hoisted(() => vi.fn());
vi.mock('@/components/experience/route-link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => {
    nextRecoveryLink(props);
    return <a {...props}>{children}</a>;
  },
}));
import { UnavailablePage } from './unavailable-page';
it('offers useful recovery without claiming deletion or exposing a requested record', () => {
  render(<UnavailablePage inventory />);
  expect(
    screen.getByRole('heading', { name: 'Inventory record unavailable' }),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
  expect(screen.getByRole('link', { name: 'Open Overview' })).toHaveAttribute(
    'href',
    '/dashboard',
  );
  expect(screen.queryByText(/deleted|unauthorized/i)).not.toBeInTheDocument();
  expect(nextRecoveryLink).toHaveBeenCalledTimes(2);
});

it('uses native document recovery on public 404 without mounting Next links or prefetch consumers', () => {
  render(<UnavailablePage />);
  expect(nextRecoveryLink).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Open Overview' })).toHaveAttribute(
    'href',
    '/dashboard',
  );
  expect(
    screen.getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
});

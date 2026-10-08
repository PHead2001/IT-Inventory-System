import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
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
});

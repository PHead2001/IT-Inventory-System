import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AccountIdentity } from './account-identity';

it('exposes the verified full name and role through a keyboard reachable account disclosure, updating with session props', () => {
  const { rerender } = render(
    <AccountIdentity name="Alex Long Account Name" role="staff" />,
  );
  const control = screen.getByLabelText(
    'Account: Alex Long Account Name, staff',
  );
  expect(control.tagName).toBe('SUMMARY');
  fireEvent.click(control);
  expect(screen.getAllByText('Alex Long Account Name').at(-1)).toBeVisible();
  expect(screen.getByText('staff')).toBeVisible();
  rerender(<AccountIdentity name="New Viewer" role="viewer" />);
  expect(screen.queryByText('Alex Long Account Name')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Account: New Viewer, viewer')).toBeVisible();
});

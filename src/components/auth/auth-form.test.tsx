import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({
  login: vi.fn(async () => ({ error: 'Unable to sign in.' })),
  recover: vi.fn(async () => ({})),
  confirmAuth: vi.fn(async () => ({})),
  setPassword: vi.fn(async () => ({})),
  logout: vi.fn(async () => ({})),
}));
vi.mock('@/lib/auth/actions', () => actions);
import { AuthForm } from './auth-form';
it('uses accessible login fields and presents action errors', async () => {
  render(<AuthForm mode="login" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'staff@example.test');
  await user.type(screen.getByLabelText('Password'), 'NotThePassword');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to sign in.',
  );
});
it('requires explicit interaction to exchange an email token', () => {
  render(<AuthForm mode="confirm" tokenHash="abc123" tokenType="invite" />);
  expect(actions.confirmAuth).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Continue securely' }),
  ).toBeEnabled();
});
it('labels password confirmation and help text', () => {
  render(<AuthForm mode="password" />);
  expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
    'autocomplete',
    'new-password',
  );
  expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
    'Use at least 12 characters.',
  );
  expect(screen.getByLabelText('Current password')).toHaveAttribute(
    'autocomplete',
    'current-password',
  );
});
it('allows server-verified emailed completion without an old password', () => {
  render(<AuthForm mode="password" emailedCompletion />);
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Confirm password')).toBeRequired();
});
it('replaces password retry with guarded sign-out after a committed change', async () => {
  actions.setPassword.mockResolvedValueOnce({
    passwordUpdated: true,
    error: 'Your password was updated, but sign-out failed.',
  });
  render(<AuthForm mode="password" emailedCompletion />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password'), 'Replacement123456');
  await user.type(
    screen.getByLabelText('Confirm password'),
    'Replacement123456',
  );
  await user.click(screen.getByRole('button', { name: 'Set password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'password was updated',
  );
  expect(
    screen.queryByRole('button', { name: 'Set password' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
});

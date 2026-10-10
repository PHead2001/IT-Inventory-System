import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({
  login: vi.fn(async () => ({ error: 'Unable to sign in.' })),
  recover: vi.fn(async () => ({})),
  confirmAuth: vi.fn(async () => ({})),
  setPassword: vi.fn(async () => ({})),
  logout: vi.fn(async () => ({})),
  signOutSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/auth/actions', () => actions);
const routing = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => routing,
}));
import { AuthForm } from './auth-form';
beforeEach(() => sessionStorage.clear());
it('uses accessible login fields and presents action errors', async () => {
  render(<AuthForm mode="login" />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'staff@example.test');
  await user.type(screen.getByLabelText('Password'), 'NotThePassword');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to sign in.',
  );
});
it('requires explicit interaction to exchange an email token', async () => {
  render(<AuthForm mode="confirm" tokenHash="abc123" tokenType="invite" />);
  expect(actions.confirmAuth).not.toHaveBeenCalled();
  expect(
    await screen.findByRole('button', { name: 'Continue securely' }),
  ).toBeEnabled();
});
it('labels password confirmation and help text', async () => {
  render(<AuthForm mode="password" />);
  expect(await screen.findByLabelText('Confirm password')).toHaveAttribute(
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
it('allows server-verified emailed completion without an old password', async () => {
  render(<AuthForm mode="password" emailedCompletion />);
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  expect(await screen.findByLabelText('Confirm password')).toBeRequired();
});
it('replaces password retry with guarded sign-out after a committed change', async () => {
  actions.setPassword.mockResolvedValueOnce({
    passwordUpdated: true,
    error: 'Your password was updated, but sign-out failed.',
  });
  render(<AuthForm mode="password" emailedCompletion />);
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText('Password'),
    'Replacement123456',
  );
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

import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/auth/password-session.server', () => ({
  readPasswordSession: mocks.session,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: {} }),
}));
vi.mock('@/components/auth/auth-form', () => ({
  AuthForm: ({ emailedCompletion }: { emailedCompletion: boolean }) => (
    <form
      aria-label={
        emailedCompletion ? 'Email completion' : 'Current password required'
      }
    />
  ),
}));
import SetPasswordPage from './page';
beforeEach(() => {
  vi.resetAllMocks();
});
it.each([true, false])(
  'uses the verified session result to render completion=%s',
  async (emailedCompletion) => {
    mocks.session.mockResolvedValue({ emailedCompletion });
    render(await SetPasswordPage());
    expect(
      screen.getByRole('form', {
        name: emailedCompletion
          ? 'Email completion'
          : 'Current password required',
      }),
    ).toBeInTheDocument();
  },
);
it('shows recoverable verification failure without a password form', async () => {
  mocks.session.mockResolvedValue(null);
  render(await SetPasswordPage());
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to verify');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
    'href',
    '/login?switch=1',
  );
});

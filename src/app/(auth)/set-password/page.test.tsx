import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/auth/password-session.server', () => ({
  readPasswordSession: mocks.session,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: {} }),
}));
vi.mock('@/lib/auth/actions', () => ({
  login: vi.fn(),
  recover: vi.fn(),
  confirmAuth: vi.fn(),
  setPassword: vi.fn(),
  signOutSession: vi.fn(),
  readLogoutPrivacyGeneration: async () => ({ status: 'absent' }),
  acknowledgeLogoutPrivacyGeneration: async () => ({ status: 'match' }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/test',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
import SetPasswordPage from './page';
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
it.each([true, false])(
  'uses the verified session result to render completion=%s',
  async (emailedCompletion) => {
    mocks.session.mockResolvedValue({ emailedCompletion });
    render(await SetPasswordPage());
    expect(
      await screen.findByRole('form', {
        name: 'Set password',
      }),
    ).toBeInTheDocument();
    expect(!!screen.queryByLabelText('Current password')).toBe(
      !emailedCompletion,
    );
  },
);
it('shows recoverable verification failure without a password form', async () => {
  mocks.session.mockResolvedValue(null);
  render(await SetPasswordPage());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to verify',
  );
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
    'href',
    '/login?switch=1',
  );
});

it('rejects unusable emailed sessions without offering the current-password form', async () => {
  mocks.session.mockResolvedValue({
    emailedCompletion: false,
    emailProof: 'unusable',
  });
  render(await SetPasswordPage());
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Request a new reset email' }),
  ).toHaveAttribute('href', '/forgot-password');
});
it.each([null, { emailedCompletion: false, emailProof: 'unusable' }])(
  'offers separate keyboard-operable recovery links for an unverifiable session',
  async (session) => {
    mocks.session.mockResolvedValue(session);
    const user = userEvent.setup();
    render(await SetPasswordPage());
    const recovery = await screen.findByRole('navigation', {
      name: 'Password recovery',
    });
    const links = within(recovery).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/login?switch=1');
    expect(links[1]).toHaveAttribute('href', '/forgot-password');
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  },
);

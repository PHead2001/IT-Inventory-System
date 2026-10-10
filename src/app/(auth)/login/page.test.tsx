import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), privacy: vi.fn() }));
vi.mock('@/lib/auth/privacy-barrier.server', () => ({
  readLogoutGeneration: mocks.privacy,
}));
vi.mock('@/lib/auth/login-session.server', () => ({
  readLoginSession: mocks.session,
}));
vi.mock('@/components/auth/auth-form', () => ({
  AuthForm: ({ next }: { next?: string }) => (
    <form aria-label="Sign in">
      <input type="hidden" name="next" value={next ?? ''} readOnly />
    </form>
  ),
}));
vi.mock('@/components/auth/auth-privacy', () => ({
  AuthPrivacyRedirect: ({ destination }: { destination: string }) => (
    <p data-testid="privacy-redirect">{destination}</p>
  ),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error('REDIRECT:' + path);
  },
}));
import LoginPage from './page';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue('anonymous');
  mocks.privacy.mockResolvedValue({ status: 'absent' });
});
it.each([
  ['/locations/ITC', '/locations/ITC'],
  ['/dashboard', '/dashboard'],
  ['https://evil.test', '/inventory'],
  ['//evil.test', '/inventory'],
  ['/login', '/inventory'],
  ['/dashboard?next=https://evil.test', '/inventory'],
  [undefined, '/inventory'],
])('redirects members safely from %s', async (next, expected) => {
  mocks.session.mockResolvedValue('member');
  await expect(
    LoginPage({ searchParams: Promise.resolve({ next }) }),
  ).rejects.toThrow('REDIRECT:' + expected);
});
it('denies an inactive or missing member without returning to login', async () => {
  mocks.session.mockResolvedValue('denied');
  await expect(
    LoginPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow('REDIRECT:/access-denied');
});
it.each([
  ['/dashboard', '/dashboard'],
  ['/dashboard?next=https://evil.test', ''],
  ['https://evil.test/dashboard', ''],
])(
  'passes only the safe Overview return into the anonymous login form: %s',
  async (next, expected) => {
    render(await LoginPage({ searchParams: Promise.resolve({ next }) }));
    expect(
      screen
        .getByRole('form', { name: 'Sign in' })
        .querySelector('input[name="next"]'),
    ).toHaveValue(expected);
  },
);
it('supports deliberate account switching without a redirect loop', async () => {
  mocks.session.mockResolvedValue('member');
  render(await LoginPage({ searchParams: Promise.resolve({ switch: '1' }) }));
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
});
it.each(['anonymous', 'member'] as const)(
  '%s login and explicit account switching preserve only safe destinations for the sign-in action',
  async (session) => {
    mocks.session.mockResolvedValue(session);
    for (const [next, expected] of [
      [undefined, ''],
      ['https://evil.test', ''],
      ['//evil.test', ''],
      ['/dashboard?next=https://evil.test', ''],
      ['/dashboard', '/dashboard'],
      ['/locations/ITC', '/locations/ITC'],
    ] as const) {
      const { unmount } = render(
        await LoginPage({
          searchParams: Promise.resolve({
            next,
            ...(session === 'member' ? { switch: '1' } : {}),
          }),
        }),
      );
      expect(
        screen
          .getByRole('form', { name: 'Sign in' })
          .querySelector('input[name="next"]'),
      ).toHaveValue(expected);
      unmount();
    }
  },
);
it('fails closed with a retry path when the session check is unavailable', async () => {
  mocks.session.mockResolvedValue('unavailable');
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});
it('does not present a forged password query as proof of a password change', async () => {
  render(
    await LoginPage({
      searchParams: Promise.resolve({ password: 'updated' }),
    }),
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Sign in with your current password.',
  );
  expect(screen.getByRole('status')).not.toHaveTextContent(
    /updated|new password/i,
  );
});
it.each([
  ['/locations/ITC', '/login?switch=1&next=%2Flocations%2FITC'],
  ['https://evil.example', '/login?switch=1'],
  ['//evil.example', '/login?switch=1'],
])(
  'keeps only validated return paths while switching accounts: %s',
  async (next, href) => {
    mocks.session.mockResolvedValue('unavailable');
    render(await LoginPage({ searchParams: Promise.resolve({ next }) }));
    expect(
      screen.getByRole('link', { name: 'Use another account' }),
    ).toHaveAttribute('href', href);
  },
);

it.each([
  ['/dashboard', '/dashboard'],
  ['https://evil.test', '/inventory'],
  [undefined, '/inventory'],
])(
  'sends an already signed-in tab through cleanup then a safe existing destination %s',
  async (next, expected) => {
    mocks.session.mockResolvedValue('member');
    mocks.privacy.mockResolvedValue({
      status: 'valid',
      generation: '00000000-0000-4000-8000-000000000001',
    });
    render(await LoginPage({ searchParams: Promise.resolve({ next }) }));
    expect(screen.getByTestId('privacy-redirect')).toHaveTextContent(expected!);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  },
);

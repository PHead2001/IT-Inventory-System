import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/auth/login-session.server', () => ({
  readLoginSession: mocks.session,
}));
vi.mock('@/components/auth/auth-form', () => ({
  AuthForm: () => <form aria-label="Sign in" />,
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
});
it.each([
  ['/locations/ITC', '/locations/ITC'],
  ['https://evil.test', '/dashboard'],
  ['/login', '/dashboard'],
  [undefined, '/dashboard'],
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
it('supports deliberate account switching without a redirect loop', async () => {
  mocks.session.mockResolvedValue('member');
  render(await LoginPage({ searchParams: Promise.resolve({ switch: '1' }) }));
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
});
it('fails closed with a retry path when the session check is unavailable', async () => {
  mocks.session.mockResolvedValue('unavailable');
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});

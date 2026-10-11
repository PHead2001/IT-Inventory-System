import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
import {
  compareLogoutGeneration,
  mayEstablishSession,
  readLogoutGeneration,
  recordConfirmedLogout,
} from './privacy-barrier.server';
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('VERCEL_ENV', 'development');
  mocks.cookies.mockResolvedValue({ get: mocks.get, set: mocks.set });
});
it('retains a versioned opaque HttpOnly host-only local reminder for one year', async () => {
  const receipt = await recordConfirmedLogout();
  expect(receipt).toEqual({
    logoutGeneration: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(mocks.set).toHaveBeenCalledWith(
    'inventory-logout-local-v1',
    'v1:' + receipt.logoutGeneration,
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 31536000,
    },
  );
  expect(mocks.set.mock.calls[0][2]).not.toHaveProperty('domain');
});
it('uses Secure __Host cookies for configured HTTPS production', async () => {
  vi.stubEnv('APP_ORIGIN', 'https://inventory.example.test');
  vi.stubEnv('VERCEL_ENV', 'production');
  await recordConfirmedLogout();
  expect(mocks.set).toHaveBeenCalledWith(
    '__Host-inventory-logout-v1',
    expect.any(String),
    expect.objectContaining({ secure: true, httpOnly: true, path: '/' }),
  );
});
it('returns a distinct already-signed-out reminder failure when cookie preparation throws', async () => {
  mocks.set.mockImplementation(() => {
    throw new Error('headers unavailable');
  });
  expect(await recordConfirmedLogout()).toEqual({
    cleanupReminderUnavailable: true,
  });
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(await recordConfirmedLogout()).toEqual({
    cleanupReminderUnavailable: true,
  });
});
it.each([undefined, '', 'v2:' + first, 'v1:garbage'])(
  'classifies absent or invalid cookie %s without erasure authority',
  async (value) => {
    mocks.get.mockReturnValue(value === undefined ? undefined : { value });
    expect(await readLogoutGeneration()).toEqual({
      status: value === undefined ? 'absent' : 'invalid',
    });
  },
);
it('fails closed on cookie access failure', async () => {
  mocks.cookies.mockRejectedValue(new Error('headers unavailable'));
  expect(await readLogoutGeneration()).toEqual({ status: 'unavailable' });
  expect(await compareLogoutGeneration(first)).toEqual({
    status: 'unavailable',
  });
});
it('acknowledges two tabs without consuming or changing the cookie', async () => {
  mocks.get.mockReturnValue({ value: 'v1:' + first });
  expect(await compareLogoutGeneration(first)).toEqual({ status: 'match' });
  expect(await compareLogoutGeneration(first)).toEqual({ status: 'match' });
  expect(mocks.set).not.toHaveBeenCalled();
});
it('a late acknowledgement observes a newer logout without overwriting it', async () => {
  mocks.get.mockReturnValue({ value: 'v1:' + second });
  expect(await compareLogoutGeneration(first)).toEqual({
    status: 'changed',
    generation: second,
  });
  expect(await compareLogoutGeneration('invalid')).toEqual({
    status: 'invalid',
  });
  expect(mocks.set).not.toHaveBeenCalled();
});
it('requires the current rendered tab generation before creating a session', async () => {
  expect(await mayEstablishSession('absent')).toBe(true);
  expect(await mayEstablishSession(null)).toBe(false);
  mocks.get.mockReturnValue({ value: 'v1:' + second });
  expect(await mayEstablishSession(first)).toBe(false);
  expect(await mayEstablishSession(second)).toBe(true);
  mocks.get.mockReturnValue({ value: 'invalid' });
  expect(await mayEstablishSession('invalid')).toBe(false);
});

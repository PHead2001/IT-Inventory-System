import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  emailProofState,
  hasRecentEmailProof,
  readPasswordSession,
} from './password-session.server';
const now = 2_000_000_000;
const claims = {
  sub: 'user',
  session_id: 'b81d6f4b-692a-4d6c-a958-732e26d4c9d8',
  exp: now + 3600,
  iat: now,
  amr: [{ method: 'otp', timestamp: now }],
};
it.each(['otp', 'magiclink', 'recovery'])(
  'accepts a verified recent %s proof',
  (method) => {
    expect(
      hasRecentEmailProof(
        { ...claims, amr: [{ method, timestamp: now - 600 }] },
        'user',
        now,
      ),
    ).toBe(true);
  },
);
it.each([
  { sub: 'other' },
  { session_id: 'unbound' },
  { exp: now },
  { exp: NaN },
  { iat: now + 1 },
  { amr: null },
  { amr: [{ method: 'password', timestamp: now }] },
  { amr: [{ method: 'otp', timestamp: now - 601 }] },
  { amr: [{ method: 'otp', timestamp: now + 1 }] },
  { amr: [{ method: 'otp', timestamp: String(now) }] },
  { amr: [null, 'otp'] },
])('rejects missing, stale, future, or mismatched proof %j', (patch) => {
  expect(hasRecentEmailProof({ ...claims, ...patch }, 'user', now)).toBe(false);
});

it('distinguishes stale email presence from an ordinary password session', () => {
  expect(
    emailProofState(
      { ...claims, amr: [{ method: 'password', timestamp: now }] },
      'user',
      now,
    ),
  ).toBe('absent');
  expect(
    emailProofState(
      {
        ...claims,
        amr: [
          { method: 'otp', timestamp: now - 601 },
          { method: 'password', timestamp: now },
        ],
      },
      'user',
      now,
    ),
  ).toBe('unusable');
  expect(
    emailProofState(
      { ...claims, amr: [{ method: 'otp', timestamp: now - 600 }] },
      'user',
      now,
    ),
  ).toBe('recent');
});
it.each([now + 1, String(now), null, undefined, NaN])(
  'retains unusable email presence for timestamp %s',
  (timestamp) => {
    expect(
      emailProofState(
        { ...claims, amr: [{ method: 'otp', timestamp }] },
        'user',
        now,
      ),
    ).toBe('unusable');
  },
);
it('retains stale proof status when reading the verified current session', async () => {
  const current = Math.floor(Date.now() / 1000);
  const auth = {
    getUser: vi
      .fn()
      .mockResolvedValue({ data: { user: { id: 'user' } }, error: null }),
    getClaims: vi.fn().mockResolvedValue({
      data: {
        claims: {
          ...claims,
          iat: current,
          exp: current + 3600,
          amr: [{ method: 'otp', timestamp: current - 601 }],
        },
      },
      error: null,
    }),
  };
  const session = await readPasswordSession(
    auth as unknown as Parameters<typeof readPasswordSession>[0],
  );
  expect(session).toMatchObject({
    emailProof: 'unusable',
    emailedCompletion: false,
  });
});

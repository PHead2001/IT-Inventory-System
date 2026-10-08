import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { hasRecentEmailProof } from './password-session.server';
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

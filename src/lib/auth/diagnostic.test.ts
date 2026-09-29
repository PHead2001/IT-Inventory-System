import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  authDiagnosticsEnabled,
  createAuthDiagnostic,
  observeAuthStage,
  observeAuthStageSync,
} from './diagnostic.server';

beforeEach(() => {
  vi.stubEnv('AUTH_DIAGNOSTICS', undefined);
  vi.stubEnv('APP_ENV', undefined);
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('fails closed without explicit opt-in and on production even if local-looking variables are set', () => {
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  expect(authDiagnosticsEnabled()).toBe(false);
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  expect(authDiagnosticsEnabled()).toBe(true);
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(authDiagnosticsEnabled()).toBe(false);
  expect(createAuthDiagnostic()).toBeNull();
});

it('allows only explicit preview or loopback local contexts', () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://hosted.example');
  expect(authDiagnosticsEnabled()).toBe(false);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
  expect(authDiagnosticsEnabled()).toBe(true);
  vi.stubEnv('VERCEL', '1');
  expect(authDiagnosticsEnabled()).toBe(false);
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(authDiagnosticsEnabled()).toBe(true);
  expect(createAuthDiagnostic()?.correlation).toMatch(
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/,
  );
});

it('logs only fixed stage, duration, and ephemeral correlation without operation data', async () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const diagnostic = createAuthDiagnostic();
  const sensitive = 'credential-and-user-id-should-not-appear';
  expect(
    await observeAuthStage(
      diagnostic,
      'login.credentials',
      async () => sensitive,
    ),
  ).toBe(sensitive);
  expect(
    observeAuthStageSync(diagnostic, 'cookie.setAll', () => sensitive),
  ).toBe(sensitive);
  expect(info).toHaveBeenCalledTimes(2);
  const lines = info.mock.calls.map(([line]) => String(line));
  expect(lines.join(' ')).not.toContain(sensitive);
  const events = lines.map((line) =>
    JSON.parse(line.slice('AUTH_DIAGNOSTIC '.length)),
  );
  expect(events.map((event) => event.stage)).toEqual([
    'login.credentials',
    'cookie.setAll',
  ]);
  expect(events[0].correlation).toBe(events[1].correlation);
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual([
      'correlation',
      'durationMs',
      'stage',
    ]);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  }
});

it('preserves operation results and original failures when logging fails', async () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('observer failed');
  });
  const diagnostic = createAuthDiagnostic();
  expect(
    await observeAuthStage(diagnostic, 'login.getUser', async () => 42),
  ).toBe(42);
  const original = new Error('original cookie failure');
  expect(() =>
    observeAuthStageSync(diagnostic, 'cookie.setAll', () => {
      throw original;
    }),
  ).toThrow(original);
  await expect(
    observeAuthStage(diagnostic, 'member.membership', async () => {
      throw original;
    }),
  ).rejects.toBe(original);
});

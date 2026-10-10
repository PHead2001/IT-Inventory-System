import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: { display_name: 'Viewer', role: 'viewer' },
  }),
}));
const privacyMocks = vi.hoisted(() => ({ read: vi.fn(), compare: vi.fn() }));
vi.mock('@/lib/auth/privacy-barrier.server', () => ({
  readLogoutGeneration: async () => ({ status: 'absent' }),
}));
vi.mock('@/lib/auth/actions', () => ({
  signOutSession: vi.fn(),
  readLogoutPrivacyGeneration: privacyMocks.read,
  acknowledgeLogoutPrivacyGeneration: privacyMocks.compare,
}));
vi.mock('@/features/scan/assignment-scope-guard', () => ({
  AssignmentScopeGuard: () => null,
}));
beforeEach(() => {
  sessionStorage.clear();
  privacyMocks.read.mockResolvedValue({ status: 'absent' });
  privacyMocks.compare.mockResolvedValue({ status: 'match' });
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/telemetry/private-speed-insights', () => ({
  PrivateSpeedInsights: () => <span data-testid="private-speed-insights" />,
}));
import ApplicationLayout from './layout';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('protected Speed Insights placement', () => {
  it('mounts once after membership only with explicit Vercel opt-in', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('SPEED_INSIGHTS_ENABLED', 'true');
    render(await ApplicationLayout({ children: <p>Inventory</p> }));
    expect(await screen.findAllByTestId('private-speed-insights')).toHaveLength(
      1,
    );
    expect(screen.getByText('Inventory', { selector: 'p' })).toBeVisible();
  });

  it('omits telemetry in local and unapproved Vercel environments', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('SPEED_INSIGHTS_ENABLED', 'true');
    render(await ApplicationLayout({ children: <p>Local inventory</p> }));
    await screen.findByText('Local inventory', { selector: 'p' });
    expect(
      screen.queryByTestId('private-speed-insights'),
    ).not.toBeInTheDocument();
    cleanup();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SPEED_INSIGHTS_ENABLED', 'false');
    render(await ApplicationLayout({ children: <p>Hosted inventory</p> }));
    await screen.findByText('Hosted inventory', { selector: 'p' });
    expect(
      screen.queryByTestId('private-speed-insights'),
    ).not.toBeInTheDocument();
  });
});

it('withholds private restoration until this tab verifies the browser-wide generation', async () => {
  const generation = '00000000-0000-4000-8000-000000000001';
  const command = 'inventory-assign-v1:previous-session';
  sessionStorage.setItem(command, 'exact uncertain command');
  let finish!: (value: { status: 'valid'; generation: string }) => void;
  privacyMocks.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  function PrivateConsumer() {
    return (
      <p>{sessionStorage.getItem(command) ?? 'Clean private restoration'}</p>
    );
  }
  render(await ApplicationLayout({ children: <PrivateConsumer /> }));
  expect(screen.queryByText('exact uncertain command')).not.toBeInTheDocument();
  finish({ status: 'valid', generation });
  expect(await screen.findByText('Clean private restoration')).toBeVisible();
  expect(sessionStorage.getItem(command)).toBeNull();
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: { display_name: 'Viewer', role: 'viewer' },
  }),
}));
vi.mock('@/lib/auth/actions', () => ({ logout: vi.fn() }));
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
    expect(screen.getAllByTestId('private-speed-insights')).toHaveLength(1);
    expect(screen.getByText('Inventory', { selector: 'p' })).toBeVisible();
  });

  it('omits telemetry in local and unapproved Vercel environments', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('SPEED_INSIGHTS_ENABLED', 'true');
    render(await ApplicationLayout({ children: <p>Local inventory</p> }));
    expect(
      screen.queryByTestId('private-speed-insights'),
    ).not.toBeInTheDocument();
    cleanup();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SPEED_INSIGHTS_ENABLED', 'false');
    render(await ApplicationLayout({ children: <p>Hosted inventory</p> }));
    expect(
      screen.queryByTestId('private-speed-insights'),
    ).not.toBeInTheDocument();
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
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
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it('uses the dynamic privacy boundary without a streaming Suspense wrapper', async () => {
  const layout = await ApplicationLayout({ children: <p>Inventory</p> });
  expect(layout.type).toBe(ProtectedPrivacyBoundary);
  expect(layout.props.serverGeneration).toEqual({ status: 'absent' });
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
  render(
    await ApplicationLayout({
      children: (
        <ProtectedPrivacyContent>
          <PrivateConsumer />
        </ProtectedPrivacyContent>
      ),
    }),
  );
  expect(screen.queryByText('exact uncertain command')).not.toBeInTheDocument();
  finish({ status: 'valid', generation });
  expect(await screen.findByText('Clean private restoration')).toBeVisible();
  expect(sessionStorage.getItem(command)).toBeNull();
});

it('keeps privacy cleanup and retry before the blank shell while private fields stay inert', async () => {
  let finish!: (value: { status: 'absent' } | { status: 'invalid' }) => void;
  privacyMocks.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    await ApplicationLayout({
      children: (
        <ProtectedPrivacyContent>
          <input aria-label="Private field" defaultValue="initial work" />
        </ProtectedPrivacyContent>
      ),
    }),
  );
  const shell = view.container.querySelector('.experience-app')!;
  const beforeShell = (message: HTMLElement) =>
    expect(
      message.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  beforeShell(screen.getByRole('status'));
  expect(screen.queryByLabelText('Private field')).not.toBeInTheDocument();
  await act(async () => finish({ status: 'absent' }));
  const field = await screen.findByLabelText('Private field');
  fireEvent.change(field, { target: { value: 'unsaved work' } });
  privacyMocks.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => window.dispatchEvent(new Event('focus')));
  beforeShell(screen.getByRole('status'));
  expect(field).not.toBeVisible();
  expect(field.closest('[inert]')).not.toBeNull();
  await act(async () => finish({ status: 'invalid' }));
  beforeShell(await screen.findByRole('alert'));
  beforeShell(screen.getByRole('button', { name: 'Retry privacy cleanup' }));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(
    screen.getAllByRole('button', { name: 'Retry privacy cleanup' }),
  ).toHaveLength(1);
  expect(field).not.toBeVisible();
  expect(field.closest('[inert]')).not.toBeNull();
  expect(field).toHaveValue('unsaved work');
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documentBoundary = vi.hoisted(() => ({
  admission: vi.fn(),
  member: vi.fn(),
}));
vi.mock('./document-admission.server', () => ({
  admitDocumentRecord: documentBoundary.admission,
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => {
    await documentBoundary.member();
    return {
      member: {
        user_id: 'viewer-actor',
        display_name: 'Viewer',
        role: 'viewer',
        can_manage_configuration: false,
      },
    };
  },
}));
const privacyMocks = vi.hoisted(() => ({
  read: vi.fn(),
  compare: vi.fn(),
  identity: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const stableRouter = {
  replace: privacyMocks.replace,
  refresh: privacyMocks.refresh,
};
vi.mock('@/lib/auth/privacy-barrier.server', () => ({
  readLogoutGeneration: async () => ({ status: 'absent' }),
}));
vi.mock('@/lib/auth/actions', () => ({
  signOutSession: privacyMocks.signOut,
  readProtectedPrivacyIdentity: privacyMocks.identity,
  readLogoutPrivacyGeneration: privacyMocks.read,
  acknowledgeLogoutPrivacyGeneration: privacyMocks.compare,
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  signOutSession: privacyMocks.signOut,
  readProtectedPrivacyIdentity: privacyMocks.identity,
  readLogoutPrivacyGeneration: privacyMocks.read,
  acknowledgeLogoutPrivacyGeneration: privacyMocks.compare,
}));
vi.mock('@/lib/auth/logout-transport', () => ({
  signOutSession: privacyMocks.signOut,
  readProtectedPrivacyIdentity: privacyMocks.identity,
  readLogoutPrivacyGeneration: privacyMocks.read,
  acknowledgeLogoutPrivacyGeneration: privacyMocks.compare,
}));
vi.mock('@/features/scan/assignment-scope-guard', () => ({
  AssignmentScopeGuard: () => null,
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));
beforeEach(() => {
  documentBoundary.admission.mockReset().mockResolvedValue(false);
  documentBoundary.member.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://isolated.supabase.co');
  sessionStorage.clear();
  privacyMocks.read.mockResolvedValue({ status: 'absent' });
  privacyMocks.compare.mockResolvedValue({ status: 'match' });
  privacyMocks.identity.mockResolvedValue({ status: 'denied' });
  privacyMocks.signOut.mockReset();
  privacyMocks.replace.mockReset();
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useRouter: () => stableRouter,
}));
vi.mock('@/features/telemetry/private-speed-insights', () => ({
  PrivateSpeedInsights: () => <span data-testid="private-speed-insights" />,
}));
import ApplicationLayout from './layout';
import ProtectedNotFound, {
  metadata as protectedNotFoundMetadata,
} from './not-found';
import { DocumentAdmission } from './document-admission';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';

it('does not admit record existence before membership or return the shell before admission', async () => {
  const denied = new Error('LOGIN_REDIRECT');
  documentBoundary.member.mockRejectedValueOnce(denied);
  await expect(
    ApplicationLayout({ children: <p>Private content</p> }),
  ).rejects.toBe(denied);
  expect(documentBoundary.admission).not.toHaveBeenCalled();
  const failure = new Error('DATABASE_FAILURE');
  documentBoundary.admission.mockRejectedValueOnce(failure);
  await expect(
    ApplicationLayout({ children: <p>Private content</p> }),
  ).rejects.toBe(failure);
  expect(documentBoundary.member.mock.invocationCallOrder.at(-1)).toBeLessThan(
    documentBoundary.admission.mock.invocationCallOrder[0],
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('renders protected missing-page recovery inside the actual shell with one main and skip-link target', async () => {
  render(await ApplicationLayout({ children: <ProtectedNotFound /> }));
  await screen.findByRole('heading', { name: 'Page not found' });
  expect(screen.getAllByRole('main')).toHaveLength(1);
  const main = screen.getByRole('main');
  expect(main).toHaveAttribute('id', 'main-content');
  expect(main).toHaveClass('experience-main');
  expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  expect(main).toContainElement(
    screen.getByRole('heading', { name: 'Page not found' }),
  );
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
    'href',
    '#main-content',
  );
  expect(
    screen.getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
  expect(protectedNotFoundMetadata).toEqual({
    title: { absolute: 'Page not found · IT Inventory' },
  });
  expect(documentBoundary.member.mock.invocationCallOrder[0]).toBeLessThan(
    documentBoundary.admission.mock.invocationCallOrder[0],
  );
});

it('keeps the unique confirmed logout completion retry usable in the actual protected shell', async () => {
  privacyMocks.signOut.mockResolvedValue({
    ok: true,
    logoutGeneration: '00000000-0000-4000-8000-000000000001',
  });
  render(
    await ApplicationLayout({
      children: (
        <ProtectedPrivacyContent>
          <input
            aria-label="Retained protected draft"
            defaultValue="original work"
          />
        </ProtectedPrivacyContent>
      ),
    }),
  );
  const signOut = await screen.findByRole('button', { name: 'Sign out' });
  const recovery = 'inventory-assign-v1:original';
  sessionStorage.setItem(recovery, 'exact original command');
  const remove = Storage.prototype.removeItem;
  const blocked = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === recovery) throw new Error('storage blocked');
      remove.call(this, key);
    });
  fireEvent.submit(signOut.closest('form')!);
  const retry = await screen.findByRole('button', {
    name: 'Finish signing out',
  });
  expect(
    screen.getAllByRole('button', { name: 'Finish signing out' }),
  ).toHaveLength(1);
  expect(retry).toBeVisible();
  expect(retry.closest('[inert]')).toBeNull();
  expect(screen.getByLabelText('Retained protected draft')).not.toBeVisible();
  expect(screen.getByLabelText('Account: Viewer, viewer')).not.toBeVisible();
  expect(privacyMocks.replace).not.toHaveBeenCalled();
  blocked.mockRestore();
  fireEvent.click(retry);
  await waitFor(() =>
    expect(privacyMocks.replace).toHaveBeenCalledWith('/login'),
  );
  expect(privacyMocks.signOut).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(recovery)).toBeNull();
});

it('uses the dynamic privacy boundary without a streaming Suspense wrapper', async () => {
  const layout = await ApplicationLayout({ children: <p>Inventory</p> });
  expect(layout.type).toBe(DocumentAdmission);
  const privacy = layout.props.children;
  expect(privacy.type).toBe(ProtectedPrivacyBoundary);
  expect(privacy.props.serverGeneration).toEqual({ status: 'absent' });
  expect(privacy.props.binding).toEqual({
    actorId: 'viewer-actor',
    backend: 'https://isolated.supabase.co',
    role: 'viewer',
    canManageConfiguration: false,
  });
});

it('resolves the shared layout and passes only a generic missing flag to its outer document gate', async () => {
  documentBoundary.admission.mockResolvedValueOnce(true);
  const layout = await ApplicationLayout({
    children: <p>Page-owned result</p>,
  });
  expect(layout.type).toBe(DocumentAdmission);
  expect(layout.props.missing).toBe(true);
  expect(Object.keys(layout.props).sort()).toEqual(['children', 'missing']);
  expect(layout.props.children.type).toBe(ProtectedPrivacyBoundary);
  expect(documentBoundary.member.mock.invocationCallOrder[0]).toBeLessThan(
    documentBoundary.admission.mock.invocationCallOrder[0],
  );
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
  expect(field).toBeVisible();
  expect(field.closest('[inert]')).toBeNull();
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

import { useLayoutEffect, useState, type ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import {
  ThemePreferenceProvider,
  VerifiedThemeScope,
} from '@/components/experience/theme-preference';
import { MotionPreference } from '@/components/experience/motion-preference';
import {
  RouteMotionProvider,
  useRouteCommandBoundary,
} from '@/components/experience/route-motion';
import { useRouteRouter } from '@/components/experience/route-pending';
import { RouteReady } from '@/components/experience/route-ready';
import { CommandProvider } from '@/features/commands/command-provider';
import { TransientFeedbackProvider } from '@/components/experience/transient-feedback';
import { observeRouteActionResult } from '@/components/experience/route-action-result';
import { PeekProvider } from './peek-provider';
import { PeekLink } from './peek-link';
const runtime = vi.hoisted(() => ({
  path: '/history',
  query: '',
  read: vi.fn(),
  identity: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => runtime.path,
  useSearchParams: () => new URLSearchParams(runtime.query),
  useRouter: () => ({ replace() {}, refresh() {}, push() {} }),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { onAuthStateChange: runtime.auth },
  }),
}));
const actor = '00000000-0000-4000-8000-000000000001',
  backend = 'https://joined.test';
const binding = {
  actorId: actor,
  backend,
  role: 'staff' as const,
  canManageConfiguration: true,
};
let command: ReturnType<typeof useRouteCommandBoundary>;
function Business() {
  const [draft, setDraft] = useState('');
  const router = useRouteRouter();
  const boundary = useRouteCommandBoundary(actor, backend);
  useLayoutEffect(() => {
    command = boundary;
  });
  return (
    <>
      <button onClick={() => router.push('/inventory?page=2')}>
        Navigate successor
      </button>
      <input
        aria-label="Mounted draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <PeekLink
        peekTarget={{ kind: 'asset', id: actor }}
        href={'/inventory/assets/' + actor}
      >
        Joined record
      </PeekLink>
    </>
  );
}
function tree(children: ReactNode = <Business />) {
  return (
    <ThemePreferenceProvider scope="joined:anonymous">
      <ProtectedPrivacyBoundary
        serverGeneration={{ status: 'absent' }}
        binding={binding}
      >
        <MotionPreference>
          <RouteMotionProvider actorId={actor}>
            <CommandProvider actorId={actor} backend={backend} staff>
              <ProtectedPrivacyContent>
                <VerifiedThemeScope scope={'joined:' + actor} />
              </ProtectedPrivacyContent>
              <PeekProvider actor={actor} backend={backend}>
                <TransientFeedbackProvider actorId={actor} backend={backend}>
                  <ProtectedPrivacyContent>
                    <RouteReady
                      actorId={actor}
                      routeKey={
                        runtime.path +
                        (runtime.query ? '?' + runtime.query : '')
                      }
                      contentIdentity={runtime.path + runtime.query}
                      conventionalPrimary
                    >
                      {children}
                    </RouteReady>
                  </ProtectedPrivacyContent>
                </TransientFeedbackProvider>
              </PeekProvider>
            </CommandProvider>
          </RouteMotionProvider>
        </MotionPreference>
      </ProtectedPrivacyBoundary>
    </ThemePreferenceProvider>
  );
}
beforeEach(() => {
  runtime.path = '/history';
  runtime.query = '';
  runtime.read.mockResolvedValue({ status: 'absent' });
  runtime.identity.mockResolvedValue({
    status: 'match',
    generation: { status: 'absent' },
  });
  runtime.auth.mockReturnValue({
    data: { subscription: { unsubscribe() {} } },
  });
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('navigation', new EventTarget());
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(10, 20, 120, 30),
  ] as unknown as DOMRectList);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () =>
      Response.json({
        actor,
        backend,
        payload: {
          target: { kind: 'asset', id: actor },
          name: 'Joined private record',
          status: 'active',
          assetTag: 'TAG',
          stock: null,
          locations: [],
          moreLocations: false,
          siteName: null,
          photo: null,
        },
      }),
    ),
  );
  window.inventoryTheme = {
    parse: () => 'dark',
    key: (scope) => scope,
    read: () => 'dark',
    resolve: (preference) => (preference === 'light' ? 'light' : 'dark'),
    apply: (preference) => (preference === 'light' ? 'light' : 'dark'),
  };
  document.documentElement.dataset.motion = 'reduced';
  history.replaceState({}, '', runtime.path);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.inventoryTheme;
  history.replaceState({}, '', '/');
});

it.each(['hidden', 'unmounted'] as const)(
  'keeps the successor same-entity preview current when its predecessor is %s',
  async (retirement) => {
    let finishFirst!: (value: Response) => void;
    let finishSecond!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      finishSecond = resolve;
    });
    const fetched = vi.mocked(fetch).mockReset();
    fetched.mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.mocked(HTMLElement.prototype.getClientRects).mockImplementation(
      function (this: HTMLElement) {
        return (this.closest('[hidden], [inert]')
          ? []
          : [new DOMRect(10, 20, 120, 30)]) as unknown as DOMRectList;
      },
    );
    function Links({ retired = false }: { retired?: boolean }) {
      return (
        <>
          {(!retired || retirement === 'hidden') && (
            <div key="first" hidden={retired}>
              <PeekLink
                peekTarget={{ kind: 'asset', id: actor }}
                href={'/inventory/assets/' + actor}
              >
                First record link
              </PeekLink>
            </div>
          )}
          <PeekLink
            key="second"
            peekTarget={{ kind: 'asset', id: actor }}
            href={'/inventory/assets/' + actor}
          >
            Second record link
          </PeekLink>
        </>
      );
    }
    const reply = (name: string) =>
      Response.json({
        actor,
        backend,
        payload: {
          target: { kind: 'asset', id: actor },
          name,
          status: 'active',
          assetTag: 'TAG',
          stock: null,
          locations: [],
          moreLocations: false,
          siteName: null,
          photo: null,
        },
      });
    const view = render(tree(<Links />));
    try {
      const firstLink = await screen.findByRole('link', {
        name: 'First record link',
      });
      act(() => firstLink.focus());
      await waitFor(() => expect(fetched).toHaveBeenCalledOnce());
      act(() =>
        screen.getByRole('link', { name: 'Second record link' }).focus(),
      );
      view.rerender(tree(<Links retired />));
      await waitFor(() => expect(fetched).toHaveBeenCalledTimes(2));
      expect(fetched.mock.calls[1][1]?.signal?.aborted).toBe(false);
      await act(async () => finishSecond(reply('Successor private record')));
      expect(await screen.findByRole('dialog')).toHaveTextContent(
        'Successor private record',
      );
      await act(async () => finishFirst(reply('Retired private record')));
      expect(screen.getByRole('dialog')).toHaveTextContent(
        'Successor private record',
      );
      expect(
        screen.queryByText('Retired private record'),
      ).not.toBeInTheDocument();
      expect(fetched.mock.calls[1][1]?.signal?.aborted).toBe(false);
    } finally {
      finishFirst(reply('Retired private record'));
      finishSecond(reply('Successor private record'));
      view.unmount();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  },
);

it('admits initial, navigated, query and Back scopes through the current protected/theme/route/command stack without losing drafts', async () => {
  const view = render(tree());
  await screen.findByRole('textbox');
  await waitFor(() => expect(command.authorized()).toBe(true));
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'retained' } });
  for (const [path, query] of [
    ['/history', ''],
    ['/inventory', ''],
    ['/inventory', 'page=2'],
    ['/history', ''],
  ]) {
    runtime.path = path;
    runtime.query = query;
    history.replaceState({}, '', path + (query ? '?' + query : ''));
    view.rerender(tree());
    await waitFor(() => expect(command.authorized()).toBe(true));
    act(() => screen.getByRole('link', { name: 'Joined record' }).focus());
    await screen.findByText('Joined private record');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Joined private record',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveValue('retained');
  }
  expect(fetch).toHaveBeenCalledTimes(4);
});
it.each(['forbidden', 'actor_changed'])(
  'keeps current terminal %s authoritative while preserving the draft',
  async (code) => {
    render(tree());
    await screen.findByRole('textbox');
    await waitFor(() => expect(command.authorized()).toBe(true));
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'retained' } });
    act(() => screen.getByRole('link', { name: 'Joined record' }).focus());
    await screen.findByRole('dialog');
    const receipt = { ok: false, code };
    await act(async () => {
      expect(await observeRouteActionResult(Promise.resolve(receipt))).toBe(
        receipt,
      );
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(command.authorized()).toBe(false);
    const requests = vi.mocked(fetch).mock.calls.length;
    const link = screen.getByRole('link', { name: 'Joined record' });
    fireEvent.focus(link);
    fireEvent.keyDown(link, { key: 'ArrowDown' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveValue('retained');
  },
);

it.each(['forbidden', 'actor_changed'])(
  'ignores a retired observer %s after successor route admission',
  async (code) => {
    const previewEnvelope = {
      actor,
      backend,
      payload: {
        target: { kind: 'asset', id: actor },
        name: 'Joined private record',
        status: 'active',
        assetTag: 'TAG',
        stock: null,
        locations: [],
        moreLocations: false,
        siteName: null,
        photo: null,
      },
    };
    let finishPreview!: (value: typeof previewEnvelope) => void;
    const previewBody = new Promise<typeof previewEnvelope>((resolve) => {
      finishPreview = resolve;
    });
    // This test controls body completion; native Response stream scheduling is
    // unrelated to whether an obsolete action may withdraw the successor card.
    const response = new Response(null, { status: 200 });
    const decode = vi.spyOn(response, 'json').mockReturnValue(previewBody);
    vi.mocked(fetch).mockResolvedValueOnce(response);
    const view = render(tree());
    await screen.findByRole('textbox');
    await waitFor(() => expect(command.authorized()).toBe(true));
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'retained' } });
    let finish!: (value: { ok: boolean; code: string }) => void;
    const originalCurrent = command.capture();
    const pending = observeRouteActionResult(
      new Promise<{ ok: boolean; code: string }>((resolve) => {
        finish = resolve;
      }),
      originalCurrent,
    );
    try {
      fireEvent.click(
        screen.getByRole('button', { name: 'Navigate successor' }),
      );
      runtime.path = '/inventory';
      runtime.query = 'page=2';
      history.replaceState({}, '', '/inventory?page=2');
      view.rerender(tree());
      await waitFor(() => expect(command.authorized()).toBe(true));
      expect(originalCurrent()).toBe(false);
      act(() => screen.getByRole('link', { name: 'Joined record' }).focus());
      await waitFor(() => expect(decode).toHaveBeenCalledOnce());
      expect(
        screen.getByRole('dialog').querySelector('[aria-busy="true"]'),
      ).toBeInTheDocument();
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
      await act(async () => {
        finishPreview(previewEnvelope);
        await previewBody;
      });
      expect(screen.getByText('Joined private record')).toBeVisible();
      const receipt = { ok: false, code };
      await act(async () => {
        finish(receipt);
        expect(await pending).toBe(receipt);
      });
      expect(screen.getByRole('dialog')).toHaveTextContent(
        'Joined private record',
      );
      expect(command.authorized()).toBe(true);
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
      expect(screen.getByRole('textbox')).toBe(draft);
      expect(draft).toHaveValue('retained');
    } finally {
      await act(async () => {
        finishPreview(previewEnvelope);
        await previewBody;
      });
      finish?.({ ok: false, code });
      await pending;
    }
  },
);

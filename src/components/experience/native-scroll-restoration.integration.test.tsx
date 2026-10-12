import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { RouteMotionProvider } from './route-motion';
import { RouteReady } from './route-ready';
import { routeKey } from './route-key';

const runtime = vi.hoisted(() => ({ pathname: '/inventory', query: 'q=x' }));
vi.mock('next/navigation', () => ({
  usePathname: () => runtime.pathname,
  useSearchParams: () => new URLSearchParams(runtime.query),
}));
vi.mock('./motion-preference', () => ({
  useEffectiveReducedMotion: () => false,
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'navigation');
  history.replaceState(null, '', '/');
});

function authorityCommitFixture() {
  history.replaceState(null, '', '/inventory?q=x#row');
  runtime.pathname = '/inventory';
  runtime.query = 'q=x';
  const navigation = Object.assign(new EventTarget(), {
    currentEntry: { key: 'list', url: location.href },
  });
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: navigation,
  });
  let y = 0;
  vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  const scrollTo = vi
    .spyOn(window, 'scrollTo')
    .mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options === 'object') y = options.top ?? 0;
      window.dispatchEvent(new Event('scroll'));
    });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 390, height: 500 },
  ] as unknown as DOMRectList);
  const view = (
    options: {
      ready?: boolean;
      visible?: boolean;
      generation?: string;
      actor?: string;
    } = {},
  ) => {
    const ready = options.ready ?? true;
    return (
      <PrivacyReadinessContext
        value={{
          ready,
          visible: options.visible ?? ready,
          generation: options.generation ?? 'original-generation',
          revocationRevision: readPrivacyRevocationRevision(),
          verifiedEpoch: ready ? assignmentEpoch() : undefined,
        }}
      >
        <RouteMotionProvider actorId={options.actor ?? 'actor'}>
          {/* Keep the original actor's primary mounted during provider drift. */}
          <RouteReady
            actorId="actor"
            routeKey={routeKey(
              runtime.pathname,
              new URLSearchParams(runtime.query),
            )}
            contentIdentity="primary"
          >
            <h1>Original actor primary</h1>
          </RouteReady>
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    );
  };
  const page = render(view());
  const offset = (value: number) =>
    act(() => {
      y = value;
      window.dispatchEvent(new Event('scroll'));
    });
  const navigate = (key: string, url: string, type: string) =>
    act(() => {
      const event = new Event('navigate');
      Object.assign(event, {
        navigationType: type,
        destination: { key, url: location.origin + url },
      });
      navigation.dispatchEvent(event);
      history.replaceState(null, '', url);
      navigation.currentEntry = { key, url: location.href };
      const target = new URL(url, location.origin);
      runtime.pathname = target.pathname;
      runtime.query = target.searchParams.toString();
      navigation.dispatchEvent(new Event('currententrychange'));
    });
  offset(728);
  navigate('detail', '/inventory/assets/a', 'push');
  page.rerender(view());
  offset(0);
  navigate('list', '/inventory?q=x#row', 'traverse');
  return {
    scrollTo,
    rerender: (options?: Parameters<typeof view>[0]) =>
      page.rerender(view(options)),
  };
}

it('rejects an old-generation checkpoint when destination primary and new generation commit together', () => {
  const f = authorityCommitFixture();
  f.rerender({ generation: 'new-generation' });
  expect(f.scrollTo).not.toHaveBeenCalled();
  f.rerender({ generation: 'new-generation' });
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it('freezes without consuming a checkpoint when destination primary and ready=false visible=true commit together', () => {
  const f = authorityCommitFixture();
  f.rerender({ ready: false, visible: true });
  expect(f.scrollTo).not.toHaveBeenCalled();
  f.rerender({ ready: false, visible: true });
  expect(f.scrollTo).not.toHaveBeenCalled();
  f.rerender();
  expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 728,
    behavior: 'instant',
  });
  f.rerender();
  expect(f.scrollTo).toHaveBeenCalledTimes(1);
});

it('rejects the old checkpoint when a retained old-actor primary registers during a new actor commit', () => {
  const f = authorityCommitFixture();
  f.rerender({ actor: 'new-actor' });
  expect(f.scrollTo).not.toHaveBeenCalled();
  f.rerender({ actor: 'new-actor' });
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it.each(['privacy-first', 'readiness-first'])(
  'the real provider preserves a checkpoint through hidden privacy collapse and %s admission',
  (order) => {
    history.replaceState(null, '', '/inventory?q=x#row');
    runtime.pathname = '/inventory';
    runtime.query = 'q=x';
    const navigation = Object.assign(new EventTarget(), {
      currentEntry: { key: 'list', url: location.href },
    });
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: navigation,
    });
    let y = 0;
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation((options: number | ScrollToOptions) => {
        if (typeof options === 'object') y = options.top ?? 0;
        window.dispatchEvent(new Event('scroll'));
      });
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      { width: 390, height: 500 },
    ] as unknown as DOMRectList);
    const view = (ready: boolean, showPrimary = ready) => (
      <PrivacyReadinessContext
        value={{
          ready,
          visible: ready,
          generation: 'same-authority',
          revocationRevision: readPrivacyRevocationRevision(),
          verifiedEpoch: ready ? assignmentEpoch() : undefined,
        }}
      >
        <RouteMotionProvider actorId="actor">
          {showPrimary ? (
            <RouteReady
              actorId="actor"
              routeKey={routeKey(
                runtime.pathname,
                new URLSearchParams(runtime.query),
              )}
              contentIdentity="primary"
            >
              <h1>Authorized primary</h1>
            </RouteReady>
          ) : null}
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    );
    const page = render(view(true));
    const offset = (value: number) =>
      act(() => {
        y = value;
        window.dispatchEvent(new Event('scroll'));
      });
    const navigate = (key: string, url: string, type: string) =>
      act(() => {
        const event = new Event('navigate');
        Object.assign(event, {
          navigationType: type,
          destination: { key, url: location.origin + url },
        });
        navigation.dispatchEvent(event);
      });
    const commit = (key: string, url: string) =>
      act(() => {
        history.replaceState(null, '', url);
        navigation.currentEntry = { key, url: location.href };
        const target = new URL(url, location.origin);
        runtime.pathname = target.pathname;
        runtime.query = target.searchParams.toString();
        navigation.dispatchEvent(new Event('currententrychange'));
      });
    offset(728);
    navigate('detail', '/inventory/assets/a', 'push');
    commit('detail', '/inventory/assets/a');
    page.rerender(view(true));
    offset(0);
    navigate('list', '/inventory?q=x#row', 'traverse');
    commit('list', '/inventory?q=x#row');
    page.rerender(view(false));
    offset(0);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(scrollTo).not.toHaveBeenCalled();
    if (order === 'readiness-first') page.rerender(view(false, true));
    else page.rerender(view(true, false));
    expect(scrollTo).not.toHaveBeenCalled();
    page.rerender(view(true));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 728,
      behavior: 'instant',
    });
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    // A real revocation notification clears the provider's accumulated proof.
    navigate('detail', '/inventory/assets/a', 'push');
    commit('detail', '/inventory/assets/a');
    page.rerender(view(true));
    offset(0);
    act(() => revokePrivatePresentation());
    page.rerender(view(true));
    navigate('list', '/inventory?q=x#row', 'traverse');
    commit('list', '/inventory?q=x#row');
    page.rerender(view(true));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  },
);

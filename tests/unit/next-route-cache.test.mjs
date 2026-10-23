// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const nextRoot = dirname(require.resolve('next/package.json'));

// Run the installed Next functions unchanged. Only their cache storage and React
// rendering/network dependencies are substituted; URL learning and navigation
// canonicalization are the actual dependency code in both shipped formats.
function router(format) {
  const prefix = format === 'esm' ? 'dist/esm/client/' : 'dist/client/';
  let entry;
  const tree = { segment: 'inventory', slots: null };
  const cache = {
    EntryStatus: { Fulfilled: 2 },
    segmentCacheMap: {},
    convertRootFlightRouterStateToRouteTree: (_tree, _query, acc) => {
      acc.metadataVaryPath = {};
      return tree;
    },
    writeRouteIntoCache: (_now, _path, _search, _next, tree, meta, _i, url) => {
      entry = {
        status: 2,
        canonicalUrl: url,
        tree,
        metadata: { varyPath: meta },
        renderedSearch: '',
      };
      return entry;
    },
    fulfillRouteCacheEntry: (_now, pending, tree, meta, _i, url) => {
      entry = Object.assign(pending, {
        status: 2,
        canonicalUrl: url,
        tree,
        metadata: { varyPath: meta },
        renderedSearch: '',
      });
      return entry;
    },
    readRouteCacheEntry: () => entry,
  };
  const modules = {
    cache,
    'cache-map': { isValueExpired: () => false },
    'cache-key': {
      splitPathnameIntoParts: (pathname) => pathname.split('/').filter(Boolean),
      createCacheKey: () => ({}),
    },
    'route-params': { doesStaticSegmentAppearInURL: () => true },
    'compute-changed-path': {
      extractPathFromFlightRouterState: () => '/inventory',
      computeChangedPath: () => '/inventory',
    },
    'flight-data-helpers': {
      getFlightDataPartsFromPath: () => ({ tree, seedData: null, head: null }),
    },
    'ppr-navigations': {
      createInitialCacheNodeForHydration: () => ({ route: tree, node: {} }),
      startPPRNavigation: () => ({ route: tree, node: {} }),
      spawnDynamicRequests: () => {},
      FreshnessPolicy: { Gesture: 99 },
    },
    bfcache: { computeDynamicStaleAt: () => 0, UnknownDynamicStaleTime: -1 },
    'router-reducer-types': { ScrollBehavior: { NoScroll: 1 } },
  };
  const load = (relative) => {
    const path = resolve(nextRoot, prefix, relative);
    const source = readFileSync(path, 'utf8');
    const code =
      format === 'esm'
        ? ts.transpileModule(source, {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
            },
          }).outputText
        : source;
    const evaluatedModule = { exports: {} };
    runInNewContext(code, {
      module: evaluatedModule,
      exports: evaluatedModule.exports,
      require: (id) => modules[id.split('/').at(-1)] ?? {},
      URL,
      process: { env: { NODE_ENV: 'production' } },
    });
    return evaluatedModule.exports;
  };
  modules['create-href-from-url'] = load(
    'components/router-reducer/create-href-from-url.js',
  );
  modules['optimistic-routes'] = load(
    'components/segment-cache/optimistic-routes.js',
  );
  const hydration = load(
    'components/router-reducer/create-initial-router-state.js',
  );
  const navigation = load('components/segment-cache/navigation.js');
  return {
    hydrate: (href) =>
      hydration.createInitialRouterState({
        navigatedAt: 0,
        initialRSCPayload: { c: ['', 'inventory'], f: [{}], q: '' },
        location: new URL(href, 'https://inventory.invalid'),
      }),
    learn: (href, pending) => {
      const url = new URL(href, 'https://inventory.invalid');
      return modules['optimistic-routes'].discoverKnownRoute(
        0,
        url.pathname,
        url.search,
        null,
        pending,
        tree,
        {},
        false,
        href,
        false,
        false,
      );
    },
    cached: () => entry.canonicalUrl,
    navigate: (state, href) => {
      const current = new URL(
        '/inventory/quantity/cable',
        'https://inventory.invalid',
      );
      return navigation.navigate(
        { ...state, canonicalUrl: current.pathname },
        new URL(href, current),
        current,
        '',
        {},
        tree,
        null,
        0,
        0,
        'push',
      );
    },
  };
}

describe.each(['cjs', 'esm'])('installed Next %s route cache', (format) => {
  it.each([
    ['/inventory#inventory-row-2', '/inventory#inventory-row-2'],
    ['/inventory#a', '/inventory#b'],
    ['/inventory#a', '/inventory'],
    ['/inventory', '/inventory#b'],
    [
      '/inventory?q=Cable%23USB&type=quantity#a',
      '/inventory?q=Cable%23USB&type=quantity#b',
    ],
    [
      '/inventory%23shelf?q=Cable%23USB#a',
      '/inventory%23shelf?q=Cable%23USB#b',
    ],
  ])('hydrates %s and returns to the exact requested %s', (initial, back) => {
    const runtime = router(format);
    const state = runtime.hydrate(initial);
    expect(state.canonicalUrl).toBe(initial);
    // Exercise the actual cached navigation, not a reimplementation of its URL.
    expect(runtime.navigate(state, back).canonicalUrl).toBe(back);
    expect(runtime.cached()).toBe(initial.split('#', 1)[0]);
  });

  it.each([null, {}])(
    'normalizes a hash-bearing learned/retry URL with pending=%s',
    (pending) => {
      const runtime = router(format);
      const href = '/inventory?q=Cable%23USB&type=quantity#a#old';
      const learned = runtime.learn(href, pending);
      expect(learned.canonicalUrl).toBe(
        '/inventory?q=Cable%23USB&type=quantity',
      );
      const state = {
        tree: {},
        nextUrl: '/inventory/quantity/cable',
        focusAndScrollRef: { scrollRef: null },
      };
      expect(
        runtime.navigate(state, '/inventory?q=Cable%23USB&type=quantity#b')
          .canonicalUrl,
      ).toBe('/inventory?q=Cable%23USB&type=quantity#b');
    },
  );
});

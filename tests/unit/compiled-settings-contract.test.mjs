import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createBuildProvenance } from '../../src/features/build-info/provenance';
import { computeCacheBustingSearchParam } from 'next/dist/shared/lib/router/utils/cache-busting-search-param.js';
import { defaultConfig } from 'next/dist/server/config-shared.js';
import {
  settingsFlightRequest,
  assertLocalBuildSnapshot,
  localBackend,
  guardedFetch,
  assertServedBuild,
  readBoundedFlight,
  maxFlightBytes,
} from '../helpers/compiled-settings-contract.mjs';

it('sends the Settings Flight cache key required by installed Next without following redirects', async () => {
  expect(defaultConfig.experimental.validateRSCRequestHeaders).toBe(true);
  const { url, init } = await settingsFlightRequest(
    'http://127.0.0.1:40200',
    'synthetic=caller',
  );
  const headers = new Headers(init.headers);
  const expectedHash = await computeCacheBustingSearchParam(
    headers.get('next-router-prefetch') ?? undefined,
    headers.get('next-router-segment-prefetch') ?? undefined,
    headers.get('next-router-state-tree') ?? undefined,
    headers.get('next-url') ?? undefined,
  );
  // Missing is null, while this complete non-prefetch request requires ''.
  expect(new URL('/settings', url.origin).searchParams.get('_rsc')).not.toBe(
    expectedHash,
  );
  expect(url.searchParams.get('_rsc')).toBe(expectedHash);
  expect(url.origin).toBe('http://127.0.0.1:40200');
  expect(url.pathname).toBe('/settings');
  expect(headers.get('rsc')).toBe('1');
  expect(headers.get('accept')).toBe('text/x-component');
  expect(headers.get('cookie')).toBe('synthetic=caller');
  expect(init.redirect).toBe('error');
});

const expected = {
  environment: 'Local',
  version: '0.1.0',
  commit: 'a'.repeat(40),
  buildStarted: '2026-10-11T12:00:00.000Z',
};
it('accepts the canonical local compiled label and rejects input tokens and nonlocal snapshots', () => {
  const snapshot = createBuildProvenance(
    { APP_ENV: 'local' },
    expected.version,
    true,
    new Date(expected.buildStarted),
  );
  expect(() => assertLocalBuildSnapshot(snapshot)).not.toThrow();
  for (const environment of ['local', 'Preview', 'Production', 'Development']) {
    expect(() =>
      assertLocalBuildSnapshot({ ...snapshot, environment }),
    ).toThrow('requires the canonical local backend build');
  }
  expect(() =>
    assertLocalBuildSnapshot({ ...snapshot, buildStarted: null }),
  ).toThrow('requires an actual production build');
  expect(() =>
    assertLocalBuildSnapshot({ ...snapshot, extra: 'unsupported' }),
  ).toThrow();
});
const element = (tag, children, props = {}) => [
  '$',
  tag,
  null,
  { ...props, children },
];
function section(snapshot = expected) {
  return element(
    'section',
    [
      element('h2', 'Build & environment'),
      element('p', [snapshot.environment, ' · Version ', snapshot.version]),
      element(
        'details',
        element('dl', [
          element('div', [
            element('dt', 'Commit'),
            element('dd', snapshot.commit),
          ]),
          element('div', [
            element('dt', 'Build started'),
            element(
              'dd',
              element('time', 'Sunday', { dateTime: snapshot.buildStarted }),
            ),
          ]),
        ]),
      ),
    ],
    { 'aria-labelledby': 'build-heading' },
  );
}
function flight(snapshot = expected) {
  // The privacy client has no SSR DOM, but its static server children remain
  // in the serialized data tree. Import/debug records must never supply proof.
  return `1:I["privacy-client"]\n2:D{"name":"debug"}\n0:${JSON.stringify(['$', '$L1', null, { ready: false, children: section(snapshot) }])}\n`;
}
it('recognizes the static server tree inside withheld privacy and rejects SSR HTML/embedded manifest text', () => {
  expect(() => assertServedBuild(flight(), expected)).not.toThrow();
  const withheldHtml = `<html><div hidden></div><script>self.__next_f.push(${JSON.stringify(flight())})</script></html>`;
  expect(() => assertServedBuild(withheldHtml, expected)).toThrow();
  expect(() =>
    assertServedBuild(
      `0:${JSON.stringify({ provenance: expected })}\n`,
      expected,
    ),
  ).toThrow();
});
it('requires exact rendered fields in the section instead of matching unrelated props or data', () => {
  for (const field of ['environment', 'version', 'commit', 'buildStarted']) {
    expect(() =>
      assertServedBuild(
        flight({ ...expected, [field]: 'forged' }) +
          `3:${JSON.stringify(expected)}\n`,
        expected,
      ),
    ).toThrow();
  }
  const wrong = section({ ...expected, commit: 'prefix' + expected.commit });
  wrong[3].provenance = expected;
  expect(() =>
    assertServedBuild(`0:${JSON.stringify(wrong)}\n`, expected),
  ).toThrow();
  expect(() =>
    assertServedBuild(
      `0:D${JSON.stringify(section())}\n1:I${JSON.stringify(section())}\n`,
      expected,
    ),
  ).toThrow();
});
it('accepts outlined host children emitted by the installed production Flight renderer', () => {
  const rendered = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      'tests/helpers/compiled-settings-render-fixture.mjs',
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: maxFlightBytes,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=768',
      },
    },
  );
  expect(rendered.error, 'Synthetic renderer must finish').toBeUndefined();
  expect(rendered.status, 'Synthetic renderer must succeed').toBe(0);
  expect(
    /"\$L?[0-9a-f]+(?::[^"\n]+)?"/.test(rendered.stdout),
    'Synthetic renderer must exercise outlined data',
  ).toBe(true);
  expect(() => assertServedBuild(rendered.stdout, expected)).not.toThrow();
});
it('resolves only bounded data references inside the BuildInfo host tree', () => {
  const outlined = section();
  const children = outlined[3].children;
  outlined[3].children = '$L1';
  const payload = `0:${JSON.stringify(outlined)}\n1:${JSON.stringify(children)}\n`;
  expect(() => assertServedBuild(payload, expected)).not.toThrow();
  const pathTree = section();
  pathTree[3].children = '$2:rendered';
  expect(() =>
    assertServedBuild(
      `0:${JSON.stringify(pathTree)}\n2:${JSON.stringify({ rendered: children })}\n`,
      expected,
    ),
  ).not.toThrow();
  for (const reference of [
    '$L9',
    '$L1',
    '$L1:rendered',
    '$1:missing',
    '$1:__proto__',
    '$@1',
    '$F1',
  ]) {
    outlined[3].children = reference;
    expect(() =>
      assertServedBuild(`0:${JSON.stringify(outlined)}\n1:["$L1"]\n`, expected),
    ).toThrow();
  }
  outlined[3].children = '$L1';
  expect(() =>
    assertServedBuild(
      `0:${JSON.stringify(outlined)}\n1:I${JSON.stringify(children)}\n`,
      expected,
    ),
  ).toThrow();
  expect(() =>
    assertServedBuild(
      `0:${JSON.stringify(outlined)}\n1:D${JSON.stringify(children)}\n`,
      expected,
    ),
  ).toThrow();
  outlined[3].children = '$F1';
  expect(() =>
    assertServedBuild(
      `0:${JSON.stringify(outlined)}\nf1:${JSON.stringify(children)}\n`,
      expected,
    ),
  ).toThrow('BuildInfo requires literal children or supported data references');
  outlined[3].children = '$L1';
  expect(() =>
    assertServedBuild(
      `0:${JSON.stringify(outlined)}\n1:${JSON.stringify(section({ ...expected, commit: 'forged' })[3].children)}\n`,
      expected,
    ),
  ).toThrow('served commit must match build exactly');
});
it('bounds outlined reference chains, expanded trees and duplicate data records', () => {
  const outlined = section();
  outlined[3].children = '$1';
  const root = `0:${JSON.stringify(outlined)}\n`;
  const chain = Array.from(
    { length: 70 },
    (_, index) =>
      `${(index + 1).toString(16)}:["$${(index + 2).toString(16)}"]\n`,
  ).join('');
  expect(() =>
    assertServedBuild(
      root + chain + `47:${JSON.stringify(section()[3].children)}\n`,
      expected,
    ),
  ).toThrow('BuildInfo exceeds literal tree limit');
  const repeated = Array.from(
    { length: 15 },
    (_, index) =>
      `${(index + 1).toString(16)}:["$${(index + 2).toString(16)}","$${(index + 2).toString(16)}"]\n`,
  ).join('');
  expect(() =>
    assertServedBuild(
      root + repeated + `10:${JSON.stringify(section()[3].children)}\n`,
      expected,
    ),
  ).toThrow('BuildInfo exceeds literal tree limit');
  expect(() => assertServedBuild(flight() + '0:{}\n', expected)).toThrow(
    'Malformed Flight JSON duplicate record',
  );
});
it('requires an exact scalar dateTime attribute after bounded data reference resolution', () => {
  const timeTree = (dateTime) => {
    const tree = section();
    // Retain valid rendered children while varying only the time property.
    tree[3].children[2][3].children[3].children[1][3].children[1][3].children[3].dateTime =
      dateTime;
    return `0:${JSON.stringify(tree)}\n`;
  };
  for (const dateTime of [
    [expected.buildStarted, ''],
    [expected.buildStarted],
    element('span', expected.buildStarted),
    { value: expected.buildStarted },
  ]) {
    expect(() => assertServedBuild(timeTree(dateTime), expected)).toThrow(
      'served time must be a scalar string',
    );
  }
  expect(() =>
    assertServedBuild(
      timeTree('$a') + `a:${JSON.stringify(expected.buildStarted)}\n`,
      expected,
    ),
  ).not.toThrow();
  expect(() =>
    assertServedBuild(
      timeTree('$a') +
        `a:"$b:timestamp"\nb:${JSON.stringify({ timestamp: expected.buildStarted })}\n`,
      expected,
    ),
  ).not.toThrow();
  expect(() =>
    assertServedBuild(
      timeTree('$a') + `a:${JSON.stringify([expected.buildStarted, ''])}\n`,
      expected,
    ),
  ).toThrow('served time must be a scalar string');
  expect(() =>
    assertServedBuild(timeTree('$a') + 'a:"$a"\n', expected),
  ).toThrow('BuildInfo requires acyclic references');
});
it('rejects malformed, missing, duplicate, oversized and unsupported referenced trees', () => {
  for (const payload of [
    '0:[broken\n',
    '0:{}\n',
    flight() + `3:${JSON.stringify(section())}\n`,
    'x'.repeat(maxFlightBytes + 1),
    `0:${JSON.stringify(element('section', '$a', { 'aria-labelledby': 'build-heading' }))}\n`,
  ]) {
    expect(() => assertServedBuild(payload, expected)).toThrow();
  }
});

it.each([
  'T',
  'A',
  'O',
  'o',
  'b',
  'U',
  'S',
  's',
  'L',
  'l',
  'G',
  'g',
  'M',
  'm',
  'V',
])(
  'rejects fake BuildInfo JSON lines inside length-framed %s payload bytes',
  (tag) => {
    const fake = element(
      'section',
      [
        element('p', 'local · Version 0.1.0'),
        element('dd', expected.commit),
        element('time', 'Sunday', { dateTime: expected.buildStarted }),
      ],
      { 'aria-labelledby': 'build-heading' },
    );
    const raw = 'unrelated text\nf:' + JSON.stringify(fake) + '\n';
    const payload =
      '1:' +
      tag +
      Buffer.byteLength(raw, 'utf8').toString(16) +
      ',' +
      raw +
      '0:' +
      JSON.stringify({ unrelatedText: '$1' }) +
      '\n';
    expect(() => assertServedBuild(payload, expected)).toThrow(
      'Unsupported length-framed Flight payload',
    );
  },
);
it('bounds the raw streamed response before parsing and validates status/content type', async () => {
  const options = {
    headers: { 'content-type': 'text/x-component; charset=utf-8' },
  };
  expect(await readBoundedFlight(new Response(flight(), options))).toBe(
    flight(),
  );
  await expect(
    readBoundedFlight(
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    readBoundedFlight(new Response(flight(), { ...options, status: 403 })),
  ).rejects.toThrow();
  let cancelled = false;
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(maxFlightBytes));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readBoundedFlight(new Response(oversized, options)),
  ).rejects.toThrow('exceeds probe limit');
  expect(cancelled).toBe(true);
});
it('refuses hosted, non-HTTP and wrong-port backends before transport', () => {
  for (const url of [
    'https://example.supabase.co',
    'http://127.0.0.1:54321',
    'https://127.0.0.1:45321',
    'http://localhost:45322',
  ]) {
    expect(() => localBackend(url)).toThrow();
  }
});
it('allows only the guarded backend and owned server, including Request inputs', () => {
  const transport = vi.fn();
  const guarded = guardedFetch(
    transport,
    localBackend('http://127.0.0.1:45321'),
    () => 'http://127.0.0.1:40200',
  );
  guarded('http://127.0.0.1:45321/auth/v1/token');
  guarded(new Request('http://127.0.0.1:40200/settings'));
  expect(transport).toHaveBeenCalledTimes(2);
  expect(() => guarded('https://example.supabase.co/auth/v1/token')).toThrow();
  expect(() => guarded('http://127.0.0.1:3000/settings')).toThrow();
  expect(transport).toHaveBeenCalledTimes(2);
});

it('refuses redirect following and keeps caller cancellation active', async () => {
  const transport = vi.fn((_input, options) =>
    options.redirect === 'error'
      ? Promise.reject(new TypeError('Redirect refused'))
      : Promise.resolve('Redirect response only'),
  );
  const guarded = guardedFetch(
    transport,
    localBackend('http://127.0.0.1:45321'),
    () => undefined,
  );
  await expect(
    guarded('http://127.0.0.1:45321/auth/v1', { redirect: 'follow' }),
  ).rejects.toThrow('Redirect refused');
  await expect(
    guarded('http://127.0.0.1:45321/auth/v1', { redirect: 'manual' }),
  ).resolves.toBe('Redirect response only');
  const caller = new AbortController();
  const aborted = guarded(
    new Request('http://127.0.0.1:45321/auth/v1', { signal: caller.signal }),
  );
  const signal = transport.mock.calls[2][1].signal;
  expect(signal.aborted).toBe(false);
  caller.abort();
  expect(signal.aborted).toBe(true);
  await expect(aborted).rejects.toThrow('Redirect refused');
});

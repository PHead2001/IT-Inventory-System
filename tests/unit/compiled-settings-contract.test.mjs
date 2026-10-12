import { expect, it, vi } from 'vitest';
import {
  localBackend,
  guardedFetch,
  assertServedBuild,
  readBoundedFlight,
  maxFlightBytes,
} from '../helpers/compiled-settings-contract.mjs';

const expected = {
  environment: 'local',
  version: '0.1.0',
  commit: 'a'.repeat(40),
  buildStarted: '2026-10-11T12:00:00.000Z',
};
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
    'https://127.0.0.1:54321',
    'http://localhost:54322',
  ]) {
    expect(() => localBackend(url)).toThrow();
  }
});
it('allows only the guarded backend and owned server, including Request inputs', () => {
  const transport = vi.fn();
  const guarded = guardedFetch(
    transport,
    localBackend('http://127.0.0.1:54321'),
    () => 'http://127.0.0.1:40200',
  );
  guarded('http://127.0.0.1:54321/auth/v1/token');
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
    localBackend('http://127.0.0.1:54321'),
    () => undefined,
  );
  await expect(
    guarded('http://127.0.0.1:54321/auth/v1', { redirect: 'follow' }),
  ).rejects.toThrow('Redirect refused');
  await expect(
    guarded('http://127.0.0.1:54321/auth/v1', { redirect: 'manual' }),
  ).resolves.toBe('Redirect response only');
  const caller = new AbortController();
  const aborted = guarded(
    new Request('http://127.0.0.1:54321/auth/v1', { signal: caller.signal }),
  );
  const signal = transport.mock.calls[2][1].signal;
  expect(signal.aborted).toBe(false);
  caller.abort();
  expect(signal.aborted).toBe(true);
  await expect(aborted).rejects.toThrow('Redirect refused');
});

import assert from 'node:assert/strict';
import { setCacheBustingSearchParam } from 'next/dist/client/components/router-reducer/set-cache-busting-search-param.js';

/** Match the installed Next router's Flight request contract before transport. */
export async function settingsFlightRequest(origin, cookie) {
  const url = new URL('/settings', origin);
  const headers = { cookie, RSC: '1', Accept: 'text/x-component' };
  // Next 16 validates this hash even when no routing/prefetch headers are sent.
  // Its canonical empty hash is ?_rsc; absence triggers a 307 before rendering.
  await setCacheBustingSearchParam(url, headers);
  return { url, init: { headers, redirect: 'error' } };
}

/** APP_ENV is an input token; the compiled snapshot contains its display label. */
export function assertLocalBuildSnapshot(expected) {
  assert.deepEqual(Object.keys(expected), [
    'environment',
    'version',
    'commit',
    'buildStarted',
  ]);
  assert.ok(expected.buildStarted, 'requires an actual production build');
  assert.equal(
    expected.environment,
    'Local',
    'requires the canonical local backend build',
  );
}

export function localBackend(value) {
  const backend = new URL(value);
  assert.equal(backend.protocol, 'http:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname));
  assert.equal(backend.port, '54321');
  return backend;
}

export function guardedFetch(originalFetch, backend, applicationOrigin) {
  return (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    assert.ok(
      url.origin === backend.origin || url.origin === applicationOrigin(),
      'refusing nonlocal compiled request',
    );
    const callerSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const deadline = AbortSignal.timeout(8_000);
    return originalFetch(input, {
      ...init,
      // Manual never follows a redirect; other modes fail before another origin.
      redirect: init?.redirect === 'manual' ? 'manual' : 'error',
      signal: callerSignal
        ? AbortSignal.any([callerSignal, deadline])
        : deadline,
    });
  };
}

export const maxFlightBytes = 512 * 1024;

export async function readBoundedFlight(response) {
  assert.equal(response.status, 200, 'viewer must receive Settings');
  assert.equal(
    response.headers.get('content-type')?.split(';')[0].trim(),
    'text/x-component',
    'requires a Flight response',
  );
  assert.ok(response.body, 'requires a Flight body');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      assert.ok(bytes <= maxFlightBytes, 'Flight response exceeds probe limit');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const hostElement = (node) =>
  Array.isArray(node) &&
  node.length >= 4 &&
  node[0] === '$' &&
  typeof node[1] === 'string' &&
  !node[1].startsWith('$') &&
  node[3] !== null &&
  typeof node[3] === 'object' &&
  !Array.isArray(node[3]);

/** Recognize BuildInfo host data, including the installed renderer's outlining. */
export function assertServedBuild(flight, expected) {
  assert.ok(
    Buffer.byteLength(flight, 'utf8') <= maxFlightBytes,
    'Flight response exceeds probe limit',
  );
  // Installed Next's binary reader uses length framing for T/A/O/o/b/U/S/s/
  // L/l/G/g/M/m/V. Never split their raw bytes into apparent JSON rows. Reject
  // any letter + hexadecimal-length framing, including future unsupported tags.
  assert.ok(
    !/^[0-9a-f]+:[a-z][0-9a-f]*,/im.test(flight),
    'Unsupported length-framed Flight payload',
  );
  const sections = [];
  let nodes = 0;
  function visit(value, depth = 0) {
    assert.ok(
      depth <= 64 && ++nodes <= 20_000,
      'Flight data exceeds traversal limit',
    );
    if (!value || typeof value !== 'object') return;
    if (
      hostElement(value) &&
      value[1] === 'section' &&
      value[3]['aria-labelledby'] === 'build-heading'
    )
      sections.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  const models = new Map();
  for (const line of flight.split('\n')) {
    const record = line.match(/^([0-9a-f]+):([\[{"].*)$/i);
    if (!record) continue; // Ignore imports, debugging and all non-JSON records.
    assert.ok(models.size < 1024, 'Flight response exceeds record limit');
    const id = record[1].toLowerCase();
    assert.ok(!models.has(id), 'Malformed Flight JSON duplicate record');
    let value;
    try {
      value = JSON.parse(record[2]);
    } catch {
      throw new Error('Malformed Flight JSON data record');
    }
    models.set(id, value);
  }
  for (const value of models.values()) visit(value);
  assert.equal(sections.length, 1, 'requires one exact BuildInfo host section');
  const elements = [];
  let literalNodes = 0;
  const references = new Set();
  function resolveData(value, depth, consume) {
    assert.ok(
      depth <= 64 && ++literalNodes <= 20_000,
      'BuildInfo exceeds literal tree limit',
    );
    if (typeof value === 'string') {
      const reference = value.match(
        /^\$(?:L([0-9a-f]+)|([0-9a-f]+)((?::[^:]+)*))$/,
      );
      if (reference) {
        assert.ok(
          !references.has(value),
          'BuildInfo requires acyclic references',
        );
        const id = reference[1] ?? reference[2];
        assert.ok(
          models.has(id),
          'BuildInfo requires an existing data reference',
        );
        let resolved = models.get(id);
        const path = reference[3] ? reference[3].slice(1).split(':') : [];
        assert.ok(path.length <= 64, 'BuildInfo exceeds reference path limit');
        for (const key of path) {
          assert.ok(
            !['__proto__', 'prototype', 'constructor'].includes(key) &&
              resolved !== null &&
              typeof resolved === 'object' &&
              Object.hasOwn(resolved, key),
            'BuildInfo requires an own data reference path',
          );
          resolved = resolved[key];
        }
        references.add(value);
        try {
          return resolveData(resolved, depth + 1, consume);
        } finally {
          references.delete(value);
        }
      }
    }
    return consume(value, depth);
  }
  function literalText(value, depth = 0, collect = true) {
    return resolveData(value, depth, (resolved, resolvedDepth) =>
      literalChildren(resolved, resolvedDepth, collect),
    );
  }
  function literalChildren(value, depth, collect) {
    if (value === null || value === undefined || typeof value === 'boolean')
      return '';
    if (typeof value === 'string') {
      if (value.startsWith('$$')) return value.slice(1);
      assert.ok(
        !value.startsWith('$'),
        'BuildInfo requires literal children or supported data references',
      );
      return value;
    }
    if (typeof value === 'number') return String(value);
    assert.ok(
      Array.isArray(value),
      'BuildInfo requires literal React children',
    );
    if (hostElement(value)) {
      if (collect) elements.push(value);
      return literalText(value[3].children, depth + 1, collect);
    }
    assert.notEqual(value[0], '$', 'BuildInfo requires literal host elements');
    return value
      .map((child) => literalText(child, depth + 1, collect))
      .join('');
  }
  const scalarString = (value) =>
    resolveData(value, 0, (resolved) => {
      assert.equal(
        typeof resolved,
        'string',
        'served time must be a scalar string',
      );
      return resolved;
    });
  literalText(sections[0]);
  const textOf = (element) => literalText(element[3].children, 0, false);
  // Only rendered children/properties in this section count, never opaque
  // provenance props, imports, debug rows or matching manifest text elsewhere.
  assert.equal(
    elements.filter(
      (node) =>
        node[1] === 'p' &&
        textOf(node) ===
          `${expected.environment} · Version ${expected.version}`,
    ).length,
    1,
    'served environment/version must match build exactly',
  );
  assert.equal(
    elements.filter(
      (node) =>
        node[1] === 'dd' && textOf(node) === (expected.commit ?? 'Unavailable'),
    ).length,
    1,
    'served commit must match build exactly',
  );
  assert.equal(
    elements.filter(
      (node) =>
        node[1] === 'time' &&
        scalarString(node[3].dateTime) === expected.buildStarted,
    ).length,
    1,
    'served time must match build exactly',
  );
}

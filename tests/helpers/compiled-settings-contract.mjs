import assert from 'node:assert/strict';

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

/** Recognize the static BuildInfo host tree; this is not a Flight decoder. */
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
  let records = 0;
  for (const line of flight.split('\n')) {
    const record = line.match(/^[0-9a-f]+:([\[{].*)$/i);
    if (!record) continue; // Ignore imports, debugging and all non-JSON records.
    assert.ok(++records <= 1024, 'Flight response exceeds record limit');
    let value;
    try {
      value = JSON.parse(record[1]);
    } catch {
      throw new Error('Malformed Flight JSON data record');
    }
    visit(value);
  }
  assert.equal(sections.length, 1, 'requires one exact BuildInfo host section');
  const elements = [];
  let literalNodes = 0;
  function literalText(value, depth = 0, collect = true) {
    assert.ok(
      depth <= 64 && ++literalNodes <= 20_000,
      'BuildInfo exceeds literal tree limit',
    );
    if (value === null || value === undefined || typeof value === 'boolean')
      return '';
    if (typeof value === 'string') {
      assert.ok(
        !value.startsWith('$'),
        'BuildInfo requires literal children, not Flight references',
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
        node[1] === 'time' && node[3].dateTime === expected.buildStarted,
    ).length,
    1,
    'served time must match build exactly',
  );
}

// @vitest-environment node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import {
  guardedFetch,
  localBackend,
} from '../helpers/compiled-settings-contract.mjs';
import { classifyProbeFailure } from '../helpers/compiled-probe-diagnostic.mjs';

it('classifies an actual Node redirect refusal without following another endpoint', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(307, { location: '/must-not-follow' });
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const guarded = guardedFetch(
      fetch,
      localBackend('http://127.0.0.1:54321'),
      () => origin,
    );
    let failure;
    try {
      await guarded(`${origin}/settings`, { redirect: 'error' });
    } catch (error) {
      failure = error;
    }
    expect(classifyProbeFailure(failure)).toBe('redirect');
    expect(requests).toEqual(['/settings']);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

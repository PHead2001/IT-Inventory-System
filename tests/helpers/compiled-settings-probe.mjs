import { createServer } from 'node:http';
import next from 'next';
import {
  localBackend,
  guardedFetch,
  assertServedBuild,
  readBoundedFlight,
  settingsFlightRequest,
} from './compiled-settings-contract.mjs';
import { classifyProbeFailure } from './compiled-probe-diagnostic.mjs';

// Serve the existing build, then close before reporting. Never build here.
process.once('message', async ({ expected, cookie, api }) => {
  let app;
  let server;
  let passed = false;
  let stage = 'backend';
  let reason = 'failure';
  const originalFetch = globalThis.fetch;
  try {
    const backend = localBackend(api);
    let origin;
    // A build with another inlined backend cannot issue any hosted request.
    globalThis.fetch = guardedFetch(originalFetch, backend, () => origin);
    stage = 'prepare';
    app = next({ dev: false, hostname: '127.0.0.1', port: 0 });
    await app.prepare();
    const handle = app.getRequestHandler();
    server = createServer((request, response) => {
      handle(request, response).catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    stage = 'listen';
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    for (let request = 0; request < 2; request++) {
      stage = `request-${request + 1}`;
      const { url, init } = await settingsFlightRequest(origin, cookie);
      const response = await fetch(url, init);
      stage = `response-${request + 1}`;
      const flight = await readBoundedFlight(response);
      stage = `tree-${request + 1}`;
      assertServedBuild(flight, expected);
      process.env.APP_ENV = 'production';
      process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40);
      process.env.APP_BUILD_PROVENANCE =
        '{"environment":"second runtime forgery"}';
    }
    passed = true;
  } catch (error) {
    // Never emit arbitrary Next/Supabase errors, HTML or credentials.
    passed = false;
    reason = classifyProbeFailure(error);
  } finally {
    globalThis.fetch = originalFetch;
    let cleanupStage = 'server-close';
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      cleanupStage = 'app-close';
      if (app) await app.close();
    } catch {
      passed = false;
      stage = cleanupStage;
      reason = 'cleanup';
    }
    process.send({ passed, stage, reason }, () => {
      process.disconnect();
      process.exit(passed ? 0 : 1);
    });
  }
});

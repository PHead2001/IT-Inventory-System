import { createServer } from 'node:http';
import next from 'next';
import {
  localBackend,
  guardedFetch,
  assertServedBuild,
  readBoundedFlight,
} from './compiled-settings-contract.mjs';

// Serve the existing build, then close before reporting. Never build here.
process.once('message', async ({ expected, cookie, api }) => {
  let app;
  let server;
  let passed = false;
  const originalFetch = globalThis.fetch;
  try {
    const backend = localBackend(api);
    let origin;
    // A build with another inlined backend cannot issue any hosted request.
    globalThis.fetch = guardedFetch(originalFetch, backend, () => origin);
    app = next({ dev: false, hostname: '127.0.0.1', port: 0 });
    await app.prepare();
    const handle = app.getRequestHandler();
    server = createServer((request, response) => {
      handle(request, response).catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    for (let request = 0; request < 2; request++) {
      const response = await fetch(`${origin}/settings`, {
        headers: { cookie, RSC: '1', Accept: 'text/x-component' },
        redirect: 'error',
      });
      const flight = await readBoundedFlight(response);
      assertServedBuild(flight, expected);
      process.env.APP_ENV = 'production';
      process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40);
      process.env.APP_BUILD_PROVENANCE =
        '{"environment":"second runtime forgery"}';
    }
    passed = true;
  } catch {
    // Never emit arbitrary Next/Supabase errors, HTML or credentials.
    passed = false;
  } finally {
    globalThis.fetch = originalFetch;
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      if (app) await app.close();
    } catch {
      passed = false;
    }
    process.send({ passed }, () => {
      process.disconnect();
      process.exit(passed ? 0 : 1);
    });
  }
});

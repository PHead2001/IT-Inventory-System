// Local measurement only. Persist endpoint classes, never headers, query strings,
// request/response bodies, tokens, inventory values, or entity/user identifiers.
import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
const target = process.env.NAVIGATION_TRACE_FILE;
if (target) {
  globalThis.fetch = async (...args) => {
    let endpoint;
    try {
      const url = new URL(args[0] instanceof Request ? args[0].url : args[0]);
      if (
        ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        url.port === '45321'
      ) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'auth') endpoint = `auth/${parts[2] ?? 'other'}`;
        else if (parts[0] === 'rest')
          endpoint =
            parts[2] === 'rpc' ? `rpc/${parts[3]}` : `table/${parts[2]}`;
      }
    } catch {
      /* Non-URL requests are outside this trace. */
    }
    const start = performance.now();
    const at = Date.now();
    let status = null;
    try {
      const response = await original(...args);
      status = response.status;
      return response;
    } finally {
      if (endpoint) {
        try {
          appendFileSync(
            target,
            JSON.stringify({
              at,
              endpoint,
              status,
              durationMs: performance.now() - start,
            }) + '\n',
          );
        } catch {
          /* Diagnostics cannot affect an application request. */
        }
      }
    }
  };
}

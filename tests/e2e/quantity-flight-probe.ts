import { setCacheBustingSearchParam } from 'next/dist/client/components/router-reducer/set-cache-busting-search-param.js';

const quantityRecordPath =
  /^\/inventory\/quantity\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Build the smallest authenticated request that asks Next for a full Flight. */
export async function buildFullQuantityFlightProbe(
  requestUrl: string,
  cookie: string,
) {
  const target = new URL(requestUrl);
  if (
    target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.port !== '3000' ||
    target.username !== '' ||
    target.password !== '' ||
    !quantityRecordPath.test(target.pathname)
  ) {
    throw new Error('Invalid local quantity route request.');
  }
  if (!cookie) throw new Error('Missing authenticated browser cookie.');

  const headers = {
    Cookie: cookie,
    rsc: '1' as const,
    Accept: 'text/x-component',
  };
  // Full Flight omits router-state/prefetch headers, but still needs their
  // matching (empty) hash. Missing _rsc redirects before Next renders the route.
  target.searchParams.delete('_rsc');
  await setCacheBustingSearchParam(target, headers);
  return {
    url: target.href,
    headers,
    redirect: 'error' as const,
  };
}

export async function fetchFullQuantityFlightProbe(
  requestUrl: string,
  cookie: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const probe = await buildFullQuantityFlightProbe(requestUrl, cookie);
  const response = await transport(probe.url, {
    headers: probe.headers,
    redirect: probe.redirect,
    signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
  });
  // Defend against a replacement transport returning a redirected response.
  if (
    response.redirected ||
    (response.status >= 300 && response.status < 400)
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Full Flight redirects are refused.');
  }
  return response;
}

export async function readFallbackMarker(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onBytes: (bytes: number) => void,
) {
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (!text.includes('Loading quantity record')) {
    const next = await reader.read();
    if (next.done) throw new Error('Stream ended before its fallback marker.');
    bytes += next.value.byteLength;
    onBytes(bytes);
    if (bytes > 512 * 1024) throw new Error('Stream exceeded its byte limit.');
    text += decoder.decode(next.value, { stream: true });
  }
  return bytes;
}

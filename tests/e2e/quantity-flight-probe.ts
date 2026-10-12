const quantityRecordPath =
  /^\/inventory\/quantity\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Build the smallest authenticated request that asks Next for a full Flight. */
export function buildFullQuantityFlightProbe(
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

  target.searchParams.delete('_rsc');
  return {
    url: target.href,
    headers: {
      Cookie: cookie,
      RSC: '1',
      Accept: 'text/x-component',
    },
  };
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

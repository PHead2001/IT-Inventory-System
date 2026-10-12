import { describe, expect, it } from 'vitest';
import {
  buildFullQuantityFlightProbe,
  readFallbackMarker,
} from '../e2e/quantity-flight-probe';

const requestUrl =
  'http://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000?type=quantity&_rsc=abc&q=adapter';

describe('full quantity Flight probe request', () => {
  it('preserves business query parameters and sends only the required headers', () => {
    const cookie = 'sb-access-token=secret-in-memory';
    const request = buildFullQuantityFlightProbe(requestUrl, cookie);

    expect(request.url).toBe(
      'http://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000?type=quantity&q=adapter',
    );
    expect(request.headers).toEqual({
      Cookie: cookie,
      RSC: '1',
      Accept: 'text/x-component',
    });
  });

  it.each([
    'https://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://example.test:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://localhost:3001/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://user@localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://localhost:3000/inventory/quantity/not-a-uuid',
    'http://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000/extra',
  ])('rejects an out-of-scope URL: %s', (url) => {
    expect(() => buildFullQuantityFlightProbe(url, 'session-cookie')).toThrow(
      'Invalid local quantity route request.',
    );
  });

  it('requires the in-memory authenticated cookie', () => {
    expect(() => buildFullQuantityFlightProbe(requestUrl, '')).toThrow(
      'Missing authenticated browser cookie.',
    );
  });

  it('finds the fallback marker in a bounded streamed body', async () => {
    const chunk = new TextEncoder().encode('Loading quantity record');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const reader = stream.getReader();

    await expect(readFallbackMarker(reader, () => {})).resolves.toBe(
      chunk.byteLength,
    );
    await reader.cancel();
  });

  it('stops reading after the 512 KiB probe limit is exceeded', async () => {
    const streamed = 512 * 1024 + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(streamed));
        controller.close();
      },
    });
    const reader = stream.getReader();
    let observedBytes = 0;

    await expect(
      readFallbackMarker(reader, (bytes) => {
        observedBytes = bytes;
      }),
    ).rejects.toThrow('Stream exceeded its byte limit.');
    expect(observedBytes).toBe(streamed);
    await reader.cancel();
  });
});

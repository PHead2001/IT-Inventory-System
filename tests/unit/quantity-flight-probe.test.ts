// @vitest-environment node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { computeCacheBustingSearchParam } from 'next/dist/shared/lib/router/utils/cache-busting-search-param.js';
import type { RequestHeaders } from 'next/dist/client/components/router-reducer/fetch-server-response';
import {
  buildFullQuantityFlightProbe,
  fetchFullQuantityFlightProbe,
  readFallbackMarker,
} from '../e2e/quantity-flight-probe';

const requestUrl =
  'http://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000?type=quantity&_rsc=abc&q=adapter';

describe('full quantity Flight probe request', () => {
  it('preserves business query parameters and sends the installed Next Flight hash for its actual headers', async () => {
    const cookie = 'sb-access-token=secret-in-memory';
    const request = await buildFullQuantityFlightProbe(requestUrl, cookie);

    const headers = new Headers(request.headers);
    const routerHeaders: RequestHeaders = request.headers;
    const expectedHash = await computeCacheBustingSearchParam(
      routerHeaders['next-router-prefetch'],
      headers.get('next-router-segment-prefetch') ?? undefined,
      headers.get('next-router-state-tree') ?? undefined,
      headers.get('next-url') ?? undefined,
    );
    const target = new URL(request.url);
    expect(target.searchParams.get('_rsc')).toBe(expectedHash);
    expect(target.searchParams.getAll('_rsc')).toHaveLength(1);
    expect(target.searchParams.get('type')).toBe('quantity');
    expect(target.searchParams.get('q')).toBe('adapter');
    expect(request.headers).toEqual({
      Cookie: cookie,
      rsc: '1',
      Accept: 'text/x-component',
    });
    expect(request.redirect).toBe('error');
  });

  it.each([301, 302, 303, 307, 308])(
    'refuses a real %s redirect before reading a fabricated fallback at another endpoint',
    async (status) => {
      const paths: string[] = [];
      const server = createServer((request, response) => {
        paths.push(new URL(request.url!, 'http://localhost').pathname);
        if (request.url!.startsWith('/must-not-follow')) {
          response.writeHead(200, { 'content-type': 'text/x-component' });
          response.end('Loading quantity record');
        } else {
          response.writeHead(status, { location: '/must-not-follow' });
          response.end();
        }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('No listener');
        // Only the test adapter maps the admitted port to this owned fixture.
        // Native fetch still owns redirect handling and never contacts a hosted URL.
        const transport: typeof fetch = (input, init) => {
          const target = new URL(String(input));
          expect(target.origin).toBe('http://localhost:3000');
          target.hostname = '127.0.0.1';
          target.port = String(address.port);
          return fetch(target, init);
        };
        await expect(
          fetchFullQuantityFlightProbe(
            requestUrl,
            'synthetic=caller',
            new AbortController().signal,
            transport,
          ),
        ).rejects.toThrow();
        expect(paths).toEqual([
          '/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
        ]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it('replaces stale, empty and duplicate cache keys with exactly one canonical key', async () => {
    for (const suffix of ['&_rsc', '&_rsc=wrong', '&_rsc=one&_rsc=two']) {
      const request = await buildFullQuantityFlightProbe(
        requestUrl + suffix,
        'synthetic=caller',
      );
      expect(new URL(request.url).searchParams.getAll('_rsc')).toEqual(['']);
    }
  });

  it('rejects nonlocal input before invoking the actual transport', async () => {
    const transport = vi.fn();
    await expect(
      fetchFullQuantityFlightProbe(
        requestUrl.replace('localhost', 'hosted.example'),
        'synthetic=caller',
        new AbortController().signal,
        transport,
      ),
    ).rejects.toThrow('Invalid local quantity route request.');
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps caller cancellation active and applies a deadline to the actual transport signal', async () => {
    const caller = new AbortController();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Flight'));
    await fetchFullQuantityFlightProbe(
      requestUrl,
      'synthetic=caller',
      caller.signal,
      transport,
    );
    const signal = transport.mock.calls[0][1]!.signal!;
    expect(signal).not.toBe(caller.signal);
    expect(signal.aborted).toBe(false);
    expect(transport.mock.calls[0][1]!.redirect).toBe('error');
    caller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('refuses returned redirects and cancels their body without reading a fallback', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 307 }));
    await expect(
      fetchFullQuantityFlightProbe(
        requestUrl,
        'synthetic=caller',
        new AbortController().signal,
        transport,
      ),
    ).rejects.toThrow('Full Flight redirects are refused.');
    expect(cancelled).toBe(true);
  });

  it('bounds a real stalled Flight body by the transport deadline', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/x-component' });
      response.write('partial Flight without fallback');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No listener');
      const transport: typeof fetch = (input, init) => {
        const target = new URL(String(input));
        expect(target.origin).toBe('http://localhost:3000');
        target.hostname = '127.0.0.1';
        target.port = String(address.port);
        return fetch(target, init);
      };
      const response = await fetchFullQuantityFlightProbe(
        requestUrl,
        'synthetic=caller',
        new AbortController().signal,
        transport,
      );
      reader = response.body!.getReader();
      await expect(readFallbackMarker(reader, () => {})).rejects.toThrow();
    } finally {
      await reader?.cancel().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each([
    'https://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://example.test:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://localhost:3001/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://user@localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000',
    'http://localhost:3000/inventory/quantity/not-a-uuid',
    'http://localhost:3000/inventory/quantity/123e4567-e89b-12d3-a456-426614174000/extra',
  ])('rejects an out-of-scope URL: %s', async (url) => {
    await expect(
      buildFullQuantityFlightProbe(url, 'session-cookie'),
    ).rejects.toThrow('Invalid local quantity route request.');
  });

  it('requires the in-memory authenticated cookie', async () => {
    await expect(buildFullQuantityFlightProbe(requestUrl, '')).rejects.toThrow(
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

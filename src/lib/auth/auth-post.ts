'use client';
import type { z } from 'zod';
import { readBoundedJson } from './bounded-json';

export const authTransportTimeoutMs = 10_000;
/** Independent of the App Router queue; cancellation never proves server rollback. */
export async function authPost<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  options: { signal?: AbortSignal; requestBytes?: number } = {},
) {
  const serialized = JSON.stringify(body);
  if (
    options.signal?.aborted ||
    new TextEncoder().encode(serialized).length > (options.requestBytes ?? 256)
  )
    throw new Error('Unconfirmed response');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error('Unconfirmed response'));
    };
  });
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    timeout = setTimeout(cancel, authTransportTimeoutMs);
    return await Promise.race([
      cancelled,
      (async () => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (
          !response.ok ||
          response.headers.get('content-type')?.split(';')[0].trim() !==
            'application/json'
        )
          throw new Error('Unconfirmed response');
        return schema.parse(await readBoundedJson(response.body, 1024));
      })(),
    ]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

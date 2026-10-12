'use client';
import type { z } from 'zod';
import { readBoundedJson } from './bounded-json';
import {
  logoutResultSchema,
  logoutUnknownMessage,
  privacyComparisonSchema,
  type LogoutResult,
} from './logout-contract';
import {
  isLogoutGeneration,
  type LogoutPrivacyComparison,
} from './privacy-barrier';

export const logoutTransportTimeoutMs = 10_000;
/** Independent of the App Router's navigation/Server Action queue. */
async function authPost<T>(path: string, body: unknown, schema: z.ZodType<T>) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Unconfirmed response'));
        }, logoutTransportTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
export async function signOutSession(): Promise<LogoutResult> {
  try {
    return await authPost('/api/auth/logout', {}, logoutResultSchema);
  } catch {
    // Abort/timeout is uncertainty; it cannot prove the server cancelled logout.
    return { ok: false, message: logoutUnknownMessage };
  }
}
export async function acknowledgeLogoutPrivacyGeneration(
  generation: string,
): Promise<LogoutPrivacyComparison> {
  if (!isLogoutGeneration(generation)) return { status: 'invalid' };
  try {
    return await authPost(
      '/api/auth/privacy-confirm',
      { generation },
      privacyComparisonSchema,
    );
  } catch {
    return { status: 'unavailable' };
  }
}

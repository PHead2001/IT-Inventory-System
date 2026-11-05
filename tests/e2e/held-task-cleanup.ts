import type { Frame, Page, Request } from '@playwright/test';
import { holdResponse } from './held-route-work';
import { isPrivacyGenerationRead } from './privacy-read-request';

/** Observe the real task -> clean navigation before selecting its later read.
 * Referrer cannot identify this request: the app sends no-referrer. */
export async function holdTaskCleanupRead(page: Page, cleanHref: string) {
  const clean = new URL(cleanHref);
  const record = /^\/inventory\/(assets|quantity)\/[0-9a-f-]{36}$/.exec(
    clean.pathname,
  );
  if (
    clean.origin !== new URL(page.url()).origin ||
    clean.search ||
    clean.hash ||
    !record
  )
    throw new Error('Expected an exact clean owned inventory URL.');
  const task = new URL(clean);
  task.searchParams.set(
    'task',
    record[1] === 'assets' ? 'asset_move' : 'quantity_move',
  );
  let stage: 'task' | 'clean' | 'ready' | 'retired' = 'task';
  const observed = new WeakSet<Request>();
  let postCleanupReadObserved = false;
  let responseClaimed = false;
  const navigation = (frame: Frame) => {
    if (frame !== page.mainFrame() || stage === 'retired') return;
    const href = frame.url();
    if (stage === 'task' && href === task.href) stage = 'clean';
    else if (stage === 'clean' && href === clean.href) stage = 'ready';
    else if (stage === 'ready' && href !== clean.href) stage = 'retired';
    else if (href !== clean.href && href !== task.href) stage = 'retired';
  };
  const request = (value: Request) => {
    if (
      stage === 'ready' &&
      page.url() === clean.href &&
      new URL(value.url()).origin === clean.origin &&
      isPrivacyGenerationRead(value)
    ) {
      // Service-worker requests can lack a frame; they are never this owner.
      try {
        if (value.frame() === page.mainFrame()) {
          observed.add(value);
          postCleanupReadObserved = true;
        }
      } catch {
        /* Preserve unrelated request handling. */
      }
    }
  };
  page.on('framenavigated', navigation);
  page.on('request', request);
  const stop = () => {
    page.off('framenavigated', navigation);
    page.off('request', request);
  };
  try {
    const held = await holdResponse(
      page,
      (value) => {
        const matches =
          stage === 'ready' && page.url() === clean.href && observed.has(value);
        if (matches) responseClaimed = true;
        return matches;
      },
      7_500,
    );
    return {
      ...held,
      diagnostic: () => ({
        phase: stage,
        postCleanupReadObserved,
        responseClaimed,
      }),
      dispose: async () => {
        stop();
        await held.dispose();
      },
    };
  } catch (error) {
    stop();
    throw error;
  }
}

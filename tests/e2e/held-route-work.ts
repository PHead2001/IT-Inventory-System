import type { Page, Request } from '@playwright/test';

/** Holds one genuine navigation/action response; never invents Flight or readiness. */
export async function holdRouteWork(
  page: Pick<Page, 'route' | 'unroute'>,
  pathname: string,
  action = false,
) {
  return holdResponse(page, (request) => {
    const headers = request.headers();
    return (
      new URL(request.url()).pathname === pathname &&
      (action
        ? request.method() === 'POST' && !!headers['next-action']
        : request.method() === 'GET' &&
          headers.rsc === '1' &&
          !headers['next-router-prefetch'] &&
          !headers['next-router-segment-prefetch'])
    );
  });
}

/** Shared genuine-response lifecycle; matchers confer no application authority. */
export async function holdResponse(
  page: Pick<Page, 'route' | 'unroute'>,
  matches: (request: Request) => boolean,
  arrivalTimeoutMs = 15_000,
) {
  if (
    !Number.isFinite(arrivalTimeoutMs) ||
    arrivalTimeoutMs <= 0 ||
    arrivalTimeoutMs > 15_000
  )
    throw new Error('Held response arrival bound invalid.');
  let release!: () => void;
  let received!: () => void;
  let arrivalFailed!: (error: unknown) => void;
  let delivered!: () => void;
  let deliveryFailed!: (error: unknown) => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrival = new Promise<void>((resolve, reject) => {
    received = resolve;
    arrivalFailed = reject;
  });
  const delivery = new Promise<void>((resolve, reject) => {
    delivered = resolve;
    deliveryFailed = reject;
  });
  // Cleanup must remain awaitable even when a response fails to arrive/deliver.
  const completion = new Promise<void>((resolve) => {
    finished = resolve;
  });
  void arrival.catch(() => {});
  void delivery.catch(() => {});
  let claimed = false;
  let expired = false;
  const timeout = setTimeout(() => {
    expired = true;
    const error = new Error('Held response did not arrive within its bound.');
    arrivalFailed(error);
    deliveryFailed(error);
    release();
  }, arrivalTimeoutMs);
  const pattern = '**/*';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    const request = route.request();
    if (claimed || expired || !matches(request))
      // Preserve earlier observers, including the partial-prefetch cancellation
      // probe. continue() would bypass every remaining matching handler.
      return route.fallback();
    claimed = true;
    try {
      const response = await route.fetch({ timeout: 15_000 });
      if (!response.ok())
        throw new Error('Held route response was not successful.');
      if (expired) throw new Error('Held response arrived after its bound.');
      clearTimeout(timeout);
      received();
      await gate;
      await route.fulfill({ response });
      // Cached destination content cannot substitute for successful fulfillment.
      delivered();
    } catch (error) {
      arrivalFailed(error);
      deliveryFailed(error);
      await route.abort('failed').catch(() => {});
    } finally {
      clearTimeout(timeout);
      finished();
    }
  };
  try {
    await page.route(pattern, handler);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
  return {
    arrival,
    delivery,
    release,
    dispose: async () => {
      clearTimeout(timeout);
      release();
      if (claimed) await completion;
      await page.unroute(pattern, handler);
    },
  };
}

import type { Page } from '@playwright/test';

/** Holds one genuine navigation/action response; never invents Flight or readiness. */
export async function holdRouteWork(
  page: Pick<Page, 'route' | 'unroute'>,
  pathname: string,
  action = false,
) {
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
  const pattern = '**/*';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (
      claimed ||
      new URL(request.url()).pathname !== pathname ||
      (action
        ? request.method() !== 'POST' || !headers['next-action']
        : request.method() !== 'GET' ||
          headers.rsc !== '1' ||
          !!headers['next-router-prefetch'])
    )
      return route.continue();
    claimed = true;
    try {
      const response = await route.fetch({ timeout: 15_000 });
      if (!response.ok())
        throw new Error('Held route response was not successful.');
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
      finished();
    }
  };
  await page.route(pattern, handler);
  return {
    arrival,
    delivery,
    release,
    dispose: async () => {
      release();
      if (claimed) await completion;
      await page.unroute(pattern, handler);
    },
  };
}

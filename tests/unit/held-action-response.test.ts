import { expect, it, vi } from 'vitest';
import type { Page, Request, Response } from '@playwright/test';
import { waitForHeldActionResponse } from '../e2e/held-action-response';

function action() {
  return {
    method: () => 'POST',
    headers: () => ({ 'next-action': 'inspection' }),
    postData: () => '[{"path":"/inventory/quantity/item","siteId":"site"}]',
  } as unknown as Request;
}
function response(request: Request, status = 200) {
  return {
    request: () => request,
    ok: () => status >= 200 && status < 300,
    status: () => status,
    // HTTP response headers can arrive while the Flight tail stays open.
    finished: vi.fn(() => new Promise<null>(() => {})),
  };
}
function transport() {
  let predicate!: (value: Response) => boolean;
  let resolve!: (value: Response) => void;
  const page = {
    waitForResponse: vi.fn((matches: typeof predicate) => {
      predicate = matches;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    }),
  } as unknown as Page;
  return {
    page,
    deliver(value: ReturnType<typeof response>) {
      if (predicate(value as unknown as Response))
        resolve(value as unknown as Response);
    },
  };
}

it('observes the exact successful held response without awaiting its open Flight tail', async () => {
  const request = action();
  const network = transport();
  const incoming = response(request);
  const observed = waitForHeldActionResponse(network.page, request);
  network.deliver(incoming);
  const result = await Promise.race([
    observed,
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('tail wait'), 30),
    ),
  ]);
  expect(result).toBe(incoming);
  expect(incoming.finished).not.toHaveBeenCalled();
});

it('ignores another successful inspection with the same business arguments', async () => {
  const held = action();
  const duplicate = action();
  expect(duplicate.postData()).toBe(held.postData());
  const network = transport();
  let released = false;
  const observed = waitForHeldActionResponse(network.page, held).then(() => {
    released = true;
  });
  network.deliver(response(duplicate));
  await Promise.resolve();
  await Promise.resolve();
  expect(released).toBe(false);
  network.deliver(response(held));
  await observed;
  expect(released).toBe(true);
});

it('rejects an unsuccessful held action before checking usable business state', async () => {
  const held = action();
  const network = transport();
  const observed = waitForHeldActionResponse(network.page, held);
  network.deliver(response(held, 500));
  await expect(observed).rejects.toThrow('Held action returned HTTP 500');
});

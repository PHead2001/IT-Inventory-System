// @vitest-environment node
import type { APIResponse, Page, Route } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { holdRouteWork } from '../e2e/held-route-work';

async function fixture() {
  let handler!: Parameters<Page['route']>[1];
  const page = {
    route: vi.fn(
      async (
        _pattern: Parameters<Page['route']>[0],
        registered: Parameters<Page['route']>[1],
      ) => {
        handler = registered;
      },
    ),
    unroute: vi.fn(async () => {}),
  } as unknown as Pick<Page, 'route' | 'unroute'>;
  const response = { ok: () => true } as APIResponse;
  const route = {
    request: () => ({
      url: () => 'http://localhost:3000/inventory/quantity/owned',
      method: () => 'GET',
      headers: () => ({ rsc: '1' }),
    }),
    fetch: vi.fn(async () => response),
    fulfill: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    continue: vi.fn(async () => {}),
  };
  const held = await holdRouteWork(page, '/inventory/quantity/owned');
  return {
    page,
    route,
    response,
    held,
    invoke: () =>
      handler(route as unknown as Route, (route as unknown as Route).request()),
  };
}

it('rejects late delivery when fulfillment fails after successful arrival, while cleanup still completes', async () => {
  const { page, route, held, invoke } = await fixture();
  const failure = new Error('Browser rejected late Flight fulfillment');
  route.fulfill.mockRejectedValue(failure);
  const handling = invoke();
  await held.arrival;
  expect(route.fulfill).not.toHaveBeenCalled();
  held.release();
  // A journey awaiting delivery must fail even if its cached heading is visible.
  await expect(held.delivery).rejects.toBe(failure);
  await handling;
  expect(route.abort).toHaveBeenCalledWith('failed');
  await held.dispose();
  expect(page.unroute).toHaveBeenCalledOnce();
});

it('resolves delivery only after released fulfillment actually completes', async () => {
  const { route, response, held, invoke } = await fixture();
  let finish!: () => void;
  route.fulfill.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const delivered = vi.fn();
  void held.delivery.then(delivered);
  const handling = invoke();
  await held.arrival;
  held.release();
  await vi.waitFor(() =>
    expect(route.fulfill).toHaveBeenCalledWith({ response }),
  );
  expect(delivered).not.toHaveBeenCalled();
  finish();
  await held.delivery;
  expect(delivered).toHaveBeenCalledOnce();
  await handling;
  await held.dispose();
});

it('rejects both arrival and delivery on fetch failure and always unregisters during cleanup', async () => {
  const { page, route, held, invoke } = await fixture();
  const failure = new Error('Real route fetch failed');
  route.fetch.mockRejectedValue(failure);
  route.abort.mockRejectedValue(new Error('Already closed'));
  const handling = invoke();
  await expect(held.arrival).rejects.toBe(failure);
  await expect(held.delivery).rejects.toBe(failure);
  await held.dispose();
  await handling;
  expect(route.fulfill).not.toHaveBeenCalled();
  expect(page.unroute).toHaveBeenCalledOnce();
});

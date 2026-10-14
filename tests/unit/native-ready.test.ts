import { expect, it, vi } from 'vitest';
import { armNativeReady } from '../e2e/native-ready';

function fixture() {
  let ready: (() => Promise<void>) | undefined;
  let close: (() => void) | undefined;
  const page = {
    exposeBinding: vi.fn(
      async (_name: string, callback: () => Promise<void>) => {
        if (ready) throw new Error('binding already registered');
        ready = callback;
      },
    ),
    once: vi.fn((_event: string, callback: () => void) => {
      close = callback;
    }),
  };
  return {
    page: page as never,
    expose: page.exposeBinding,
    ready: () => ready!(),
    close: () => close!(),
  };
}

it('rearms the same page twice with one binding and a fresh validation for each native-ready event', async () => {
  const f = fixture(),
    validate = vi.fn(async () => {}),
    run = vi.fn(async () => {});
  for (let i = 0; i < 2; i++) {
    const { completed } = await armNativeReady(f.page, validate, run);
    await f.ready();
    await completed;
    await f.ready();
  }
  expect(f.expose).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(2);
});

it('rejects an overlapping arm without losing the original ready barrier', async () => {
  const f = fixture(),
    run = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, async () => {}, run);
  await expect(armNativeReady(f.page, async () => {}, run)).rejects.toThrow(
    'already armed',
  );
  await f.ready();
  await completed;
  expect(run).toHaveBeenCalledTimes(1);
});

it('a failed actual-animation validation rejects the wait and never performs the operation', async () => {
  const f = fixture(),
    run = vi.fn(async () => {});
  const { completed } = await armNativeReady(
    f.page,
    async () => {
      throw new Error('no running native snapshot');
    },
    run,
  );
  const result = expect(completed).rejects.toThrow(
    'no running native snapshot',
  );
  await f.ready();
  await result;
  expect(run).not.toHaveBeenCalled();
});

it('page closure rejects and retires the pending operation', async () => {
  const f = fixture(),
    run = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, async () => {}, run);
  const result = expect(completed).rejects.toThrow('Page closed');
  f.close();
  await result;
  await f.ready();
  expect(run).not.toHaveBeenCalled();
});

import { afterEach, expect, it, vi } from 'vitest';
import { createRouteCaptureCompletion } from './route-capture-completion';
import {
  inventoryCaptureRegionIds,
  isInventoryCaptureName,
} from './inventory-capture-regions';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => vi.unstubAllGlobals());

it.each(['title-first', 'regions-first'])(
  'seals one synchronous %s capture and waits for every shared and unmatched region',
  async (order) => {
    const store = createRouteCaptureCompletion();
    const names = ['title', 'body', 'header-enter', 'task-exit'];
    const finishes: (() => void)[] = [];
    const animations = names.map((name) => ({
      effect: { pseudoElement: `::view-transition-new(${name})` },
      finished: new Promise<void>((resolve) => finishes.push(resolve)),
    }));
    vi.stubGlobal('document', { getAnimations: () => animations });
    const captured = vi.fn(),
      complete = vi.fn(),
      missing = vi.fn();
    const approval = {};
    const published = vi.fn();
    store.subscribe(published);
    expect(store.available(approval)).toBe(true);
    const capture = (name: string) =>
      store.capture({
        approval,
        name,
        current: () => true,
        captured,
        complete,
        missing,
        body: (participant) => participant !== 'title',
      });
    for (const name of order === 'title-first' ? names : [...names].reverse())
      expect(capture(name)).toBe(true);
    expect(capture('body')).toBe(false); // Duplicate dispatch cannot acquire a lease.
    expect(captured).not.toHaveBeenCalled(); // All region handoffs happen first.
    await flush();
    expect(captured).toHaveBeenCalledOnce();
    expect(published).toHaveBeenCalledOnce();
    expect(store.snapshot()).toBe(1);
    expect(store.available(approval)).toBe(false);
    expect(capture('late-region')).toBe(false);
    expect(capture('body')).toBe(false);
    for (const finish of finishes.slice(0, -1)) finish();
    await flush();
    expect(complete).not.toHaveBeenCalled();
    finishes.at(-1)!();
    await flush();
    expect(complete).toHaveBeenCalledOnce();
    expect(missing).not.toHaveBeenCalled();
  },
);

it.each(['supersession', 'privacy withdrawal'])(
  'an old final participant cannot retire a newer approval after %s',
  async () => {
    const store = createRouteCaptureCompletion();
    let resolve!: () => void;
    const animation = {
      effect: { pseudoElement: '::view-transition-old(body)' },
      finished: new Promise<void>((done) => {
        resolve = done;
      }),
    };
    vi.stubGlobal('document', { getAnimations: () => [animation] });
    const old = {},
      next = {};
    let current = old;
    const complete = vi.fn(),
      captured = vi.fn(),
      missing = vi.fn();
    const capture = (approval: object) =>
      store.capture({
        approval,
        name: 'body',
        current: () => current === approval,
        captured,
        complete,
        missing,
        body: () => true,
      });
    expect(capture(old)).toBe(true);
    await flush();
    current = next;
    expect(capture(old)).toBe(false);
    expect(capture(next)).toBe(true);
    await flush();
    current = {};
    resolve();
    await flush();
    expect(complete).not.toHaveBeenCalled();
    expect(missing).not.toHaveBeenCalled();
  },
);

it('rejects a title without an actual opted-in region and bounds the explicit names before capture', async () => {
  expect(inventoryCaptureRegionIds.length + 1).toBeLessThan(64);
  expect(
    isInventoryCaptureName('pair-content-body-forged', 'pair-content'),
  ).toBe(false);
  expect(isInventoryCaptureName('pair-content-header', 'pair-content')).toBe(
    true,
  );
  const store = createRouteCaptureCompletion(),
    missing = vi.fn(),
    complete = vi.fn();
  vi.stubGlobal('document', { getAnimations: () => [] });
  store.capture({
    approval: {},
    name: 'title',
    current: () => true,
    captured: () => {},
    complete,
    missing,
    body: () => false,
  });
  await flush();
  expect(missing).toHaveBeenCalledOnce();
  expect(complete).not.toHaveBeenCalled();
});

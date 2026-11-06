import { expect, it, vi } from 'vitest';
import { invalidatePeeks, peekInvalidationEvent } from './invalidation';
import {
  bindRouteActionResults,
  observeRouteActionResult,
} from '@/components/experience/route-action-result';

it('invalidates an authoritative commit and preserves its exact receipt', async () => {
  const listener = vi.fn();
  window.addEventListener(peekInvalidationEvent, listener);
  const retire = bindRouteActionResults(vi.fn());
  try {
    const result = { ok: true, changed: true, entityId: 'record' };
    expect(await observeRouteActionResult(Promise.resolve(result))).toBe(
      result,
    );
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    retire();
    window.removeEventListener(peekInvalidationEvent, listener);
  }
});
it('does not invalidate an unknown/error result or a retired actor scope', async () => {
  const listener = vi.fn();
  window.addEventListener(peekInvalidationEvent, listener);
  let settle!: (value: { ok: true }) => void;
  const retireOld = bindRouteActionResults(vi.fn());
  const old = observeRouteActionResult(
    new Promise<{ ok: true }>((resolve) => {
      settle = resolve;
    }),
  );
  const retireNew = bindRouteActionResults(vi.fn());
  retireOld();
  try {
    await observeRouteActionResult(
      Promise.resolve({ ok: false, code: 'unexpected' }),
    );
    settle({ ok: true });
    await old;
    expect(listener).not.toHaveBeenCalled();
    invalidatePeeks();
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    retireNew();
    window.removeEventListener(peekInvalidationEvent, listener);
  }
});

it.each(['always-unbound', 'bind-then-unbind'])(
  'does not invalidate a success captured %s without a presentation scope',
  async (scenario) => {
    const listener = vi.fn();
    window.addEventListener(peekInvalidationEvent, listener);
    let complete!: (value: { ok: true }) => void;
    const receipt = { ok: true as const };
    const pending = observeRouteActionResult(
      new Promise<{ ok: true }>((resolve) => {
        complete = resolve;
      }),
    );
    if (scenario === 'bind-then-unbind') {
      const retire = bindRouteActionResults(vi.fn());
      retire();
    }
    try {
      complete(receipt);
      expect(await pending).toBe(receipt);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(peekInvalidationEvent, listener);
    }
  },
);

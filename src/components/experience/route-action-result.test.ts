import { expect, it, vi } from 'vitest';
import {
  bindRouteActionResults,
  observeRouteActionResult,
} from './route-action-result';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';

it.each(['forbidden', 'actor_changed', 'P1001', '42501'])(
  'signals explicit %s denial before the caller receives the unchanged result',
  async (code) => {
    const invalidate = vi.fn();
    const unbind = bindRouteActionResults(invalidate);
    const result = { ok: false, code, message: 'Existing action message' };
    try {
      const observed = await observeRouteActionResult(Promise.resolve(result));
      expect(invalidate).toHaveBeenCalledOnce();
      expect(observed).toBe(result);
    } finally {
      unbind();
    }
  },
);

it('preserves successes, transport rejection and unclassified failure without suppression', async () => {
  const invalidate = vi.fn();
  const unbind = bindRouteActionResults(invalidate);
  const error = new Error('Transport failed');
  try {
    for (const result of [
      { ok: true, code: 'forbidden', receipt: 'existing receipt' },
      { ok: false, code: 'identity_unverified' },
      { ok: false, code: 'P1002' },
      { ok: false, message: 'Forbidden' },
      { error: { code: '42501' } },
    ]) {
      expect(await observeRouteActionResult(Promise.resolve(result))).toBe(
        result,
      );
    }
    await expect(observeRouteActionResult(Promise.reject(error))).rejects.toBe(
      error,
    );
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    unbind();
  }
});

it('preserves the authoritative denial when presentation invalidation throws', async () => {
  const invalidate = vi.fn(() => {
    throw new Error('Snapshot cancellation failed');
  });
  const unbind = bindRouteActionResults(invalidate);
  const denied = { ok: false, code: 'forbidden', message: 'Existing denial' };
  const transportError = new Error('Original action rejection');
  try {
    expect(await observeRouteActionResult(Promise.resolve(denied))).toBe(
      denied,
    );
    expect(invalidate).toHaveBeenCalledOnce();
    await expect(
      observeRouteActionResult(Promise.reject(transportError)),
    ).rejects.toBe(transportError);
    expect(invalidate).toHaveBeenCalledOnce();
  } finally {
    unbind();
  }
});

it('binds denial to invocation scope and ignores actions started without a mounted provider', async () => {
  let settle!: (result: { ok: false; code: string }) => void;
  const deferred = () =>
    new Promise<{ ok: false; code: string }>((resolve) => {
      settle = resolve;
    });
  const oldInvalidate = vi.fn();
  const newInvalidate = vi.fn();
  const retireOld = bindRouteActionResults(oldInvalidate);
  const oldAction = observeRouteActionResult(deferred());
  const retireNew = bindRouteActionResults(newInvalidate);
  retireOld();
  settle({ ok: false, code: 'forbidden' });
  await oldAction;
  expect(oldInvalidate).not.toHaveBeenCalled();
  expect(newInvalidate).not.toHaveBeenCalled();
  retireNew();
  const unscopedAction = observeRouteActionResult(deferred());
  const retireLater = bindRouteActionResults(newInvalidate);
  try {
    settle({ ok: false, code: 'P1001' });
    await unscopedAction;
    expect(newInvalidate).not.toHaveBeenCalled();
  } finally {
    retireLater();
  }
});

it('tracks the original promise once and ignores a denial from a retired navigation generation', async () => {
  let settle!: (value: { ok: false; code: string }) => void;
  const action = new Promise<{ ok: false; code: string }>((resolve) => {
    settle = resolve;
  });
  let generation = 0;
  const invalidate = vi.fn();
  const track = vi.fn();
  const retire = bindRouteActionResults(invalidate, track, () => {
    const started = generation;
    return () => generation === started;
  });
  try {
    const result = observeRouteActionResult(action);
    expect(track).toHaveBeenCalledExactlyOnceWith(action);
    generation += 1;
    const denial = { ok: false as const, code: 'forbidden' };
    settle(denial);
    expect(await result).toBe(denial);
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    retire();
  }
});

it('presentation tracking and generation-check failures do not change results or promise rejection', async () => {
  const denied = { ok: false, code: 'forbidden' };
  const originalError = new Error('Original transport failure');
  for (const failure of ['track', 'generation']) {
    const retire = bindRouteActionResults(
      vi.fn(),
      () => {
        if (failure === 'track') throw new Error('Presentation');
      },
      () => () => {
        throw new Error('Presentation');
      },
    );
    try {
      expect(await observeRouteActionResult(Promise.resolve(denied))).toBe(
        denied,
      );
      await expect(
        observeRouteActionResult(Promise.reject(originalError)),
      ).rejects.toBe(originalError);
    } finally {
      retire();
    }
  }
});

it('withdraws only a departed caller and cannot invalidate another live presentation scope', async () => {
  const invalidate = vi.fn();
  const retire = bindRouteActionResults(invalidate);
  let live = true;
  let settle!: (value: { ok: false; code: string }) => void;
  const action = new Promise<{ ok: false; code: string }>((resolve) => {
    settle = resolve;
  });
  try {
    const result = observeRouteActionResult(action, () => live);
    live = false;
    const denial = { ok: false as const, code: 'forbidden' };
    settle(denial);
    expect(await result).toBe(denial);
    expect(invalidate).not.toHaveBeenCalled();
    expect(
      await observeRouteActionResult(Promise.resolve(denial), () => true),
    ).toBe(denial);
    expect(invalidate).toHaveBeenCalledOnce();
    const original = new Error('Original');
    await expect(
      observeRouteActionResult(Promise.reject(original), () => false),
    ).rejects.toBe(original);
  } finally {
    retire();
  }
});

it('a throwing owner liveness check cannot change an authoritative denial', async () => {
  const invalidate = vi.fn();
  const retire = bindRouteActionResults(invalidate);
  const denial = { ok: false, code: 'forbidden' };
  try {
    expect(
      await observeRouteActionResult(Promise.resolve(denial), () => {
        throw new Error('Presentation');
      }),
    ).toBe(denial);
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    retire();
  }
});

it.each(['forbidden', 'UNKNOWN', 'success', 'transport'])(
  'a separate native presentation ticket preserves the exact %s outcome and releases once',
  async (outcome) => {
    const lifetime = createRoutePresentationLifetime();
    const source = Symbol();
    const unmount = lifetime.mount(source);
    const exit = lifetime.exitCallback(source);
    let owner = true;
    let settle!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const action = new Promise<unknown>((resolve, fail) => {
      settle = resolve;
      reject = fail;
    });
    const invalidate = vi.fn();
    const release = vi.fn();
    const unbind = bindRouteActionResults(
      invalidate,
      undefined,
      () => () => false,
      (current, token) => {
        const ticket = lifetime.capture(token, current, () => true)!;
        return Object.freeze({
          current: ticket.current,
          release: () => {
            release();
            ticket.release();
          },
        });
      },
    );
    try {
      const result = observeRouteActionResult(action, () => owner, source);
      lifetime.navigation();
      owner = false;
      unmount();
      lifetime.mount(Symbol());
      const finish = exit()!;
      const value =
        outcome === 'success'
          ? { ok: true, receipt: 'unchanged' }
          : { ok: false, code: outcome };
      if (outcome === 'transport') {
        const error = new Error('Original rejection');
        reject(error);
        await expect(result).rejects.toBe(error);
      } else {
        settle(value);
        expect(await result).toBe(value);
      }
      expect(invalidate).toHaveBeenCalledTimes(outcome === 'forbidden' ? 1 : 0);
      expect(release).toHaveBeenCalledOnce();
      expect(exit()).toBeUndefined();
      finish();
    } finally {
      unbind();
    }
  },
);

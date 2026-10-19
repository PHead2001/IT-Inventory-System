import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { routeContentMotion } from './route-content-motion';
import { sharedTitleMotion } from './shared-title-motion';

type Effect = {
  startTime: number | null;
  playState: string;
  effect: { pseudoElement: string; getKeyframes: () => Keyframe[] };
  cancel: ReturnType<typeof vi.fn>;
};
const title = 'inventory-title-clock';
const body = 'inventory-body-clock';
let clock: number | null;
let native: Effect[];
let replacements: Effect[];
let skip: ReturnType<typeof vi.fn>;
function effect(pseudo: string, startTime: number): Effect {
  const result: Effect = {
    startTime,
    playState: 'running',
    effect: {
      pseudoElement: pseudo,
      getKeyframes: () => [
        {
          offset: 0,
          width: '120px',
          height: '20px',
          transform: 'matrix(1, 0, 0, 1, 20, 400)',
        },
        { offset: 1 },
      ],
    },
    cancel: vi.fn(() => {
      result.playState = 'idle';
    }),
  };
  return result;
}
beforeEach(() => {
  clock = 100;
  replacements = [];
  native = [title, body].flatMap((name, index) =>
    ['group', 'old', 'new'].map((kind) =>
      effect(`::view-transition-${kind}(${name})`, 100 + index * 66),
    ),
  );
  native.push(effect('::view-transition-group(unowned)', 2000));
  skip = vi.fn();
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition: skip },
  });
  Object.defineProperty(document, 'timeline', {
    configurable: true,
    value: {
      get currentTime() {
        return clock;
      },
    },
  });
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () =>
      [...native, ...replacements].filter((a) => a.playState !== 'idle'),
  });
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    value: vi.fn((_frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const replacement = effect(
        options.pseudoElement!,
        300 + replacements.length * 66,
      );
      replacements.push(replacement);
      return replacement;
    }),
  });
  vi.stubGlobal('getComputedStyle', (_element: Element, pseudo?: string) =>
    pseudo
      ? {
          width: '240px',
          height: '48px',
          transform: 'matrix(1, 0, 0, 1, 100, 80)',
        }
      : {
          getPropertyValue: (name: string) =>
            name === '--motion-route' ? '200ms' : 'ease',
        },
  );
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      is2D = true;
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor(value?: string) {
        if (value)
          [this.a, this.b, this.c, this.d, this.e, this.f] = value
            .match(/matrix\((.*)\)/)![1]
            .split(',')
            .map(Number);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each(['body-first', 'title-first'])(
  'aligns all title/body replacements and native title fades after synchronous %s registration',
  async (order) => {
    const callbacks = [
      () => routeContentMotion({ name: body }, () => true),
      () => sharedTitleMotion({ name: title }, () => true),
    ];
    if (order === 'title-first') callbacks.reverse();
    callbacks[0]();
    clock = 166;
    callbacks[1]();
    expect(replacements).toHaveLength(4);
    clock = 200;
    await Promise.resolve();
    expect(
      [...replacements, native[1], native[2]].map((a) => a.startTime),
    ).toEqual(Array(6).fill(200));
    expect(native[6].startTime).toBe(2000);
    expect(skip).not.toHaveBeenCalled();
  },
);

it('fails closed when the final shared clock is unavailable', async () => {
  const unsupported = vi.fn();
  routeContentMotion({ name: body }, () => true, unsupported);
  sharedTitleMotion({ name: title }, () => true, unsupported);
  clock = null;
  await Promise.resolve();
  expect(unsupported).toHaveBeenCalled();
  replacements.forEach((a) => expect(a.cancel).toHaveBeenCalled());
  expect(skip).toHaveBeenCalled();
});

it('never retimes or skips a replacement native transition before finalization', async () => {
  routeContentMotion({ name: body }, () => true);
  sharedTitleMotion({ name: title }, () => true);
  const newerSkip = vi.fn();
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition: newerSkip },
  });
  clock = 400;
  await Promise.resolve();
  replacements.forEach((a) => expect(a.cancel).toHaveBeenCalled());
  expect(newerSkip).not.toHaveBeenCalled();
});

it('does not revive withdrawn effects when privacy ownership expires before finalization', async () => {
  let valid = true;
  routeContentMotion({ name: body }, () => valid);
  sharedTitleMotion({ name: title }, () => valid);
  valid = false;
  await Promise.resolve();
  replacements.forEach((a) => expect(a.cancel).toHaveBeenCalled());
  expect(skip).toHaveBeenCalled();
});

it('ignores retired callback effects while aligning the remaining exact owner', async () => {
  const cleanup = routeContentMotion({ name: body }, () => true);
  sharedTitleMotion({ name: title }, () => true);
  cleanup?.();
  clock = 400;
  await Promise.resolve();
  expect(replacements.slice(0, 3).map((a) => a.startTime)).toEqual([
    300, 366, 432,
  ]);
  expect(replacements[3].startTime).toBe(400);
  expect(native[1].startTime).toBe(400);
  expect(skip).not.toHaveBeenCalled();
});

it('fails closed instead of inventing another clock for a late callback on the same native transition', async () => {
  routeContentMotion({ name: body }, () => true);
  await Promise.resolve();
  const unsupported = vi.fn();
  clock = 400;
  sharedTitleMotion({ name: title }, () => true, unsupported);
  expect(unsupported).toHaveBeenCalledOnce();
  expect(skip).toHaveBeenCalledOnce();
});

it('does not revive a native image effect canceled before the shared clock is finalized', async () => {
  sharedTitleMotion({ name: title }, () => true);
  native[1].cancel();
  clock = 400;
  await Promise.resolve();
  expect(native[1].startTime).toBe(100);
  expect(native[1].playState).toBe('idle');
  expect(native[2].startTime).toBe(400);
  expect(replacements[0].startTime).toBe(400);
  expect(skip).not.toHaveBeenCalled();
});

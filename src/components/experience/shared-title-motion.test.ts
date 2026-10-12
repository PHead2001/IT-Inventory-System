import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { sharedTitleMotion } from './shared-title-motion';

const name = 'inventory-title-opaque';
const group = `::view-transition-group(${name})`;
const nativeCancel = vi.fn();
const otherCancel = vi.fn();
const replacementCancel = vi.fn();
let frames: Array<Record<string, unknown>>;
let destination: { width: string; height: string; transform: string };
let animate: ReturnType<typeof vi.fn>;
let skip: ReturnType<typeof vi.fn>;
let durationToken: string;

it('holds captured geometry without inheriting its paused state into native image fades', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const groupRule = css.match(
    /::view-transition-group\(\.record-title\)\s*\{([^}]+)\}/,
  )?.[1];
  const imageRule = css
    .match(
      /::view-transition-old\(\.record-title\),\s*::view-transition-new\(\.record-title\)\s*\{([^}]+)\}/g,
    )
    ?.at(-1);
  // The native UA sets image-pair/old/new play state to inherit. Without this
  // author override, paused finite fades prevent ViewTransition.finished.
  expect(groupRule).toMatch(/animation-play-state:\s*paused\s*;/);
  expect(imageRule).toMatch(/animation-play-state:\s*running\s*;/);
  expect(imageRule).toMatch(/width:\s*100%\s*;/);
  expect(imageRule).toMatch(/height:\s*100%\s*;/);
});

beforeEach(() => {
  durationToken = '200ms';
  frames = [
    {
      offset: 0,
      computedOffset: 0,
      width: '120px',
      height: '20px',
      transform: 'matrix(1, 0, 0, 1, 20, 400)',
    },
    { offset: 1, computedOffset: 1 },
  ];
  destination = {
    width: '240px',
    height: '48px',
    transform: 'matrix(1, 0, 0, 1, 100, 80)',
  };
  skip = vi.fn();
  animate = vi.fn(() => ({ cancel: replacementCancel }));
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition: skip },
  });
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        effect: { pseudoElement: group, getKeyframes: () => frames },
        cancel: nativeCancel,
      },
      {
        effect: {
          pseudoElement: '::view-transition-group(other-title)',
          getKeyframes: () => [],
        },
        cancel: otherCancel,
      },
    ],
  });
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    value: animate,
  });
  vi.stubGlobal('getComputedStyle', (_element: Element, pseudo?: string) => {
    if (pseudo === group) {
      // It is an error to read an interpolated destination before cancellation.
      expect(nativeCancel).toHaveBeenCalled();
      return destination;
    }
    return {
      getPropertyValue: (property: string) =>
        property === '--motion-route'
          ? durationToken
          : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    };
  });
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
        if (!value) return;
        const values = value
          .match(/^matrix\((.*)\)$/)?.[1]
          .split(',')
          .map(Number);
        if (!values || values.length !== 6)
          throw new Error('Unsupported transform');
        [this.a, this.b, this.c, this.d, this.e, this.f] = values;
      }
    },
  );
});

it.each(['0.2s', '.2s', ' 200ms ', '2e-1s'])(
  'converts the CSS time %s to the 200ms WAAPI duration',
  (token) => {
    durationToken = token;
    sharedTitleMotion({ name }, () => true);
    expect(animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 200 }),
    );
    expect(skip).not.toHaveBeenCalled();
  },
);

it.each([
  '200',
  '200seconds',
  '200 ms',
  '200.ms',
  'NaNms',
  'Infinitys',
  '1e999s',
  '0ms',
  '-1ms',
  '251ms',
  '0.251s',
])(
  'rejects invalid or out-of-bounds CSS timing %s without starting replacement motion',
  (token) => {
    durationToken = token;
    sharedTitleMotion({ name }, () => true);
    expect(animate).not.toHaveBeenCalled();
    expect(skip).toHaveBeenCalled();
  },
);
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'activeViewTransition');
  Reflect.deleteProperty(document, 'getAnimations');
  Reflect.deleteProperty(document.documentElement, 'animate');
});

it('replaces only the exact browser-captured shared group with transform-only motion and implicit final geometry', () => {
  const cleanup = sharedTitleMotion({ name }, () => true);
  expect(nativeCancel).toHaveBeenCalledTimes(1);
  expect(otherCancel).not.toHaveBeenCalled();
  expect(animate).toHaveBeenCalledWith(
    [
      { transform: 'translate(20px, 400px) scale(0.5, 0.4166666666666667)' },
      { transform: 'translate(100px, 80px) scale(1, 1)' },
    ],
    {
      duration: 200,
      delay: 0,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      pseudoElement: group,
    },
  );
  const replacementFrames = animate.mock.calls[0][0] as Array<
    Record<string, unknown>
  >;
  expect(
    replacementFrames.every((frame) =>
      Object.keys(frame).every(
        (property) => property === 'transform' || property === 'opacity',
      ),
    ),
  ).toBe(true);
  expect(skip).not.toHaveBeenCalled();
  cleanup?.();
  expect(replacementCancel).toHaveBeenCalled();
});

it('uses the actual Back capture, including a scroll shift, instead of a saved click box', () => {
  frames[0] = {
    offset: 0,
    width: '240px',
    height: '48px',
    transform: 'matrix(1, 0, 0, 1, 100, -40)',
  };
  destination = {
    width: '120px',
    height: '20px',
    transform: 'matrix(1, 0, 0, 1, 20, 180)',
  };
  sharedTitleMotion({ name }, () => true);
  expect(animate.mock.calls[0][0]).toEqual([
    { transform: 'translate(100px, -40px) scale(2, 2.4)' },
    { transform: 'translate(20px, 180px) scale(1, 1)' },
  ]);
});

it('a departing callback cleanup cannot cancel a subsequent replacement', () => {
  const firstCancel = vi.fn();
  const nextCancel = vi.fn();
  animate
    .mockReturnValueOnce({ cancel: firstCancel })
    .mockReturnValueOnce({ cancel: nextCancel });
  const firstCleanup = sharedTitleMotion({ name }, () => true);
  const nextCleanup = sharedTitleMotion({ name }, () => true);
  firstCleanup?.();
  expect(firstCancel).toHaveBeenCalledOnce();
  expect(nextCancel).not.toHaveBeenCalled();
  nextCleanup?.();
  expect(nextCancel).toHaveBeenCalledOnce();
});

it('supports a source implicit dimension endpoint without inventing another box', () => {
  frames[0] = { offset: 0, transform: 'matrix(1, 0, 0, 1, 10, 100)' };
  sharedTitleMotion({ name }, () => true);
  expect(animate.mock.calls[0][0][0]).toEqual({
    transform: 'translate(10px, 100px) scale(1, 1)',
  });
});

it.each([
  [
    'zero width',
    () => {
      destination.width = '0px';
    },
  ],
  [
    'non-finite height',
    () => {
      destination.height = 'NaNpx';
    },
  ],
  [
    'rotated source',
    () => {
      frames[0].transform = 'matrix(0, 1, -1, 0, 0, 0)';
    },
  ],
  [
    'unknown geometry',
    () => {
      frames = [];
    },
  ],
  [
    'unsupported pseudo WAAPI',
    () => {
      animate.mockImplementation(() => {
        throw new Error('Unsupported pseudo-element');
      });
    },
  ],
] as const)(
  'skips the entire native transition after unsupported %s, cancelling forbidden geometry',
  (_reason, change) => {
    change();
    sharedTitleMotion({ name }, () => true);
    expect(nativeCancel).toHaveBeenCalled();
    expect(skip).toHaveBeenCalled();
  },
);

it('stale callbacks and auth/reduction during setup cannot start a replacement', () => {
  sharedTitleMotion({ name }, () => false);
  expect(animate).not.toHaveBeenCalled();
  expect(skip).toHaveBeenCalled();
  let checks = 0;
  sharedTitleMotion({ name }, () => ++checks === 1);
  expect(animate).not.toHaveBeenCalled();
  expect(nativeCancel).toHaveBeenCalled();
});

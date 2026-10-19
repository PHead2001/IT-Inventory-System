import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { routeContentMotion } from './route-content-motion';
import { createRouteCaptureCompletion } from './route-capture-completion';

const name = 'route-body-owned';
const group = `::view-transition-group(${name})`;
const oldImage = `::view-transition-old(${name})`;
const newImage = `::view-transition-new(${name})`;
let frames: Array<Record<string, unknown>>;
let destination: { width: string; height: string; transform: string };
let animate: ReturnType<typeof vi.fn>;
let nativeCancel: ReturnType<typeof vi.fn>;
let skip: ReturnType<typeof vi.fn>;
let imageCancel: ReturnType<typeof vi.fn>;
let unrelatedCancel: ReturnType<typeof vi.fn>;
let replacements: Array<{ cancel: ReturnType<typeof vi.fn> }>;
let duration: string;

beforeEach(() => {
  duration = '200ms';
  frames = [
    {
      offset: 0,
      width: '1100px',
      height: '1429px',
      transform: 'matrix(1, 0, 0, 1, 20, -602)',
    },
    { offset: 1 },
  ];
  destination = {
    width: '1180px',
    height: '7622px',
    transform: 'matrix(1, 0, 0, 1, 40, -77)',
  };
  nativeCancel = vi.fn();
  imageCancel = vi.fn();
  unrelatedCancel = vi.fn();
  skip = vi.fn();
  replacements = [];
  animate = vi.fn(() => {
    const replacement = { cancel: vi.fn() };
    replacements.push(replacement);
    return replacement;
  });
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
      { effect: { pseudoElement: oldImage }, cancel: imageCancel },
      { effect: { pseudoElement: newImage }, cancel: imageCancel },
      {
        effect: { pseudoElement: '::view-transition-group(unrelated)' },
        cancel: unrelatedCancel,
      },
    ],
  });
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    value: animate,
  });
  vi.stubGlobal('getComputedStyle', (_element: Element, pseudo?: string) => {
    if (pseudo === group) {
      expect(nativeCancel).toHaveBeenCalled();
      return destination;
    }
    return {
      getPropertyValue: (property: string) =>
        property === '--motion-route'
          ? duration
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

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'activeViewTransition');
  Reflect.deleteProperty(document, 'getAnimations');
  Reflect.deleteProperty(document.documentElement, 'animate');
});

it('collects the real synchronous geometry replacements and waits for every replacement to finish', async () => {
  const completion = createRouteCaptureCompletion();
  const approval = {};
  const complete = vi.fn();
  const missing = vi.fn();
  const captured = vi.fn();
  const finishes: (() => void)[] = [];
  const installed: Animation[] = [];
  const nativeAnimations = document.getAnimations();
  animate.mockImplementation((_frames, options: KeyframeAnimationOptions) => {
    const animation = {
      effect: { pseudoElement: options.pseudoElement },
      cancel: vi.fn(),
      finished: new Promise<void>((resolve) => finishes.push(resolve)),
    } as unknown as Animation;
    installed.push(animation);
    return animation;
  });
  const observe = vi.fn(() =>
    installed.length ? installed : nativeAnimations,
  );
  Object.defineProperty(document, 'getAnimations', { value: observe });

  expect(
    completion.capture({
      approval,
      name,
      current: () => true,
      captured,
      complete,
      missing,
      body: () => true,
    }),
  ).toBe(true);
  expect(observe).not.toHaveBeenCalled();
  const cleanup = routeContentMotion({ name }, () => true);
  expect(installed).toHaveLength(3);
  expect(observe).toHaveBeenCalledOnce(); // Geometry reads the native first frame.
  await Promise.resolve();
  expect(observe).toHaveBeenCalledTimes(2); // Collector sees the replacements.
  expect(captured).toHaveBeenCalledOnce();
  expect(missing).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  for (const finish of finishes.slice(0, -1)) finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  finishes.at(-1)!();
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).toHaveBeenCalledOnce();
  cleanup?.();
  for (const animation of installed)
    expect(animation.cancel).toHaveBeenCalledOnce();
});

it('preserves the old scrolled bitmap at y=-602 while the new body begins at y=-77', () => {
  const cleanup = routeContentMotion({ name }, () => true);
  expect(animate).toHaveBeenCalledTimes(3);
  const constant = {
    width: '1180px',
    height: '7622px',
    transform: 'translate(40px, -77px)',
  };
  expect(animate.mock.calls[0]).toEqual([
    [constant, constant],
    expect.objectContaining({ pseudoElement: group }),
  ]);
  expect(animate.mock.calls[1][0]).toEqual([
    {
      width: '1100px',
      height: '1429px',
      transform: 'translate(-20px, -525px)',
      opacity: 1,
    },
    {
      width: '1100px',
      height: '1429px',
      transform: 'translate(-20px, -525px)',
      opacity: 0,
    },
  ]);
  expect(animate.mock.calls[2][0]).toEqual([
    {
      transform: 'translateY(8px)',
      opacity: 0,
    },
    {
      transform: 'translateY(0px)',
      opacity: 1,
    },
  ]);
  expect(imageCancel).toHaveBeenCalledTimes(2);
  expect(unrelatedCancel).not.toHaveBeenCalled();
  expect(skip).not.toHaveBeenCalled();
  cleanup?.();
  replacements.forEach(({ cancel }) => expect(cancel).toHaveBeenCalledOnce());
});

it('preserves the Back bitmap at y=151 when the restored destination begins at y=-602', () => {
  frames[0] = {
    computedOffset: 0,
    width: '1180px',
    height: '7622px',
    transform: 'matrix(1, 0, 0, 1, 40, 151)',
  };
  destination = {
    width: '1100px',
    height: '1429px',
    transform: 'matrix(1, 0, 0, 1, 20, -602)',
  };
  routeContentMotion({ name }, () => true);
  expect(animate.mock.calls[1][0]).toEqual([
    {
      width: '1180px',
      height: '7622px',
      transform: 'translate(20px, 753px)',
      opacity: 1,
    },
    {
      width: '1180px',
      height: '7622px',
      transform: 'translate(20px, 753px)',
      opacity: 0,
    },
  ]);
});

it.each(['200ms', '.2s', '2e-1s'])(
  'uses %s timing while the group/old box stay fixed and incoming sizing stays natural',
  (token) => {
    duration = token;
    routeContentMotion({ name }, () => true);
    for (const [keyframes, options] of animate.mock.calls) {
      expect(options).toMatchObject({ duration: 200, fill: 'both', delay: 0 });
      if (options.pseudoElement === newImage) {
        for (const frame of keyframes) {
          expect(Object.keys(frame).toSorted()).toEqual([
            'opacity',
            'transform',
          ]);
          expect(frame).not.toHaveProperty('width');
          expect(frame).not.toHaveProperty('height');
        }
      } else {
        expect(keyframes[0].width).toBe(keyframes[1].width);
        expect(keyframes[0].height).toBe(keyframes[1].height);
      }
      expect(
        keyframes.every(
          (frame: Keyframe) => !String(frame.transform).includes('scale'),
        ),
      ).toBe(true);
    }
  },
);

it('older cleanup cancels only its three effects after another body replacement starts', () => {
  const first = routeContentMotion({ name }, () => true);
  const second = routeContentMotion({ name }, () => true);
  first?.();
  replacements
    .slice(0, 3)
    .forEach(({ cancel }) => expect(cancel).toHaveBeenCalledOnce());
  replacements
    .slice(3)
    .forEach(({ cancel }) => expect(cancel).not.toHaveBeenCalled());
  second?.();
  replacements
    .slice(3)
    .forEach(({ cancel }) => expect(cancel).toHaveBeenCalledOnce());
});

it('ignores stale or reduced callbacks without cancelling another navigation', () => {
  routeContentMotion({ name }, () => false);
  expect(nativeCancel).not.toHaveBeenCalled();
  expect(animate).not.toHaveBeenCalled();
  expect(skip).not.toHaveBeenCalled();
});

it('falls back if privacy or Reduced motion invalidates authority during geometry setup', () => {
  let reads = 0;
  routeContentMotion({ name }, () => ++reads === 1);
  expect(animate).not.toHaveBeenCalled();
  expect(nativeCancel).toHaveBeenCalled();
  expect(skip).toHaveBeenCalledOnce();
});

it.each([
  [
    'missing old dimensions',
    () => {
      delete frames[0].height;
    },
  ],
  [
    'missing first frame',
    () => {
      frames = [];
    },
  ],
  [
    'zero destination',
    () => {
      destination.height = '0px';
    },
  ],
  [
    'scaled old capture',
    () => {
      frames[0].transform = 'matrix(2, 0, 0, 1, 20, -602)';
    },
  ],
  [
    'rotated destination',
    () => {
      destination.transform = 'matrix(0, 1, -1, 0, 20, 20)';
    },
  ],
  [
    'invalid duration',
    () => {
      duration = '251ms';
    },
  ],
] as const)(
  'retires and skips malformed %s without inventing a live DOM box',
  (_label, change) => {
    change();
    const unsupported = vi.fn();
    skip.mockImplementation(() => expect(unsupported).toHaveBeenCalledOnce());
    routeContentMotion({ name }, () => true, unsupported);
    expect(animate).not.toHaveBeenCalled();
    expect(unsupported).toHaveBeenCalledOnce();
    expect(skip).toHaveBeenCalledOnce();
  },
);

it('cancels partially created effects if pseudo-element animation is unsupported', () => {
  animate
    .mockImplementationOnce(() => {
      const replacement = { cancel: vi.fn() };
      replacements.push(replacement);
      return replacement;
    })
    .mockImplementationOnce(() => {
      throw new Error('Unsupported pseudo');
    });
  routeContentMotion({ name }, () => true);
  expect(replacements[0].cancel).toHaveBeenCalledOnce();
  expect(skip).toHaveBeenCalledOnce();
});

it('retains native capture geometry without clipping translated old bitmaps or pausing single-sided fades', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const groupRule = css.match(
    /::view-transition-group\(\.route-content\)\s*\{([^}]+)\}/,
  )?.[1];
  const pairRule = css.match(
    /::view-transition-image-pair\(\.route-content\)\s*\{([^}]+)\}/,
  )?.[1];
  expect(groupRule).toMatch(/animation-play-state:\s*paused\s*;/);
  expect(groupRule).not.toMatch(/animation:\s*none\s*;/);
  expect(groupRule).toMatch(/overflow:\s*visible\s*;/);
  expect(pairRule).toMatch(/overflow:\s*visible\s*;/);
  for (const image of ['old', 'new']) {
    const imageRule = [
      ...css.matchAll(
        new RegExp(
          `::view-transition-${image}\\(\\.route-content\\)\\s*\\{([^}]+)\\}`,
          'g',
        ),
      ),
    ].at(-1)?.[1];
    expect(imageRule).toMatch(/animation-play-state:\s*running\s*;/);
    if (image === 'new') {
      expect(imageRule).toMatch(/width:\s*auto\s*;/);
      expect(imageRule).toMatch(/height:\s*auto\s*;/);
      expect(imageRule).toMatch(/object-fit:\s*none\s*;/);
      expect(imageRule).toMatch(/object-position:\s*0 0\s*;/);
      expect(imageRule).toMatch(/overflow:\s*visible\s*;/);
    }
  }
});

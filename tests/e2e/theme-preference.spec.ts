import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { isPrivacyGenerationRead } from './privacy-read-request';

type AppearanceFrame = {
  time: number;
  theme: string | undefined;
  scheme: string;
  background: string;
  privateEligible: string | undefined;
};
type ThemeAnimation = {
  pseudo: string;
  duration: number;
  frames: Keyframe[];
  region: { left: number; top: number } | null;
  running: boolean;
  progressed: boolean;
  completed: boolean;
  rejected: boolean;
};
type ThemeProof = {
  frames: AppearanceFrame[];
  paints: { name: string; time: number }[];
  transitions: { ready: boolean; finished: boolean; rejected: boolean }[];
  animations: ThemeAnimation[];
  observing: boolean;
  instantFrames: {
    theme: string | undefined;
    snapshots: number;
    overlays: number;
  }[];
};
declare global {
  interface Window {
    themeAcceptanceProof?: ThemeProof;
  }
}

test.beforeEach(async ({ baseURL }) => {
  const origin = new URL(baseURL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
  expect(origin.port).toBe('3000');
});

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
const themeControls = (page: Page) =>
  page.getByRole('group', { name: 'Theme in this browser' });
async function choose(page: Page, preference: 'Dark' | 'Light' | 'System') {
  await themeControls(page)
    .getByRole('radio', { name: preference, exact: true })
    .check();
  await expect(
    themeControls(page).getByRole('radio', { name: preference, exact: true }),
  ).toBeChecked();
}

/** Passive browser observations, installed before parser/bootstrap work. Native
 * methods retain their real receiver, promises, animations and update callback. */
async function observeAppearance(page: Page, unsupported = false) {
  await page.addInitScript(
    ({ unsupported }) => {
      const proof: ThemeProof = {
        frames: [],
        paints: [],
        transitions: [],
        animations: [],
        observing: true,
        instantFrames: [],
      };
      window.themeAcceptanceProof = proof;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          proof.paints.push({ name: entry.name, time: entry.startTime });
      }).observe({ type: 'paint', buffered: true });
      const frame = (time: number) => {
        const root = document.documentElement;
        if (root) {
          const style = getComputedStyle(root);
          proof.frames.push({
            time,
            theme: root.dataset.theme,
            scheme: style.colorScheme,
            background: style.backgroundColor,
            privateEligible: root.dataset.routeMotionPrivate,
          });
        }
        if (proof.observing && proof.frames.length < 180)
          requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      if (unsupported) {
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          value: undefined,
        });
        return;
      }
      if (typeof document.startViewTransition !== 'function') return;
      const native = document.startViewTransition.bind(document);
      document.startViewTransition = ((
        ...args: Parameters<Document['startViewTransition']>
      ) => {
        const entry = { ready: false, finished: false, rejected: false };
        proof.transitions.push(entry);
        const transition = native(...args);
        void transition.ready.then(
          () => {
            entry.ready = true;
          },
          () => {
            entry.rejected = true;
          },
        );
        void transition.finished.then(
          () => {
            entry.finished = true;
          },
          () => {
            entry.finished = true;
            entry.rejected = true;
          },
        );
        return transition;
      }) as Document['startViewTransition'];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = animate.call(this, frames, options);
        if (
          typeof options === 'object' &&
          options.pseudoElement?.startsWith('::view-transition-new(theme-')
        ) {
          const name = options.pseudoElement.slice(
            '::view-transition-new('.length,
            -1,
          );
          const element = Array.from(
            document.querySelectorAll<HTMLElement>('[data-theme-region]'),
          ).find(
            (node) =>
              node.style.getPropertyValue('--theme-region-name') === name,
          );
          const bounds = element?.getBoundingClientRect();
          const entry: ThemeAnimation = {
            pseudo:
              (animation.effect as KeyframeEffect | null)?.pseudoElement ?? '',
            duration: Number(
              (animation.effect as KeyframeEffect | null)?.getTiming().duration,
            ),
            frames:
              (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [],
            region: bounds ? { left: bounds.left, top: bounds.top } : null,
            running: false,
            progressed: false,
            completed: false,
            rejected: false,
          };
          proof.animations.push(entry);
          // A skipped native transition may fulfill its own finished promise
          // while cancelling these effects. Observe each browser animation's
          // real result separately; readiness/progress is insufficient.
          void animation.finished.then(
            () => {
              entry.completed = true;
            },
            () => {
              entry.rejected = true;
            },
          );
          void animation.ready.then(
            () => {
              entry.running = animation.playState === 'running';
              requestAnimationFrame(() => {
                const previous = Number(animation.currentTime);
                requestAnimationFrame(() => {
                  entry.progressed =
                    animation.playState === 'running' &&
                    Number(animation.currentTime) > previous;
                });
              });
            },
            () => {},
          );
        }
        return animation;
      };
    },
    { unsupported },
  );
}
async function proof(page: Page) {
  return page.evaluate(() => window.themeAcceptanceProof!);
}
async function clearTransitions(page: Page) {
  await page.evaluate(() => {
    window.themeAcceptanceProof!.transitions = [];
    window.themeAcceptanceProof!.animations = [];
  });
}
async function noOverlay(page: Page) {
  await expect(page.locator('[data-theme-region]')).toHaveCount(0);
  await expect(page.locator('.experience-theme-background')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme-transition',
  );
}

test('first visit stays Dark even when the device prefers Light', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await signIn(page);
  await page.goto('/settings');
  await expect(
    themeControls(page).getByRole('radio', { name: 'Dark', exact: true }),
  ).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const preference of ['Light', 'System'] as const) {
  test(`saved ${preference} paints Light through initial deferred privacy verification on reload`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await signIn(page);
    await page.goto('/settings');
    await choose(page, preference);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const expectedBackground = await page
      .locator('html')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    await observeAppearance(page);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    // Hold the real admitted generation-read transport used by the current
    // privacy controller; preserve its actual server response after release.
    const hold = async (route: import('@playwright/test').Route) => {
      if (!held && isPrivacyGenerationRead(route.request())) {
        held = true;
        await barrier;
      }
      await route.continue();
    };
    await page.route('**/api/auth/privacy-read', hold);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => held).toBe(true);
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true }),
      ).not.toBeVisible();
      await expect(page.locator('[data-route-ready]')).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute(
        'data-route-motion-private',
        'false',
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect
        .poll(async () => (await proof(page)).frames.length)
        .toBeGreaterThanOrEqual(6);
      await expect
        .poll(async () =>
          (await proof(page)).paints.some(
            (entry) => entry.name === 'first-paint',
          ),
        )
        .toBe(true);
      const waiting = await proof(page);
      const painted = waiting.paints.find(
        (entry) => entry.name === 'first-paint',
      )!;
      const atFirstPaint = waiting.frames
        .filter((entry) => entry.time <= painted.time)
        .at(-1);
      expect(
        atFirstPaint,
        'a frame observation must precede actual first paint',
      ).toBeDefined();
      expect(atFirstPaint!.theme).toBe('light');
      expect(atFirstPaint!.scheme).toBe('light');
      expect(atFirstPaint!.background).toBe(expectedBackground);
      expect(
        waiting.frames.every(
          (entry) =>
            entry.theme === 'light' &&
            entry.scheme === 'light' &&
            entry.background === expectedBackground,
        ),
      ).toBe(true);
      expect(waiting.transitions).toHaveLength(0);
      expect(
        waiting.frames
          .filter((entry) => entry.privateEligible !== undefined)
          .every((entry) => entry.privateEligible === 'false'),
      ).toBe(true);
      await info.attach(`initial-${preference.toLowerCase()}-paint.json`, {
        body: JSON.stringify(waiting),
        contentType: 'application/json',
      });
      release();
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true }),
      ).toBeVisible();
      await expect(
        themeControls(page).getByRole('radio', {
          name: preference,
          exact: true,
        }),
      ).toBeChecked();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.evaluate(() => {
        window.themeAcceptanceProof!.observing = false;
      });
    } finally {
      release();
      await page.unroute('**/api/auth/privacy-read', hold);
    }
  });
}

test('Full theme circle runs on native pseudo-elements from the current control and cleans up; System uses a real crossfade', async ({
  page,
}, info) => {
  await observeAppearance(page);
  await page.emulateMedia({
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  await signIn(page);
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  expect(
    await page.evaluate(
      () => typeof document.startViewTransition === 'function',
    ),
    'native theme acceptance requires a supporting browser',
  ).toBe(true);
  await clearTransitions(page);
  const control = page.getByRole('button', { name: 'Switch to Light theme' });
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const radius = Math.max(
    ...[0, viewport.width].flatMap((x) =>
      [0, viewport.height].map((y) => Math.hypot(x - center.x, y - center.y)),
    ),
  );
  await control.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect
    .poll(async () =>
      (await proof(page)).animations.some(
        (entry) => entry.running && entry.progressed,
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await proof(page)).transitions.every((entry) => entry.finished),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const animations = (await proof(page)).animations;
      return (
        animations.length > 0 &&
        animations.every((entry) => entry.completed || entry.rejected)
      );
    })
    .toBe(true);
  const circle = await proof(page);
  expect(circle.transitions).toHaveLength(1);
  expect(circle.transitions[0]).toEqual({
    ready: true,
    finished: true,
    rejected: false,
  });
  expect(circle.animations.length).toBeGreaterThan(0);
  for (const animation of circle.animations) {
    expect(animation.pseudo).toMatch(/^::view-transition-new\(theme-/);
    expect(animation.running).toBe(true);
    expect(animation.progressed).toBe(true);
    expect(animation.completed).toBe(true);
    expect(animation.rejected).toBe(false);
    expect(animation.duration).toBeGreaterThanOrEqual(450);
    expect(animation.duration).toBeLessThanOrEqual(600);
    const origin = animation.region ?? { left: 0, top: 0 };
    const start = /^circle\(0px at ([\d.-]+)px ([\d.-]+)px\)$/.exec(
      String(animation.frames[0].clipPath),
    );
    const end = /^circle\(([\d.-]+)px at/.exec(
      String(animation.frames.at(-1)!.clipPath),
    );
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(Number(start![1]) + origin.left).toBeCloseTo(center.x, 1);
    expect(Number(start![2]) + origin.top).toBeCloseTo(center.y, 1);
    expect(Number(end![1])).toBeCloseTo(radius, 1);
  }
  await noOverlay(page);
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Switch to Dark theme' }),
  ).toBeFocused();
  await choose(page, 'System');
  await clearTransitions(page);
  await page.emulateMedia({
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(async () =>
      (await proof(page)).animations.some(
        (entry) => entry.running && entry.progressed,
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await proof(page)).transitions.every((entry) => entry.finished),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const animations = (await proof(page)).animations;
      return (
        animations.length > 0 &&
        animations.every((entry) => entry.completed || entry.rejected)
      );
    })
    .toBe(true);
  const system = await proof(page);
  expect(system.transitions).toHaveLength(1);
  expect(system.transitions[0]).toEqual({
    ready: true,
    finished: true,
    rejected: false,
  });
  expect(system.animations.length).toBeGreaterThan(0);
  expect(
    system.animations.every(
      (entry) =>
        /^::view-transition-new\(theme-/.test(entry.pseudo) &&
        entry.running &&
        entry.progressed &&
        entry.completed &&
        !entry.rejected &&
        entry.duration > 0 &&
        entry.duration <= 250 &&
        Number(entry.frames[0].opacity) === 0 &&
        Number(entry.frames.at(-1)!.opacity) === 1,
    ),
  ).toBe(true);
  await noOverlay(page);
  await info.attach('native-theme-circle-and-system.json', {
    body: JSON.stringify({ circle, system }),
    contentType: 'application/json',
  });
});

for (const mode of ['reduced', 'unsupported'] as const) {
  test(`${mode} theme changes apply without native snapshots or leftover overlays`, async ({
    page,
  }) => {
    await observeAppearance(page, mode === 'unsupported');
    await page.emulateMedia({
      reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
    });
    await signIn(page);
    await page.goto('/settings');
    await clearTransitions(page);
    for (const preference of ['Light', 'Dark'] as const) {
      const radio = themeControls(page).getByRole('radio', {
        name: preference,
        exact: true,
      });
      // Observe the first render frame after the real user click; no clock or
      // animation is driven by this listener.
      await radio.evaluate((node) => {
        node.addEventListener(
          'click',
          () => {
            requestAnimationFrame(() => {
              const proof = window.themeAcceptanceProof!;
              proof.instantFrames.push({
                theme: document.documentElement.dataset.theme,
                snapshots: proof.transitions.length,
                overlays: document.querySelectorAll(
                  '[data-theme-region], .experience-theme-background',
                ).length,
              });
            });
          },
          { once: true },
        );
      });
      await choose(page, preference);
      await expect
        .poll(async () => (await proof(page)).instantFrames.length)
        .toBe(preference === 'Light' ? 1 : 2);
      expect((await proof(page)).instantFrames.at(-1)).toEqual({
        theme: preference.toLowerCase(),
        snapshots: 0,
        overlays: 0,
      });
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        preference.toLowerCase(),
      );
    }
    expect((await proof(page)).transitions).toHaveLength(0);
    expect((await proof(page)).animations).toHaveLength(0);
    await noOverlay(page);
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true }),
    ).toBeVisible();
  });
}

function palettePixels(image: Buffer, expected: number[]) {
  const png = PNG.sync.read(image);
  let matching = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    if (
      expected.every(
        (value, channel) => Math.abs(png.data[offset + channel] - value) <= 3,
      )
    )
      matching++;
  }
  return {
    width: png.width,
    height: png.height,
    matching,
    fraction: matching / (png.width * png.height),
  };
}
test('real WebGL changes rendered palette pixels while retaining selected location, user camera and canvas', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = page.getByTestId('room-viewer');
  const canvas = viewer.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const renderer = await canvas.evaluate((node) => {
    const gl = (node as HTMLCanvasElement).getContext('webgl2');
    if (!gl || gl.isContextLost()) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      renderer: String(
        gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      ),
    };
  });
  expect(
    renderer,
    'this journey requires a functioning real WebGL2 context',
  ).not.toBeNull();
  expect(renderer!.width).toBeGreaterThan(0);
  expect(renderer!.height).toBeGreaterThan(0);
  await expect(viewer).toHaveAttribute('data-camera-view', /"zoom":/);
  const initial = JSON.parse(
    (await viewer.getAttribute('data-camera-view'))!,
  ) as { zoom: number };
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          JSON.parse((await viewer.getAttribute('data-camera-view'))!) as {
            zoom: number;
          }
        ).zoom,
    )
    .toBeGreaterThan(initial.zoom);
  const camera = await viewer.getAttribute('data-camera-view');
  const matrices = await canvas.evaluate((node) => ({
    view: (node as HTMLCanvasElement).dataset.cameraViewMatrix,
    projection: (node as HTMLCanvasElement).dataset.cameraProjectionMatrix,
  }));
  expect(matrices.view).toBeTruthy();
  expect(matrices.projection).toBeTruthy();
  const original = await canvas.elementHandle();
  const expectContinuity = async () => {
    expect(
      await original!.evaluate(
        (node) => node === document.querySelector('canvas'),
      ),
    ).toBe(true);
    await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
    await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
    await expect(viewer).toHaveAttribute('data-camera-view', camera!);
    expect(
      await canvas.evaluate((node) => ({
        view: (node as HTMLCanvasElement).dataset.cameraViewMatrix,
        projection: (node as HTMLCanvasElement).dataset.cameraProjectionMatrix,
      })),
    ).toEqual(matrices);
  };
  const readPalette = () =>
    canvas.evaluate((node) => {
      const token = getComputedStyle(node)
        .getPropertyValue('--room-canvas-background')
        .trim();
      const match = /^#([\da-f]{6})$/i.exec(token);
      if (!match)
        throw new Error(
          'Expected the declared Three-compatible room background token',
        );
      return [0, 2, 4].map((index) =>
        Number.parseInt(match[1].slice(index, index + 2), 16),
      );
    });
  const dark = await readPalette();
  const darkPng = await canvas.screenshot();
  expect(palettePixels(darkPng, dark).fraction).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: 'Switch to Light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await readPalette();
  expect(light).not.toEqual(dark);
  await expect
    .poll(async () => palettePixels(await canvas.screenshot(), light).fraction)
    .toBeGreaterThan(0.005);
  const lightPng = await canvas.screenshot();
  expect(palettePixels(lightPng, dark).fraction).toBeLessThan(
    palettePixels(darkPng, dark).fraction,
  );
  await expectContinuity();
  await page.getByRole('button', { name: 'Switch to Dark theme' }).click();
  await expect
    .poll(async () => palettePixels(await canvas.screenshot(), dark).fraction)
    .toBeGreaterThan(0.005);
  await expectContinuity();
  await noOverlay(page);
  await info.attach('room-dark.png', {
    body: darkPng,
    contentType: 'image/png',
  });
  await info.attach('room-light.png', {
    body: lightPng,
    contentType: 'image/png',
  });
  await info.attach('room-renderer-and-camera.json', {
    body: JSON.stringify({
      renderer,
      camera,
      matrices,
      dark: palettePixels(darkPng, dark),
      light: palettePixels(lightPng, light),
    }),
    contentType: 'application/json',
  });
});

test('a required owned location-label preview stays white paper and black ink in both screen themes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  // Only this disposable context's queue changes; ITC is an immutable read-only
  // reference. No inventory/category fixture or persisted database write is needed.
  await page.goto('/labels?location=ITC');
  const queue = page.getByRole('region', { name: 'Label queue' });
  await expect(queue).toContainText('1 distinct record');
  const preview = page.locator('.label-print-root');
  const paper = preview.locator('.label-page');
  const card = paper.locator('.label-card[data-code-ready="true"]');
  try {
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Print preview refreshed from current inventory' }),
    ).toBeVisible();
    await expect(preview).toHaveCount(1);
    await expect(paper).toHaveCount(1);
    await expect(card).toHaveCount(1);
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page
          .getByRole('button', {
            name:
              theme === 'light'
                ? 'Switch to Light theme'
                : 'Switch to Dark theme',
          })
          .click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // The screen wrapper is transparent; these are the actual paper surfaces.
      await expect(paper).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(card).toHaveCSS('color', 'rgb(0, 0, 0)');
      await expect(card.locator('strong[data-fit-text]')).toHaveCSS(
        'color',
        'rgb(0, 0, 0)',
      );
      await expect(card.locator('.experience-code')).toHaveText('ITC');
      await expect(card.locator('.experience-code')).toHaveCSS(
        'color',
        'rgb(0, 0, 0)',
      );
      await expect(card).toHaveCount(1);
    }
  } finally {
    await queue
      .getByRole('button', { name: 'Clear queue', exact: true })
      .click();
    await expect(queue).toContainText('0 distinct records');
  }
});

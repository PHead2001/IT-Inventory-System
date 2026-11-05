import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Box3, Matrix4, Ray, Vector3 } from 'three';
import { measureRoomLabelName } from './room-label-name';
import { enableRoomLayoutDiagnostics } from './room-layout-diagnostics';
import {
  captureRoomAssertionState,
  observeRoomFitDispatch,
  reportRoomAssertionFailure,
} from './room-assertion-diagnostics';
import {
  observeRoomScene,
  captureRoomWitness,
  captureRoomReveal,
  captureRoomEffects,
  captureRoomSelectionWitness,
  roomWitnessCodeAtPoint,
  roomVisibilityWitnesses,
  uncoveredRoomWitnesses,
} from './room-visibility-witness';
import {
  registerRoomTestSupport,
  activateMap,
  uncoveredCanvasGesture,
  type CameraReading,
} from './room-test-support';

const {
  inventoryName,
  locationNames,
  bindingBounds,
  login,
  chooseMapMode,
  setRoomLabels,
  selected,
  settledLabels,
  ready,
  markRoomProgress,
  trackRoomPage,
  keyboardRoomLocation,
  settledReveal,
  camera,
  near,
} = registerRoomTestSupport();

async function recenterMap(page: Page) {
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
  if (!wasOpen) await more.click();
  await page.getByRole('button', { name: 'Recenter', exact: true }).click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toBeFocused();
}

// Passive, bounded evidence for native pointer delivery and focus ownership.
async function withRoomDragWitness(
  page: Page,
  run: (snapshot: (x: number, y: number) => Promise<void>) => Promise<void>,
) {
  const witness = await page.evaluateHandle(() => {
    const canvas = document.querySelector('canvas');
    const surface = canvas?.closest('[data-room-surface]');
    const category = (target: EventTarget | null) => {
      if (!target) return 'none';
      if (target === canvas) return 'canvas';
      if (!(target instanceof Element)) return 'outside';
      if (target.closest('[role="toolbar"], [aria-label="More map controls"]'))
        return 'toolbar';
      return surface?.contains(target) ? 'room-overlay' : 'outside';
    };
    const state = () => {
      const rect = canvas?.getBoundingClientRect();
      return {
        active: canvas?.getAttribute('data-map-active') === 'true',
        focused: document.activeElement === canvas,
        focusOwner: category(document.activeElement),
        bounds: rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null,
      };
    };
    const events: object[] = [];
    let omitted = 0;
    let start: object | null = null;
    const observe = (event: Event) => {
      if (events.length === 16) {
        omitted++;
        return;
      }
      events.push({
        type: event.type,
        trusted: event.isTrusted,
        target: category(event.target),
        point:
          event instanceof PointerEvent
            ? { x: event.clientX, y: event.clientY }
            : null,
        ...state(),
      });
    };
    const types = ['pointerdown', 'focusin', 'focusout'];
    for (const type of types)
      document.addEventListener(type, observe, {
        capture: true,
        passive: true,
      });
    return {
      snapshot(x: number, y: number) {
        start = {
          x,
          y,
          hit: category(document.elementFromPoint(x, y)),
          ...state(),
        };
      },
      read() {
        return { start, events, omitted, final: state() };
      },
      cleanup() {
        for (const type of types)
          document.removeEventListener(type, observe, true);
      },
    };
  });
  let failed = false;
  try {
    await run(async (x, y) => {
      await witness.evaluate(
        (value, point) => value.snapshot(point.x, point.y),
        {
          x,
          y,
        },
      );
    });
  } catch (error) {
    failed = true;
    try {
      const evidence = await witness.evaluate((value) => value.read());
      console.error('room-native-drag-focus ' + JSON.stringify(evidence));
      await test.info().attach('room-native-drag-focus', {
        body: JSON.stringify(evidence),
        contentType: 'application/json',
      });
    } catch {
      // Preserve the original failure if the page or attachment is unavailable.
    }
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      await witness.evaluate((value) => value.cleanup());
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await witness.dispose();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (!failed && cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        'Room drag witness cleanup failed',
      );
  }
}

async function chooseRoomLocation(page: Page, code: string) {
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  await browser.getByRole('searchbox', { name: 'Browse locations' }).fill(code);
  await browser.getByRole('button', { name: new RegExp(`${code}$`) }).click();
}

/** Read the body for the actual committed generation, reacquiring only a changed render. */

test('scene effects retain actual surface ownership and stop drawing after settled selection and palette changes', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  trackRoomPage(testInfo, page);
  markRoomProgress(testInfo, { journey: 'effects', stage: 'room setup' });
  await observeRoomScene(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  await page.goto('/room?space=it-closet');
  await ready(page);
  const canvas = page.locator('[data-room-surface] canvas');
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'initial contact cache and effect snapshot',
  });
  await expect(canvas).toHaveAttribute('data-contact-status', 'cached');
  const initial = await captureRoomEffects(page);
  expect(initial.bloomStatus).toBe('unselected');
  await canvas.evaluate((element) => {
    element.dataset.effectsIdentityWitness = 'original';
  });
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'select and settle ITC-RED',
    code: 'ITC-RED',
  });
  await keyboardRoomLocation(page, 'ITC-RED');
  await settledReveal(page, 'ITC-RED');
  await expect(canvas).toHaveAttribute('data-bloom-status', 'active');
  await expect(canvas).toHaveAttribute('data-contact-status', 'cached');
  const opened = await captureRoomEffects(page);
  expect(opened.bloomCodes).toEqual(['ITC-RED']);
  expect(opened.bloomMeshes).toBeGreaterThan(1);
  expect(opened.contactCaptures).toBe(initial.contactCaptures + 1);
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'witness and hover ITC-RED surface',
    code: 'ITC-RED',
  });
  const targets = await uncoveredRoomWitnesses(
    page,
    roomVisibilityWitnesses(await captureRoomWitness(page)),
  );
  const point = targets.get('ITC-RED');
  expect(point, 'Independent exposed container surface').toBeDefined();
  await page.mouse.move(point!.x, point!.y);
  await expect(canvas).toHaveAttribute('data-visual-hover-code', 'ITC-RED');
  await expect
    .poll(async () =>
      Object.values((await captureRoomEffects(page)).hoverOffsets).some(
        (offset) => Math.abs(offset[1] - 0.1) < 0.0001,
      ),
    )
    .toBe(true);
  const visibleOwner = roomWitnessCodeAtPoint(
    await captureRoomWitness(page),
    point!,
  );
  await expect(canvas).toHaveAttribute(
    'data-hover-visible-code',
    visibleOwner ?? '',
  );
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'clear hover and settle camera/count changes',
    code: 'ITC-RED',
  });
  await page.mouse.move(0, 0);
  await expect
    .poll(async () =>
      Object.values((await captureRoomEffects(page)).hoverOffsets).every(
        (offset) => offset[1] === 0,
      ),
    )
    .toBe(true);
  await expect(canvas).toHaveAttribute('data-contact-status', 'cached');
  const beforeCamera = await captureRoomEffects(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await settledLabels(page);
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'open item-count controls',
    code: 'ITC-RED',
  });
  await more.click();
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'toggle item counts',
    code: 'ITC-RED',
  });
  await page
    .getByRole('button', { name: 'Show item counts', exact: true })
    .click();
  await more.click();
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'settle item-count labels',
    code: 'ITC-RED',
  });
  await settledLabels(page);
  expect((await captureRoomEffects(page)).contactCaptures).toBe(
    beforeCamera.contactCaptures,
  );
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'change palette and wait for revision',
    code: 'ITC-RED',
  });
  const originalStyle = await page.locator('html').getAttribute('style');
  // This exercises live token lifecycle, not acceptance of the forthcoming Light theme tuning.
  await page.locator('html').evaluate((root) => {
    root.style.setProperty('--room-canvas-background', '#f4f6f8');
    root.style.setProperty('--room-grid', '#8793a4');
  });
  await expect
    .poll(async () => (await captureRoomEffects(page)).paletteRevision)
    .toBeGreaterThan(beforeCamera.paletteRevision);
  await expect(canvas).toHaveAttribute('data-contact-status', 'cached');
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'reduced-motion selection ITC-D07',
    code: 'ITC-D07',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await keyboardRoomLocation(page, 'ITC-D07');
  await settledReveal(page, 'ITC-D07');
  await expect(canvas).toHaveAttribute('data-bloom-status', 'active');
  expect((await captureRoomEffects(page)).bloomCodes).toEqual(['ITC-D07']);
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'aggregate selection and effect capture',
    code: 'ITC-L',
  });
  await keyboardRoomLocation(page, 'ITC-L');
  await settledReveal(page, 'ITC-L');
  await expect(canvas).toHaveAttribute('data-bloom-status', 'active');
  const aggregate = await captureRoomEffects(page);
  expect(aggregate.bloomCodes.length).toBeGreaterThan(1);
  expect(
    aggregate.bloomCodes.every((code) =>
      /^ITC-(S[12][ABC]|D0[1-6])$/.test(code),
    ),
  ).toBe(true);
  markRoomProgress(testInfo, {
    journey: 'effects',
    stage: 'restore palette and verify settled idle window',
    code: 'ITC-L',
  });
  await page.locator('html').evaluate((root, style) => {
    if (style === null) root.removeAttribute('style');
    else root.setAttribute('style', style);
  }, originalStyle);
  await expect(canvas).toHaveAttribute('data-contact-status', 'cached');
  await expect(canvas).toHaveAttribute(
    'data-effects-identity-witness',
    'original',
  );
  await page.waitForTimeout(750);
  const idleStart = await captureRoomEffects(page);
  await page.waitForTimeout(500);
  const idleEnd = await captureRoomEffects(page);
  expect([
    idleEnd.sceneFrames,
    idleEnd.composerFrames,
    idleEnd.drawFrame,
    idleEnd.contactCaptures,
  ]).toEqual([
    idleStart.sceneFrames,
    idleStart.composerFrames,
    idleStart.drawFrame,
    idleStart.contactCaptures,
  ]);
  await testInfo.attach('scene-effects-behavior', {
    body: JSON.stringify({ initial, opened, aggregate, idleStart, idleEnd }),
    contentType: 'application/json',
  });
});

test('scene effects resources plateau across repeated settled selection and palette cycles', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await observeRoomScene(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto('/room?space=it-closet');
  await ready(page);
  const canvas = page.locator('[data-room-surface] canvas');
  const originalStyle = await page.locator('html').getAttribute('style');
  const samples: Awaited<ReturnType<typeof captureRoomEffects>>[] = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    for (const code of ['ITC-RED', 'ITC-D07']) {
      await keyboardRoomLocation(page, code);
      await settledReveal(page, code);
      await expect(canvas).toHaveAttribute('data-bloom-status', 'active');
    }
    const previous = (await captureRoomEffects(page)).paletteRevision;
    await page
      .locator('html')
      .evaluate(
        (root, light) =>
          root.style.setProperty(
            '--room-canvas-background',
            light ? '#f4f6f8' : '#101827',
          ),
        cycle % 2 === 0,
      );
    await expect
      .poll(async () => (await captureRoomEffects(page)).paletteRevision)
      .toBeGreaterThan(previous);
    await expect(canvas).toHaveAttribute('data-contact-status', 'cached');
    samples.push(await captureRoomEffects(page));
  }
  const warm = samples[3].memory,
    final = samples.at(-1)!.memory;
  expect(final.geometries).toBeLessThanOrEqual(warm.geometries);
  expect(final.textures).toBeLessThanOrEqual(warm.textures);
  expect(final.programs).toBeLessThanOrEqual(warm.programs + 1);
  await page.locator('html').evaluate((root, style) => {
    if (style === null) root.removeAttribute('style');
    else root.setAttribute('style', style);
  }, originalStyle);
  await testInfo.attach('scene-effects-resource-cycles', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
});

test('opened drawer, container and shelf retain their resting selection footprint through actual pointer clicks', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await observeRoomScene(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto('/room?space=it-closet');
  const viewer = await ready(page),
    canvas = viewer.locator('canvas');
  for (const [code, geometry] of [
    ['ITC-D01', 'drawer-1'],
    ['ITC-RED', 'red-container'],
    ['ITC-S1A', 'shelf-1a'],
  ] as const) {
    await keyboardRoomLocation(page, code);
    await settledReveal(page, code);
    await page.mouse.move(0, 0);
    const selection = await captureRoomSelectionWitness(page);
    const physical = await captureRoomWitness(page);
    const candidates = roomVisibilityWitnesses(selection).get(code) ?? [];
    let point: (typeof candidates)[number] | undefined;
    // A moved-body point cannot prove that the stationary proxy works.
    for (const candidate of candidates) {
      if (roomWitnessCodeAtPoint(selection, candidate) !== code) continue;
      if (roomWitnessCodeAtPoint(physical, candidate) === code) continue;
      if (
        await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
          candidate,
        )
      ) {
        point = candidate;
        break;
      }
    }
    expect(
      point,
      `${geometry} (${code}) has no exposed resting proxy point outside the moved visible body`,
    ).toBeDefined();
    expect(
      roomWitnessCodeAtPoint(selection, point!),
      `${geometry}: selection witness owns the resting point`,
    ).toBe(code);
    expect(
      roomWitnessCodeAtPoint(physical, point!),
      `${geometry}: moved visible body cannot authorize this point`,
    ).not.toBe(code);
    const before = await canvas.getAttribute('data-spatial-request');
    await page.mouse.click(point!.x, point!.y);
    await expect(canvas).not.toHaveAttribute('data-spatial-request', before!);
    await expect(viewer).toHaveAttribute('data-selected-code', code);
    await settledReveal(page, code);
    await testInfo.attach('resting-selection-' + code, {
      body: await viewer.screenshot(),
      contentType: 'image/png',
    });
  }
});

test('spatial interruption, reduced motion, stationary hover and moving down/up cannot revive a stale target', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  trackRoomPage(testInfo, page);
  markRoomProgress(testInfo, {
    journey: 'spatial-interruption',
    stage: 'room setup',
  });
  await page.clock.install();
  await observeRoomScene(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  await page.goto('/room?space=it-closet');
  const viewer = await ready(page),
    canvas = viewer.locator('canvas');
  const fit = page.getByRole('button', { name: 'Fit room', exact: true });
  await observeRoomFitDispatch(fit);
  const selectWhilePaused = async (code: string) => {
    const previous = await canvas.getAttribute('data-spatial-request');
    await keyboardRoomLocation(page, code);
    await expect(canvas).not.toHaveAttribute(
      'data-spatial-request',
      previous ?? '',
    );
    await expect
      .poll(async () => {
        const raw = await canvas.getAttribute('data-spatial-request');
        return raw ? (JSON.parse(raw) as { code: string }).code : null;
      })
      .toBe(code);
  };
  // Input delivery can exceed the whole 750 ms flight under CI load. Keep
  // trusted toolbar input, but prove that Fit is accepted during the flight.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  await selectWhilePaused('ITC-D01');
  await expect
    .poll(async () => {
      const request = await canvas.getAttribute('data-spatial-request');
      return request ? (JSON.parse(request) as { code: string }).code : null;
    })
    .toBe('ITC-D01');
  await page.clock.runFor(100);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'flying');
  markRoomProgress(testInfo, {
    journey: 'spatial-interruption',
    stage: 'Fit room interrupts flight',
    code: 'ITC-D01',
  });
  await fit.click();
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'cancelled');
  const held = await camera(page);
  const afterClick = await captureRoomAssertionState(page, 'ITC-D01', false);
  // Deliberate negative deadline window: old 750ms flight plus 400ms opening.
  await page.clock.runFor(1300);
  const afterHold = await captureRoomAssertionState(page, 'ITC-D01', false);
  try {
    near((await camera(page)).position, held.position);
    await expect(canvas).toHaveAttribute('data-spatial-open-code', '');
  } catch (error) {
    reportRoomAssertionFailure('fit-interruption', 'ITC-D01', {
      afterClick,
      afterHold,
      failure: await captureRoomAssertionState(page, 'ITC-D01', false),
    });
    throw error;
  }
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'cancelled');
  markRoomProgress(testInfo, {
    journey: 'spatial-interruption',
    stage: 'reduced motion and stale pointer target',
    code: 'ITC-D07',
  });
  await selectWhilePaused('ITC-D07');
  await page.clock.runFor(16);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'flying');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(32);
  await page.clock.resume();
  await settledReveal(page, 'ITC-D07');
  near((await captureRoomReveal(page)).offsets['drawer-7'], [-5.6, 0, 0]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Trusted input and visibility inspection may outlast the 400 ms phase under
  // load. Hold time before selection, then advance the actual RAF-driven flight.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  await selectWhilePaused('ITC-RED');
  await page.clock.runFor(800);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'revealing');
  const snapshot = await captureRoomWitness(page);
  const point = (
    await uncoveredRoomWitnesses(page, roomVisibilityWitnesses(snapshot))
  ).get('ITC-RED');
  expect(
    point,
    'selected moving container has an actual exposed pointer face',
  ).toBeTruthy();
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  await page.clock.runFor(450);
  await page.clock.resume();
  await settledReveal(page, 'ITC-RED');
  const endpoint = await captureRoomWitness(page);
  if (
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
      point!,
    )
  )
    await expect(canvas).toHaveAttribute(
      'data-hover-visible-code',
      roomWitnessCodeAtPoint(endpoint, point!) ?? '',
    );
  await page.mouse.up();
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-RED');
  await settledReveal(page, 'ITC-RED');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  await selectWhilePaused('ITC-BLACK');
  await page.clock.runFor(800);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'revealing');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.clock.runFor(32);
  await page.clock.resume();
  await settledReveal(page, 'ITC-BLACK');
  near((await captureRoomReveal(page)).offsets['black-container'], [-4, 0, 0]);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  await selectWhilePaused('ITC-D01');
  await page.clock.runFor(16);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'flying');
  await selectWhilePaused('ITC-D07');
  await selectWhilePaused('ITC-D01');
  await page.clock.runFor(1200);
  await page.clock.resume();
  await settledReveal(page, 'ITC-D01');
  await expect(canvas).toHaveAttribute('data-spatial-open-code', 'ITC-D01');
  near((await captureRoomReveal(page)).offsets['drawer-7'], [0, 0, 0]);
  // Observe real draw count only after all bounded reveal/label work settles.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(700);
  const idle = await captureRoomReveal(page);
  await page.waitForTimeout(400);
  expect((await captureRoomReveal(page)).drawFrame).toBe(idle.drawFrame);
});

test('room label placement transforms are measurable synchronously in Full and Reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/room?location=ITC-S1A');
    const viewer = await ready(page);
    await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
    await settledLabels(page);
    const movement = await viewer.evaluate((host) => {
      const label = host.querySelector<HTMLElement>(
        '[data-room-label-code][data-label-suppressed="false"]',
      );
      const projection = label?.closest<HTMLElement>(
        '[class*="labelProjection"]',
      );
      if (!label || !projection)
        throw new Error('Expected an exposed projected label');
      return [label, projection].map((element) => {
        const original = element.style.transform;
        const before = label.getBoundingClientRect();
        try {
          element.style.transform = `${original} translate(11px, 7px)`;
          const after = label.getBoundingClientRect();
          return { dx: after.x - before.x, dy: after.y - before.y };
        } finally {
          element.style.transform = original;
        }
      });
    });
    for (const delta of movement) {
      expect(delta.dx).toBeCloseTo(11, 2);
      expect(delta.dy).toBeCloseTo(7, 2);
    }
  }
});

test('map wheel ownership preserves page/browser zoom and enables deliberate camera zoom', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  // Graphics readiness precedes the initial 750ms selection focus. Observe its
  // completion before attributing any camera movement to browser input.
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const canvas = viewer.locator('canvas');
  await page.evaluate(() =>
    document.addEventListener(
      'wheel',
      (event) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return;
        const sequence =
          Number(canvas.dataset.wheelDispatchedSequence ?? 0) + 1;
        canvas.dataset.wheelDispatchedSequence = String(sequence);
        // Native event listeners can have microtask checkpoints between them.
        // A task observes cancellation after Orbit's target listener has run.
        setTimeout(() => {
          canvas.dataset.lastWheelCancelled = String(event.defaultPrevented);
          canvas.dataset.lastWheelSequence = String(sequence);
        }, 0);
      },
      { capture: true, passive: true },
    ),
  );
  const wheelAndObserve = async (delta: number) => {
    const previous = Number(
      (await canvas.getAttribute('data-wheel-dispatched-sequence')) ?? 0,
    );
    await page.mouse.wheel(0, delta);
    await expect
      .poll(async () =>
        Number((await canvas.getAttribute('data-last-wheel-sequence')) ?? 0),
      )
      .toBeGreaterThan(previous);
  };
  for (const active of [false, true]) {
    if (active) await activateMap(page);
    await canvas.evaluate((element) =>
      element.scrollIntoView({ block: 'start' }),
    );
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const beforeScroll = await page.evaluate(() => window.scrollY);
    const before = await camera(page);
    const point = await canvas.evaluate((element) => {
      const box = element.getBoundingClientRect();
      for (const yPart of [0.2, 0.5, 0.8])
        for (const xPart of [0.5, 0.2, 0.8]) {
          const x = box.x + box.width * xPart,
            y = box.y + box.height * yPart;
          if (document.elementFromPoint(x, y) === element) return { x, y };
        }
      throw new Error('No uncovered canvas pixel for wheel ownership');
    });
    await page.mouse.move(point.x, point.y);
    await wheelAndObserve(160);
    if (active) {
      await expect
        .poll(async () => (await camera(page)).zoom)
        .not.toBe(before.zoom);
      await expect(canvas).toHaveAttribute('data-last-wheel-cancelled', 'true');
      expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
      for (const modifier of ['Control', 'Meta']) {
        const zoom = (await camera(page)).zoom;
        await page.keyboard.down(modifier);
        await wheelAndObserve(60);
        await page.keyboard.up(modifier);
        await expect(canvas).toHaveAttribute(
          'data-last-wheel-cancelled',
          'false',
        );
        expect((await camera(page)).zoom).toBeCloseTo(zoom, 6);
      }
    } else {
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(beforeScroll + 30);
      await expect(canvas).toHaveAttribute(
        'data-last-wheel-cancelled',
        'false',
      );
      const after = await camera(page);
      expect(after.zoom).toBeCloseTo(before.zoom, 6);
      near(after.position, before.position);
    }
  }
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-map-active', 'false');
  await expect(
    page.getByRole('button', { name: 'Interact with map', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText('Map interaction off. Scroll moves the page.'),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'More map controls', exact: true }),
  ).toBeFocused();
  expect(
    await canvas.evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('auto');
  for (const width of [375, 390, 640]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
    const buttons = await toolbar.getByRole('button').all();
    const boxes = (
      await Promise.all(buttons.map((button) => button.boundingBox()))
    ).filter((box) => box !== null);
    expect(
      Math.max(...boxes.map((box) => box!.y)) -
        Math.min(...boxes.map((box) => box!.y)),
    ).toBeLessThan(2);
    expect(boxes.every((box) => box!.width >= 44 && box!.height >= 44)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const toolbarBox = await toolbar.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(
      canvasBox!.y,
    );
  }
});

test('real Chromium touch swipes scroll passively and activated gestures rotate and pinch', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  // Graphics readiness precedes the initial 750ms selection focus. Observe its
  // completion before attributing any camera movement to browser input.
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const canvas = viewer.locator('canvas');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number; id: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await canvas.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  );
  const box = (await canvas.boundingBox())!;
  const before = await camera(page);
  const scroll = await page.evaluate(() => window.scrollY);
  const x = box.x + box.width / 2;
  const y = Math.max(100, box.y + 240);
  await touch('touchStart', [{ x, y, id: 0 }]);
  for (let step = 1; step <= 8; step++)
    await touch('touchMove', [{ x, y: y - step * 16, id: 0 }]);
  await touch('touchEnd', []);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scroll + 30);
  expect((await camera(page)).zoom).toBeCloseTo(before.zoom, 5);
  near((await camera(page)).position, before.position);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await activateMap(page);
  await canvas.scrollIntoViewIfNeeded();
  const center = await uncoveredCanvasGesture(page, 80, 0);
  const activated = await camera(page);
  await touch('touchStart', [{ ...center, id: 0 }]);
  for (let step = 1; step <= 8; step++)
    await touch('touchMove', [{ x: center.x + step * 10, y: center.y, id: 0 }]);
  await touch('touchEnd', []);
  expect(
    Math.abs((await camera(page)).azimuth - activated.azimuth),
  ).toBeGreaterThan(0.05);
  const beforePinch = await camera(page);
  const pinchStart = await uncoveredCanvasGesture(page, 108, 0);
  const pinchCenter = { x: pinchStart.x + 54, y: pinchStart.y };
  await touch('touchStart', [
    { x: pinchCenter.x - 18, y: pinchCenter.y, id: 0 },
    { x: pinchCenter.x + 18, y: pinchCenter.y, id: 1 },
  ]);
  for (let step = 1; step <= 6; step++)
    await touch('touchMove', [
      { x: pinchCenter.x - 18 - step * 6, y: pinchCenter.y, id: 0 },
      { x: pinchCenter.x + 18 + step * 6, y: pinchCenter.y, id: 1 },
    ]);
  await touch('touchEnd', []);
  expect((await camera(page)).zoom).toBeGreaterThan(beforePinch.zoom);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-map-active', 'false');
  await cdp.detach();
});

test('all visible room text shares collision placement and demand rendering settles', async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const original = prototype.drawElements;
    prototype.drawElements = function (...args) {
      const result = original.apply(this, args);
      if (this.canvas instanceof HTMLCanvasElement)
        this.canvas.dataset.testDrawCalls = String(
          Number(this.canvas.dataset.testDrawCalls ?? 0) + 1,
        );
      return result;
    };
  });
  await login(page);
  await page.goto('/room?location=ITC-RED');
  const viewer = await ready(page);
  const canvas = viewer.locator('canvas');
  await page.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await setRoomLabels(page, true);
  for (const width of [1280, 375, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await settledLabels(page);
    await page.getByRole('button', { name: 'Fit room' }).click();
    await settledLabels(page);
    const labels = viewer.locator(
      '[data-room-label-code], [data-room-decorative-label], [data-hover-tooltip]',
    );
    await expect
      .poll(() => labels.filter({ visible: true }).count())
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        // Measure every visible label in one synchronous DOM snapshot so
        // pairwise comparisons cannot combine rectangles from different frames.
        const boxes = await labels
          .filter({ visible: true })
          .evaluateAll((elements) =>
            elements.map((element) => {
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            }),
          );
        return (
          boxes.length > 0 &&
          boxes.every((box, index) =>
            boxes
              .slice(index + 1)
              .every(
                (other) =>
                  box.x + box.width <= other.x ||
                  other.x + other.width <= box.x ||
                  box.y + box.height <= other.y ||
                  other.y + other.height <= box.y,
              ),
          )
        );
      })
      .toBe(true);
  }
  let previous = -1;
  let stable = 0;
  await expect
    .poll(
      async () => {
        const draws = Number(await canvas.getAttribute('data-test-draw-calls'));
        stable = draws > 0 && draws === previous ? stable + 1 : 0;
        previous = draws;
        return stable;
      },
      { intervals: [100, 200, 250] },
    )
    .toBeGreaterThanOrEqual(3);
});

/** Pick a visible patch of the central aisle using the actual camera matrices. */
async function exposedFloorPoint(page: Page) {
  const canvas = page.locator('[aria-label="Interactive room canvas"] canvas');
  await canvas.scrollIntoViewIfNeeded();
  const frame = await canvas.boundingBox();
  expect(frame).toBeTruthy();
  const reading = await camera(page);
  const view = new Matrix4().fromArray(reading.view);
  const projection = new Matrix4().fromArray(reading.projection);
  const inverse = new Matrix4().multiplyMatrices(projection, view).invert();
  const solids = bindingBounds
    .filter((binding) => binding.primary)
    .map(
      ({ bounds }) =>
        new Box3(
          new Vector3(bounds.min[0], bounds.min[2], -bounds.max[1]),
          new Vector3(bounds.max[0], bounds.max[2], -bounds.min[1]),
        ),
    );
  for (const [roomX, roomY] of [
    [42, 63],
    [42, 55],
    [42, 72],
    [35, 63],
    [49, 63],
  ]) {
    const floor = new Vector3(roomX, 0, -roomY);
    const clip = floor.clone().applyMatrix4(view).applyMatrix4(projection);
    if (Math.abs(clip.x) > 0.85 || Math.abs(clip.y) > 0.85) continue;
    const point = {
      x: frame!.x + ((clip.x + 1) / 2) * frame!.width,
      y: frame!.y + ((1 - clip.y) / 2) * frame!.height,
    };
    if (
      (await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        point,
      )) !== 'CANVAS'
    )
      continue;
    const near = new Vector3(clip.x, clip.y, -1).applyMatrix4(inverse);
    const far = new Vector3(clip.x, clip.y, 1).applyMatrix4(inverse);
    const ray = new Ray(near, far.sub(near).normalize());
    const floorDistance = near.distanceTo(floor);
    if (
      solids.some((solid) => {
        const hit = ray.intersectBox(solid, new Vector3());
        return hit && near.distanceTo(hit) < floorDistance - 0.1;
      })
    )
      continue;
    return point;
  }
  throw new Error('No exposed central-aisle floor pixel in the current camera');
}

function projectedBounds(reading: CameraReading, code: string) {
  const bounds = bindingBounds.find((entry) => entry.code === code)?.bounds;
  expect(bounds, 'geometry bounds for ' + code).toBeTruthy();
  const transform = (matrix: number[], point: number[]) =>
    [0, 1, 2, 3].map(
      (row) =>
        matrix[row] * point[0] +
        matrix[4 + row] * point[1] +
        matrix[8 + row] * point[2] +
        matrix[12 + row] * point[3],
    );
  const pixels: number[][] = [];
  for (const x of [bounds!.min[0], bounds!.max[0]])
    for (const y of [bounds!.min[1], bounds!.max[1]])
      for (const z of [bounds!.min[2], bounds!.max[2]]) {
        const scene = [x, z, -y, 1];
        const eye = transform(reading.view, scene);
        const clip = transform(reading.projection, eye);
        pixels.push([clip[0] / clip[3], clip[1] / clip[3]]);
      }
  return pixels;
}

function expectFramed(reading: CameraReading, code: string) {
  for (const [x, y] of projectedBounds(reading, code)) {
    expect(Math.abs(x), `${code} horizontal clip coordinate`).toBeLessThan(
      0.99,
    );
    expect(Math.abs(y), `${code} vertical clip coordinate`).toBeLessThan(0.99);
  }
}

/** Independent room-JSON geometry witness for a pointer ray, not scene hover state. */
async function pointerRayIntersectsBinding(
  page: Page,
  point: { x: number; y: number },
  code: string,
) {
  const binding = bindingBounds.find(
    (entry) => entry.code === code && entry.primary,
  );
  expect(binding, `primary room geometry for ${code}`).toBeTruthy();
  const frame = await page
    .locator('[aria-label="Interactive room canvas"] canvas')
    .boundingBox();
  expect(frame).toBeTruthy();
  const reading = await camera(page);
  const inverse = new Matrix4()
    .multiplyMatrices(
      new Matrix4().fromArray(reading.projection),
      new Matrix4().fromArray(reading.view),
    )
    .invert();
  const x = ((point.x - frame!.x) / frame!.width) * 2 - 1;
  const y = 1 - ((point.y - frame!.y) / frame!.height) * 2;
  const nearPoint = new Vector3(x, y, -1).applyMatrix4(inverse);
  const farPoint = new Vector3(x, y, 1).applyMatrix4(inverse);
  const ray = new Ray(nearPoint, farPoint.sub(nearPoint).normalize());
  const bounds = binding!.bounds;
  const sceneBounds = new Box3(
    new Vector3(bounds.min[0], bounds.min[2], -bounds.max[1]),
    new Vector3(bounds.max[0], bounds.max[2], -bounds.min[1]),
  );
  return ray.intersectBox(sceneBounds, new Vector3()) !== null;
}

async function hoverSceneMesh(page: Page, code: string) {
  const viewer = page.getByTestId('room-viewer');
  const canvas = viewer.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const frame = await canvas.boundingBox();
  expect(frame).toBeTruthy();
  const corners = projectedBounds(await camera(page), code);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const range = {
    left: Math.max(-0.95, Math.min(...xs)),
    right: Math.min(0.95, Math.max(...xs)),
    bottom: Math.max(-0.95, Math.min(...ys)),
    top: Math.min(0.95, Math.max(...ys)),
  };
  let hit: { x: number; y: number } | null = null;
  for (const yPart of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    for (const xPart of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const point = {
        x:
          frame!.x +
          ((range.left + (range.right - range.left) * xPart + 1) / 2) *
            frame!.width,
        y:
          frame!.y +
          ((1 - (range.bottom + (range.top - range.bottom) * yPart)) / 2) *
            frame!.height,
      };
      if (
        (await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
          point,
        )) !== 'CANVAS'
      )
        continue;
      await page.mouse.move(point.x, point.y);
      if ((await canvas.getAttribute('data-hover-visible-code')) === code) {
        hit = point;
        break;
      }
    }
    if (hit) break;
  }
  expect(hit, `normal pointer hover reaches ${code} mesh`).toBeTruthy();
  return hit!;
}

/** Discover a genuinely exposed storage face with real pointer events. */
async function hoverAnyVisibleStorage(page: Page) {
  const viewer = page.getByTestId('room-viewer');
  const canvas = viewer.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const frame = await canvas.boundingBox();
  expect(frame).toBeTruthy();
  const codes = /^(ITC-(S[1-4][ABC]|D\d\d|RACK|RED|BLACK|CLEAR))$/;
  for (let row = 1; row < 11; row++) {
    for (let column = 1; column < 15; column++) {
      const point = {
        x: frame!.x + (frame!.width * column) / 15,
        y: frame!.y + (frame!.height * row) / 11,
      };
      if (
        (await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
          point,
        )) !== 'CANVAS'
      )
        continue;
      await page.mouse.move(point.x, point.y);
      const code = await canvas.getAttribute('data-hover-visible-code');
      if (!code || !codes.test(code)) continue;
      if (!(await pointerRayIntersectsBinding(page, point, code))) continue;
      const tooltip = viewer.locator('[data-hover-tooltip="true"]');
      await expect(tooltip).toHaveAttribute('data-location-code', code);
      await expect(tooltip).toBeVisible();
      return { code, point };
    }
  }
  throw new Error('No exposed storage face found at this camera angle');
}

async function clickSceneLocation(page: Page, code: string, viaLabel = false) {
  const viewer = page.getByTestId('room-viewer');
  if (!viaLabel) {
    const hit = await hoverSceneMesh(page, code);
    await page.mouse.click(hit!.x, hit!.y);
    await selected(page, code);
    await expect(viewer).toHaveAttribute('data-selected-code', code);
    await expect(viewer).toHaveAttribute('data-focused-code', code);
    return;
  }
  await setRoomLabels(page, true);
  // One path exercises the actual canvas mesh, while another exercises the
  // accessible projected label. Both must navigate through the same code contract.
  const label = viewer.locator('[data-location-code="' + code + '"]').first();
  await settledLabels(page);
  // Fit may legitimately declutter leaf labels. Reveal this target using real
  // zoom controls; the label itself must still perform the navigation.
  for (
    let zoom = 0;
    zoom < 4 && (await label.getAttribute('data-label-suppressed')) === 'true';
    zoom++
  ) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await settledLabels(page);
  }
  await expect(label).toBeVisible();
  await label.scrollIntoViewIfNeeded();
  await expect(label).toBeInViewport();
  let previous: { x: number; y: number; width: number; height: number } | null =
    null;
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const current = await label.boundingBox();
        if (
          current &&
          previous &&
          Math.max(
            Math.abs(current.x - previous.x),
            Math.abs(current.y - previous.y),
            Math.abs(current.width - previous.width),
            Math.abs(current.height - previous.height),
          ) < 0.25
        )
          stableSamples++;
        else stableSamples = 0;
        previous = current;
        return stableSamples;
      },
      { message: 'projected location target settles before raycasting' },
    )
    .toBeGreaterThanOrEqual(2);
  const box = await label.boundingBox();
  expect(box).toBeTruthy();
  const point = {
    x: box!.x + box!.width / 2,
    y: viaLabel ? box!.y + box!.height / 2 : box!.y + box!.height + 3,
  };
  const canvas = await viewer.locator('canvas').boundingBox();
  expect(canvas).toBeTruthy();
  expect(point.x).toBeGreaterThan(canvas!.x);
  expect(point.x).toBeLessThan(canvas!.x + canvas!.width);
  expect(point.y).toBeGreaterThan(canvas!.y);
  expect(point.y).toBeLessThan(canvas!.y + canvas!.height);
  if (viaLabel) {
    await label.click();
  } else {
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        point,
      ),
    ).toBe('CANVAS');
    await page.mouse.click(point.x, point.y);
  }
  await selected(page, code);
  await expect(viewer).toHaveAttribute('data-selected-code', code);
  await expect(viewer).toHaveAttribute('data-focused-code', code);
}

test('room labels appear on real mesh hover and Show labels restores keyboard buttons', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  trackRoomPage(testInfo, page);
  markRoomProgress(testInfo, { journey: 'room-labels', stage: 'room setup' });
  await enableRoomLayoutDiagnostics(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room');
  const viewer = await ready(page);
  await setRoomLabels(page, false);
  markRoomProgress(testInfo, {
    journey: 'room-labels',
    stage: 'real mesh hover',
  });
  for (const code of ['ITC-RACK', 'ITC-D01']) {
    const label = viewer.locator(`[data-location-code="${code}"]`);
    await expect(label).toHaveCount(0);
    await hoverSceneMesh(page, code);
    await expect(label.first()).toBeVisible();
    if (code === 'ITC-RACK')
      await page.screenshot({
        path: testInfo.outputPath('desktop-rack-hover.png'),
      });
    await page.mouse.move(15, 15);
    await expect(label).toHaveCount(0);
  }
  await hoverSceneMesh(page, 'ITC-RACK');
  await viewer.locator('button[data-location-code="ITC-RACK"]').click();
  await selected(page, 'ITC-RACK');
  await setRoomLabels(page, true);
  await page.screenshot({
    path: testInfo.outputPath('desktop-show-all-labels.png'),
  });
  const buttons = viewer.locator('button[data-location-code]');
  await expect(buttons.first()).toBeAttached();
  const available = buttons.filter({ visible: true });
  expect(await available.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) {
    if ((await button.getAttribute('aria-hidden')) === 'true')
      await expect(button).toHaveAttribute('tabindex', '-1');
  }
  await setRoomLabels(page, false);
  markRoomProgress(testInfo, {
    journey: 'room-labels',
    stage: 'selected rack label after labels off',
    code: 'ITC-RACK',
  });
  await expect(
    viewer.locator('button[data-location-code]:not([data-hover-tooltip])'),
  ).toHaveCount(1);
  try {
    await expect(
      viewer.locator('[data-room-label-code="ITC-RACK"]'),
    ).toBeVisible();
  } catch (error) {
    reportRoomAssertionFailure('rack-labels-off', 'ITC-RACK', {
      state: await captureRoomAssertionState(page, 'ITC-RACK'),
    });
    throw error;
  }
});

test('Free Orbit labels follow exposed storage under actual pointer movement from oblique, top, bottom and panned views', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC');
  const viewer = await ready(page);
  const toolbar = page.locator('[data-room-surface]');
  await chooseMapMode(page, 'Free Orbit');
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const rotate = toolbar.getByRole('button', { name: 'Rotate right' });
  const up = toolbar.getByRole('button', { name: 'Tilt up' });
  const down = toolbar.getByRole('button', { name: 'Tilt down' });
  for (let index = 0; index < 3; index++) await rotate.click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  for (const view of ['oblique', 'overhead', 'underside', 'panned'] as const) {
    if (view === 'overhead') {
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      for (let index = 0; index < 5; index++) await up.click();
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
    } else if (view === 'underside') {
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      for (let index = 0; index < 12; index++) await down.click();
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
    } else if (view === 'panned') {
      await toolbar.getByRole('button', { name: 'Fit room' }).click();
      await settledLabels(page);
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      await toolbar.getByRole('button', { name: 'Pan right' }).click();
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
    }
    const { code } = await hoverAnyVisibleStorage(page);
    expect(code, `visible storage target at ${view}`).toMatch(/^ITC-/);
    await expect(viewer).toHaveAttribute('data-selected-code', 'ITC');
    await viewer.screenshot({ path: testInfo.outputPath(`hover-${view}.png`) });
    await page.mouse.move(15, 15);
    await expect(viewer.locator('[data-hover-tooltip="true"]')).toHaveCount(0);
  }
});

test('hover tooltip survives DOM handoff and a stationary pointer tracks camera changes', async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC');
  const viewer = await ready(page);
  const toolbar = page.locator('[data-room-surface]');
  await chooseMapMode(page, 'Free Orbit');
  const { code } = await hoverAnyVisibleStorage(page);
  const tooltip = viewer.locator('[data-hover-tooltip="true"]');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC');
  await tooltip.hover();
  await expect(tooltip).toHaveAttribute('data-location-code', code);
  await expect(tooltip).toBeVisible();
  await tooltip.click();
  await selected(page, code);
  await page.goto('/room?location=ITC');
  await ready(page);
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const shelfPoint = await hoverSceneMesh(page, 'ITC-S1A');
  await expect(tooltip).toHaveAttribute('data-location-code', 'ITC-S1A');
  expect(await pointerRayIntersectsBinding(page, shelfPoint, 'ITC-S1A')).toBe(
    true,
  );
  // Keep the pointer on the DOM handoff while the underlying scene moves;
  // retaining the button must not retain a location that left the visible ray.
  await tooltip.hover();
  const canvas = viewer.locator('canvas');
  const pan = toolbar.getByRole('button', { name: 'Pan right' });
  // DOM activation keeps the real pointer fixed. Pan until an independent
  // room-geometry ray no longer intersects the originally hovered shelf.
  let leftOldSurface = false;
  for (let step = 0; step < 12; step++) {
    const previousTarget = (await camera(page)).target;
    await pan.evaluate((element) => (element as HTMLButtonElement).click());
    await expect
      .poll(async () =>
        Math.hypot(
          ...(await camera(page)).target.map(
            (value, index) => value - previousTarget[index],
          ),
        ),
      )
      .toBeGreaterThan(5);
    if (!(await pointerRayIntersectsBinding(page, shelfPoint, 'ITC-S1A'))) {
      leftOldSurface = true;
      break;
    }
  }
  expect(
    leftOldSurface,
    'camera pan must move the shelf off the fixed ray',
  ).toBe(true);
  await expect
    .poll(async () =>
      (await tooltip.count())
        ? tooltip.getAttribute('data-location-code')
        : null,
    )
    .not.toBe('ITC-S1A');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC');

  await page.setViewportSize({ width: 320, height: 640 });
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await hoverAnyVisibleStorage(page);
  const tooltipBounds = await tooltip.boundingBox();
  const canvasBounds = await canvas.boundingBox();
  expect(tooltipBounds).toBeTruthy();
  expect(canvasBounds).toBeTruthy();
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x + 7);
  expect(tooltipBounds!.y).toBeGreaterThanOrEqual(canvasBounds!.y + 7);
  expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(
    canvasBounds!.x + canvasBounds!.width - 7,
  );
  expect(tooltipBounds!.y + tooltipBounds!.height).toBeLessThanOrEqual(
    canvasBounds!.y + canvasBounds!.height - 7,
  );
});

test('real WebGL room raycasting selects shelf and drawer inventory', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room');
  await expect(
    page.getByRole('heading', { name: 'Spaces & maps', exact: true }),
  ).toBeVisible();
  const viewer = await ready(page);
  expect(
    await viewer
      .locator('canvas')
      .evaluate(
        (canvas) =>
          canvas instanceof HTMLCanvasElement &&
          canvas.width > 0 &&
          canvas.height > 0 &&
          canvas.getContext('webgl2') !== null,
      ),
  ).toBe(true);
  await clickSceneLocation(page, 'ITC-S1A');
  const inventory = page.getByRole('region', {
    name: 'Location inventory',
    exact: true,
  });
  await expect(
    inventory.getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(1);
  const fixtureRow = inventory.getByRole('listitem').filter({
    has: page.getByRole('link', { name: inventoryName, exact: true }),
  });
  await expect(fixtureRow.getByText('7 units', { exact: true })).toBeVisible();
  const toolbar = page.locator('[data-room-surface]');
  await setRoomLabels(page, true);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const objectLabel = viewer.locator('[data-location-code="ITC-S1A"]').first();
  await expect(objectLabel).toBeVisible();
  const labelBox = await objectLabel.boundingBox();
  expect(labelBox).toBeTruthy();
  await page.mouse.dblclick(
    labelBox!.x + labelBox!.width / 2,
    labelBox!.y + labelBox!.height / 2,
  );
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  expect(
    Math.hypot(
      ...(await camera(page)).target.map(
        (value, index) => value - [42, 35, -63][index],
      ),
    ),
    'double-clicking an object must not run floor recenter',
  ).toBeGreaterThan(1);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const meshBox = await objectLabel.boundingBox();
  expect(meshBox).toBeTruthy();
  const meshPoint = {
    x: meshBox!.x + meshBox!.width / 2,
    y: meshBox!.y + meshBox!.height + 3,
  };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      meshPoint,
    ),
  ).toBe('CANVAS');
  await page.mouse.dblclick(meshPoint.x, meshPoint.y);
  expect(
    Math.hypot(
      ...(await camera(page)).target.map(
        (value, index) => value - [42, 35, -63][index],
      ),
    ),
    'double-clicking furniture must not run floor recenter',
  ).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await settledLabels(page);
  await clickSceneLocation(page, 'ITC-D01', true);
  await expect(
    inventory.getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(1);
  await expect(fixtureRow.getByText('4 units', { exact: true })).toBeVisible();
});

for (const { name, viewport } of [
  { name: 'desktop', viewport: { width: 1280, height: 1100 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
]) {
  test(`visible drawer labels remain distinct and clickable across ${name} orbit views`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    trackRoomPage(testInfo, page);
    markRoomProgress(testInfo, {
      journey: 'drawer-labels',
      stage: `room setup at ${viewport.width}px`,
    });
    await login(page);
    await page.setViewportSize(viewport);
    await page.goto('/room?location=ITC-S1A');
    const viewer = await ready(page);
    const toolbar = page.locator('[data-room-surface]');
    await setRoomLabels(page, true);
    for (const code of ['ITC-D01', 'ITC-D04']) {
      const label = viewer.locator(`[data-location-code="${code}"]`).first();
      await expect(label).toHaveAttribute(
        'data-label-suppressed',
        /^(true|false)$/,
      );
      // A hidden or never-placed target has no placement offset. Keep the
      // subsequent real click/focus and opaque-visibility checks authoritative.
      if (
        (await label.getAttribute('data-label-suppressed')) === 'false' &&
        (await label.isVisible())
      ) {
        await expect(label).toHaveAttribute('data-label-dx', /^-?\d/);
        await expect(label).toHaveAttribute('data-label-dy', /^-?\d/);
      }
    }
    await chooseMapMode(page, 'Free Orbit');
    const clicked = new Set<string>();
    for (let side = 0; side < 4; side++) {
      await toolbar.getByRole('button', { name: 'Fit room' }).click();
      await settledLabels(page);
      for (const code of ['ITC-D01', 'ITC-D04']) {
        markRoomProgress(testInfo, {
          journey: 'drawer-labels',
          stage: `drawer label at ${viewport.width}px side ${side}`,
          code,
        });
        const label = viewer.locator(`[data-location-code="${code}"]`).first();
        if ((await label.getAttribute('data-label-suppressed')) === 'true') {
          await expect(label).toHaveAttribute('aria-hidden', 'true');
          await expect(label).toHaveAttribute('tabindex', '-1');
          continue;
        }
        if (!(await label.isVisible())) {
          expect(
            await label.evaluate((element) => {
              element.focus();
              return document.activeElement === element;
            }),
            `occluded ${code} label cannot receive keyboard focus`,
          ).toBe(false);
          continue;
        }
        await label.scrollIntoViewIfNeeded({ timeout: 3000 });
        await settledLabels(page);
        const firstChildRectCount = await label.evaluate((element) => {
          const text = element.firstChild;
          if (!text) return 0;
          const range = document.createRange();
          range.selectNodeContents(text);
          return range.getClientRects().length;
        });
        try {
          const name = await label.evaluate(measureRoomLabelName);
          expect(name.text, `expected drawer name for ${code}`).toBe(
            locationNames.get(code),
          );
          expect(name.visible, `visible drawer name for ${code}`).toBe(true);
          expect(
            name.rects,
            'ordinary drawer names remain readable on one line',
          ).toHaveLength(1);
          expect(
            name.rects[0].width,
            `drawer name width for ${code}`,
          ).toBeGreaterThan(0);
          expect(
            name.rects[0].height,
            `drawer name height for ${code}`,
          ).toBeGreaterThan(0);
        } catch (error) {
          reportRoomAssertionFailure('drawer-name-lines', code, {
            viewport,
            side,
            firstChildRectCount,
            state: await captureRoomAssertionState(page, code, false),
          });
          throw error;
        }
        const box = await label.boundingBox();
        expect(box, `visible label bounds for ${code}`).toBeTruthy();
        const point = {
          x: box!.x + box!.width / 2,
          y: box!.y + box!.height / 2,
        };
        expect(
          await page.evaluate(
            ({ x, y }) =>
              document
                .elementFromPoint(x, y)
                ?.closest('[data-location-code]')
                ?.getAttribute('data-location-code'),
            point,
          ),
          `visible ${code} label center on side ${side}`,
        ).toBe(code);
        await label.click({ timeout: 3000 });
        await expect(viewer).toHaveAttribute('data-selected-code', code);
        clicked.add(code);
        await toolbar.getByRole('button', { name: 'Fit room' }).click();
        await settledLabels(page);
      }
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      for (let step = 0; step < 9; step++)
        await toolbar.getByRole('button', { name: 'Rotate right' }).click();
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
    }
    expect(clicked.has('ITC-D01'), 'Drawer 1 label reachable').toBe(true);
    expect(clicked.has('ITC-D04'), 'Drawer 4 label reachable').toBe(true);
  });
}

test('panned camera keeps visible drawer labels clickable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room');
  const viewer = await ready(page);
  const toolbar = page.locator('[data-room-surface]');
  await setRoomLabels(page, true);
  for (const direction of ['Pan right', 'Pan left']) {
    await toolbar.getByRole('button', { name: 'Fit room' }).click();
    await settledLabels(page);
    await toolbar
      .getByRole('button', { name: 'More map controls', exact: true })
      .click();
    await toolbar.getByRole('button', { name: direction }).click();
    await toolbar
      .getByRole('button', { name: 'More map controls', exact: true })
      .click();
    let clicked = false;
    for (const code of ['ITC-D01', 'ITC-D04']) {
      const label = viewer.locator(`[data-location-code="${code}"]`).first();
      await expect(label).toHaveAttribute(
        'data-label-suppressed',
        /^(true|false)$/,
      );
      if (
        !(await label.isVisible()) ||
        (await label.getAttribute('data-label-suppressed')) === 'true'
      )
        continue;
      const box = await label.boundingBox();
      expect(box).toBeTruthy();
      expect(
        await label.evaluate(
          (element, point) =>
            element.contains(document.elementFromPoint(point.x, point.y)),
          {
            x: box!.x + box!.width / 2,
            y: box!.y + box!.height / 2,
          },
        ),
      ).toBe(true);
      await label.click();
      await selected(page, code);
      clicked = true;
      break;
    }
    expect(
      clicked,
      `${direction} must leave a visible drawer label clickable`,
    ).toBe(true);
  }
});

test('real controls orbit through both complete turns and preserve selection across mode changes', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const toolbar = page.locator('[data-room-surface]');
  await chooseMapMode(page, 'Free Orbit');
  await expect(viewer.locator('canvas')).toHaveAttribute(
    'data-orbit-mode',
    'free',
  );
  const start = await camera(page);
  expect(start.mode).toBe('free');
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const right = toolbar.getByRole('button', { name: 'Rotate right' });
  const left = toolbar.getByRole('button', { name: 'Rotate left' });
  const raw: number[] = [start.azimuth];
  for (let step = 0; step < 38; step++) {
    await right.click();
    raw.push((await camera(page)).azimuth);
  }
  const clockwise = await camera(page);
  expect(clockwise.unwrapped - start.unwrapped).toBeGreaterThan(2 * Math.PI);
  expect(
    raw.some(
      (value, index) => index > 0 && Math.abs(value - raw[index - 1]) > 5,
    ),
  ).toBe(true);
  for (let step = 0; step < 38; step++) await left.click();
  const counterclockwise = await camera(page);
  expect(clockwise.unwrapped - counterclockwise.unwrapped).toBeGreaterThan(
    2 * Math.PI,
  );
  near(counterclockwise.target, start.target);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await withRoomDragWitness(page, async (snapshot) => {
    // Complete activation before measuring and placing the native drag pointer.
    await activateMap(page);
    await viewer.locator('canvas').scrollIntoViewIfNeeded();
    const bounds = await viewer.locator('canvas').boundingBox();
    expect(bounds).toBeTruthy();
    const dx = -bounds!.width * 0.44;
    const drag = await uncoveredCanvasGesture(page, dx, 0);
    await page.mouse.move(drag.x, drag.y);
    await snapshot(drag.x, drag.y);
    expect(
      await viewer
        .locator('canvas')
        .evaluate((element) => element.matches(':hover')),
      'The final drag pointer must hit the canvas at the intended drag start',
    ).toBe(true);
    await page.mouse.down();
    await expect(viewer.locator('canvas')).toHaveAttribute(
      'data-map-active',
      'true',
    );
    await expect(viewer.locator('canvas')).toBeFocused();
    await page.mouse.move(drag.x + dx, drag.y, { steps: 12 });
    await page.mouse.up();
    expect(
      Math.abs((await camera(page)).unwrapped - counterclockwise.unwrapped),
    ).toBeGreaterThan(0.1);
  });
  await page.reload();
  await ready(page);
  expect((await camera(page)).mode).toBe('free');
  await chooseMapMode(page, 'Guided');
  const guided = await camera(page);
  expect(guided.mode).toBe('guided');
  expect(Math.abs(guided.azimuth)).toBeLessThanOrEqual(Math.PI / 4 + 0.001);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Pan left' }).click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  expect((await camera(page)).target).not.toEqual([42, 35, -63]);
  const floorPoint = await exposedFloorPoint(page);
  await page.screenshot({
    path: testInfo.outputPath('exposed-floor-after-orbit.png'),
  });
  await page.mouse.dblclick(floorPoint.x, floorPoint.y);
  near((await camera(page)).target, [42, 35, -63]);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await page.reload();
  await ready(page);
  expect((await camera(page)).mode).toBe('guided');
});

test('Free Orbit tilts to both poles and below the horizon while Guided clamps both tilt controls', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  const toolbar = page.locator('[data-room-surface]');
  await chooseMapMode(page, 'Free Orbit');
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const up = toolbar.getByRole('button', { name: 'Tilt up' });
  const down = toolbar.getByRole('button', { name: 'Tilt down' });
  for (let step = 0; step < 10; step++) await up.click();
  const top = await camera(page);
  expect(top.elevation).toBeGreaterThan(1.55);
  expect(top.elevation).toBeLessThan(Math.PI / 2);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await recenterMap(page);
  expect((await camera(page)).elevation).toBeCloseTo(top.elevation, 4);
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  expect((await camera(page)).elevation).toBeCloseTo(top.elevation, 4);
  await page.screenshot({ path: testInfo.outputPath('desktop-free-top.png') });
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  for (let step = 0; step < 19; step++) await down.click();
  const bottom = await camera(page);
  expect(bottom.elevation).toBeLessThan(-1.55);
  expect(bottom.elevation).toBeGreaterThan(-Math.PI / 2);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  expect((await camera(page)).elevation).toBeCloseTo(bottom.elevation, 4);
  await page.screenshot({
    path: testInfo.outputPath('desktop-free-bottom.png'),
  });
  const bottomFrame = await viewer.locator('canvas').boundingBox();
  expect(bottomFrame).toBeTruthy();
  const projected = projectedBounds(await camera(page), 'ITC-D01');
  const floorOccludedPoint = {
    x:
      bottomFrame!.x +
      ((projected.reduce((sum, [x]) => sum + x, 0) / projected.length + 1) /
        2) *
        bottomFrame!.width,
    y:
      bottomFrame!.y +
      ((1 - projected.reduce((sum, [, y]) => sum + y, 0) / projected.length) /
        2) *
        bottomFrame!.height,
  };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      floorOccludedPoint,
    ),
  ).toBe('CANVAS');
  await page.mouse.click(floorOccludedPoint.x, floorOccludedPoint.y);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await page.setViewportSize({ width: 390, height: 844 });
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  expectFramed(await camera(page), 'ITC');
  await viewer.screenshot({
    path: testInfo.outputPath('phone-free-bottom.png'),
  });
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  for (let step = 0; step < 19; step++) await up.click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  expect((await camera(page)).elevation).toBeGreaterThan(1.55);
  expectFramed(await camera(page), 'ITC');
  await viewer.screenshot({ path: testInfo.outputPath('phone-free-top.png') });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await chooseMapMode(page, 'Guided');
  const guided = await camera(page);
  expect(guided.elevation).toBeGreaterThanOrEqual((35 * Math.PI) / 180 - 0.001);
  expect(guided.elevation).toBeLessThanOrEqual((70 * Math.PI) / 180 + 0.001);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  for (let step = 0; step < 8; step++) await down.click();
  expect((await camera(page)).elevation).toBeCloseTo((35 * Math.PI) / 180, 3);
  for (let step = 0; step < 8; step++) await up.click();
  expect((await camera(page)).elevation).toBeCloseTo((70 * Math.PI) / 180, 3);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await chooseMapMode(page, 'Free Orbit');
  const canvas = viewer.locator('canvas');
  await withRoomDragWitness(page, async (snapshot) => {
    // Complete activation before measuring and placing the native drag pointer.
    await activateMap(page);
    await canvas.scrollIntoViewIfNeeded();
    const frame = await canvas.boundingBox();
    expect(frame).toBeTruthy();
    const beforeDrag = await camera(page);
    const dy = frame!.height * 0.35;
    const drag = await uncoveredCanvasGesture(page, 0, dy);
    await page.mouse.move(drag.x, drag.y);
    await snapshot(drag.x, drag.y);
    expect(
      await canvas.evaluate((element) => element.matches(':hover')),
      'The final drag pointer must hit the canvas at the intended drag start',
    ).toBe(true);
    await page.mouse.down();
    await expect(viewer.locator('canvas')).toHaveAttribute(
      'data-map-active',
      'true',
    );
    await expect(viewer.locator('canvas')).toBeFocused();
    await page.mouse.move(drag.x, drag.y + dy, { steps: 12 });
    await page.mouse.up();
    expect(
      Math.abs((await camera(page)).elevation - beforeDrag.elevation),
    ).toBeGreaterThan(0.1);
  });
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
});

test('recenter restores overview target while preserving orbit, zoom and selection', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const toolbar = page.locator('[data-room-surface]');
  await toolbar.getByRole('button', { name: 'Zoom in' }).click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Rotate right' }).click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  const before = await camera(page);
  await recenterMap(page);
  const recentered = await camera(page);
  near(recentered.target, [42, 35, -63]);
  expect(recentered.zoom).toBeCloseTo(before.zoom, 5);
  expect(recentered.azimuth).toBeCloseTo(before.azimuth, 5);
  near(
    recentered.position.map((value, index) => value - recentered.target[index]),
    before.position.map((value, index) => value - before.target[index]),
  );
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Pan left' }).click();
  const panned = await camera(page);
  expect(panned.target).not.toEqual(recentered.target);
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const floorPoint = await exposedFloorPoint(page);
  await page.mouse.dblclick(floorPoint.x, floorPoint.y);
  const floor = await camera(page);
  near(floor.target, recentered.target);
  expect(floor.zoom).toBeCloseTo(panned.zoom, 5);
  expect(floor.azimuth).toBeCloseTo(panned.azimuth, 5);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await page.setViewportSize({ width: 1024, height: 700 });
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  expectFramed(await camera(page), 'ITC');
  await expect(viewer.locator('canvas')).toBeVisible();
});

test('root and large aggregate focus fit their geometry at desktop and phone widths', async ({
  page,
}) => {
  test.setTimeout(75_000);
  await login(page);
  for (const viewport of [
    { width: 1280, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const code of ['ITC', 'ITC-L']) {
      await page.goto('/room?location=' + code);
      const viewer = await ready(page);
      await expect(viewer).toHaveAttribute('data-focused-code', code);
      const completed = Number(await viewer.getAttribute('data-focus-count'));
      await page.getByRole('button', { name: 'Center selected' }).click();
      await expect
        .poll(async () => Number(await viewer.getAttribute('data-focus-count')))
        .toBeGreaterThan(completed);
      expectFramed(await camera(page), code);
      await expect(viewer).toHaveAttribute('data-selected-code', code);
    }
  }
  await page.goto('/room?location=ITC');
  const viewer = await ready(page);
  const toolbar = page.locator('[data-room-surface]');
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await settledLabels(page);
  await chooseMapMode(page, 'Free Orbit');
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  for (let step = 0; step < 2; step++)
    await toolbar.getByRole('button', { name: 'Rotate left' }).click();
  expect(Math.abs((await camera(page)).azimuth)).toBeLessThan(0.02);
  for (let step = 0; step < 6; step++)
    await toolbar.getByRole('button', { name: 'Rotate right' }).click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const completed = Number(await viewer.getAttribute('data-focus-count'));
  await toolbar.getByRole('button', { name: 'Center selected' }).click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-focus-count')))
    .toBeGreaterThan(completed);
  expectFramed(await camera(page), 'ITC');
});

test('manual pointer movement interrupts an in-flight selected-location focus', async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Install before navigation so performance.now and animation frames share a clock.
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-D01');
  const viewer = await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
  const toolbar = page.locator('[data-room-surface]');
  const canvas = viewer.locator('canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const displaced = await camera(page);
  const completedBefore = Number(await viewer.getAttribute('data-focus-count'));
  // CI input delivery can exceed the whole 750 ms flight. Control elapsed
  // time, while still exercising the real focus button and trusted pointer drag.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  await toolbar.getByRole('button', { name: 'Center selected' }).click();
  await page.clock.runFor(100);
  const inFlight = await camera(page);
  expect(inFlight.target).not.toEqual(displaced.target);
  expect(Number(await viewer.getAttribute('data-focus-count'))).toBe(
    completedBefore,
  );
  await activateMap(page);
  const drag = await uncoveredCanvasGesture(page, bounds!.width * 0.12, 0);
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down({ button: 'right' });
  await expect(canvas).toHaveAttribute('data-map-active', 'true');
  await expect(canvas).toBeFocused();
  await page.mouse.move(drag.x + bounds!.width * 0.12, drag.y, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const stopped = await camera(page);
  expect(stopped.target).not.toEqual(inFlight.target);
  await page.clock.runFor(1200);
  near((await camera(page)).target, stopped.target);
  expect(Number(await viewer.getAttribute('data-focus-count'))).toBe(
    completedBefore,
  );
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
  // A subsequent uninterrupted request must still complete under the same clock.
  await toolbar.getByRole('button', { name: 'Center selected' }).click();
  await page.clock.runFor(1200);
  await expect(viewer).toHaveAttribute(
    'data-focus-count',
    String(completedBefore + 1),
  );
});

test('captures four room sides and searchable picker at desktop and phone widths without console errors', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  // The all-spec run enables private telemetry. Serve its pinned intake script
  // locally so this console check still catches actual room errors.
  const speedInsightsScript = readFileSync(
    new URL('../fixtures/speed-insights-script.js', import.meta.url),
    'utf8',
  );
  await page.route('**/_vercel/speed-insights/script.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: speedInsightsScript,
    }),
  );
  await page.route('**/_vercel/speed-insights/vitals', (route) =>
    route.fulfill({ status: 204 }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  const toolbar = page.locator('[data-room-surface]');
  await chooseMapMode(page, 'Free Orbit');
  await page.screenshot({
    path: testInfo.outputPath('desktop-selected-focus.png'),
  });
  for (const width of ['desktop', 'phone'] as const) {
    if (width === 'phone') {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    for (const side of ['front', 'right', 'back', 'left'] as const) {
      await toolbar.getByRole('button', { name: 'Fit room' }).click();
      await settledLabels(page);
      expectFramed(await camera(page), 'ITC');
      const path = testInfo.outputPath(`${width}-${side}.png`);
      if (width === 'desktop') await page.screenshot({ path });
      else await viewer.screenshot({ path });
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      const initial = (await camera(page)).unwrapped;
      for (let step = 0; step < 9; step++)
        await toolbar.getByRole('button', { name: 'Rotate right' }).click();
      expect((await camera(page)).unwrapped - initial).toBeGreaterThan(1.5);
      await toolbar
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
    }
    await setRoomLabels(page, true);
    await page.screenshot({
      path: testInfo.outputPath(`${width}-show-all-labels.png`),
    });
    const browser = page.getByRole('navigation', { name: 'Location browser' });
    await expect(
      browser.getByRole('searchbox', { name: 'Browse locations' }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${width}-location-browser.png`),
    });
    const search = browser.getByRole('searchbox', { name: 'Browse locations' });
    await search.fill('right storage');
    await expect(
      browser.getByRole('button', { name: /ITC-D07$/ }),
    ).toBeVisible();
    if (width === 'phone') {
      const panel = await browser.boundingBox();
      const canvas = await viewer.locator('canvas').boundingBox();
      expect(panel).toBeTruthy();
      expect(canvas).toBeTruthy();
      expect(panel!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);
    }
    await page.screenshot({
      path: testInfo.outputPath(`${width}-picker-search.png`),
    });
    await search.clear();
    if (width === 'phone') {
      await page
        .getByRole('region', { name: 'Location inventory' })
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: testInfo.outputPath('phone-selected-inventory.png'),
      });
    }
  }
  expect(errors).toEqual([]);
});

test('search focuses the room and aggregate selection survives reload and browser navigation', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto('/inventory?q=' + encodeURIComponent(inventoryName));
  await page
    .getByRole('link', { name: 'Show ITC-S1A in room', exact: true })
    .click();
  await selected(page, 'ITC-S1A');
  const viewer = await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  await chooseRoomLocation(page, 'ITC-L');
  await selected(page, 'ITC-L');
  await expect(
    page
      .getByRole('region', { name: 'Location inventory', exact: true })
      .getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(2);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-L');
  await page.reload();
  await selected(page, 'ITC-L');
  await ready(page);
  await chooseRoomLocation(page, 'ITC-D01');
  await selected(page, 'ITC-D01');
  await page.goBack();
  await selected(page, 'ITC-L');
  await page.goForward();
  await selected(page, 'ITC-D01');
  await page
    .getByRole('button', { name: 'Center selected', exact: true })
    .click();
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
  const completed = Number(await viewer.getAttribute('data-focus-count'));
  const canvas = await viewer.locator('canvas').boundingBox();
  expect(canvas).toBeTruthy();
  await page.mouse.move(
    canvas!.x + canvas!.width / 2,
    canvas!.y + canvas!.height / 2,
  );
  await page.mouse.wheel(0, 180);
  await page
    .getByRole('button', { name: 'Center selected', exact: true })
    .click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-focus-count')))
    .toBeGreaterThan(completed);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
  await page.goto('/locations/ITC-D01');
  await page
    .getByRole('link', { name: 'Show ITC-D01 in room', exact: true })
    .first()
    .click();
  await selected(page, 'ITC-D01');
  await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
});

test('native Back restores the exact room selection and settles contents after changing motion in Settings', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  await page.goto('/room?space=it-closet&location=ITC-RACK');
  for (const [code, reduced] of [
    ['ITC-RACK', true],
    ['ITC-RED', false],
  ] as const) {
    if (code === 'ITC-RED') {
      // Preserve the initially server-rendered Rack entry, then change the
      // client-owned selection before visiting a fully settled other route.
      await page.reload();
      await selected(page, 'ITC-RACK');
      await ready(page);
      await chooseRoomLocation(page, code);
    }
    await selected(page, code);
    await ready(page);
    const inventory = page.getByRole('region', {
      name: 'Location inventory',
      exact: true,
    });
    await expect(inventory).toHaveAttribute('aria-busy', 'false');
    const roomUrl = page.url();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings', exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings$/);
    const toggle = page.getByRole('switch', {
      name: 'Reduce motion in this browser',
    });
    await expect(toggle).toBeEnabled();
    if ((await toggle.getAttribute('aria-checked')) !== String(reduced))
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(reduced));
    const progress = page.locator('.experience-route-progress');
    await expect(progress).toHaveAttribute('data-visible', 'false');
    await expect(progress).toHaveAttribute('aria-hidden', 'true');
    await expect(progress.getByRole('status')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(roomUrl);
    await selected(page, code);
    const viewer = await ready(page);
    await expect(viewer).toHaveAttribute('data-selected-code', code);
    if (code === 'ITC-RED')
      await expect(viewer).toHaveAttribute('data-focused-code', code);
    await expect(inventory).toHaveAttribute('aria-busy', 'false');
    await expect(progress).toHaveAttribute('data-visible', 'false');
    await expect(progress).toHaveAttribute('aria-hidden', 'true');
    await expect(progress.getByRole('status')).toHaveCount(0);
    await expect(
      page.getByText('Inventory could not be loaded.', { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute(
      'data-motion',
      reduced ? 'reduced' : 'full',
    );
  }
});

test('room location browser refreshes filtered selections and results', async ({
  page,
}) => {
  await login(page);
  await page.goto('/room');
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  const search = browser.getByRole('searchbox', { name: 'Browse locations' });
  await chooseRoomLocation(page, 'ITC-D01');
  await selected(page, 'ITC-D01');
  await expect(search).toHaveValue('ITC-D01');
  await search.clear();
  await expect(
    browser.getByRole('button', { name: /Expand IT Closet/ }),
  ).toBeVisible();
  await search.fill('ITC-D04');
  await browser.getByRole('button', { name: /ITC-D04$/ }).click();
  await selected(page, 'ITC-D04');
  await expect(search).toHaveValue('ITC-D04');
});

test('phone More settles focused room labels and scrolls to keyboard Help and Close without moving the camera', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto('/room?location=ITC-D01');
  const viewer = await ready(page);
  await selected(page, 'ITC-D01');
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
  await setRoomLabels(page, true);
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  await more.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settledLabels(page);
  const before = await camera(page);
  await more.click();
  const popup = page.getByRole('region', {
    name: 'More map controls',
    exact: true,
  });
  await expect(popup).toBeVisible();
  await settledLabels(page);
  await expect(
    viewer.getByRole('list', {
      name: 'Locations with unavailable room labels',
      exact: true,
    }),
  ).toHaveCount(0);
  const scroll = await page.evaluate(() => scrollY);
  const rect = await popup.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(
    rect!.x + rect!.width / 2,
    rect!.y + Math.min(70, rect!.height / 2),
  );
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() => popup.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(30);
  const help = popup.getByRole('button', { name: 'Controls', exact: true });
  const close = popup.getByRole('button', {
    name: 'Close controls',
    exact: true,
  });
  await expect(help).toBeInViewport({ ratio: 0.95 });
  await expect(close).toBeInViewport({ ratio: 0.95 });
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await popup.getByRole('button', { name: 'Recenter', exact: true }).focus();
  let reachedHelp = false;
  for (let tabs = 0; tabs < 24; tabs++) {
    await page.keyboard.press('Tab');
    if (await help.evaluate((element) => document.activeElement === element)) {
      reachedHelp = true;
      break;
    }
  }
  expect(reachedHelp).toBe(true);
  await page.keyboard.press('Enter');
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(popup).toHaveCount(0);
  await expect(more).toBeFocused();
  await settledLabels(page);
  await expect(
    viewer.getByRole('list', {
      name: 'Locations with unavailable room labels',
      exact: true,
    }),
  ).toHaveCount(0);
  const after = await camera(page);
  near(after.position, before.position);
  near(after.target, before.target);
  near(after.view, before.view);
  near(after.projection, before.projection);
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await selected(page, 'ITC-D01');
});

test('location browser has keyboard drill-down, aggregate selection, and full search breadcrumbs', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/room');
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  const root = browser.getByRole('button', { name: /IT Closet ITC$/ });
  await expect(root).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('phone-location-browser.png'),
  });
  const openRoot = browser.getByRole('button', { name: 'Open IT Closet' });
  await openRoot.focus();
  await openRoot.press('Enter');
  await expect(browser).toBeFocused();
  await expect(browser.getByRole('status')).toHaveText('Browsing IT Closet');
  const left = browser.getByRole('button', { name: /Left Storage ITC-L$/ });
  await expect(left).toBeVisible();
  await browser.getByRole('button', { name: 'Open Left Storage' }).click();
  await expect(browser).toBeFocused();
  await expect(browser.getByRole('status')).toHaveText(
    'Browsing IT Closet / Left Storage',
  );
  await expect(
    browser.getByRole('button', { name: /Shelf 1 ITC-S1$/ }),
  ).toBeVisible();
  await browser.getByRole('button', { name: 'Back to IT Closet' }).click();
  await expect(browser).toBeFocused();
  await expect(browser).toBeVisible();
  await expect(browser.getByRole('status')).toHaveText('Browsing IT Closet');
  await left.click();
  await selected(page, 'ITC-L');
  const search = browser.getByRole('searchbox', { name: 'Browse locations' });
  await search.fill('ITC-D01');
  await expect(browser).toContainText(
    'Selected path: IT Closet / Left Storage',
  );
  const result = browser.getByRole('button', { name: /Drawer 1 ITC-D01$/ });
  await result.click();
  await selected(page, 'ITC-D01');
  await expect(browser).toContainText(
    'Selected path: IT Closet / Left Storage / Drawer 1',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('viewer phone navigation offers keyboard selection and an optional room without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'viewer');
  await page.goto('/room?location=ITC-S1A');
  await selected(page, 'ITC-S1A');
  const hide = page.getByRole('button', { name: 'Hide room', exact: true });
  if (await hide.isVisible()) await hide.click();
  await expect(
    page.getByRole('button', { name: 'Show room', exact: true }),
  ).toBeVisible();
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  const search = browser.getByRole('searchbox', { name: 'Browse locations' });
  await search.focus();
  await expect(search).toBeFocused();
  await search.fill('ITC-D01');
  const result = browser.getByRole('button', { name: /Drawer 1 ITC-D01$/ });
  await result.focus();
  await result.press('Enter');
  await selected(page, 'ITC-D01');
  const box = await search.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const inventory = page.getByRole('region', {
    name: 'Location inventory',
    exact: true,
  });
  await inventory
    .getByRole('link', { name: inventoryName, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: inventoryName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Record tasks', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('form', { name: 'Move stock', exact: true }),
  ).toHaveCount(0);
});

test('real WebGL context loss recovers with the current selection and reduced-motion focus', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const origin = new URL(page.url());
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
  expect(origin.port).toBe('3000');
  const viewer = await ready(page);
  await selected(page, 'ITC-S1A');
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  expect(
    await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true);
  const injected = await viewer.locator('canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const context = canvas.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(
    injected,
    'the browser must expose real WebGL context-loss injection',
  ).toBe(true);
  await expect(
    viewer.getByRole('heading', { name: 'Room view unavailable' }),
  ).toBeVisible();
  await expect(
    viewer.getByRole('heading', { name: 'Room view unavailable', exact: true }),
  ).toBeVisible();
  await chooseRoomLocation(page, 'ITC-D01');
  await selected(page, 'ITC-D01');
  await expect(
    page
      .getByRole('region', { name: 'Location inventory', exact: true })
      .getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(1);
  // Selecting another location requests a fresh scene after context loss.
  await ready(page);
  await selected(page, 'ITC-D01');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
  const completed = Number(await viewer.getAttribute('data-focus-count'));
  await page
    .getByRole('button', { name: 'Center selected', exact: true })
    .click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-focus-count')))
    .toBeGreaterThan(completed);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
});

test('unavailable WebGL preserves location inventory, search and ordinary detail workflows', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (
          contextId === 'webgl' ||
          contextId === 'webgl2' ||
          contextId === 'experimental-webgl'
        )
          return null;
        return Reflect.apply(getContext, this, [contextId, ...args]);
      },
    });
  });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  await selected(page, 'ITC-S1A');
  const show = page.getByRole('button', { name: 'Show room', exact: true });
  if (await show.isVisible()) await show.click();
  await expect(
    page
      .getByTestId('room-viewer')
      .getByRole('heading', { name: 'Room view unavailable' }),
  ).toBeVisible({ timeout: 20_000 });
  await chooseRoomLocation(page, 'ITC-D01');
  await selected(page, 'ITC-D01');
  await page
    .getByRole('region', { name: 'Location inventory', exact: true })
    .getByRole('link', { name: inventoryName, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: inventoryName, exact: true }),
  ).toBeVisible();
  await page.goto('/inventory?q=' + encodeURIComponent(inventoryName));
  await expect(
    page.getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole('link', { name: 'Show ITC-S1A in room', exact: true })
    .click();
  await selected(page, 'ITC-S1A');
  await expect(
    page
      .getByRole('region', { name: 'Location inventory', exact: true })
      .getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(1);
});

test('real emulated touch tap remains selectable through normal pointerup and implicit capture release', async ({
  page,
}) => {
  await observeRoomScene(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto('/room?space=it-closet');
  const viewer = await ready(page),
    canvas = viewer.locator('canvas');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  await page.evaluate(() => {
    const events: string[] = [];
    Reflect.set(window, 'roomTapEvents', events);
    for (const type of [
      'pointerdown',
      'pointerup',
      'lostpointercapture',
      'click',
    ])
      document.addEventListener(
        type,
        (event) => {
          if (event.target instanceof HTMLCanvasElement) events.push(type);
        },
        { capture: true },
      );
  });
  let previous: string | null = null;
  for (const active of [false, true]) {
    await page.getByRole('button', { name: 'Fit room', exact: true }).click();
    if (active) await activateMap(page);
    await canvas.scrollIntoViewIfNeeded();
    await settledLabels(page);
    const witnesses = roomVisibilityWitnesses(await captureRoomWitness(page));
    const uncovered = await uncoveredRoomWitnesses(page, witnesses);
    const target = [...uncovered].find(([code]) => code !== previous);
    expect(
      target,
      'independently witnessed exposed mesh for a new touch selection',
    ).toBeTruthy();
    const [code, point] = target!;
    // The recorder closes over its array; clear it in place instead.
    await page.evaluate(() => {
      const events = Reflect.get(window, 'roomTapEvents') as string[];
      events.length = 0;
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id: 0 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await selected(page, code);
    previous = code;
    const events = await page.evaluate(
      () => Reflect.get(window, 'roomTapEvents') as string[],
    );
    expect(events.indexOf('pointerdown')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('pointerup')).toBeGreaterThan(
      events.indexOf('pointerdown'),
    );
    expect(events.indexOf('lostpointercapture')).toBeGreaterThan(
      events.indexOf('pointerup'),
    );
    expect(events.indexOf('click')).toBeGreaterThan(
      events.indexOf('lostpointercapture'),
    );
  }
  await cdp.detach();
});

test('initial Fit waits for viewport and later resize preserves deliberate camera intent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto('/room?space=it-closet');
  await ready(page);
  await settledLabels(page);
  expectFramed(await camera(page), 'ITC');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const intent = await camera(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await settledLabels(page);
  const resized = await camera(page);
  near(resized.target, intent.target);
  near(resized.position, intent.position);
  expect(resized.zoom).toBeCloseTo(intent.zoom, 6);
});

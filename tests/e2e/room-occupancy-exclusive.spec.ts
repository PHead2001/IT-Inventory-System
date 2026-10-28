import { expect, test, type Page, type Response } from '@playwright/test';
import type { RoomOccupancy } from '../../src/features/room/occupancy-contract';
import { occupancyText } from '../../src/features/room/occupancy-contract';
import { roomSelectionOccupancy } from './room-occupancy-snapshot';
import { measureRoomTarget, roomTargetMeetsMinimum } from './room-target-size';
import {
  enableRoomLayoutDiagnostics,
  reportRoomLayoutFailure,
  type RoomLayoutWitnessStage,
  type RoomPointerAttempt,
} from './room-layout-diagnostics';
import { type RoomAssertionId } from './room-failure-metadata';
import {
  captureRoomAssertionState,
  reportRoomAssertionFailure,
} from './room-assertion-diagnostics';
import {
  uncoveredRoomClickWitnesses,
  roomClickOutsideRest,
} from './room-click-witness';
import {
  observeRoomScene,
  captureRoomWitness,
  captureRoomReveal,
  captureRoomSelectionWitness,
  roomVisibilityWitnesses,
  roomVisibilityWitnessReport,
  uncoveredRoomWitnesses,
  type WitnessSnapshot,
} from './room-visibility-witness';
import { registerRoomTestSupport } from './room-test-support';

const {
  bindingBounds,
  login,
  chooseMapMode,
  setRoomLabels,
  selected,
  settledLabels,
  ready,
  roomProgressByTest,
  markRoomProgress,
  markRoomAssertion,
  trackRoomPage,
  keyboardRoomLocation,
  settledReveal,
  camera,
  near,
} = registerRoomTestSupport();

test('spatial reveal endpoints retain actual picking and labels across oblique, overhead, underside and panned views', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  trackRoomPage(testInfo, page);
  await enableRoomLayoutDiagnostics(page);
  const assertion = (id: RoomAssertionId) => markRoomAssertion(testInfo, id);
  markRoomProgress(testInfo, {
    journey: 'spatial-reveal',
    stage: 'room setup',
  });
  const occupancyResponses = new Map<
    string,
    Promise<{ requestUrl: string; response: unknown } | null>
  >();
  let occupancyCaptureOverflow = false;
  const captureOccupancy = (response: Response) => {
    const url = new URL(response.url());
    if (
      !response.ok() ||
      url.origin !== new URL(page.url()).origin ||
      url.pathname !== '/api/room/occupancy' ||
      url.searchParams.get('space') !== 'it-closet'
    )
      return;
    const generation = url.searchParams.get('generation');
    if (!generation) return;
    if (occupancyResponses.size >= 128) {
      occupancyCaptureOverflow = true;
      return;
    }
    occupancyResponses.set(
      generation,
      response
        .json()
        .then((payload: unknown) => ({
          requestUrl: response.request().url(),
          response: payload,
        }))
        .catch(() => null),
    );
  };
  page.on('response', captureOccupancy);
  await observeRoomScene(page);
  await enableRoomLayoutDiagnostics(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  await page.goto('/room?space=it-closet');
  const viewer = await ready(page),
    canvas = viewer.locator('canvas');
  await chooseMapMode(page, 'Free Orbit');
  const outsideRest = new Set<string>();
  const exercised = new Set<string>();
  let occupancyGeneration: string | null = null;
  const expectations: Record<string, { id: string; offset: number[] }> = {
    'ITC-D01': { id: 'drawer-1', offset: [5.6, 0, 0] },
    'ITC-D07': { id: 'drawer-7', offset: [-5.6, 0, 0] },
    'ITC-RED': { id: 'red-container', offset: [4, 0, 0] },
    'ITC-BLACK': { id: 'black-container', offset: [-4, 0, 0] },
    'ITC-CLEAR': { id: 'clear-container', offset: [-4, 0, 0] },
    'ITC-S1A': { id: 'shelf-1a', offset: [0, 1, 0] },
    'ITC-RACK': { id: 'server-rack', offset: [0, 0, 0] },
  };
  for (const pose of ['oblique', 'overhead', 'underside', 'panned'] as const) {
    markRoomProgress(testInfo, {
      journey: 'spatial-reveal',
      stage: 'set camera pose',
      pose,
    });
    if (pose !== 'oblique') {
      await page
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      const command =
        pose === 'panned'
          ? 'Pan right'
          : pose === 'overhead'
            ? 'Tilt up'
            : 'Tilt down';
      const count = pose === 'panned' ? 2 : pose === 'overhead' ? 4 : 11;
      for (let index = 0; index < count; index++)
        await page.getByRole('button', { name: command, exact: true }).click();
      await page
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
    }
    for (const [code, expected] of Object.entries(expectations)) {
      markRoomProgress(testInfo, {
        journey: 'spatial-reveal',
        stage: 'select target and receive occupancy',
        pose,
        code,
      });
      await keyboardRoomLocation(page, code);
      await expect(viewer).toHaveAttribute('data-selected-code', code);
      markRoomProgress(testInfo, {
        journey: 'spatial-reveal',
        stage: 'settle reveal and inspect presentation',
        pose,
        code,
      });
      await settledReveal(page, code, assertion);
      const presentation = await captureRoomReveal(page);
      assertion('selected-offset');
      near(presentation.offsets[expected.id], expected.offset);
      for (const [id, offset] of Object.entries(presentation.offsets))
        if (id !== expected.id) {
          assertion('unselected-offset');
          near(offset, [0, 0, 0]);
        }
      const snapshot = await captureRoomWitness(page);
      const physical = roomVisibilityWitnesses(snapshot);
      const points = physical.get(code) ?? [];
      // This assertion records camera poses with a physically exposed selected face.
      if (!points.length) continue;
      exercised.add(code);
      const witnesses = await uncoveredRoomClickWitnesses(
        page,
        snapshot,
        await captureRoomSelectionWitness(page),
        physical,
        {
          code,
          report: (diagnostics) => {
            const progress = roomProgressByTest.get(testInfo);
            if (progress) progress.clickWitness = diagnostics;
          },
        },
      );
      const clickWitness = roomProgressByTest.get(testInfo)?.clickWitness;
      // A focus/pageshow recheck can issue a valid unrelated same-space request.
      // Use only the successful generation adopted by this selected render.
      let acceptedGeneration: string | null = null;
      await expect
        .poll(async () => {
          const accepted = await viewer.evaluate((host) => ({
            code: host.dataset.selectedCode,
            status: host.dataset.occupancyStatus,
            generation: host.dataset.occupancyGeneration,
          }));
          acceptedGeneration =
            accepted.code === code &&
            accepted.status === 'ready' &&
            accepted.generation &&
            accepted.generation !== occupancyGeneration
              ? accepted.generation
              : null;
          return acceptedGeneration;
        })
        .toMatch(/^[0-9a-f-]{36}$/);
      expect(
        occupancyCaptureOverflow,
        'bounded occupancy response capture',
      ).toBe(false);
      const adoptedResponse = occupancyResponses.get(acceptedGeneration!);
      expect(
        adoptedResponse,
        'response for the adopted render generation',
      ).toBeDefined();
      const adopted = await adoptedResponse!;
      expect(adopted, 'readable adopted occupancy response').not.toBeNull();
      const occupancy = roomSelectionOccupancy({
        ...adopted!,
        origin: new URL(page.url()).origin,
        spaceId: 'it-closet',
        code,
        acceptedGeneration: acceptedGeneration!,
        previousGeneration: occupancyGeneration,
      });
      occupancyGeneration = occupancy.generation;
      markRoomProgress(testInfo, {
        journey: 'spatial-reveal',
        stage: 'verify label and complete pointer pick',
        pose,
        code,
        occupancyExpected: occupancy.counts,
        clickWitness,
      });
      assertion('occupancy-snapshot');
      expect(
        occupancy.counts,
        `actual scoped occupancy snapshot for ${code}`,
      ).toBeTruthy();
      assertion('occupancy-label');
      await expect(
        viewer.locator(`[data-room-label-code="${code}"]`),
      ).toHaveAttribute(
        'aria-label',
        new RegExp(
          occupancyText(occupancy.counts, true).replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
          ),
        ),
      );
      await expect(viewer).toHaveAttribute('data-occupancy-status', 'ready');
      await expect(viewer).toHaveAttribute(
        'data-occupancy-generation',
        occupancy.generation,
      );
      assertion('label-visible');
      try {
        await expect(
          viewer.locator(
            `[data-room-label-code="${code}"][data-label-suppressed="false"]`,
          ),
        ).toBeVisible();
      } catch (error) {
        if (code === 'ITC-RACK')
          reportRoomAssertionFailure('selected-rack-label', code, {
            state: await captureRoomAssertionState(page, code),
          });
        throw error;
      }
      const first = witnesses.get(code)?.[0];
      assertion('click-witness');
      expect(first, `uncovered selected face at ${pose}: ${code}`).toBeTruthy();
      let point = first!.client;
      const resting = bindingBounds.find(
        (binding) => binding.code === code && binding.primary,
      );
      assertion('primary-binding');
      expect(resting, `primary room geometry for ${code}`).toBeTruthy();
      for (const candidate of witnesses.get(code) ?? []) {
        if (!roomClickOutsideRest(snapshot, candidate, resting!.bounds))
          continue;
        outsideRest.add(code);
        point = candidate.client;
        break;
      }
      await page.mouse.move(point.x, point.y);
      assertion('hover-owner');
      await expect(canvas).toHaveAttribute('data-hover-visible-code', code);
      const beforePick = await canvas.getAttribute('data-spatial-request');
      await page.mouse.click(point.x, point.y);
      assertion('selected-code');
      await expect(viewer).toHaveAttribute('data-selected-code', code);
      assertion('pick-request');
      await expect(canvas).not.toHaveAttribute(
        'data-spatial-request',
        beforePick!,
      );
      await settledReveal(page, code, assertion);
      await testInfo.attach(`reveal-${pose}-${code}`, {
        body: await viewer.screenshot(),
        contentType: 'image/png',
      });
    }
    markRoomProgress(testInfo, {
      journey: 'spatial-reveal',
      stage: 'select aggregate location and verify resting offsets',
      pose,
      code: 'ITC-L',
    });
    await keyboardRoomLocation(page, 'ITC-L');
    await settledReveal(page, 'ITC-L', assertion);
    for (const offset of Object.values(
      (await captureRoomReveal(page)).offsets,
    )) {
      assertion('aggregate-offset');
      near(offset, [0, 0, 0]);
    }
    assertion('aggregate-count-badge');
    expect(
      await viewer
        .locator('[data-room-label-code="ITC-L"] [class*="countBadge"]')
        .count(),
    ).toBe(0);
  }
  markRoomProgress(testInfo, {
    journey: 'spatial-reveal',
    stage: 'verify cross-pose selection coverage',
    pose: 'panned',
    code: 'ITC-L',
  });
  assertion('drawer-outside-rest');
  expect(
    outsideRest.has('ITC-D01') || outsideRest.has('ITC-D07'),
    'a moved drawer face outside resting bindings remains selectable',
  ).toBe(true);
  assertion('presentation-coverage');
  expect(
    [...exercised].sort(),
    'every modeled presentation kind gets actual pointer proof in an exposed pose',
  ).toEqual(Object.keys(expectations).sort());
  assertion('container-outside-rest');
  expect(
    [...outsideRest].some((code) => /RED|BLACK|CLEAR/.test(code)),
    'a moved container face outside resting bindings remains selectable',
  ).toBe(true);
});

test('optional room counts reconcile with active leaf contents and refresh as uncached snapshots', async ({
  page,
}) => {
  await login(page);
  await page.goto('/room?space=it-closet&location=ITC-D01');
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer.locator('canvas')).toBeVisible();
  await page
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const toggle = page.getByRole('button', {
    name: 'Show item counts',
    exact: true,
  });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const snapshot = page.waitForResponse(
    (response) =>
      response.url().includes('/api/room/occupancy?') &&
      response.status() === 200,
  );
  await toggle.click();
  const countsResponse = await snapshot;
  expect(countsResponse.headers()['cache-control']).toBe('private, no-store');
  const counts = await countsResponse.json();
  expect(counts.counts['ITC-D01'].quantity_product_count).toMatch(
    /^[1-9][0-9]*$/,
  );
  await page
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await selected(page, 'ITC-D01');
  const badgeLabel = viewer.locator('[data-room-label-code="ITC-D01"]');
  await expect(badgeLabel).toBeVisible();
  await expect(badgeLabel).toContainText(
    BigInt(counts.counts['ITC-D01'].quantity_unit_count).toLocaleString(
      'en-US',
    ) + ' units',
  );
  await expect(badgeLabel).toHaveAccessibleName(/products?.*units?/);
  const contents = await page.request.get(
    '/api/room/contents?space=it-closet&location=ITC-D01',
  );
  expect(contents.ok()).toBe(true);
  expect(
    String(
      BigInt(counts.counts['ITC-D01'].quantity_product_count) +
        BigInt(counts.counts['ITC-D01'].asset_count),
    ),
  ).toBe(String((await contents.json()).result.total));
  const countsExplanation = page.getByRole('status').filter({
    hasText:
      'Counts show quantity items with stock and active individual assets at each storage location.',
  });
  await expect(countsExplanation).toBeVisible();
  await expect(countsExplanation).toContainText(/counts are a snapshot/);
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes('/api/room/occupancy?') &&
      response.status() === 200,
  );
  const refreshedContents = page.waitForResponse(
    (response) =>
      response.url().includes('/api/room/contents?') &&
      response.status() === 200,
  );
  await page
    .getByRole('button', { name: 'Refresh inventory', exact: true })
    .click();
  await refreshed;
  await refreshedContents;
  await page
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(countsExplanation).toHaveCount(0);
  await expect(page.getByText(/counts are a snapshot/)).toHaveCount(0);
});

async function assertOccupiedWitnessActions(
  page: Page,
  scene: WitnessSnapshot,
  counts: RoomOccupancy,
  witnesses = roomVisibilityWitnesses(scene),
  onWitness?: (attempt: RoomPointerAttempt) => void,
) {
  expect(
    witnesses.size,
    'independent actual opaque triangles expose storage',
  ).toBeGreaterThan(0);
  const viewer = page.getByTestId('room-viewer');
  const boxes = [];
  for (const code of witnesses.keys()) {
    onWitness?.({
      expectedCode: code,
      point: witnesses.get(code)![0],
      candidates: witnesses.get(code)!,
    });
    expect(
      counts[code],
      'authorized occupied leaf snapshot for ' + code,
    ).toBeDefined();
    expect(BigInt(counts[code].quantity_unit_count)).toBeGreaterThan(0n);
    const action = viewer.locator('[data-room-label-code="' + code + '"]');
    await expect(
      action,
      'every independently witnessed target has one action: ' + code,
    ).toHaveCount(1);
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute('tabindex', '0');
    await expect(action).not.toHaveAttribute('aria-hidden', 'true');
    await expect(action).toHaveAccessibleName(
      new RegExp(
        BigInt(counts[code].quantity_product_count).toLocaleString('en-US') +
          ' products? / ' +
          BigInt(counts[code].quantity_unit_count).toLocaleString('en-US') +
          ' units?',
      ),
    );
    if (counts[code].asset_count !== '0')
      await expect(action).toHaveAccessibleName(
        new RegExp(
          BigInt(counts[code].asset_count).toLocaleString('en-US') + ' assets?',
        ),
      );
    const box = await action.boundingBox();
    expect(box).toBeTruthy();
    const targetSize = await action.evaluate(measureRoomTarget);
    expect(roomTargetMeetsMinimum(targetSize), JSON.stringify(targetSize)).toBe(
      true,
    );
    expect(box!.x).toBeGreaterThanOrEqual(scene.frame.x);
    expect(box!.y).toBeGreaterThanOrEqual(scene.frame.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      scene.frame.x + scene.frame.width,
    );
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      scene.frame.y + scene.frame.height,
    );
    for (const mask of scene.masks)
      expect(
        box!.x >= mask.right ||
          box!.x + box!.width <= mask.left ||
          box!.y >= mask.bottom ||
          box!.y + box!.height <= mask.top,
      ).toBe(true);
    boxes.push(box!);
  }
  for (const [index, box] of boxes.entries())
    for (const other of boxes.slice(index + 1))
      expect(
        box.x >= other.x + other.width ||
          box.x + box.width <= other.x ||
          box.y >= other.y + other.height ||
          box.y + box.height <= other.y,
      ).toBe(true);
  await expect(
    page.getByRole('list', { name: 'Locations with unavailable room labels' }),
  ).toHaveCount(0);
  return witnesses;
}

async function assertOccupiedWitnessActionsWithDiagnostics(
  page: Page,
  scene: WitnessSnapshot,
  counts: RoomOccupancy,
  stage: RoomLayoutWitnessStage,
  witnesses = roomVisibilityWitnesses(scene),
) {
  let target: RoomPointerAttempt | undefined;
  try {
    const result = await assertOccupiedWitnessActions(
      page,
      scene,
      counts,
      witnesses,
      (attempt) => {
        target = attempt;
      },
    );
    await reportRoomLayoutFailure(
      page,
      bindingBounds.map((binding) => binding.code),
      stage,
      'measurement',
    );
    return result;
  } catch (error) {
    await reportRoomLayoutFailure(
      page,
      bindingBounds.map((binding) => binding.code),
      stage,
      'failure',
      target,
    );
    throw error;
  }
}

/** Keep the independently chosen code while refreshing real DOM coverage.
 * Hover can repack neighboring controls after the previous journey. */
async function currentUncoveredRoomPoint(
  page: Page,
  attempt: RoomPointerAttempt,
) {
  for (let capture = 0; capture < 2; capture++) {
    const current = await uncoveredRoomWitnesses(
      page,
      new Map([[attempt.expectedCode, attempt.candidates]]),
    );
    const point = current.get(attempt.expectedCode);
    if (point) {
      attempt.point = point;
      return point;
    }
    if (capture === 0) {
      await page.mouse.move(15, 15);
      await settledLabels(page);
      const fresh = roomVisibilityWitnesses(await captureRoomWitness(page));
      attempt.candidates = fresh.get(attempt.expectedCode) ?? [];
      if (attempt.candidates[0]) attempt.point = attempt.candidates[0];
    }
  }
  throw new Error(
    'Independent target has no currently uncovered canvas sample: ' +
      attempt.expectedCode,
  );
}

test('375px populated room gives every independently witnessed opaque target an action with More and selected long text', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await enableRoomLayoutDiagnostics(page);
  await observeRoomScene(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto('/room?space=it-closet');
  const viewer = await ready(page),
    canvas = viewer.locator('canvas');
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  const assertMoreOutsideCanvasWhenAboveFits = async () => {
    const panel = page.getByRole('region', {
      name: 'More map controls',
      exact: true,
    });
    // Scroll/resize schedules popup placement on rAF. Read every rectangle and
    // the resulting placement together on each retry, never reuse a below-menu
    // rectangle captured before awaiting the later "above" attribute.
    await expect
      .poll(() =>
        panel.evaluate((element) => {
          const surface = element.closest('[data-room-surface]');
          const bar = surface
            ?.querySelector('[role="toolbar"]')
            ?.getBoundingClientRect();
          const frame = surface
            ?.querySelector('canvas')
            ?.getBoundingClientRect();
          if (!bar || !frame) return false;
          const popup = element.getBoundingClientRect();
          const top = window.visualViewport?.offsetTop ?? 0;
          const fullHeight = Math.min(
            parseFloat(
              getComputedStyle(element).getPropertyValue('--room-menu-height'),
            ) || 200,
            (window.visualViewport?.height ?? window.innerHeight) * 0.35,
            element.scrollHeight + 2,
          );
          return (
            bar.top - top - 9 < fullHeight ||
            (element.getAttribute('data-placement') === 'above' &&
              popup.top >= top + 4 &&
              popup.bottom <= bar.top - 5 &&
              popup.bottom <= frame.top)
          );
        }),
      )
      .toBe(true);
  };
  await more.click();
  await assertMoreOutsideCanvasWhenAboveFits();
  const initialSnapshot = page.waitForResponse(
    (response) =>
      response.url().includes('/api/room/occupancy?') && response.ok(),
  );
  await page
    .getByRole('button', { name: 'Show item counts', exact: true })
    .click();
  let counts: RoomOccupancy = (await (await initialSnapshot).json()).counts;
  expect(Object.keys(counts)).toHaveLength(28);
  for (const value of Object.values(counts))
    expect(BigInt(value.quantity_unit_count)).toBeGreaterThan(0n);
  await more.click();
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  // Page scrolling flips More across the canvas without moving the camera.
  // Its old opaque mask must not keep independently visible actions hidden.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await more.click();
  await settledLabels(page);
  const menu = page.getByRole('region', {
    name: 'More map controls',
    exact: true,
  });
  const scrollFrame = await canvas.boundingBox();
  expect(scrollFrame).not.toBeNull();
  await page.mouse.move(5, 800);
  await page.mouse.wheel(0, scrollFrame!.y - 149);
  await expect
    .poll(async () => Math.abs((await canvas.boundingBox())!.y - 149))
    .toBeLessThan(5);
  await expect(menu).toHaveAttribute('data-placement', 'below');
  await settledLabels(page);
  const coveredScene = await captureRoomWitness(page);
  const coveredWitnesses = await assertOccupiedWitnessActionsWithDiagnostics(
    page,
    coveredScene,
    counts,
    'scroll-more-overlapping-canvas',
  );
  const unchangedCamera = await camera(page);
  const scrollRevision = Number(
    await canvas.getAttribute('data-label-layout-revision'),
  );
  await page.mouse.wheel(0, -250);
  await expect(menu).toHaveAttribute('data-placement', 'above');
  await assertMoreOutsideCanvasWhenAboveFits();
  await settledLabels(page, scrollRevision);
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const restoredCamera = await camera(page);
  near(restoredCamera.position, unchangedCamera.position);
  near(restoredCamera.target, unchangedCamera.target);
  expect(restoredCamera.zoom).toBeCloseTo(unchangedCamera.zoom, 5);
  const uncoveredScene = await captureRoomWitness(page);
  const restoredWitnesses = await assertOccupiedWitnessActionsWithDiagnostics(
    page,
    uncoveredScene,
    counts,
    'scroll-more-outside-canvas-without-reopening',
  );
  expect(restoredWitnesses.size).toBeGreaterThan(coveredWitnesses.size);
  await more.click();
  await page.setViewportSize({ width: 375, height: 812 });
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  const initialSize = await canvas.boundingBox();
  let selectedCode: string | null = null;
  const partialCodes = new Set<string>();
  await page.evaluate(() => document.fonts.ready);
  for (const scenario of [
    'fit-closed',
    'fit-open',
    'oblique-open',
    'overhead-open',
    'underside-open',
  ] as const) {
    const requestedAfter = Number(
      await canvas.getAttribute('data-label-layout-revision'),
    );
    const open = scenario !== 'fit-closed';
    if (open && (await more.getAttribute('aria-expanded')) !== 'true')
      await more.click();
    if (scenario === 'oblique-open') {
      await page
        .getByRole('button', { name: 'Free Orbit', exact: true })
        .click();
      for (let step = 0; step < 3; step++)
        await page
          .getByRole('button', { name: 'Rotate right', exact: true })
          .click();
    } else if (scenario === 'overhead-open') {
      for (let step = 0; step < 5; step++)
        await page
          .getByRole('button', { name: 'Tilt up', exact: true })
          .click();
    } else if (scenario === 'underside-open') {
      for (let step = 0; step < 12; step++)
        await page
          .getByRole('button', { name: 'Tilt down', exact: true })
          .click();
    }
    // Return the internally scrolled popup to its anchor without moving camera.
    if (open)
      await page
        .getByRole('region', { name: 'More map controls', exact: true })
        .evaluate((element) => {
          element.scrollTop = 0;
        });
    await page.mouse.move(15, 15);
    await settledLabels(
      page,
      scenario === 'fit-closed' ? undefined : requestedAfter,
    );
    const response = page.waitForResponse(
      (result) => result.url().includes('/api/room/occupancy?') && result.ok(),
    );
    await page
      .getByRole('button', { name: 'Refresh inventory', exact: true })
      .click();
    counts = (await (await response).json()).counts;
    if (open && (await more.getAttribute('aria-expanded')) !== 'true')
      await more.click();
    await canvas.scrollIntoViewIfNeeded();
    await settledLabels(page);
    if (open) await assertMoreOutsideCanvasWhenAboveFits();
    const scene = await captureRoomWitness(page);
    expect(scene.frame.width).toBe(initialSize!.width);
    expect(scene.frame.height).toBe(initialSize!.height);
    const report = roomVisibilityWitnessReport(scene);
    report.partiallyExposedCodes.forEach((code) => partialCodes.add(code));
    const witnesses = await assertOccupiedWitnessActionsWithDiagnostics(
      page,
      scene,
      counts,
      scenario,
      report.witnesses,
    );
    await testInfo.attach(scenario + '-opaque-witnesses', {
      body: JSON.stringify({
        codeSamples: [...witnesses].map(([code, points]) => ({
          code,
          samples: points.length,
        })),
        triangleCount: scene.triangles.length,
        partiallyExposedCodes: report.partiallyExposedCodes,
        sampledRays: report.rays,
        method:
          'Actual committed R3F world triangles; bounded per-target raster/edge/face samples, not exhaustive pixel proof.',
      }),
      contentType: 'application/json',
    });
    const uncovered = await uncoveredRoomWitnesses(page, witnesses);
    expect(
      uncovered.size,
      'actual canvas journeys reach independently witnessed surfaces',
    ).toBeGreaterThan(0);
    for (const [code, originalPoint] of uncovered) {
      const attempt: RoomPointerAttempt = {
        expectedCode: code,
        point: originalPoint,
        candidates: witnesses.get(code)!,
      };
      try {
        const point = await currentUncoveredRoomPoint(page, attempt);
        await page.mouse.move(point.x, point.y);
        await expect(canvas).toHaveAttribute('data-hover-visible-code', code);
        // The expected code came from independent triangles, never this telemetry.
        await expect(
          viewer.locator('[data-room-label-code="' + code + '"]'),
        ).toBeVisible();
      } catch (error) {
        await reportRoomLayoutFailure(
          page,
          bindingBounds.map((binding) => binding.code),
          scenario,
          'failure',
          attempt,
        );
        throw error;
      }
    }
    await page.mouse.move(15, 15);
    await settledLabels(page);
    if (scenario === 'fit-open') {
      const [code, originalPoint] = [...uncovered][0];
      selectedCode = code;
      const attempt: RoomPointerAttempt = {
        expectedCode: code,
        point: originalPoint,
        candidates: witnesses.get(code)!,
      };
      try {
        const point = await currentUncoveredRoomPoint(page, attempt);
        await page.mouse.click(point.x, point.y);
        await selected(page, code);
      } catch (error) {
        await reportRoomLayoutFailure(
          page,
          bindingBounds.map((binding) => binding.code),
          scenario,
          'failure',
          attempt,
        );
        throw error;
      }
      await page.getByRole('button', { name: 'Fit room', exact: true }).click();
      if ((await more.getAttribute('aria-expanded')) !== 'true')
        await more.click();
      await canvas.scrollIntoViewIfNeeded();
      await settledLabels(page);
      await assertMoreOutsideCanvasWhenAboveFits();
      const selectedScene = await captureRoomWitness(page);
      const selectedWitnesses =
        await assertOccupiedWitnessActionsWithDiagnostics(
          page,
          selectedScene,
          counts,
          'fit-open-selected-before-long-text',
        );
      expect(
        selectedWitnesses.has(code),
        'selected target is independently witnessed after reopening More',
      ).toBe(true);
      const label = viewer.locator('[data-room-label-code="' + code + '"]');
      await expect(label).toBeVisible();
      await expect(label).toHaveAttribute('aria-pressed', 'true');
      await expect(label).toHaveAttribute('data-label-compact', 'false');
      await expect(label).toContainText('units');
      const full = label.locator('[data-room-label-full]');
      const original = await full.evaluate((element) => {
        const text = element.firstChild?.textContent ?? '';
        if (element.firstChild)
          element.firstChild.textContent =
            'Shared equipment drawer for replacement laptop adapters and carefully packed networking accessories';
        return text;
      });
      await settledLabels(page);
      // Same captured physical scene and overlay: text-only stress cannot remove
      // neighbors from the independently required visible set.
      await assertOccupiedWitnessActionsWithDiagnostics(
        page,
        selectedScene,
        counts,
        'fit-open-selected-long-text',
      );
      await expect(label).toBeVisible();
      await expect(label).toContainText(
        'carefully packed networking accessories',
      );
      await expect(label).toHaveAttribute('data-label-compact', 'false');
      await page.screenshot({
        path: testInfo.outputPath(
          '375-open-more-supplementary-long-label-stress.png',
        ),
      });
      await testInfo.attach('supplementary-long-label-stress', {
        body: 'Synthetic DOM name with actual live geometry; no canonical location rename. Required opaque witnesses remain unchanged. Component tests retain accessible names/counts; this is supplementary, not an authentic renamed-location or physical-phone proof.',
        contentType: 'text/plain',
      });
      await full.evaluate((element, text) => {
        if (element.firstChild) element.firstChild.textContent = text;
      }, original);
      await settledLabels(page);
      // A revealing primary action must remove the actual opaque popup before
      // focusing the selected geometry. Selection came from an actual canvas
      // pointer journey above, not injected selection or visibility state.
      const center = page.getByRole('button', {
        name: 'Center selected',
        exact: true,
      });
      const beforeFocus = Number(await viewer.getAttribute('data-focus-count'));
      const active = await canvas.getAttribute('data-map-active');
      await center.click();
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(
        page.getByRole('region', { name: 'More map controls', exact: true }),
      ).toHaveCount(0);
      await expect(center).toBeFocused();
      await expect(canvas).toHaveAttribute('data-map-active', active!);
      await expect(viewer).toHaveAttribute('data-selected-code', code);
      await expect(viewer).toHaveAttribute('data-focused-code', code);
      await expect(viewer).toHaveAttribute(
        'data-focus-count',
        String(beforeFocus + 1),
      );
      await canvas.scrollIntoViewIfNeeded();
      await settledLabels(page);
      const centeredScene = await captureRoomWitness(page);
      const centeredWitnesses = roomVisibilityWitnesses(centeredScene);
      expect(
        centeredWitnesses.has(code),
        'centered selected target has independently witnessed uncovered opaque geometry',
      ).toBe(true);
      await expect(label).toBeVisible();
      await expect(label).toHaveAttribute('aria-pressed', 'true');
      await expect(label).toHaveAttribute('data-label-compact', 'false');
      await expect(label.locator('[data-room-label-full]')).toBeVisible();
      const centeredUncovered = await uncoveredRoomWitnesses(
        page,
        centeredWitnesses,
      );
      const centeredPoint = centeredUncovered.get(code);
      if (centeredPoint) {
        await page.mouse.move(centeredPoint.x, centeredPoint.y);
        await expect(canvas).toHaveAttribute('data-hover-visible-code', code);
      }
      await testInfo.attach('center-selected-after-more', {
        body: JSON.stringify({
          code,
          independentlyWitnessed: centeredWitnesses.has(code),
          actualCanvasPointerJourney: !!centeredPoint,
          pointerLimit: centeredPoint
            ? null
            : 'No independently sampled selected pixel was uncovered in actual DOM hit-testing; real-pointer proof is unavailable for this pose.',
        }),
        contentType: 'application/json',
      });
      await page.screenshot({
        path: testInfo.outputPath('375-center-selected-dismissed-more.png'),
      });
      await page.mouse.move(15, 15);
      await more.click();
      const fit = page.getByRole('button', { name: 'Fit room', exact: true });
      await fit.click();
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(fit).toBeFocused();
      await expect(canvas).toHaveAttribute('data-map-active', active!);
      await expect(viewer).toHaveAttribute('data-selected-code', code);
      // Retain the existing next-pose/open-More capacity scenario.
      await more.click();
      await canvas.scrollIntoViewIfNeeded();
      await settledLabels(page);
    }
    if (selectedCode && witnesses.has(selectedCode)) {
      await expect(
        viewer.locator('[data-room-label-code="' + selectedCode + '"]'),
      ).toHaveAttribute('data-label-compact', 'false');
    }
    await page.screenshot({
      path: testInfo.outputPath('375-' + scenario + '.png'),
    });
  }
  expect(
    partialCodes.size,
    'actual opaque blockers leave partially exposed witnessed faces across the camera poses',
  ).toBeGreaterThan(0);

  // Keep the cold 375px scenarios above intact, then exercise the same mounted
  // room through the hosted failure's 375 -> 390 resize with ordinary controls.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await chooseMapMode(page, 'Guided');
  await setRoomLabels(page, true);
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  await page.mouse.move(15, 15);
  await settledLabels(page);
  expect((await camera(page)).elevation).toBeCloseTo((35 * Math.PI) / 180, 3);
  const red = viewer.locator('[data-room-label-code="ITC-RED"]');
  expect(
    roomVisibilityWitnesses(await captureRoomWitness(page)).has('ITC-RED'),
  ).toBe(true);
  await red.click();
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-RED');
  await expect(page).toHaveURL(/location=ITC-RED(?:&|$)/);
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await more.click();
  await canvas.scrollIntoViewIfNeeded();
  await page.mouse.move(15, 15);
  await settledLabels(page);
  await assertMoreOutsideCanvasWhenAboveFits();
  await assertOccupiedWitnessActions(
    page,
    await captureRoomWitness(page),
    counts,
  );

  const beforeResize = Number(
    await canvas.getAttribute('data-label-layout-revision'),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await settledLabels(page, beforeResize);
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await canvas.scrollIntoViewIfNeeded();
  await page.mouse.move(15, 15);
  await settledLabels(page);
  await assertMoreOutsideCanvasWhenAboveFits();
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-RED');
  await expect(red).toHaveAttribute('aria-pressed', 'true');
  await expect(red).toHaveAttribute('data-label-compact', 'false');
  expect(await canvas.getAttribute('data-label-layout-error')).toBeNull();
  const resizedScene = await captureRoomWitness(page);
  const resizedRequiredWitnesses = roomVisibilityWitnesses(resizedScene);
  expect(
    resizedRequiredWitnesses.has('ITC-S4C'),
    'the previously missing action is independently exposed after mounted resize',
  ).toBe(true);
  const resizedWitnesses = await assertOccupiedWitnessActions(
    page,
    resizedScene,
    counts,
    resizedRequiredWitnesses,
  );
  await testInfo.attach('390-after-mounted-resize-opaque-witnesses', {
    body: JSON.stringify({
      viewport: page.viewportSize(),
      frame: resizedScene.frame,
      codeSamples: [...resizedWitnesses].map(([code, points]) => ({
        code,
        samples: points.length,
      })),
      triangleCount: resizedScene.triangles.length,
      method:
        'Fresh actual committed R3F world triangles after mounted resize; bounded samples, not exhaustive pixel proof.',
    }),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: testInfo.outputPath('390-after-mounted-resize-selected-more.png'),
  });
  const resizedUncovered = await uncoveredRoomWitnesses(page, resizedWitnesses);
  const nextSelection = [...resizedUncovered].find(
    ([code]) => code !== 'ITC-RED',
  );
  expect(
    nextSelection,
    'resized room exposes an independently witnessed new pointer selection',
  ).toBeDefined();
  const [resizedCode, resizedPoint] = nextSelection!;
  await page.mouse.move(resizedPoint.x, resizedPoint.y);
  await expect(canvas).toHaveAttribute('data-hover-visible-code', resizedCode);
  await page.mouse.click(resizedPoint.x, resizedPoint.y);
  await expect(viewer).toHaveAttribute('data-selected-code', resizedCode);
  await expect(page).toHaveURL(
    new RegExp('location=' + resizedCode + '(?:&|$)'),
  );
  await expect(
    page
      .getByRole('region', { name: 'Location inventory', exact: true })
      .getByText(resizedCode, { exact: true }),
  ).toBeVisible();
  await page.mouse.move(15, 15);
  await settledLabels(page);
  expect(await canvas.getAttribute('data-label-layout-error')).toBeNull();
  expect(pageErrors).toEqual([]);
});

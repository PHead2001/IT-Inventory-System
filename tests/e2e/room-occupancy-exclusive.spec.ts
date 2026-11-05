import { expect, test, type Page, type Locator } from '@playwright/test';
import type { RoomOccupancy } from '../../src/features/room/occupancy-contract';
import { occupancyText } from '../../src/features/room/occupancy-contract';
import {
  roomSelectionOccupancy,
  observeRoomOccupancy,
  readCommittedRoomOccupancy,
  type RoomOccupancyCapture,
  type RoomOccupancyCommit,
} from './room-occupancy-snapshot';
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
  finishNativeRoomClick,
  observeNativeRoomClick,
  originalClickAgreement,
} from './room-native-click-observation';
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
import {
  registerRoomTestSupport,
  activateMap,
  uncoveredCanvasGesture,
} from './room-test-support';

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

async function committedRoomCounts(
  page: Page,
  viewer: Locator,
  capture: RoomOccupancyCapture,
  previousGeneration: string | null = null,
  code?: string,
) {
  return readCommittedRoomOccupancy({
    capture,
    origin: new URL(page.url()).origin,
    spaceId: 'it-closet',
    code,
    previousGeneration,
    readCommit: async () => {
      let commit!: RoomOccupancyCommit;
      await expect
        .poll(async () => {
          commit = await viewer.evaluate((host) => ({
            code: host.dataset.selectedCode ?? '',
            status: host.dataset.occupancyStatus ?? '',
            generation: host.dataset.occupancyGeneration ?? '',
          }));
          return commit.status === 'ready' &&
            commit.generation !== previousGeneration &&
            (code === undefined || commit.code === code)
            ? commit.generation
            : '';
        })
        .toMatch(/^[0-9a-f-]{36}$/);
      return commit;
    },
    observe: async () => undefined,
  });
}

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
  await observeRoomScene(page);
  await enableRoomLayoutDiagnostics(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  const occupancyCapture = observeRoomOccupancy(
    page,
    new URL(page.url()).origin,
    'it-closet',
  );
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
      const adopted = await occupancyCapture.read(acceptedGeneration!);
      const occupancy = roomSelectionOccupancy({
        ...adopted,
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
  const capture = observeRoomOccupancy(
    page,
    new URL(page.url()).origin,
    'it-closet',
  );
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
  await toggle.click();
  const counts = await committedRoomCounts(
    page,
    viewer,
    capture,
    null,
    'ITC-D01',
  );
  expect(counts.cacheControl).toBe('private, no-store');
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

  const refreshedContents = page.waitForResponse(
    (response) =>
      response.url().includes('/api/room/contents?') &&
      response.status() === 200,
  );
  await page
    .getByRole('button', { name: 'Refresh inventory', exact: true })
    .click();
  await committedRoomCounts(
    page,
    viewer,
    capture,
    counts.generation,
    'ITC-D01',
  );
  await refreshedContents;
  await page
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(countsExplanation).toHaveCount(0);
  await expect(page.getByText(/counts are a snapshot/)).toHaveCount(0);
});

async function assertOccupiedWitnessRepresentations(
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
    const action = viewer.locator(
      '[data-room-representation-code="' + code + '"]:visible',
    );
    await expect(
      action,
      'every independently witnessed occupied target has its own representation: ' +
        code,
    ).toHaveCount(1);
    await expect(action).toBeVisible();
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
    if ((await action.getAttribute('data-room-occupied-marker')) === 'true') {
      await expect(action).toHaveAttribute('role', 'img');
      await expect(action).not.toHaveAttribute('tabindex');
      expect(await action.evaluate((element) => element.tagName)).toBe('SPAN');
      // Transformed DOMRect edges can differ by a few millionths of a CSS px.
      // The authored badge remains exactly 24px; collision checks stay strict.
      expect(box!.width).toBeCloseTo(24, 3);
      expect(box!.height).toBeCloseTo(24, 3);
      expect(
        await action.evaluate((element) => {
          const style = getComputedStyle(element);
          return { width: style.width, height: style.height };
        }),
      ).toEqual({ width: '24px', height: '24px' });
      expect(
        await action.evaluate((element) => {
          const wrapper = element.closest('[data-room-passive-wrapper]');
          const rect = element.getBoundingClientRect();
          const top = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          const canvas = element
            .closest('[data-room-surface]')
            ?.querySelector('canvas');
          return (
            getComputedStyle(element).pointerEvents === 'none' &&
            !!wrapper &&
            getComputedStyle(wrapper).pointerEvents === 'none' &&
            top === canvas
          );
        }),
        'passive badge and wrapper leave actual canvas hit-testing available: ' +
          code,
      ).toBe(true);
    } else {
      await expect(action).toHaveAttribute('tabindex', '0');
      expect(await action.evaluate((element) => element.tagName)).toBe(
        'BUTTON',
      );
      const targetSize = await action.evaluate(measureRoomTarget);
      expect(
        roomTargetMeetsMinimum(targetSize),
        JSON.stringify(targetSize),
      ).toBe(true);
      if ((await action.getAttribute('aria-pressed')) === 'true') {
        await expect(action).toHaveAttribute('data-label-compact', 'false');
        if (await action.locator('[data-room-label-full]').count())
          await expect(action.locator('[data-room-label-full]')).toBeVisible();
        else
          expect((await action.innerText()).trim().length).toBeGreaterThan(0);
      }
    }
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
    expect(
      await action.evaluate((element) => {
        const own = element.getBoundingClientRect();
        return [
          ...element
            .closest('[data-room-surface]')!
            .querySelectorAll<HTMLElement>('[data-label-layout-id]'),
        ].every((other) => {
          if (
            other === element ||
            other.dataset.labelSuppressed === 'true' ||
            other.getClientRects().length === 0 ||
            getComputedStyle(other).visibility !== 'visible'
          )
            return true;
          const area = other.getBoundingClientRect();
          return (
            !area.width ||
            !area.height ||
            own.left >= area.right ||
            own.right <= area.left ||
            own.top >= area.bottom ||
            own.bottom <= area.top
          );
        });
      }),
      'occupied representation does not overlap any registered optional label: ' +
        code,
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

async function assertOccupiedWitnessRepresentationsWithDiagnostics(
  page: Page,
  scene: WitnessSnapshot,
  counts: RoomOccupancy,
  stage: RoomLayoutWitnessStage,
  witnesses = roomVisibilityWitnesses(scene),
) {
  let target: RoomPointerAttempt | undefined;
  try {
    const result = await assertOccupiedWitnessRepresentations(
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

test('375px populated room shows every occupied target with passive badges and selected readable text', async ({
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
  const occupancyCapture = observeRoomOccupancy(
    page,
    new URL(page.url()).origin,
    'it-closet',
  );
  await page.goto('/room?space=it-closet');
  const viewer = await ready(page),
    canvas = viewer.locator('canvas');
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  const assertMoreOutsideCanvas = async () => {
    const panel = page.getByRole('region', {
      name: 'More map controls',
      exact: true,
    });
    // Read placement and geometry together after each scheduled layout. Inline
    // stays latched across page scrolling and must occupy its own scrollable row.
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
          const css = getComputedStyle(element);
          const outsideCanvas = popup.bottom <= frame.top;
          const scrollable =
            ['auto', 'scroll'].includes(css.overflowY) &&
            element.clientHeight > 0 &&
            element.scrollHeight > element.clientHeight;
          if (
            !outsideCanvas ||
            !scrollable ||
            popup.left < bar.left ||
            popup.right > bar.right
          )
            return false;
          if (element.getAttribute('data-placement') === 'inline')
            return css.position === 'relative' && popup.top >= bar.bottom;
          const top = window.visualViewport?.offsetTop ?? 0;
          return (
            element.getAttribute('data-placement') === 'above' &&
            popup.top >= top + 4 &&
            popup.bottom <= bar.top - 5
          );
        }),
      )
      .toBe(true);
  };
  await more.click();
  await assertMoreOutsideCanvas();

  await page
    .getByRole('button', { name: 'Show item counts', exact: true })
    .click();
  let snapshot = await committedRoomCounts(page, viewer, occupancyCapture);
  let counts: RoomOccupancy = snapshot.counts;
  const assertCurrentGeneration = async () => {
    await expect(viewer).toHaveAttribute('data-occupancy-status', 'ready');
    await expect(viewer).toHaveAttribute(
      'data-occupancy-generation',
      snapshot.generation,
    );
  };
  const assertCurrentRepresentations = async (
    scene: WitnessSnapshot,
    stage: RoomLayoutWitnessStage,
    witnesses = roomVisibilityWitnesses(scene),
  ) => {
    await assertCurrentGeneration();
    const result = await assertOccupiedWitnessRepresentationsWithDiagnostics(
      page,
      scene,
      counts,
      stage,
      witnesses,
    );
    await assertCurrentGeneration();
    return result;
  };
  expect(Object.keys(counts)).toHaveLength(28);
  for (const value of Object.values(counts))
    expect(BigInt(value.quantity_unit_count)).toBeGreaterThan(0n);
  await more.click();
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  // The narrow More panel moves into page flow when above cannot fit. Native
  // page scrolling must preserve its latch, the camera and every required label.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await more.click();
  await settledLabels(page);
  const menu = page.getByRole('region', {
    name: 'More map controls',
    exact: true,
  });
  await menu.hover();
  const controlsScroll = await menu.evaluate((element) => element.scrollTop);
  const controlsCamera = await camera(page);
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => menu.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(controlsScroll);
  await page.mouse.wheel(0, -160);
  await expect
    .poll(() => menu.evaluate((element) => element.scrollTop))
    .toBe(controlsScroll);
  const controlsCameraAfter = await camera(page);
  near(controlsCameraAfter.position, controlsCamera.position);
  near(controlsCameraAfter.target, controlsCamera.target);
  expect(controlsCameraAfter.zoom).toBeCloseTo(controlsCamera.zoom, 6);
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  await assertMoreOutsideCanvas();
  const scrollFrame = await canvas.boundingBox();
  expect(scrollFrame).not.toBeNull();
  const scrollBadge = viewer
    .locator('[data-room-occupied-marker]:visible')
    .first();
  const scrollBadgeBox = await scrollBadge.boundingBox();
  expect(scrollBadgeBox).not.toBeNull();
  const beforePassiveWheel = await camera(page);
  const selectionBeforeScroll = await viewer.getAttribute('data-selected-code');
  const pageScrollBefore = await page.evaluate(() => scrollY);
  const scrollPoint = { x: scrollBadgeBox!.x + 12, y: scrollBadgeBox!.y + 12 };
  await page.mouse.move(scrollPoint.x, scrollPoint.y);
  // Await installation before input. Passive map policy stops wheel listeners
  // on the canvas itself; document capture observes its actual native target.
  const trustedPassiveWheel = await scrollBadge.evaluateHandle(
    (badge, point) => {
      const canvas = badge
        .closest('[data-room-surface]')
        ?.querySelector('canvas');
      const wrapper = badge.closest('[data-room-passive-wrapper]');
      const rect = badge.getBoundingClientRect();
      const document = badge.ownerDocument;
      if (
        !canvas ||
        !wrapper ||
        point.x < rect.left ||
        point.x >= rect.right ||
        point.y < rect.top ||
        point.y >= rect.bottom ||
        getComputedStyle(badge).pointerEvents !== 'none' ||
        getComputedStyle(wrapper).pointerEvents !== 'none' ||
        document.elementFromPoint(point.x, point.y) !== canvas
      )
        throw new Error(
          'Passive wheel point must be inside the live badge and hit its canvas',
        );
      let cancel: () => void = () => undefined;
      const result = new Promise<boolean>((resolve) => {
        const receive = (event: WheelEvent) =>
          finish(event.isTrusted && event.target === canvas);
        const stop = window.setTimeout(() => finish(false), 3000);
        function finish(value: boolean) {
          clearTimeout(stop);
          document.removeEventListener('wheel', receive, true);
          resolve(value);
        }
        cancel = () => finish(false);
        document.addEventListener('wheel', receive, {
          capture: true,
          passive: true,
        });
      });
      return { result, cancel };
    },
    scrollPoint,
  );
  try {
    await page.mouse.wheel(0, Math.max(200, scrollFrame!.y));
    expect(
      await trustedPassiveWheel.evaluate((observation) => observation.result),
      'a trusted wheel over the passive badge reaches the canvas',
    ).toBe(true);
  } finally {
    try {
      await trustedPassiveWheel.evaluate((observation) => observation.cancel());
    } finally {
      await trustedPassiveWheel.dispose();
    }
  }
  const afterPassiveWheel = await camera(page);
  near(afterPassiveWheel.position, beforePassiveWheel.position);
  near(afterPassiveWheel.target, beforePassiveWheel.target);
  expect(afterPassiveWheel.zoom).toBeCloseTo(beforePassiveWheel.zoom, 6);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(pageScrollBefore);
  await expect(menu).toHaveAttribute('data-placement', 'inline');
  await assertMoreOutsideCanvas();
  await settledLabels(page);
  const scrolledFrame = await canvas.boundingBox();
  expect(scrolledFrame!.width).toBe(scrollFrame!.width);
  expect(scrolledFrame!.height).toBe(scrollFrame!.height);
  await expect(viewer).toHaveAttribute(
    'data-selected-code',
    selectionBeforeScroll!,
  );
  await assertCurrentRepresentations(
    await captureRoomWitness(page),
    'scroll-more-outside-canvas-without-reopening',
  );
  const pageScrollAfter = await page.evaluate(() => scrollY);
  const returnPoint = await uncoveredCanvasGesture(page, 0, 0);
  await page.mouse.move(returnPoint.x, returnPoint.y);
  await page.mouse.wheel(0, -250);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeLessThan(pageScrollAfter);
  await expect(menu).toHaveAttribute('data-placement', 'inline');
  await assertMoreOutsideCanvas();
  await settledLabels(page);
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const restoredCamera = await camera(page);
  near(restoredCamera.position, beforePassiveWheel.position);
  near(restoredCamera.target, beforePassiveWheel.target);
  expect(restoredCamera.zoom).toBeCloseTo(beforePassiveWheel.zoom, 6);
  const restoredFrame = await canvas.boundingBox();
  expect(restoredFrame!.width).toBe(scrollFrame!.width);
  expect(restoredFrame!.height).toBe(scrollFrame!.height);
  await expect(viewer).toHaveAttribute(
    'data-selected-code',
    selectionBeforeScroll!,
  );
  await assertCurrentRepresentations(
    await captureRoomWitness(page),
    'scroll-more-outside-canvas-without-reopening',
  );
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

    await page
      .getByRole('button', { name: 'Refresh inventory', exact: true })
      .click();
    snapshot = await committedRoomCounts(
      page,
      viewer,
      occupancyCapture,
      snapshot.generation,
    );
    counts = snapshot.counts;
    if (open && (await more.getAttribute('aria-expanded')) !== 'true')
      await more.click();
    await canvas.scrollIntoViewIfNeeded();
    await settledLabels(page);
    if (open) await assertMoreOutsideCanvas();
    const scene = await captureRoomWitness(page);
    expect(scene.frame.width).toBe(initialSize!.width);
    expect(scene.frame.height).toBe(initialSize!.height);
    const report = roomVisibilityWitnessReport(scene);
    report.partiallyExposedCodes.forEach((code) => partialCodes.add(code));
    const witnesses = await assertCurrentRepresentations(
      scene,
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
          viewer.locator(
            '[data-room-representation-code="' + code + '"]:visible',
          ),
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
      await assertMoreOutsideCanvas();
      // Navigation may finish its privacy verification during the map actions.
      // Bind the adopted body only after those actions, then freeze this judgment.
      snapshot = await committedRoomCounts(
        page,
        viewer,
        occupancyCapture,
        null,
        code,
      );
      counts = snapshot.counts;
      await settledLabels(page);
      await assertCurrentGeneration();
      const selectedScene = await captureRoomWitness(page);
      const selectedWitnesses = await assertCurrentRepresentations(
        selectedScene,
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
      await assertCurrentRepresentations(
        selectedScene,
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
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  await browser
    .getByRole('searchbox', { name: 'Browse locations' })
    .fill('ITC-RED');
  const redControl = browser.getByRole('button', { name: /ITC-RED$/ });
  expect(
    roomTargetMeetsMinimum(await redControl.evaluate(measureRoomTarget)),
  ).toBe(true);
  await redControl.focus();
  await redControl.press('Enter');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-RED');
  await expect(page).toHaveURL(/location=ITC-RED(?:&|$)/);
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await more.click();
  await canvas.scrollIntoViewIfNeeded();
  await page.mouse.move(15, 15);
  await settledLabels(page);
  await assertMoreOutsideCanvas();
  await expect(
    menu.getByRole('button', { name: 'Show labels', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    menu.getByRole('button', { name: 'Show item counts', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  snapshot = await committedRoomCounts(
    page,
    viewer,
    occupancyCapture,
    null,
    'ITC-RED',
  );
  counts = snapshot.counts;
  await settledLabels(page);
  await assertCurrentGeneration();
  await assertCurrentRepresentations(
    await captureRoomWitness(page),
    'selected-red-before-resize',
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
  await assertMoreOutsideCanvas();
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
  await assertCurrentGeneration();
  const resizedWitnesses = await assertOccupiedWitnessRepresentations(
    page,
    resizedScene,
    counts,
    resizedRequiredWitnesses,
  );
  await assertCurrentGeneration();
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
  const resizedSelection = await captureRoomSelectionWitness(page);
  const originalAgreement = originalClickAgreement(
    resizedScene,
    resizedSelection,
    resizedCode,
    resizedPoint,
  );
  const resizedClicks = await uncoveredRoomClickWitnesses(
    page,
    resizedScene,
    resizedSelection,
    // Preserve the original logical target. A different code is not a retry.
    new Map([[resizedCode, resizedWitnesses.get(resizedCode)!]]),
  );
  const resizedClick = resizedClicks.get(resizedCode)?.[0];
  await testInfo.attach('390-resized-original-native-agreement', {
    body: JSON.stringify({
      originalAgreement,
      nativeClick: resizedClick ?? null,
    }),
    contentType: 'application/json',
  });
  expect(
    resizedClick,
    'the original resized target has a visible native click with both ray owners',
  ).toBeDefined();
  await page.mouse.move(resizedClick!.client.x, resizedClick!.client.y);
  await expect(canvas).toHaveAttribute('data-hover-visible-code', resizedCode);
  const resizedObservation = await observeNativeRoomClick(page);
  try {
    // Exactly one native click. The panel remains open until application input
    // handling closes it; no diagnostic moves the camera or changes selection.
    await page.mouse.click(resizedClick!.client.x, resizedClick!.client.y);
    await expect(viewer).toHaveAttribute('data-selected-code', resizedCode);
    await expect(page).toHaveURL(
      new RegExp('location=' + resizedCode + '(?:&|$)'),
    );
    await expect(
      page
        .getByRole('region', { name: 'Location inventory', exact: true })
        .getByText(resizedCode, { exact: true }),
    ).toBeVisible();
  } finally {
    const phases = await finishNativeRoomClick(
      resizedObservation,
      resizedClick!,
    );
    const diagnostic = JSON.stringify({ originalAgreement, ...phases });
    console.log('ROOM_RESIZED_NATIVE_CLICK', diagnostic);
    await testInfo.attach('390-resized-native-click-phases', {
      body: diagnostic,
      contentType: 'application/json',
    });
  }
  await page.mouse.move(15, 15);
  await settledLabels(page);
  // A passive badge is also a valid start for a native canvas pan; it cannot
  // intercept the down event or activate a location of its own.
  await activateMap(page);
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  const panBadge = viewer
    .locator('[data-room-occupied-marker]:visible')
    .first();
  const panBox = await panBadge.boundingBox();
  expect(panBox).not.toBeNull();
  const panStart = { x: panBox!.x + 12, y: panBox!.y + 12 };
  expect(
    await canvas.evaluate(
      (element, point) =>
        document.elementFromPoint(point.x, point.y) === element,
      panStart,
    ),
  ).toBe(true);
  const beforeBadgePan = await camera(page);
  const selectedBeforeBadgePan =
    await viewer.getAttribute('data-selected-code');
  const focusBeforeBadgePan = await viewer.getAttribute('data-focus-count');
  await page.mouse.move(panStart.x, panStart.y);
  const trustedBadgeDown = await panBadge.evaluateHandle((badge, point) => {
    const canvas = badge
      .closest('[data-room-surface]')
      ?.querySelector('canvas');
    const rect = badge.getBoundingClientRect();
    const document = badge.ownerDocument;
    if (
      !canvas ||
      point.x < rect.left ||
      point.x >= rect.right ||
      point.y < rect.top ||
      point.y >= rect.bottom ||
      document.elementFromPoint(point.x, point.y) !== canvas
    )
      throw new Error(
        'Passive pan point must be inside the live badge and hit its canvas',
      );
    let cancel: () => void = () => undefined;
    const result = new Promise<boolean>((resolve) => {
      const receive = (event: PointerEvent) =>
        finish(event.isTrusted && event.target === canvas);
      const stop = window.setTimeout(() => finish(false), 3000);
      function finish(value: boolean) {
        clearTimeout(stop);
        document.removeEventListener('pointerdown', receive, true);
        resolve(value);
      }
      cancel = () => finish(false);
      document.addEventListener('pointerdown', receive, {
        capture: true,
        passive: true,
      });
    });
    return { result, cancel };
  }, panStart);
  try {
    await page.mouse.down({ button: 'right' });
    try {
      await page.mouse.move(
        panStart.x +
          (panStart.x < resizedScene.frame.x + resizedScene.frame.width / 2
            ? 24
            : -24),
        panStart.y,
        { steps: 8 },
      );
    } finally {
      await page.mouse.up({ button: 'right' });
    }
    expect(
      await trustedBadgeDown.evaluate((observation) => observation.result),
    ).toBe(true);
  } finally {
    try {
      await trustedBadgeDown.evaluate((observation) => observation.cancel());
    } finally {
      await trustedBadgeDown.dispose();
    }
  }
  await expect
    .poll(async () => {
      const moved = await camera(page);
      return moved.target.some(
        (value, index) => value !== beforeBadgePan.target[index],
      );
    })
    .toBe(true);
  await expect(viewer).toHaveAttribute(
    'data-selected-code',
    selectedBeforeBadgePan!,
  );
  await expect(viewer).toHaveAttribute(
    'data-focus-count',
    focusBeforeBadgePan!,
  );
  await page.keyboard.press('Escape');

  // Conventional native 44px controls remain the dependable touch path.
  // Pan changed the camera; choose from fresh independent physical witnesses.
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  const touchWitnesses = roomVisibilityWitnesses(
    await captureRoomWitness(page),
  );
  const touchCode = [...touchWitnesses.keys()].find(
    (code) => code !== resizedCode,
  )!;
  expect(touchCode).toBeDefined();
  await browser
    .getByRole('searchbox', { name: 'Browse locations' })
    .fill(touchCode);
  const touchControl = browser.getByRole('button', {
    name: new RegExp(touchCode + '$'),
  });
  await touchControl.scrollIntoViewIfNeeded();
  expect(
    roomTargetMeetsMinimum(await touchControl.evaluate(measureRoomTarget)),
  ).toBe(true);
  const touchBox = await touchControl.boundingBox();
  expect(touchBox).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 2,
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        {
          x: touchBox!.x + touchBox!.width / 2,
          y: touchBox!.y + touchBox!.height / 2,
          id: 0,
        },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await selected(page, touchCode);
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.detach();
  }
  await canvas.scrollIntoViewIfNeeded();
  await settledLabels(page);
  snapshot = await committedRoomCounts(
    page,
    viewer,
    occupancyCapture,
    null,
    touchCode,
  );
  counts = snapshot.counts;
  await settledLabels(page);
  await assertCurrentGeneration();
  expect(
    roomVisibilityWitnesses(await captureRoomWitness(page)).has(touchCode),
    'conventionally selected target remains independently exposed',
  ).toBe(true);
  const touchLabel = viewer.locator(
    '[data-room-label-code="' + touchCode + '"]',
  );
  await expect(touchLabel).toBeVisible();
  await expect(touchLabel).toHaveAttribute('aria-pressed', 'true');
  await expect(touchLabel).toHaveAttribute('data-label-compact', 'false');
  await assertCurrentGeneration();
  const selectedCounts = counts[touchCode];
  const formatCount = (value: string, word: string) =>
    BigInt(value).toLocaleString('en-US') +
    ' ' +
    word +
    (value === '1' ? '' : 's');
  await expect(touchLabel).toHaveAccessibleName(
    new RegExp(
      [
        formatCount(selectedCounts.quantity_product_count, 'product'),
        formatCount(selectedCounts.quantity_unit_count, 'unit'),
        formatCount(selectedCounts.asset_count, 'asset'),
      ].join(' / '),
    ),
  );

  await assertCurrentGeneration();
  expect(await canvas.getAttribute('data-label-layout-error')).toBeNull();
  expect(pageErrors).toEqual([]);
});

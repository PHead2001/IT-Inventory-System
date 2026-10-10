import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Box3, Matrix4, Ray, Vector3 } from 'three';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import rawRoom from '../../data/rooms/it-closet.json' with { type: 'json' };
import { buildRoomBindings } from '../../src/features/room/bindings';
import { roomSchema } from '../../src/features/room/schema';
import type { RoomOccupancy } from '../../src/features/room/occupancy-contract';
import { measureRoomTarget, roomTargetMeetsMinimum } from './room-target-size';
import {
  enableRoomLayoutDiagnostics,
  reportRoomLayoutFailure,
  type RoomLayoutWitnessStage,
} from './room-layout-diagnostics';
import {
  observeRoomScene,
  captureRoomWitness,
  roomVisibilityWitnesses,
  roomVisibilityWitnessReport,
  uncoveredRoomWitnesses,
  type WitnessSnapshot,
} from './room-visibility-witness';

// Sort the current fixture first even when iterative runs retain earlier local stock.
const inventoryName =
  '000 Room stock ' +
  String(Number.MAX_SAFE_INTEGER - Date.now()) +
  ' ' +
  crypto.randomUUID();
const locationNames = new Map<string, string>();
const roomContract = roomSchema.parse(rawRoom);
const bindingBounds = buildRoomBindings(roomContract);
let occupancyFixtureId: string | null = null;
let occupancyFixtureJournal: string | null = null;

test.beforeAll(async ({}, testInfo) => {
  const url = new URL(process.env.LOCAL_API_URL!);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.port !== '54321'
  ) {
    throw new Error('Refusing a nonlocal room test fixture target');
  }
  const client = createClient(
    url.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const session = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  if (session.error) throw session.error;
  try {
    const locations = await client
      .from('locations')
      .select('id,code,name')
      .in('code', ['ITC-L', 'ITC-S1A', 'ITC-D01', 'ITC-D04', 'ITC-RACK']);
    if (locations.error) throw locations.error;
    for (const location of locations.data)
      locationNames.set(location.code, location.name);
    const locationId = (code: string) => {
      const location = locations.data.find((row) => row.code === code);
      expect(location, 'required room fixture location ' + code).toBeTruthy();
      return location!.id;
    };
    const category = await client
      .from('categories')
      .select('id')
      .eq('code', 'CABLES')
      .single();
    if (category.error) throw category.error;
    const created = await client.rpc('quantity_create', {
      p_request_id: crypto.randomUUID(),
      p_payload: {
        name: inventoryName,
        category_id: category.data.id,
        initial_quantity: 7,
        initial_location_id: locationId('ITC-S1A'),
      },
    });
    if (created.error) throw created.error;
    const received = await client.rpc('quantity_receive', {
      p_request_id: crypto.randomUUID(),
      p_payload: {
        item_id: created.data.entity_id,
        expected_version: 1,
        location_id: locationId('ITC-D01'),
        quantity: 4,
        reason: 'Room navigation fixture',
      },
    });
    if (received.error) throw received.error;
    const modeled = await client
      .from('locations')
      .select('id,code,name,active,can_hold_inventory,parent_id')
      .in(
        'code',
        bindingBounds.map((binding) => binding.code),
      );
    if (modeled.error) throw modeled.error;
    const leaves = modeled.data
      .filter(
        (location) =>
          location.active &&
          location.can_hold_inventory &&
          !modeled.data.some((child) => child.parent_id === location.id),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    expect(leaves).toHaveLength(28);
    const occupancy = await client.rpc('quantity_create', {
      p_request_id: crypto.randomUUID(),
      p_payload: {
        name: 'ZZ Owned room occupancy ' + crypto.randomUUID(),
        category_id: category.data.id,
        initial_quantity: 31,
        initial_location_id: leaves[0].id,
      },
    });
    if (occupancy.error) throw occupancy.error;
    occupancyFixtureId = occupancy.data.entity_id;
    occupancyFixtureJournal = testInfo.outputPath(
      'owned-room-occupancy-fixture.json',
    );
    writeFileSync(
      occupancyFixtureJournal,
      JSON.stringify(
        {
          origin: url.origin,
          itemId: occupancyFixtureId,
          locationCodes: leaves.map((location) => location.code),
          cleanup: 'pending',
        },
        null,
        2,
      ),
    );
    for (const [index, location] of leaves.slice(1).entries()) {
      const receipt = await client.rpc('quantity_receive', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          item_id: occupancyFixtureId,
          expected_version: index + 1,
          location_id: location.id,
          quantity: 31,
          reason: 'Owned room occupancy browser fixture',
        },
      });
      if (receipt.error) throw receipt.error;
    }
  } finally {
    await client.auth.signOut({ scope: 'local' });
  }
});

test.afterAll(async () => {
  if (!occupancyFixtureId) return;
  const url = new URL(process.env.LOCAL_API_URL!);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.port !== '54321'
  )
    throw new Error('Refusing nonlocal occupancy cleanup');
  const client = createClient(
    url.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const session = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  if (session.error) throw session.error;
  try {
    const item = await client
      .from('quantity_items')
      .select('version,archived')
      .eq('id', occupancyFixtureId)
      .single();
    if (item.error) throw item.error;
    if (!item.data.archived) {
      const cleanup = await client.rpc('quantity_archive_and_clear', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          item_id: occupancyFixtureId,
          expected_version: String(item.data.version),
          confirm_clear_stock: true,
          reason: 'Clean owned room occupancy browser fixture',
        },
      });
      if (cleanup.error) throw cleanup.error;
    }
    if (occupancyFixtureJournal)
      writeFileSync(
        occupancyFixtureJournal,
        JSON.stringify(
          {
            origin: url.origin,
            itemId: occupancyFixtureId,
            cleanup: 'archived and cleared through audited RPC',
          },
          null,
          2,
        ),
      );
  } finally {
    await client.auth.signOut({ scope: 'local' });
  }
});

async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function chooseMapMode(page: Page, mode: 'Guided' | 'Free Orbit') {
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
  if (!wasOpen) await more.click();
  await page
    .getByRole('region', { name: 'More map controls', exact: true })
    .getByRole('button', { name: mode, exact: true })
    .click();
  if (!wasOpen) await more.click();
}
async function setRoomLabels(page: Page, enabled: boolean) {
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
  if (!wasOpen) await more.click();
  const toggle = page.getByRole('button', { name: 'Show labels', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== String(enabled))
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(enabled));
  if (!wasOpen) await more.click();
}
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
async function activateMap(page: Page) {
  if (await page.locator('canvas[data-map-active="true"]').count()) return;
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  let activation = page
    .getByRole('button', { name: 'Interact with map', exact: true })
    .filter({ visible: true });
  const needsOverflow = (await activation.count()) === 0;
  const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
  if (needsOverflow && !wasOpen) await more.click();
  activation = page
    .getByRole('button', { name: 'Interact with map', exact: true })
    .filter({ visible: true });
  await activation.evaluate((element) =>
    element.focus({ preventScroll: true }),
  );
  await page.keyboard.press('Enter');
  if (needsOverflow && !wasOpen) await more.click();
  await expect(page.locator('canvas')).toHaveAttribute(
    'data-map-active',
    'true',
  );
}

async function selected(page: Page, code: string) {
  await expect(page).toHaveURL(
    new RegExp('/room\\?.*location=' + code + '(?:&|$)'),
  );
  await expect(
    page.getByRole('navigation', { name: 'Location browser' }),
  ).toContainText('Selected path:');
  const inventory = page.getByRole('region', {
    name: 'Location inventory',
    exact: true,
  });
  await expect(inventory).toBeVisible();
  await expect(
    inventory.getByRole('heading', {
      name: locationNames.get(code),
      exact: true,
    }),
  ).toBeVisible();
  await expect(inventory.getByText(code, { exact: true })).toBeVisible();
  await expect(
    inventory.getByRole('link', { name: 'Location details and history' }),
  ).toHaveAttribute('href', '/locations/' + code);
}

async function chooseRoomLocation(page: Page, code: string) {
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  await browser.getByRole('searchbox', { name: 'Browse locations' }).fill(code);
  await browser.getByRole('button', { name: new RegExp(`${code}$`) }).click();
}

async function settledLabels(page: Page, afterRevision?: number) {
  const canvas = page.locator('[aria-label="Interactive room canvas"] canvas');
  let previous = '';
  await expect
    .poll(async () => {
      const current = await canvas.evaluate(async (element) => {
        // Let the requested control update project and measure before accepting
        // a settled flag that could still belong to the previous camera frame.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return {
          pending: element.dataset.labelLayoutPending,
          revision: Number(element.dataset.labelLayoutRevision ?? 0),
          frame: [
            element.dataset.cameraViewMatrix,
            element.dataset.cameraProjectionMatrix,
          ],
        };
      });
      const key = JSON.stringify(current);
      const stable =
        current.pending === 'false' &&
        key === previous &&
        (afterRevision === undefined || current.revision > afterRevision);
      previous = key;
      return stable;
    })
    .toBe(true);
}

async function uncoveredCanvasGesture(page: Page, dx: number, dy: number) {
  return page.locator('[aria-label="Interactive room canvas"] canvas').evaluate(
    (canvas, delta) => {
      const rect = canvas.getBoundingClientRect();
      // Labels are genuine DOM controls above the canvas. A canvas gesture must
      // start on the canvas, with its whole initial path inside the viewport.
      for (const yPart of [0.5, 0.3, 0.7, 0.15, 0.85])
        for (const xPart of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const x = rect.x + rect.width * xPart;
          const y = rect.y + rect.height * yPart;
          const uncovered = Array.from({ length: 9 }, (_, step) => {
            const px = x + (delta.dx * step) / 8;
            const py = y + (delta.dy * step) / 8;
            return document.elementFromPoint(px, py) === canvas;
          }).every(Boolean);
          if (uncovered) return { x, y };
        }
      throw new Error('No uncovered native canvas gesture path');
    },
    { dx, dy },
  );
}

async function ready(page: Page) {
  const show = page.getByRole('button', { name: 'Show room', exact: true });
  if (await show.isVisible()) await show.click();
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer).toHaveAttribute('data-camera-view', /"position":\[/, {
    timeout: 20_000,
  });
  await expect(viewer.locator('canvas')).toBeVisible();
  return viewer;
}

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
  // Graphics readiness precedes the initial 300ms selection focus. Observe its
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
  // Graphics readiness precedes the initial 300ms selection focus. Observe its
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
  await setRoomLabels(page, true);
  for (const width of [1280, 375, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'Fit room' }).click();
    const labels = viewer.locator(
      '[data-room-label-code], [data-room-decorative-label], [data-hover-tooltip]',
    );
    await expect
      .poll(() => labels.filter({ visible: true }).count())
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const boxes = (
          await Promise.all(
            (await labels.filter({ visible: true }).all()).map((label) =>
              label.boundingBox(),
            ),
          )
        ).filter((box) => box !== null);
        return boxes.every((box, index) =>
          boxes
            .slice(index + 1)
            .every(
              (other) =>
                box!.x + box!.width <= other!.x ||
                other!.x + other!.width <= box!.x ||
                box!.y + box!.height <= other!.y ||
                other!.y + other!.height <= box!.y,
            ),
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

type CameraReading = {
  azimuth: number;
  elevation: number;
  unwrapped: number;
  zoom: number;
  target: number[];
  position: number[];
  view: number[];
  projection: number[];
  mode: string;
};
async function camera(page: Page): Promise<CameraReading> {
  const canvas = page.locator('[aria-label="Interactive room canvas"] canvas');
  await expect(canvas).toHaveAttribute('data-camera-azimuth-unwrapped', /.+/);
  return canvas.evaluate((element) => ({
    azimuth: Number(element.getAttribute('data-camera-azimuth')),
    elevation: Number(element.getAttribute('data-camera-elevation')),
    unwrapped: Number(element.getAttribute('data-camera-azimuth-unwrapped')),
    zoom: Number(element.getAttribute('data-camera-zoom')),
    target: JSON.parse(element.getAttribute('data-camera-target')!),
    position: JSON.parse(element.getAttribute('data-camera-position')!),
    view: JSON.parse(element.getAttribute('data-camera-view-matrix')!),
    projection: JSON.parse(
      element.getAttribute('data-camera-projection-matrix')!,
    ),
    mode: element.getAttribute('data-orbit-mode')!,
  }));
}

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
function near(actual: number[], expected: number[], tolerance = 0.001) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) =>
    expect(Math.abs(value - expected[index])).toBeLessThan(tolerance),
  );
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
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room');
  const viewer = await ready(page);
  await setRoomLabels(page, false);
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
  await expect(
    viewer.locator('button[data-location-code]:not([data-hover-tooltip])'),
  ).toHaveCount(1);
  await expect(
    viewer.locator('[data-room-label-code="ITC-RACK"]'),
  ).toBeVisible();
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

test('visible drawer labels remain distinct and clickable across desktop and phone orbit views', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);
  for (const viewport of [
    { width: 1280, height: 1100 },
    { width: 390, height: 844 },
  ]) {
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
        expect(
          await label.evaluate((element) => {
            const text = element.firstChild;
            if (!text) return 0;
            const range = document.createRange();
            range.selectNodeContents(text);
            return range.getClientRects().length;
          }),
          'ordinary drawer names remain readable on one line',
        ).toBe(1);
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
  }
});

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
  await viewer.locator('canvas').scrollIntoViewIfNeeded();
  const bounds = await viewer.locator('canvas').boundingBox();
  expect(bounds).toBeTruthy();
  const y = bounds!.y + bounds!.height * 0.48;
  await page.mouse.move(bounds!.x + bounds!.width * 0.72, y);
  await activateMap(page);
  await page.mouse.down();
  await expect(viewer.locator('canvas')).toHaveAttribute(
    'data-map-active',
    'true',
  );
  await expect(viewer.locator('canvas')).toBeFocused();
  await page.mouse.move(bounds!.x + bounds!.width * 0.28, y, { steps: 12 });
  await page.mouse.up();
  expect(
    Math.abs((await camera(page)).unwrapped - counterclockwise.unwrapped),
  ).toBeGreaterThan(0.1);
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
  await canvas.scrollIntoViewIfNeeded();
  const frame = await canvas.boundingBox();
  expect(frame).toBeTruthy();
  const beforeDrag = await camera(page);
  const x = frame!.x + frame!.width * 0.5;
  await page.mouse.move(x, frame!.y + frame!.height * 0.4);
  await activateMap(page);
  await page.mouse.down();
  await expect(viewer.locator('canvas')).toHaveAttribute(
    'data-map-active',
    'true',
  );
  await expect(viewer.locator('canvas')).toBeFocused();
  await page.mouse.move(x, frame!.y + frame!.height * 0.75, { steps: 12 });
  await page.mouse.up();
  expect(
    Math.abs((await camera(page)).elevation - beforeDrag.elevation),
  ).toBeGreaterThan(0.1);
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
  // CI input delivery can exceed the whole 300 ms animation. Control elapsed
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
  await page.clock.runFor(400);
  near((await camera(page)).target, stopped.target);
  expect(Number(await viewer.getAttribute('data-focus-count'))).toBe(
    completedBefore,
  );
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
  // A subsequent uninterrupted request must still complete under the same clock.
  await toolbar.getByRole('button', { name: 'Center selected' }).click();
  await page.clock.runFor(400);
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
  await expect(page.getByText(/counts are a snapshot/)).toBeVisible();
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
  await expect(page.getByText(/counts are a snapshot/)).toHaveCount(0);
});

async function assertOccupiedWitnessActions(
  page: Page,
  scene: WitnessSnapshot,
  counts: RoomOccupancy,
  witnesses = roomVisibilityWitnesses(scene),
) {
  expect(
    witnesses.size,
    'independent actual opaque triangles expose storage',
  ).toBeGreaterThan(0);
  const viewer = page.getByTestId('room-viewer');
  const boxes = [];
  for (const code of witnesses.keys()) {
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
  try {
    const result = await assertOccupiedWitnessActions(
      page,
      scene,
      counts,
      witnesses,
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
    );
    throw error;
  }
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
    const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
    const [bar, popup, frame, visual] = await Promise.all([
      toolbar.boundingBox(),
      panel.boundingBox(),
      canvas.boundingBox(),
      panel.evaluate((element) => ({
        top: window.visualViewport?.offsetTop ?? 0,
        fullHeight: Math.min(
          parseFloat(
            getComputedStyle(element).getPropertyValue('--room-menu-height'),
          ) || 200,
          (window.visualViewport?.height ?? window.innerHeight) * 0.35,
          element.scrollHeight + 2,
        ),
      })),
    ]);
    expect(bar).not.toBeNull();
    expect(popup).not.toBeNull();
    expect(frame).not.toBeNull();
    if (bar!.y - visual.top - 9 >= visual.fullHeight) {
      await expect(panel).toHaveAttribute('data-placement', 'above');
      expect(popup!.y).toBeGreaterThanOrEqual(visual.top + 4);
      expect(popup!.y + popup!.height).toBeLessThanOrEqual(bar!.y - 5);
      expect(popup!.y + popup!.height).toBeLessThanOrEqual(frame!.y);
    }
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
    for (const [code, point] of uncovered) {
      await page.mouse.move(point.x, point.y);
      await expect(canvas).toHaveAttribute('data-hover-visible-code', code);
      // The expected code came from independent triangles, never this telemetry.
      await expect(
        viewer.locator('[data-room-label-code="' + code + '"]'),
      ).toBeVisible();
    }
    await page.mouse.move(15, 15);
    await settledLabels(page);
    if (scenario === 'fit-open') {
      const [code, point] = [...uncovered][0];
      selectedCode = code;
      await page.mouse.click(point.x, point.y);
      await selected(page, code);
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

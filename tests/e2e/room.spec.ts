import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Box3, Matrix4, Ray, Vector3 } from 'three';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import rawRoom from '../../data/rooms/it-closet.json' with { type: 'json' };
import { buildRoomBindings } from '../../src/features/room/bindings';
import { roomSchema } from '../../src/features/room/schema';
import { chooseLocation } from './location-picker';

// Sort the current fixture first even when iterative runs retain earlier local stock.
const inventoryName =
  '000 Room stock ' +
  String(Number.MAX_SAFE_INTEGER - Date.now()) +
  ' ' +
  crypto.randomUUID();
const locationNames = new Map<string, string>();
const roomContract = roomSchema.parse(rawRoom);
const bindingBounds = buildRoomBindings(roomContract);

test.beforeAll(async () => {
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
      .in('code', ['ITC-L', 'ITC-S1A', 'ITC-D01', 'ITC-D04']);
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
    page.getByRole('heading', { name: 'Inventory workspace', exact: true }),
  ).toBeVisible();
}

async function selected(page: Page, code: string) {
  await expect(page).toHaveURL(
    new RegExp('/room\\?location=' + code + '(?:&|$)'),
  );
  await expect(
    page.getByLabel('Select location', { exact: true }),
  ).toContainText(code);
  await expect(
    page.getByRole('heading', {
      name: locationNames.get(code) + ' (' + code + ')',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Location inventory', exact: true }),
  ).toBeVisible();
}

async function chooseRoomLocation(page: Page, code: string) {
  await chooseLocation(page.locator('body'), 'Select location', code);
}

async function ready(page: Page) {
  const show = page.getByRole('button', { name: 'Show room', exact: true });
  if (await show.isVisible()) await show.click();
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000,
  });
  await expect(viewer.locator('canvas')).toBeVisible();
  return viewer;
}

type CameraReading = {
  azimuth: number;
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
function near(actual: number[], expected: number[], tolerance = 0.001) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) =>
    expect(Math.abs(value - expected[index])).toBeLessThan(tolerance),
  );
}

async function clickSceneLocation(page: Page, code: string, viaLabel = false) {
  const viewer = page.getByTestId('room-viewer');
  // One path exercises the actual canvas mesh, while another exercises the
  // accessible projected label. Both must navigate through the same code contract.
  const label = viewer.locator('[data-location-code="' + code + '"]').first();
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

test('real WebGL room raycasting selects shelf and drawer inventory', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room');
  await expect(
    page.getByRole('heading', { name: 'Room navigation', exact: true }),
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
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  await toolbar.locator('summary').click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar.locator('summary').click();
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
  await toolbar.locator('summary').click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar.locator('summary').click();
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
    const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
    for (const code of ['ITC-D01', 'ITC-D04']) {
      const label = viewer.locator(`[data-location-code="${code}"]`).first();
      await expect(label).toHaveAttribute(
        'data-label-suppressed',
        /^(true|false)$/,
      );
      await expect(label).toHaveAttribute('data-label-dx', /^-?\d/);
      await expect(label).toHaveAttribute('data-label-dy', /^-?\d/);
    }
    await toolbar.getByRole('button', { name: 'Free Orbit' }).click();
    const clicked = new Set<string>();
    for (let side = 0; side < 4; side++) {
      await toolbar.getByRole('button', { name: 'Fit room' }).click();
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
      }
      await toolbar.locator('summary').click();
      for (let step = 0; step < 9; step++)
        await toolbar.getByRole('button', { name: 'Rotate right' }).click();
      await toolbar.locator('summary').click();
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
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  for (const direction of ['Pan right', 'Pan left']) {
    await toolbar.getByRole('button', { name: 'Fit room' }).click();
    await toolbar.locator('summary').click();
    await toolbar.getByRole('button', { name: direction }).click();
    await toolbar.locator('summary').click();
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
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  await toolbar.getByRole('button', { name: 'Free Orbit' }).click();
  await expect(
    toolbar.getByRole('button', { name: 'Free Orbit' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const start = await camera(page);
  expect(start.mode).toBe('free');
  await toolbar.locator('summary').click();
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
  await toolbar.locator('summary').click();
  await viewer.locator('canvas').scrollIntoViewIfNeeded();
  const bounds = await viewer.locator('canvas').boundingBox();
  expect(bounds).toBeTruthy();
  const y = bounds!.y + bounds!.height * 0.48;
  await page.mouse.move(bounds!.x + bounds!.width * 0.72, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.28, y, { steps: 12 });
  await page.mouse.up();
  expect(
    Math.abs((await camera(page)).unwrapped - counterclockwise.unwrapped),
  ).toBeGreaterThan(0.1);
  await page.reload();
  await ready(page);
  expect((await camera(page)).mode).toBe('free');
  await toolbar.getByRole('button', { name: 'Guided' }).click();
  const guided = await camera(page);
  expect(guided.mode).toBe('guided');
  expect(Math.abs(guided.azimuth)).toBeLessThanOrEqual(Math.PI / 4 + 0.001);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await toolbar.locator('summary').click();
  await toolbar.getByRole('button', { name: 'Pan left' }).click();
  await toolbar.locator('summary').click();
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

test('recenter restores overview target while preserving orbit, zoom and selection', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  await toolbar.getByRole('button', { name: 'Zoom in' }).click();
  await toolbar.locator('summary').click();
  await toolbar.getByRole('button', { name: 'Rotate right' }).click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  const before = await camera(page);
  await toolbar.getByRole('button', { name: 'Recenter' }).click();
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
  await toolbar.getByRole('button', { name: 'Pan left' }).click();
  const panned = await camera(page);
  expect(panned.target).not.toEqual(recentered.target);
  await toolbar.locator('summary').click();
  const floorPoint = await exposedFloorPoint(page);
  await page.mouse.dblclick(floorPoint.x, floorPoint.y);
  const floor = await camera(page);
  near(floor.target, recentered.target);
  expect(floor.zoom).toBeCloseTo(panned.zoom, 5);
  expect(floor.azimuth).toBeCloseTo(panned.azimuth, 5);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await page.setViewportSize({ width: 1024, height: 700 });
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
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
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  await toolbar.getByRole('button', { name: 'Fit room' }).click();
  await toolbar.getByRole('button', { name: 'Free Orbit' }).click();
  await toolbar.locator('summary').click();
  for (let step = 0; step < 2; step++)
    await toolbar.getByRole('button', { name: 'Rotate left' }).click();
  expect(Math.abs((await camera(page)).azimuth)).toBeLessThan(0.02);
  for (let step = 0; step < 6; step++)
    await toolbar.getByRole('button', { name: 'Rotate right' }).click();
  await toolbar.locator('summary').click();
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
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-D01');
  const viewer = await ready(page);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-D01');
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  const canvas = viewer.locator('canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  await toolbar.locator('summary').click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await toolbar.locator('summary').click();
  const displaced = await camera(page);
  const completedBefore = Number(await viewer.getAttribute('data-focus-count'));
  await toolbar.getByRole('button', { name: 'Center selected' }).click();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.5,
    bounds!.y + bounds!.height * 0.5,
  );
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.62,
    bounds!.y + bounds!.height * 0.5,
    { steps: 6 },
  );
  await page.mouse.up({ button: 'right' });
  const stopped = await camera(page);
  expect(stopped.target).not.toEqual(displaced.target);
  await page.waitForTimeout(400);
  near((await camera(page)).target, stopped.target);
  expect(Number(await viewer.getAttribute('data-focus-count'))).toBe(
    completedBefore,
  );
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
});

test('captures four room sides and searchable picker at desktop and phone widths without console errors', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await login(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = await ready(page);
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  await toolbar.getByRole('button', { name: 'Free Orbit' }).click();
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
      expectFramed(await camera(page), 'ITC');
      const path = testInfo.outputPath(`${width}-${side}.png`);
      if (width === 'desktop') await page.screenshot({ path });
      else await viewer.screenshot({ path });
      await toolbar.locator('summary').click();
      const initial = (await camera(page)).unwrapped;
      for (let step = 0; step < 9; step++)
        await toolbar.getByRole('button', { name: 'Rotate right' }).click();
      expect((await camera(page)).unwrapped - initial).toBeGreaterThan(1.5);
      await toolbar.locator('summary').click();
    }
    await page.getByLabel('Select location', { exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Search locations' });
    await search.fill('right storage');
    await expect(
      page.getByRole('option').filter({ hasText: 'ITC-D07' }),
    ).toBeVisible();
    if (width === 'phone') {
      const door = await page
        .getByText(/Door · 36/)
        .first()
        .boundingBox();
      const pickerPanel = search.locator('..');
      const panel = await pickerPanel.boundingBox();
      expect(door).toBeTruthy();
      expect(panel).toBeTruthy();
      const point = {
        x: door!.x + door!.width / 2,
        y: door!.y + door!.height / 2,
      };
      expect(point.x).toBeGreaterThan(panel!.x);
      expect(point.x).toBeLessThan(panel!.x + panel!.width);
      expect(point.y).toBeGreaterThan(panel!.y);
      expect(point.y).toBeLessThan(panel!.y + panel!.height);
      expect(
        await pickerPanel.evaluate(
          (element, coordinates) =>
            element.contains(
              document.elementFromPoint(coordinates.x, coordinates.y),
            ),
          point,
        ),
        'room door label must stay behind the mobile picker',
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`${width}-picker-search.png`),
    });
    await search.press('Escape');
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

test('room location picker reopens after a filtered selection with fresh results', async ({
  page,
}) => {
  await login(page);
  await page.goto('/room');
  const picker = page.getByLabel('Select location', { exact: true });
  await chooseRoomLocation(page, 'ITC-D01');
  await selected(page, 'ITC-D01');
  await picker.click();
  const search = page.getByRole('combobox', { name: 'Search locations' });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('option').filter({ hasText: 'ITC-D04' }).first(),
  ).toBeVisible();
  await search.fill('ITC-D04');
  await page.getByRole('option').filter({ hasText: 'ITC-D04' }).first().click();
  await selected(page, 'ITC-D04');
  await picker.click();
  await expect(
    page.getByRole('combobox', { name: 'Search locations' }),
  ).toHaveValue('');
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
  const picker = page.getByLabel('Select location', { exact: true });
  await picker.focus();
  await expect(picker).toBeFocused();
  await picker.press('ArrowDown');
  const search = page.getByRole('combobox', { name: 'Search locations' });
  await expect(search).toBeFocused();
  await search.fill('ITC-D01');
  await search.press('Enter');
  await selected(page, 'ITC-D01');
  const box = await picker.boundingBox();
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
    page.getByText('Manage quantity inventory', { exact: true }),
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
  await expect(viewer).toHaveAttribute('data-state', 'failed');
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
  await page.getByRole('button', { name: 'Retry room', exact: true }).click();
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
  await expect(page.getByTestId('room-viewer')).toHaveAttribute(
    'data-state',
    'failed',
    { timeout: 20_000 },
  );
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

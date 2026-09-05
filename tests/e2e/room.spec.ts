import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };

// Sort the current fixture first even when iterative runs retain earlier local stock.
const inventoryName =
  '000 Room stock ' +
  String(Number.MAX_SAFE_INTEGER - Date.now()) +
  ' ' +
  crypto.randomUUID();
const locationNames = new Map<string, string>();

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
      .in('code', ['ITC-L', 'ITC-S1A', 'ITC-D01']);
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
  await expect(page.getByLabel('Select location', { exact: true })).toHaveValue(
    code,
  );
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

async function clickSceneLocation(page: Page, code: string) {
  const viewer = page.getByTestId('room-viewer');
  // Labels are passive projected geometry markers; the actual pointer hits the canvas.
  // No DOM click handler or synthetic application selection substitutes for raycasting.
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
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const canvas = await viewer.locator('canvas').boundingBox();
  expect(canvas).toBeTruthy();
  expect(point.x).toBeGreaterThan(canvas!.x);
  expect(point.x).toBeLessThan(canvas!.x + canvas!.width);
  expect(point.y).toBeGreaterThan(canvas!.y);
  expect(point.y).toBeLessThan(canvas!.y + canvas!.height);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      point,
    ),
  ).toBe('CANVAS');
  await page.mouse.click(point.x, point.y);
  await selected(page, code);
  await expect(viewer).toHaveAttribute('data-selected-code', code);
  await expect(viewer).toHaveAttribute('data-focused-code', code);
}

test('real WebGL room raycasting selects shelf and drawer inventory', async ({
  page,
}) => {
  test.setTimeout(60_000);
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
  await page.getByRole('button', { name: 'Fit room', exact: true }).click();
  await clickSceneLocation(page, 'ITC-D01');
  await expect(
    inventory.getByRole('link', { name: inventoryName, exact: true }),
  ).toHaveCount(1);
  await expect(fixtureRow.getByText('4 units', { exact: true })).toBeVisible();
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
  await page
    .getByLabel('Select location', { exact: true })
    .selectOption('ITC-L');
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
  await page
    .getByLabel('Select location', { exact: true })
    .selectOption('ITC-D01');
  await selected(page, 'ITC-D01');
  await page.goBack();
  await selected(page, 'ITC-L');
  await page.goForward();
  await selected(page, 'ITC-D01');
  await page
    .getByRole('button', { name: 'Focus selected', exact: true })
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
    .getByRole('button', { name: 'Focus selected', exact: true })
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
  await picker.press('Enter');
  await expect(picker).not.toHaveValue('ITC-S1A');
  await picker.selectOption('ITC-D01');
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
  await page
    .getByLabel('Select location', { exact: true })
    .selectOption('ITC-D01');
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
    .getByRole('button', { name: 'Focus selected', exact: true })
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
  await page
    .getByLabel('Select location', { exact: true })
    .selectOption('ITC-D01');
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

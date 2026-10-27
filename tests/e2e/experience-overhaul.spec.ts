import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { expectCategoryAdded } from './configuration-assertions';
import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PNG } from 'pngjs';
import {
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { decodeInventoryFrame } from '../../src/features/scan/decode-frame';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { setLocalReducedMotion } from './motion-settings';

test.use({ deviceScaleFactor: 2 });

async function pendingDesignerActor(page: Page, privateName: string) {
  let actor = '';
  await expect
    .poll(async () => {
      actor = await page.evaluate((name) => {
        for (const key of Object.keys(sessionStorage)) {
          if (!key.startsWith('it-inventory:form-designer:v1:')) continue;
          const raw = sessionStorage.getItem(key);
          if (!raw?.includes(name)) continue;
          const draft = JSON.parse(raw) as { memberId?: unknown };
          if (typeof draft.memberId === 'string') return draft.memberId;
        }
        return '';
      }, privateName);
      return actor;
    })
    .toMatch(/^[0-9a-f-]{36}$/i);
  return actor;
}

/** Privacy generation reads/acknowledgements are separate from this actor check. */
function isDesignerIdentityRequest(request: Request, actor: string) {
  if (request.method() !== 'POST' || !request.headers()['next-action'])
    return false;
  try {
    const args: unknown = JSON.parse(request.postData() ?? '');
    return Array.isArray(args) && args.length === 1 && args[0] === actor;
  } catch {
    return false;
  }
}

async function expectLocationIdentity(
  panel: Locator,
  name: string,
  code: string,
) {
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(panel.getByText(code, { exact: true })).toBeVisible();
  await expect(
    panel.getByRole('link', { name: 'Location details and history' }),
  ).toHaveAttribute('href', '/locations/' + code);
}

type CameraSnapshot = {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  mode: 'guided' | 'free';
};

function parseCameraSnapshot(raw: string | null): CameraSnapshot | null {
  if (!raw || raw === 'null') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const view = value as Partial<CameraSnapshot>;
    const vector = (value: unknown): value is [number, number, number] =>
      Array.isArray(value) &&
      value.length === 3 &&
      value.every(
        (number) => typeof number === 'number' && Number.isFinite(number),
      );
    if (
      !vector(view.position) ||
      !vector(view.target) ||
      typeof view.zoom !== 'number' ||
      !Number.isFinite(view.zoom) ||
      view.zoom <= 0 ||
      (view.mode !== 'guided' && view.mode !== 'free')
    )
      return null;
    return view as CameraSnapshot;
  } catch {
    return null;
  }
}

async function readyCameraSnapshot(viewer: Locator): Promise<CameraSnapshot> {
  let snapshot: CameraSnapshot | null = null;
  await expect
    .poll(async () => {
      snapshot = parseCameraSnapshot(
        await viewer.getAttribute('data-camera-view'),
      );
      return snapshot !== null;
    })
    .toBe(true);
  return snapshot!;
}

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

function decodedCode(png: Buffer) {
  const image = PNG.sync.read(png);
  const rgba = new Uint8ClampedArray(image.data);
  const canvas = {
    width: image.width,
    height: image.height,
    getContext: () => ({
      getImageData: () => ({
        data: rgba,
        width: image.width,
        height: image.height,
      }),
    }),
  } as unknown as HTMLCanvasElement;
  const gray = new Uint8ClampedArray(image.width * image.height);
  for (let index = 0; index < gray.length; index++)
    gray[index] = image.data[index * 4];
  return decodeInventoryFrame(canvas, () =>
    new MultiFormatReader().decode(
      new BinaryBitmap(
        new HybridBinarizer(
          new RGBLuminanceSource(gray, image.width, image.height),
        ),
      ),
      new Map(),
    ),
  ).getText();
}

function expectWhiteQuietZone(png: Buffer) {
  const image = PNG.sync.read(png);
  let firstBlack = image.width;
  let lastBlack = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      if (
        image.data[offset] < 90 &&
        image.data[offset + 1] < 90 &&
        image.data[offset + 2] < 90
      ) {
        firstBlack = Math.min(firstBlack, x);
        lastBlack = Math.max(lastBlack, x);
      }
    }
  }
  expect(firstBlack, 'left white code quiet zone').toBeGreaterThan(5);
  expect(
    image.width - lastBlack - 1,
    'right white code quiet zone',
  ).toBeGreaterThan(5);
}

test('Settings deep links retain active navigation through Back and Forward and load only the selected area', async ({
  page,
}) => {
  await signIn(page);
  const navigation = page.getByRole('navigation', {
    name: 'Settings sections',
  });
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Forms and fields' }),
  ).toHaveCount(0);
  let siteDraft: string | null = null;
  for (const [label, path, heading] of [
    ['Categories', '/settings/categories', 'Categories'],
    ['Forms & fields', '/settings/forms', 'Forms & fields'],
    ['Storage locations', '/settings/locations', 'Manage logical locations'],
    ['Properties & sites', '/settings/sites', 'Properties & sites'],
    ['Labels & printing', '/settings/labels', 'Labels & printing defaults'],
  ] as const) {
    await navigation.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === path &&
        (path === '/settings/sites'
          ? url.searchParams.size === 1 &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              url.searchParams.get('siteDraft') ?? '',
            )
          : url.search === ''),
    );
    if (path === '/settings/sites')
      siteDraft = new URL(page.url()).searchParams.get('siteDraft');
    await expect(
      navigation.getByRole('link', { name: label, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('heading', { name: heading, exact: true, level: 1 }),
    ).toBeVisible();
    if (path !== '/settings/forms')
      await expect(
        page.getByRole('region', { name: 'Forms and fields' }),
      ).toHaveCount(0);
  }
  await page.goBack();
  await expect(page).toHaveURL(
    new URL('/settings/sites?siteDraft=' + siteDraft, page.url()).href,
  );
  await expect(
    navigation.getByRole('link', { name: 'Properties & sites' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/labels$/);
  await expect(
    navigation.getByRole('link', { name: 'Labels & printing' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Labels & printing defaults' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Forms and fields' }),
  ).toHaveCount(0);
});

test('viewer can deep link to a form but sees an explanation instead of edit controls', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings/forms');
  await expect(page.getByRole('note')).toContainText('Form editing requires');
  const first = page.locator('a[href^="/settings/forms/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByRole('note')).toContainText('Form editing requires');
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'All category forms' }).click();
  await expect(
    page.getByRole('heading', { name: 'Forms & fields', level: 1 }),
  ).toBeVisible();
});

test('Spaces links follow location ancestry even when codes omit or spoof a root prefix', async ({
  page,
}) => {
  await signIn(page);
  // Code-managed structure is prepared only in the disposable loopback fixture.
  const fixtureUrl = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(fixtureUrl.hostname);
  expect(fixtureUrl.port).toBe('45321');
  const fixtureAdmin = createClient(
    fixtureUrl.href,
    process.env.LOCAL_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const makeLocation = async (code: string, parentCode: string) => {
    const parent = await fixtureAdmin
      .from('locations')
      .select('id')
      .eq('code', parentCode)
      .single();
    expect(parent.error).toBeNull();
    const inserted = await fixtureAdmin
      .from('locations')
      .insert({
        code,
        name: code,
        parent_id: parent.data!.id,
        kind: 'storage_area',
        can_hold_inventory: true,
      })
      .select('id,parent_id,code')
      .single();
    expect(inserted.error).toBeNull();
    expect(inserted.data).toMatchObject({ parent_id: parent.data!.id, code });
  };
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const staging = `STAGING-${suffix}`;
  await makeLocation(staging, 'ITO');
  await page.goto('/locations/' + staging);
  await expect(
    page.getByRole('link', { name: `Show ${staging} in Spaces` }),
  ).toHaveAttribute('href', `/room?location=${staging}`);
  await page.getByRole('link', { name: `Show ${staging} in Spaces` }).click();
  await expect(page.getByRole('combobox', { name: 'Space' })).toHaveValue(
    'it-office',
  );
  await expect(
    page
      .getByRole('region', { name: 'Location inventory' })
      .getByRole('heading', {
        name: new RegExp(staging),
      }),
  ).toBeVisible();
  await expect(page.getByTestId('room-viewer')).toHaveCount(0);
  const spoof = `ITO-SPOOF-${suffix}`;
  await makeLocation(spoof, 'ITC');
  await page.goto('/locations/' + spoof);
  await expect(
    page.getByRole('link', { name: `Show ${spoof} in Spaces` }),
  ).toHaveAttribute('href', `/room?location=${spoof}`);
  await expect(page.getByRole('link', { name: /in room/ })).toHaveCount(0);
  await page.getByRole('link', { name: `Show ${spoof} in Spaces` }).click();
  await expect(page.getByRole('combobox', { name: 'Space' })).toHaveValue(
    'it-closet',
  );
});

test('designer gestures reflow while held, resize before release, cancel, undo and expose phone panels', async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await signIn(page);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: 'Cables', exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeVisible();
  const firstSection = designer.locator('[data-section-id]').first();
  const handles = firstSection.locator(
    '[data-control-id] button[aria-label^="Drag "]',
  );
  const order = async () =>
    handles.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label')),
    );
  const original = await order();
  expect(original.length).toBeGreaterThanOrEqual(2);
  const source = handles.nth(1);
  const destination = handles.first();
  await source.locator('xpath=ancestor::*[@data-control-id]').press('Enter');
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await destination.boundingBox();
  expect(from && to).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
      steps: 16,
    });
    await expect.poll(order).not.toEqual(original);
  } finally {
    await page.mouse.up();
  }
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await expect.poll(order).toEqual(original);

  const nameControl = designer.locator(
    '[data-control-id]:has(button[aria-label="Resize Name"])',
  );
  await nameControl.press('Enter');
  const width = designer
    .getByTestId('designer-inspector')
    .getByRole('combobox', { name: 'Preferred width', exact: true });
  await width.selectOption('12');
  const initialWidth = await width.inputValue();
  const resize = nameControl.getByRole('button', { name: 'Resize Name' });
  await resize.scrollIntoViewIfNeeded();
  const box = await resize.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(
      box!.x + box!.width / 2 - 260,
      box!.y + box!.height / 2,
      { steps: 12 },
    );
    await expect(width).not.toHaveValue(initialWidth);
  } finally {
    await page.mouse.up();
  }
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await expect(width).toHaveValue(initialWidth);

  await designer.getByRole('button', { name: 'Add section' }).click();
  await page.setViewportSize({ width: 1280, height: 6000 });
  const empty = designer.locator('[data-section-id]').last();
  await expect(empty.locator('[data-control-id]')).toHaveCount(0);
  await nameControl.press('Enter');
  const nameDrag = designer.getByRole('button', { name: 'Drag Name' });
  await nameDrag.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  );
  await page.evaluate(() => window.scrollBy(0, -100));
  const nameBox = await nameDrag.boundingBox();
  const emptyBox = await empty.locator('.border-dashed').boundingBox();
  expect(nameBox && emptyBox).toBeTruthy();
  await page.mouse.move(
    nameBox!.x + nameBox!.width / 2,
    nameBox!.y + nameBox!.height / 2,
  );
  await page.mouse.down();
  try {
    await page.mouse.move(
      emptyBox!.x + emptyBox!.width / 2,
      emptyBox!.y + emptyBox!.height / 2,
      { steps: 18 },
    );
    await expect(empty.locator('[data-control-id]')).toHaveCount(1);
    await page.keyboard.press('Escape');
  } finally {
    await page.mouse.up();
  }
  await expect(empty.locator('[data-control-id]')).toHaveCount(0);
  await expect(
    firstSection.getByRole('button', { name: 'Drag Name' }),
  ).toBeVisible();
  const crossHandle = firstSection.getByRole('button', { name: 'Drag Name' });
  // Hover performs Playwright's live hit testing at the exact pointer position.
  // Keep that pointer in place for down, then discover the drop target while held.
  await crossHandle.hover();
  await page.mouse.down();
  const crossTarget = await empty.locator('.border-dashed').boundingBox();
  expect(crossTarget).toBeTruthy();
  await page.mouse.move(
    crossTarget!.x + crossTarget!.width / 2,
    crossTarget!.y + crossTarget!.height / 2,
    { steps: 18 },
  );
  await expect(
    designer.locator('[data-control-id]:has(button[aria-label="Drag Name"])'),
  ).toHaveAttribute('data-dragging', 'true');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await empty.locator('[data-control-id]').count()) break;
    const liveTarget = await empty.locator('.border-dashed').boundingBox();
    expect(liveTarget).toBeTruthy();
    await page.mouse.move(
      liveTarget!.x + liveTarget!.width / 2,
      liveTarget!.y + liveTarget!.height / 2,
      { steps: 8 },
    );
  }
  await expect(empty.getByRole('button', { name: 'Drag Name' })).toBeVisible();
  await page.mouse.up();
  await expect(empty.getByRole('button', { name: 'Drag Name' })).toBeVisible();
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await expect(empty.locator('[data-control-id]')).toHaveCount(0);
  const sectionOrder = async () =>
    designer
      .locator('[data-section-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-section-id')),
      );
  const beforeSectionDrag = await sectionOrder();
  await nameDrag.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  );
  await page.evaluate(() => window.scrollBy(0, -100));
  const sectionFrom = await empty
    .getByRole('button', { name: 'Drag section New section' })
    .boundingBox();
  const sectionTo = await firstSection
    .locator('button[aria-label^="Drag section "]')
    .boundingBox();
  expect(sectionFrom && sectionTo).toBeTruthy();
  await page.mouse.move(
    sectionFrom!.x + sectionFrom!.width / 2,
    sectionFrom!.y + sectionFrom!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sectionTo!.x + sectionTo!.width / 2,
    sectionTo!.y + sectionTo!.height / 2,
    { steps: 18 },
  );
  await page.mouse.up();
  await expect.poll(sectionOrder).not.toEqual(beforeSectionDrag);
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await expect.poll(sectionOrder).toEqual(beforeSectionDrag);
  await page.setViewportSize({ width: 390, height: 844 });
  const panels = designer.getByRole('navigation', { name: 'Designer panels' });
  for (const [panel, heading] of [
    ['Library', 'Field library'],
    ['Canvas', 'Form canvas'],
    ['Inspector', 'Inspector'],
  ] as const) {
    await panels.getByRole('button', { name: panel }).click();
    await expect(
      designer.getByRole('heading', { name: heading }),
    ).toBeVisible();
  }
});

test('a newly required field requests targeted confirmation before changing the active form', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const category = `Review form ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page);
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expectCategoryAdded(page, category);
  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Add quantity item' });
  await create
    .getByLabel('Name', { exact: true })
    .fill(`Review item ${category}`);
  await create.getByLabel('Category').selectOption({ label: category });
  await metadataReviewButton(create).click();
  await metadataSaveButton(create).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const addition = designer.getByRole('dialog', { name: 'Add field' });
  await addition.getByLabel('Field name').fill('Review required value');
  await addition.getByRole('button', { name: 'Add to form' }).click();
  await designer.getByRole('checkbox', { name: 'Required' }).check();
  await designer.getByRole('button', { name: 'Save changes' }).click();
  const impact = designer.getByRole('region', { name: 'Form save impact' });
  await expect(impact).toBeVisible();
  await expect(impact).toContainText('1 quantity records');
  await expect(impact).toContainText('newly need metadata review');
  await expect(
    designer.getByRole('status').filter({ hasText: 'Review the effect' }),
  ).toContainText('Review the effect');
  await impact
    .getByRole('button', { name: 'Confirm and save changes' })
    .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toContainText('Saved active form revision');
  await page.goto('/inventory/quantity/new');
  await page
    .getByRole('form', { name: 'Add quantity item' })
    .getByLabel('Category')
    .selectOption({ label: category });
  await expect(
    page
      .getByRole('form', { name: 'Add quantity item' })
      .getByLabel('Review required value'),
  ).toBeVisible();
});

test('a stale category publication retains the exact unsaved input for explicit review', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const category = `Stale form ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page);
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expectCategoryAdded(page, category);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/forms\/[0-9a-f-]{36}$/);
  const formUrl = page.url();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  const other = await page.context().newPage();
  try {
    await other.goto(formUrl);
    const competing = other.locator(
      'section[aria-labelledby="metadata-settings-heading"]',
    );
    await expect(
      competing.getByRole('button', { name: 'Add section' }),
    ).toBeVisible();
    await designer.getByRole('button', { name: 'Add section' }).click();
    const unsaved = designer.getByLabel('Section heading').last();
    await unsaved.fill('Retained local draft');
    await competing.getByRole('button', { name: 'Add section' }).click();
    await competing
      .getByLabel('Section heading')
      .last()
      .fill('Competing publication');
    await competing.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      competing
        .getByRole('status')
        .filter({ hasText: 'Saved active form revision' }),
    ).toContainText('Saved active form revision');
    await designer.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      designer
        .getByRole('status')
        .filter({ hasText: /changed|stale|revision/i }),
    ).toContainText(/changed|stale|revision/i);
    await expect(unsaved).toHaveValue('Retained local draft');
    await expect(
      designer.getByRole('region', { name: 'Form save impact' }),
    ).toHaveCount(0);
    page.once('dialog', (dialog) => dialog.accept());
    await designer
      .getByRole('button', { name: 'Recovery & advanced', exact: true })
      .click();
    await designer.getByRole('button', { name: 'Refresh from server' }).click();
    await expect(designer.getByLabel('Section heading').last()).toHaveValue(
      'Competing publication',
    );
  } finally {
    await other.close();
  }
});

test('same-user focus checks coalesce while the unsaved designer remains mounted', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: 'Cables', exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer.getByRole('button', { name: 'Add section' }).click();
  const input = designer.getByLabel('Section heading').last();
  const pendingName = `Unsaved focus ${crypto.randomUUID()}`;
  await input.fill(pendingName);
  const actor = await pendingDesignerActor(page, pendingName);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  let actionRequests = 0;
  await page.route('**/settings/forms/**', async (route) => {
    if (isDesignerIdentityRequest(route.request(), actor)) {
      actionRequests++;
      started();
      await gate;
    }
    try {
      await route.continue();
    } catch {
      /* Navigation may cancel a request. */
    }
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await first;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(actionRequests).toBe(1);
    await expect(input).toHaveValue(pendingName);
  } finally {
    release();
    await page.unroute('**/settings/forms/**');
  }
  await expect(input).toHaveValue(pendingName);
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeVisible();
});

test('a transient access-check failure retains local edits and pauses Save until retry succeeds', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: 'Cables', exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer.getByRole('button', { name: 'Add section' }).click();
  const input = designer.getByLabel('Section heading').last();
  const pendingName = `Retained on failure ${crypto.randomUUID()}`;
  await input.fill(pendingName);
  const actor = await pendingDesignerActor(page, pendingName);
  let interrupted!: () => void;
  const requestFailed = new Promise<void>((resolve) => {
    interrupted = resolve;
  });
  await page.route('**/settings/forms/**', async (route) => {
    if (isDesignerIdentityRequest(route.request(), actor)) {
      await route.abort('failed');
      interrupted();
    } else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await requestFailed;
  await expect(designer.getByRole('alert')).toContainText(
    'Identity verification was interrupted',
  );
  await expect(input).toHaveValue(pendingName);
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled();
  await page.unroute('**/settings/forms/**');
  await designer.getByRole('button', { name: 'Retry access check' }).click();
  await expect(designer.getByRole('alert')).toHaveCount(0);
  await expect(input).toHaveValue(pendingName);
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeEnabled();
});

test('account switch during a held designer gesture permanently masks the old private editor', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: 'Cables', exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer.getByRole('button', { name: 'Add section' }).click();
  const privateName = `Private unsaved ${crypto.randomUUID()}`;
  await designer.getByLabel('Section heading').last().fill(privateName);
  const nameControl = designer.locator(
    '[data-control-id]:has(button[aria-label="Resize Name"])',
  );
  await nameControl.press('Enter');
  const width = designer
    .getByTestId('designer-inspector')
    .getByRole('combobox', { name: 'Preferred width', exact: true });
  await width.selectOption('12');
  const beforeResize = await width.inputValue();
  const handle = designer.getByRole('button', { name: 'Resize Name' });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 - 260,
    box!.y + box!.height / 2,
    { steps: 8 },
  );
  await expect(width).not.toHaveValue(beforeResize);
  const other = await page.context().newPage();
  try {
    await other.goto('/settings');
    await other.getByRole('button', { name: 'Sign out' }).click();
    await other
      .getByLabel('Email', { exact: true })
      .fill(fixture.emails.viewer);
    await other.getByLabel('Password', { exact: true }).fill(fixture.password);
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      other.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    // A privacy presentation mask alone is not terminal designer denial.
    await expect(page.getByText(/Configuration access changed\./)).toHaveCount(
      1,
    );
    await expect(
      designer.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
    expect(
      await page
        .locator('input')
        .evaluateAll(
          (inputs, value) =>
            inputs.some((input) => (input as HTMLInputElement).value === value),
          privateName,
        ),
    ).toBe(false);
    await page.mouse.up();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText(/Configuration access changed\./)).toHaveCount(
      1,
    );
    await expect(
      designer.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
    expect(
      await page
        .locator('input')
        .evaluateAll(
          (inputs, value) =>
            inputs.some((input) => (input as HTMLInputElement).value === value),
          privateName,
        ),
    ).toBe(false);
  } finally {
    await page.mouse.up();
    await other.close();
  }
});

test('Spaces selection updates the heading immediately, rejects stale contents and follows history', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.goto('/room?location=ITC-D01');
  const space = page.getByLabel('Space', { exact: true });
  const inventory = page.getByRole('region', { name: 'Location inventory' });
  await expect(space).toHaveValue('it-closet');
  await expectLocationIdentity(inventory, 'Drawer 1', 'ITC-D01');
  await expect(inventory).toHaveAttribute('aria-busy', 'false');
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');

  let releaseOffice!: () => void;
  const officeGate = new Promise<void>((resolve) => {
    releaseOffice = resolve;
  });
  let officeRequested!: () => void;
  const officeRequest = new Promise<void>((resolve) => {
    officeRequested = resolve;
  });
  await page.route('**/api/room/contents?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('space') === 'it-office') {
      officeRequested();
      await officeGate;
    }
    try {
      await route.continue();
    } catch {
      /* The selection may abort the old request. */
    }
  });
  try {
    await space.selectOption('it-office');
    await expect(page).toHaveURL(/space=it-office/);
    await expect(
      page.getByRole('heading', { name: 'IT Office inventory' }),
    ).toBeVisible();
    await expect(viewer).toHaveCount(0);
    const browser = page.getByRole('navigation', { name: 'Location browser' });
    await browser.getByLabel('Browse locations').fill('ITO');
    const office = browser.getByRole('button', { name: /IT Office ITO$/ });
    await expect(office).toBeVisible();
    await office.click();
    await officeRequest;
    await expectLocationIdentity(inventory, 'IT Office', 'ITO');
    await space.selectOption('it-closet');
    await browser.getByLabel('Browse locations').fill('ITC-D01');
    await browser
      .getByRole('button', { name: /ITC-D01/ })
      .first()
      .click();
    await expectLocationIdentity(inventory, 'Drawer 1', 'ITC-D01');
    releaseOffice();
    await expect(inventory).toHaveAttribute('aria-busy', 'false');
    await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-D01');
    await expect(
      inventory.getByRole('heading', { name: 'IT Office', exact: true }),
    ).toHaveCount(0);
    await expect(inventory.getByText('ITO', { exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(space).toHaveValue('it-closet');
    await page.goBack();
    await expect(space).toHaveValue('it-office');
    await expectLocationIdentity(inventory, 'IT Office', 'ITO');
  } finally {
    releaseOffice();
    await page.unroute('**/api/room/contents?*');
  }
});

async function mapOverflow(viewer: Locator) {
  const more = viewer
    .getByRole('toolbar', { name: 'Room camera controls' })
    .getByRole('button', { name: 'More map controls', exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  return viewer.getByRole('region', { name: 'More map controls', exact: true });
}

test('a user camera pan is restored after leaving and returning to the modeled space', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.goto('/room?space=it-closet');
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer.locator('canvas')).toBeVisible();
  const original = await readyCameraSnapshot(viewer);
  const initialTarget = JSON.stringify(original.target);
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Free Orbit', exact: true })
    .click();
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Pan left', exact: true })
    .click();
  const movement: { snapshot: CameraSnapshot | null } = { snapshot: null };
  await expect
    .poll(async () => {
      movement.snapshot = parseCameraSnapshot(
        await viewer.getAttribute('data-camera-view'),
      );
      return (
        movement.snapshot !== null &&
        JSON.stringify(movement.snapshot.target) !== initialTarget
      );
    })
    .toBe(true);
  const moved = movement.snapshot;
  if (!moved) throw new Error('Panned camera snapshot unavailable');
  expect(moved.mode).toBe('free');
  await page.getByLabel('Space', { exact: true }).selectOption('it-office');
  await expect(viewer).toHaveCount(0);
  await page.getByLabel('Space', { exact: true }).selectOption('it-closet');
  await expect(viewer.locator('canvas')).toBeVisible();
  const restored = await readyCameraSnapshot(viewer);
  expect(restored.mode).toBe(moved.mode);
  expect(restored.zoom).toBeCloseTo(moved.zoom, 3);
  for (const key of ['position', 'target'] as const)
    for (let index = 0; index < 3; index++)
      expect(restored[key][index]).toBeCloseTo(moved[key][index], 2);
});

test('Back into a selected modeled space focuses from its saved camera baseline', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.goto('/room?location=ITC-S1A');
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const beforePan = await readyCameraSnapshot(viewer);
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Pan right' })
    .click();
  // A non-null saved snapshot may still precede the scene's pan-command commit.
  const pan: { snapshot: CameraSnapshot | null } = { snapshot: null };
  await expect
    .poll(async () => {
      pan.snapshot = parseCameraSnapshot(
        await viewer.getAttribute('data-camera-view'),
      );
      return (
        pan.snapshot !== null &&
        JSON.stringify(pan.snapshot.target) !== JSON.stringify(beforePan.target)
      );
    })
    .toBe(true);
  const displaced = pan.snapshot;
  if (!displaced) throw new Error('Panned camera snapshot unavailable');
  await page.getByLabel('Space', { exact: true }).selectOption('it-office');
  await expect(viewer).toHaveCount(0);
  await page.goBack();
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const focused = await readyCameraSnapshot(viewer);
  expect(focused.target).not.toEqual(displaced.target);
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
});

test('local and OS reduced motion settle room focus without disabling manual camera controls', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signIn(page);
  await page.goto('/room?location=ITC-D01');
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer.locator('canvas')).toBeVisible();
  await expect(
    viewer.getByRole('button', { name: 'Center selected' }),
  ).toBeEnabled();
  const view = async () => JSON.stringify(await readyCameraSnapshot(viewer));
  await readyCameraSnapshot(viewer);
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Pan left', exact: true })
    .click();
  const panned = await view();
  const initialFocusCount = Number(
    await viewer.getAttribute('data-focus-count'),
  );
  await viewer.getByRole('button', { name: 'Center selected' }).click();
  await setLocalReducedMotion(page, true);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-focus-count')))
    .toBeGreaterThan(initialFocusCount);
  await expect.poll(view).not.toBe(panned);
  const settled = await view();
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Pan left', exact: true })
    .click();
  const secondPan = await view();
  expect(secondPan).not.toBe(settled);
  await viewer.getByRole('button', { name: 'Center selected' }).click();
  await expect.poll(view).toBe(settled);

  await setLocalReducedMotion(page, false);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Pan left', exact: true })
    .click();
  const fullPan = await view();
  await viewer.evaluate((element) => {
    const before = Number(element.dataset.focusCount);
    const button = element.querySelector<HTMLButtonElement>(
      'button[aria-label="Center selected"]',
    );
    if (!button) throw new Error('Center selected control unavailable');
    let started: number | null = null;
    element.dataset.fullMotionSample = 'pending';
    const finish = (result: string) => {
      observer.disconnect();
      button.removeEventListener('click', onClick, true);
      clearTimeout(timeout);
      element.dataset.fullMotionSample = result;
    };
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted) return finish('untrusted click');
      started = performance.now();
    };
    const observer = new MutationObserver(() => {
      if (started === null || Number(element.dataset.focusCount) <= before)
        return;
      finish(String(performance.now() - started));
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['data-focus-count'],
    });
    button.addEventListener('click', onClick, true);
    const timeout = window.setTimeout(() => finish('timeout'), 5_000);
  });
  await viewer.getByRole('button', { name: 'Center selected' }).click();
  await expect
    .poll(() => viewer.getAttribute('data-full-motion-sample'), {
      timeout: 7_000,
    })
    .not.toBe('pending');
  const fullMotionMs = Number(
    await viewer.getAttribute('data-full-motion-sample'),
  );
  expect(fullMotionMs).toBeGreaterThanOrEqual(250);
  await expect.poll(view).not.toBe(fullPan);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Pan left', exact: true })
    .click();
  const osPan = await view();
  await viewer.getByRole('button', { name: 'Center selected' }).click();
  await expect.poll(view).not.toBe(osPan);
  await (
    await mapOverflow(viewer)
  )
    .getByRole('button', { name: 'Free Orbit', exact: true })
    .click();
  const beforeZoom = (await readyCameraSnapshot(viewer)).zoom;
  await viewer.getByRole('button', { name: 'Zoom in' }).click();
  const manualView = await readyCameraSnapshot(viewer);
  expect(manualView.mode).toBe('free');
  expect(manualView.zoom).toBeGreaterThan(beforeZoom);
});

test('Spaces handles a failed contents request without dropping selection or the modeled room', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/room?space=it-closet');
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  const inventory = page.getByRole('region', { name: 'Location inventory' });
  await page.route('**/api/room/contents?*', (route) => route.abort('failed'));
  await browser.getByLabel('Browse locations').fill('ITC-D01');
  await browser
    .getByRole('button', { name: /ITC-D01/ })
    .first()
    .click();
  await expectLocationIdentity(inventory, 'Drawer 1', 'ITC-D01');
  await expect(inventory.getByRole('alert')).toContainText(
    'Inventory could not be loaded',
  );
  await expect(page.getByTestId('room-viewer')).toHaveAttribute(
    'data-selected-code',
    'ITC-D01',
  );
  await page.unroute('**/api/room/contents?*');
  await inventory.getByRole('button', { name: 'Retry contents' }).click();
  await expect(inventory).toHaveAttribute('aria-busy', 'false');
  await expect(inventory.getByRole('alert')).toHaveCount(0);
});

test('automatic label sheet retains readable codes across rapid layout edits and blocks direct print', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, 'viewer');
  await page.goto('/labels?location=ITC');
  const card = page.locator('.label-card').first();
  await expect(card).toHaveAttribute('data-code-ready', 'true');
  const size = page.getByRole('combobox', { name: 'Label size' });
  const paperChoice = page.getByRole('combobox', { name: 'Paper size' });
  for (const labelSize of ['70x35', '90x50'] as const) {
    for (const paper of ['A4', 'letter'] as const) {
      await size.selectOption(labelSize);
      await paperChoice.selectOption(paper);
      await expect(card).toHaveAttribute('data-code-ready', 'true');
      await page
        .locator('.label-print-root')
        .evaluate((element) =>
          element.setAttribute('data-print-authorized', 'true'),
        );
      try {
        const pdf = await page.pdf({
          path: testInfo.outputPath(`one-label-${labelSize}-${paper}.pdf`),
          preferCSSPageSize: true,
          printBackground: true,
        });
        expect(
          (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length,
          `one ${labelSize} label on ${paper} has no trailing blank page`,
        ).toBe(1);
      } finally {
        await page
          .locator('.label-print-root')
          .evaluate((element) =>
            element.removeAttribute('data-print-authorized'),
          );
      }
    }
  }
  await page
    .getByRole('region', { name: 'Label queue' })
    .getByLabel('Copies')
    .fill('20');
  await expect(page.locator('.label-card')).toHaveCount(20);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  const print = page.getByRole('button', { name: /Print selected labels/ });
  const format = page.getByRole('combobox', { name: 'Barcode type' });
  let measuredReflows = 0;
  for (const [labelSize, paper, code] of [
    ['70x35', 'A4', 'qr'],
    ['90x50', 'letter', 'code128'],
  ] as const) {
    const changingSize = (await size.inputValue()) !== labelSize;
    if (changingSize) {
      await card.evaluate((element, targetSize) => {
        const [width, height] = targetSize.split('x');
        const samples: Array<{ width: number; height: number }> = [];
        const promise = new Promise<typeof samples>((resolve) => {
          let started = false;
          let timeout = 0;
          const finish = () => {
            observer.disconnect();
            window.clearTimeout(timeout);
            resolve(samples);
          };
          const observer = new MutationObserver(() => {
            if (
              started ||
              element.style.width !== `${width}mm` ||
              element.style.height !== `${height}mm`
            )
              return;
            started = true;
            observer.disconnect();
            const start = performance.now();
            const measure = () => {
              const box = element.getBoundingClientRect();
              samples.push({ width: box.width, height: box.height });
              if (performance.now() - start < 280)
                requestAnimationFrame(measure);
              else finish();
            };
            measure();
          });
          observer.observe(element, {
            attributes: true,
            attributeFilter: ['style'],
          });
          timeout = window.setTimeout(finish, 1500);
        });
        (
          window as Window & { __physicalLabelFrames?: typeof promise }
        ).__physicalLabelFrames = promise;
      }, labelSize);
    }
    await size.selectOption(labelSize);
    await expect(card).toHaveAttribute(
      'style',
      new RegExp(
        `width: ${labelSize.split('x')[0]}mm; height: ${labelSize.split('x')[1]}mm`,
      ),
    );
    const frames = changingSize
      ? await page.evaluate(
          () =>
            (
              window as Window & {
                __physicalLabelFrames?: Promise<
                  Array<{ width: number; height: number }>
                >;
              }
            ).__physicalLabelFrames ?? [],
        )
      : [];
    const [physicalWidth, physicalHeight] = labelSize.split('x').map(Number);
    if (changingSize) {
      measuredReflows++;
      expect(frames.length).toBeGreaterThan(2);
    }
    for (const [index, frame] of frames.entries()) {
      expect(frame.width, `${labelSize} frame ${index} width`).toBeCloseTo(
        (physicalWidth * 96) / 25.4,
        0,
      );
      expect(frame.height, `${labelSize} frame ${index} height`).toBeCloseTo(
        (physicalHeight * 96) / 25.4,
        0,
      );
    }
    await paperChoice.selectOption(paper);
    await format.selectOption(code);
    await expect(card).toHaveAttribute('data-code-ready', 'true');
    await expect(print).toBeEnabled();
    const dimensions = await card.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        background: getComputedStyle(element).backgroundColor,
      };
    });
    const [width, height] = labelSize.split('x').map(Number);
    expect(dimensions.width).toBeCloseTo((width * 96) / 25.4, 0);
    expect(dimensions.height).toBeCloseTo((height * 96) / 25.4, 0);
    expect(dimensions.background).toBe('rgb(255, 255, 255)');
    const codeImage = card.getByRole('img', {
      name: code === 'qr' ? /QR code for/ : /Code 128 LOC:ITC/,
    });
    await expect(codeImage).toBeVisible();
    const renderedCode = await codeImage.screenshot();
    expect(decodedCode(renderedCode)).toBe(
      code === 'qr' ? process.env.APP_ORIGIN + '/locations/ITC' : 'LOC:ITC',
    );
    expectWhiteQuietZone(renderedCode);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.label-print-root')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    // The app authorizes only a validated print lifecycle. A direct browser print remains blank.
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.locator('.label-print-root')).not.toHaveAttribute(
      'data-print-authorized',
    );
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('.label-print-root')).not.toHaveAttribute(
      'data-print-authorized',
    );
    await page.emulateMedia({ media: 'print' });
    await page
      .locator('.label-print-root')
      .evaluate((element) =>
        element.setAttribute('data-print-authorized', 'true'),
      );
    try {
      const pdf = await page.pdf({
        path: testInfo.outputPath(`overhaul-${labelSize}.pdf`),
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect(
        (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length,
      ).toBe(2);
      const mediaBox = pdf
        .toString('latin1')
        .match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      expect(
        mediaBox,
        'PDF page must declare physical dimensions',
      ).not.toBeNull();
      const [paperWidthMm, paperHeightMm] =
        paper === 'A4' ? [210, 297] : [215.9, 279.4];
      expect(Number(mediaBox![1])).toBeCloseTo((paperWidthMm * 72) / 25.4, 0);
      expect(Number(mediaBox![2])).toBeCloseTo((paperHeightMm * 72) / 25.4, 0);
    } finally {
      await page
        .locator('.label-print-root')
        .evaluate((element) =>
          element.removeAttribute('data-print-authorized'),
        );
      await page.emulateMedia({ media: 'screen' });
    }
  }
  expect(measuredReflows).toBeGreaterThan(0);
});

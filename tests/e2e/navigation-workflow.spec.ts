import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { expect, test, type Page, type Request } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { createClient } from '@supabase/supabase-js';

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await expect(
    page.getByRole('button', { name: 'Reduce motion locally' }),
  ).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function staffProofClient() {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  return { client, actorId: signed.data.user!.id };
}

async function createCategories(page: Page, prefix: string) {
  const names = ['A', 'B'].map(
    (letter) => `${prefix} ${letter} ${crypto.randomUUID()}`,
  );
  for (const name of names) {
    await page.goto('/settings/categories');
    await page.getByLabel('Display name').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved.');
  }
  await page.goto('/settings/forms');
  const categoryLink = page.getByRole('link', { name: names[0], exact: true });
  const categoryHref = await categoryLink.getAttribute('href');
  expect(categoryHref).toBeTruthy();
  const categoryUrl = new URL(categoryHref!, page.url()).href;
  await categoryLink.click();
  await expect(page).toHaveURL(categoryUrl);
  await expect(
    page.getByRole('heading', { name: `${names[0]} form`, exact: true }),
  ).toBeVisible();
  return names;
}

test('failed and delayed category requests retain dirty and pending input and save the original category', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const proof = await staffProofClient();
  const actorId = proof.actorId;
  await proof.client.auth.signOut({ scope: 'local' });
  const identityPayload = JSON.stringify([actorId]);
  const isIdentity = (request: Request) =>
    request.method() === 'POST' && request.postData() === identityPayload;
  const names = await createCategories(page, 'Category request');
  const routeA = page.url();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  const selector = designer.getByLabel('Designer category', { exact: true });
  const categoryB = await selector
    .locator('option')
    .filter({ hasText: names[1] })
    .getAttribute('value');
  expect(categoryB).toBeTruthy();
  await designer.getByRole('button', { name: 'Add section' }).click();
  const heading = designer.getByLabel('Section heading').last();
  await heading.fill('Original category local section');
  let preflights = 0;
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/settings/forms/**', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postData()?.includes(categoryB!)
    ) {
      preflights++;
      started();
      await gate;
      await route.abort('failed');
    } else await route.continue();
  });
  page.once('dialog', (dialog) => dialog.dismiss());
  await selector.selectOption({ label: names[1] });
  await expect(page).toHaveURL(routeA);
  expect(preflights).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await selector.selectOption({ label: names[1] });
  await requested;
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Add field', exact: true });
  await modal.getByLabel('Field name').fill('Pending during failed load');
  release();
  await expect(designer.locator('[role="status"]')).toContainText(
    'could not be opened',
  );
  await expect(modal.getByLabel('Field name')).toHaveValue(
    'Pending during failed load',
  );
  await expect(heading).toHaveValue('Original category local section');
  await expect(page).toHaveURL(routeA);
  await page.screenshot({
    path: testInfo.outputPath('failed-category-pending-field.png'),
  });
  await page.keyboard.press('Escape');
  await page.unroute('**/settings/forms/**');
  // Learn the real action header from the exact actor argument. Flight stream
  // closure is not an action-result barrier: CI can leave a successful stream
  // open after the application has consumed its result.
  const identityProbe = page.waitForRequest(isIdentity);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const probeRequest = await identityProbe;
  expect(probeRequest.postData()).toBe(identityPayload);
  const identityAction = probeRequest.headers()['next-action'];
  expect(identityAction).toBeTruthy();
  expect((await probeRequest.response())?.ok()).toBe(true);
  await page.evaluate(() => {
    const proofWindow = window as Window & {
      navigationProofTriggers?: string[];
    };
    proofWindow.navigationProofTriggers = [];
    window.addEventListener('focus', () =>
      proofWindow.navigationProofTriggers!.push('focus'),
    );
    document.addEventListener('visibilitychange', () =>
      proofWindow.navigationProofTriggers!.push('visibilitychange'),
    );
  });
  let releaseDelayed!: () => void;
  let startedDelayed!: () => void;
  const delayed = new Promise<void>((resolve) => {
    startedDelayed = resolve;
  });
  const delayedGate = new Promise<void>((resolve) => {
    releaseDelayed = resolve;
  });
  await page.route('**/settings/forms/**', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postData()?.includes(categoryB!)
    ) {
      startedDelayed();
      await delayedGate;
    }
    await route.continue();
  });
  page.once('dialog', (dialog) => dialog.accept());
  await selector.selectOption({ label: names[1] });
  await delayed;
  const response = page.waitForResponse(
    (result) =>
      result.request().method() === 'POST' &&
      !!result.request().postData()?.includes(categoryB!),
  );
  // The new identity request proves the browser consumed the real B preflight
  // result. It does not prove the identity result or epoch callback has settled.
  // The deferred fetch + identity RTL regression proves that callback completes
  // without pushing B while A is still dirty/editable, before any Save occurs.
  await selector.selectOption({ label: names[0] });
  // Only a newly started exact identity action after release can complete this
  // barrier. An old in-flight check, metadata save or unrelated POST cannot.
  const identityStarted = page.waitForRequest(
    (request) =>
      isIdentity(request) &&
      request.headers()['next-action'] === identityAction,
  );
  releaseDelayed();
  expect((await response).ok()).toBe(true);
  const continuation = await identityStarted;
  const identityResponse = await continuation.response();
  expect(identityResponse?.ok()).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { navigationProofTriggers?: string[] })
          .navigationProofTriggers,
    ),
  ).toEqual([]);
  await expect(page).toHaveURL(routeA);
  await expect(selector).toHaveValue(
    new URL(routeA).pathname.split('/').at(-1)!,
  );
  await expect(heading).toHaveValue('Original category local section');
  await expect(
    designer.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeEnabled();
  await expect(designer.getByRole('status')).not.toContainText(
    /Loading selected category|Opening selected category/,
  );
  await page.unroute('**/settings/forms/**');
  await designer.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toContainText('Saved active form revision');
  await selector.selectOption({ label: names[1] });
  await expect(
    page.getByRole('heading', { name: `${names[1]} form`, exact: true }),
  ).toBeVisible();
  expect(
    await designer
      .getByLabel('Section heading')
      .evaluateAll((inputs) =>
        inputs.map((node) => (node as HTMLInputElement).value),
      ),
  ).not.toContain('Original category local section');
  await selector.selectOption({ label: names[0] });
  await expect(page).toHaveURL(routeA);
  await expect(designer.getByLabel('Section heading').last()).toHaveValue(
    'Original category local section',
  );
});

test('a lost committed designer response survives authorization denial and replays the exact reviewed command after same-page reauthorization', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const names = await createCategories(page, 'Unknown reviewed save');
  const formUrl = page.url();
  const categoryId = new URL(formUrl).pathname.split('/').at(-1)!;
  const { client, actorId } = await staffProofClient();
  const publications = async () => {
    const events = await client
      .from('form_publication_events')
      .select('id,revision_id,actor_id')
      .eq('category_id', categoryId)
      .order('id');
    expect(events.error).toBeNull();
    return events.data!;
  };
  const beforePublications = await publications();
  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Add quantity item' });
  await create
    .getByLabel('Name', { exact: true })
    .fill('Reviewed save item ' + crypto.randomUUID());
  await create.getByLabel('Category').selectOption({ label: names[0] });
  await metadataReviewButton(create).click();
  await metadataSaveButton(create).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await page.goto(formUrl);
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Add field', exact: true });
  await modal.getByLabel('Field name').fill('Reviewed required answer');
  await modal.getByRole('button', { name: 'Add to form' }).click();
  await designer
    .getByRole('checkbox', { name: 'Required', exact: true })
    .check();
  await designer.getByRole('button', { name: 'Save changes' }).click();
  const impact = designer.getByRole('region', { name: 'Form save impact' });
  await expect(impact).toContainText('1 quantity records');
  const commands: string[] = [];
  let committedRevision = '';
  let committedEvent = '';
  await page.route('**/settings/forms/**', async (route) => {
    const request = route.request();
    const body = request.postData();
    if (request.method() === 'POST' && body?.includes('review_token')) {
      commands.push(body);
      if (commands.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const text = await response.text();
        expect(text).toContain('"status":"saved"');
        committedRevision =
          text.match(/"published_revision_id":"([0-9a-f-]+)"/)?.[1] ?? '';
        expect(committedRevision).not.toBe('');
        committedEvent = text.match(/"event_id":"([0-9a-f-]+)"/)?.[1] ?? '';
        expect(committedEvent).not.toBe('');
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await impact
    .getByRole('button', { name: 'Confirm and save changes' })
    .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'save outcome could not be confirmed' }),
  ).toContainText('save outcome could not be confirmed');
  const committedPublications = await publications();
  expect(committedPublications).toHaveLength(beforePublications.length + 1);
  expect(
    committedPublications.filter(
      (event) => !beforePublications.some((before) => before.id === event.id),
    ),
  ).toEqual([
    { id: committedEvent, revision_id: committedRevision, actor_id: actorId },
  ]);
  const other = await context.newPage();
  try {
    await other.goto('/settings');
    await other.getByRole('button', { name: 'Sign out' }).click();
    await signIn(other, 'viewer');
    await designer.getByRole('button', { name: 'Retry original save' }).click();
    await expect(
      designer
        .getByRole('status')
        .filter({ hasText: 'Configuration access changed' }),
    ).toContainText('Configuration access changed');
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBe(commands[0]);
    await expect(
      designer.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('unknown-save-authorization-mask.png'),
    });
    await other.getByRole('button', { name: 'Sign out' }).click();
    await signIn(other);
    await designer
      .getByRole('button', { name: 'Retry access', exact: true })
      .click();
    await designer.getByRole('button', { name: 'Recover edits' }).click();
    await designer.getByRole('button', { name: 'Retry original save' }).click();
    await expect(
      designer
        .getByRole('status')
        .filter({ hasText: 'Saved active form revision' }),
    ).toContainText('Saved active form revision');
    expect(commands).toHaveLength(3);
    expect(commands[2]).toBe(commands[0]);
    try {
      const current = await client.rpc('metadata_form_get_v2', {
        p_category_id: categoryId,
      });
      expect(current.error).toBeNull();
      expect(
        (current.data as { published_revision_id: string })
          .published_revision_id,
      ).toBe(committedRevision);
      expect(await publications()).toEqual(committedPublications);
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  } finally {
    await page.unroute('**/settings/forms/**');
    await other.close();
  }
});

test('category routes, pending field recovery and native modal focus remain consistent through Back/Forward', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const names = [
    `Navigation A ${crypto.randomUUID()}`,
    `Navigation B ${crypto.randomUUID()}`,
  ];
  for (const name of names) {
    await page.goto('/settings/categories');
    await page.getByLabel('Display name').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved.');
  }
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: names[0], exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/forms\/[0-9a-f-]+$/);
  const routeA = page.url();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  const selector = designer.getByLabel('Designer category', { exact: true });
  await expect(
    selector.locator('option').filter({ hasText: names[1] }),
  ).toHaveCount(1);
  const categoryB = await selector
    .locator('option')
    .filter({ hasText: names[1] })
    .getAttribute('value');
  await selector.selectOption({ label: names[1] });
  await expect(page).toHaveURL(
    new URL(`/settings/forms/${categoryB}`, routeA).href,
  );
  await expect(
    page.getByRole('heading', { name: `${names[1]} form`, exact: true }),
  ).toBeVisible();
  const routeB = page.url();
  expect(routeB).not.toBe(routeA);
  await selector.selectOption({ label: names[0] });
  await expect(page).toHaveURL(routeA);
  await expect(
    page.getByRole('heading', { name: `${names[0]} form`, exact: true }),
  ).toBeVisible();

  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Add field', exact: true });
  await modal.getByRole('button', { name: 'Date & time', exact: true }).click();
  await modal
    .getByLabel('Field name', { exact: true })
    .fill('Pending appointment');
  const rulesSummary = modal
    .locator('summary')
    .filter({ hasText: /^Optional rules$/ });
  const rules = modal.locator('details').filter({
    has: page.locator('summary').filter({ hasText: /^Optional rules$/ }),
  });
  await rulesSummary.click();
  await rules.getByLabel('Display timezone').selectOption('America/Chicago');
  await rules.getByLabel('Date', { exact: true }).fill('2026-03-08');
  await rules.getByLabel('Time', { exact: true }).fill('02:30:00');
  const initialAnswer = rules.getByRole('group', {
    name: 'Starts with (optional)',
    exact: true,
  });
  await expect(initialAnswer.getByRole('alert')).toHaveText(
    'This time does not exist in this timezone. Choose another time.',
  );
  await page.goBack();
  await expect(page).toHaveURL(routeB);
  await expect(page.getByRole('button', { name: 'Recover edits' })).toHaveCount(
    0,
  );
  await page.goForward();
  await expect(page).toHaveURL(routeA);
  await page.getByRole('button', { name: 'Recover edits' }).click();
  await expect(modal.getByLabel('Field name', { exact: true })).toHaveValue(
    'Pending appointment',
  );
  await rulesSummary.click();
  await expect(rules.getByLabel('Display timezone')).toHaveValue(
    'America/Chicago',
  );
  await expect(rules.getByLabel('Date', { exact: true })).toHaveValue(
    '2026-03-08',
  );
  await expect(rules.getByLabel('Time', { exact: true })).toHaveValue(
    '02:30:00',
  );
  await expect(initialAnswer.getByRole('alert')).toHaveText(
    'This time does not exist in this timezone. Choose another time.',
  );
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(
    designer.getByRole('button', { name: 'Add field', exact: true }),
  ).toBeFocused();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 480 },
    { width: 1440, height: 330 },
  ]) {
    await page.setViewportSize(viewport);
    const canvas = designer.getByRole('button', {
      name: 'Canvas',
      exact: true,
    });
    if (await canvas.isVisible()) await canvas.click();
    const trigger = designer.getByRole('button', {
      name: 'Add field to Details',
      exact: true,
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await trigger.scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await page.evaluate(() =>
      document
        .querySelector('.experience-page-arrival')
        ?.animate(
          [{ transform: 'translateY(12px)' }, { transform: 'translateY(0)' }],
          { duration: 10000 },
        ),
    );
    await trigger.click();
    const box = await modal.boundingBox();
    expect(box).toBeTruthy();
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(box!.y).toBeGreaterThanOrEqual(15);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 15);
    expect(
      Math.abs(box!.y + box!.height / 2 - viewport.height / 2),
    ).toBeLessThan(2);
    await expect(
      modal.getByRole('button', { name: 'Add to form' }),
    ).toBeInViewport();
    await expect(
      modal.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeInViewport();
    await expect(
      modal.getByRole('button', { name: 'Cancel field addition', exact: true }),
    ).toBeInViewport();
    await modal.getByRole('button', { name: 'Add to form' }).focus();
    await page.keyboard.press('Tab');
    await expect(
      modal.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(
        `add-field-${viewport.width}-${viewport.height}.png`,
      ),
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.evaluate(() =>
      document
        .querySelector('.experience-page-arrival')
        ?.getAnimations()
        .forEach((animation) => animation.cancel()),
    );
  }
});

test('viewer controls personal motion in Settings and retains it across routes with OS precedence', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');
  const preference = page.getByRole('region', {
    name: 'Appearance & preferences',
  });
  await preference
    .getByRole('button', { name: 'Reduce motion locally' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    preference.getByRole('button', { name: 'Use system motion setting' }),
  ).toHaveText(/Reduced locally/);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Inventory' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(
    page.getByRole('button', { name: 'Use system motion setting' }),
  ).toHaveCount(0);
  await page.goto('/settings');
  await preference
    .getByRole('button', { name: 'Use system motion setting' })
    .click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    preference.getByRole('button', { name: 'Reduce motion locally' }),
  ).toHaveText(/Reduced by system/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});

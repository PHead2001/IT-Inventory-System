import { randomUUID } from 'node:crypto';
import { expectCategoryAdded } from './configuration-assertions';
import { expectPrivateTitleExcluded } from '../helpers/private-title';
import type { Route } from '@playwright/test';
import { interfaceTest, interfaceLogin } from './interface-fixtures';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { expect, test, type Page, type Request } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { createClient } from '@supabase/supabase-js';

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await expect(
    page.getByRole('switch', { name: 'Reduce motion in this browser' }),
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
  expect(api.port).toBe('45321');
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
    await expectCategoryAdded(page, name);
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
  await expect(
    designer.getByRole('status').filter({ hasText: 'could not be opened' }),
  ).toContainText('could not be opened');
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
  let primaryFailure: unknown;
  try {
    await other.goto('/settings');
    await other.getByRole('button', { name: 'Sign out' }).click();
    await signIn(other, 'viewer');
    await expect(
      page.getByRole('alert').filter({ hasText: 'original account access' }),
    ).toBeVisible();
    await expect(designer).toHaveCount(0);
    expect(commands).toHaveLength(1);
    expect(await publications()).toEqual(committedPublications);
    await page.screenshot({
      path: testInfo.outputPath('unknown-save-authorization-mask.png'),
    });
    await other.getByRole('button', { name: 'Sign out' }).click();
    await signIn(other);
    const workspaceRetry = page.getByRole('button', {
      name: 'Retry privacy cleanup',
      exact: true,
    });
    const deniedDesigner = designer
      .getByRole('status')
      .filter({ hasText: 'Configuration access changed' });
    // A fresh external check may already verify the restored original binding.
    // Otherwise explicitly finish workspace verification before touching its owner.
    await expect
      .poll(
        async () =>
          (await workspaceRetry.isVisible()) ||
          (await deniedDesigner.isVisible()),
      )
      .toBe(true);
    if (await workspaceRetry.isVisible()) await workspaceRetry.click();
    await expect(
      designer
        .getByRole('status')
        .filter({ hasText: 'Configuration access changed' }),
    ).toContainText('Configuration access changed');
    expect(commands).toHaveLength(1);
    await expect(
      designer.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
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
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBe(commands[0]);
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
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([
      page.isClosed()
        ? Promise.resolve()
        : page.unroute('**/settings/forms/**'),
      other.isClosed() ? Promise.resolve() : other.close(),
    ]);
    // Preserve the earlier assertion/timeout if teardown closes its targets.
    if (primaryFailure === undefined) {
      for (const result of cleanup)
        if (result.status === 'rejected') throw result.reason;
    }
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
    await expectCategoryAdded(page, name);
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
  await expect(
    preference.getByRole('switch', { name: 'Reduce motion in this browser' }),
  ).toBeEnabled();
  await preference
    .getByRole('switch', { name: 'Reduce motion in this browser' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    preference.getByRole('switch', { name: 'Reduce motion in this browser' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Inventory' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(
    page.getByRole('switch', { name: 'Reduce motion in this browser' }),
  ).toHaveCount(0);
  await page.goto('/settings');
  await preference
    .getByRole('switch', { name: 'Reduce motion in this browser' })
    .click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    preference.getByRole('switch', { name: 'Reduce motion in this browser' }),
  ).toHaveAccessibleDescription(
    'Reduced motion is required by your system, even when this switch is off.',
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});

test('motion Settings waits for the browser choice before the first keyboard activation', async ({
  page,
  context,
}) => {
  await signIn(page, 'viewer');
  for (const saved of [false, true]) {
    await page.evaluate(
      (value) =>
        localStorage.setItem('it-inventory-reduce-motion', String(value)),
      saved,
    );
    const probe = await context.newPage();
    await probe.emulateMedia({ reducedMotion: 'no-preference' });
    let release!: () => void;
    const scripts = new Promise<void>((resolve) => {
      release = resolve;
    });
    await probe.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await scripts;
      await route.continue();
    });
    try {
      await probe.goto('/settings', { waitUntil: 'commit' });
      // Settings is withheld by the protected privacy gate until its scripts
      // can verify restoration. The standalone toggle's SSR loading state is
      // covered at the component layer; this route must expose no control yet.
      await expect(
        probe.getByRole('status').filter({
          hasText: 'Clearing private data from this tab…',
        }),
      ).toBeVisible();
      await expect(
        probe.locator('[aria-label="Reduce motion in this browser"]'),
      ).toHaveCount(0);
      await expect(probe.getByRole('switch')).toHaveCount(0);
      await expect(
        probe.getByRole('heading', { name: 'Settings', exact: true }),
      ).toHaveCount(0);
      await expect(probe.locator('html')).toHaveAttribute(
        'data-motion',
        'reduced',
      );
      release();
      const toggle = probe.getByRole('switch', {
        name: 'Reduce motion in this browser',
      });
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveAttribute('aria-checked', String(saved));
      await toggle.focus();
      await probe.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', String(!saved));
      await expect(probe.locator('html')).toHaveAttribute(
        'data-motion',
        saved ? 'full' : 'reduced',
      );
      await probe.reload();
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveAttribute('aria-checked', String(!saved));
    } finally {
      release();
      await probe.close();
    }
  }
});

for (const width of [1280, 375, 390]) {
  for (const reduced of [false, true]) {
    test(`working controls preserve accessible state at ${width}px with ${reduced ? 'Reduced' : 'Full'} motion`, async ({
      page,
    }, testInfo) => {
      await signIn(page);
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      await page.emulateMedia({
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      });
      await page.goto('/settings');
      const toggle = page.getByRole('switch', {
        name: 'Reduce motion in this browser',
      });
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('html')).toHaveAttribute(
        'data-motion',
        'reduced',
      );
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('html')).toHaveAttribute(
        'data-motion',
        reduced ? 'reduced' : 'full',
      );
      await expect(toggle).toHaveAccessibleDescription(
        reduced
          ? 'Reduced motion is required by your system, even when this switch is off.'
          : 'Full motion is active.',
      );
      await page.screenshot({
        path: testInfo.outputPath('motion-settings.png'),
        fullPage: true,
      });

      await page.goto('/settings/locations');
      const tree = page.getByRole('tree', { name: 'Locations' });
      const right = tree.getByRole('treeitem', { name: /ITC-R · Active$/ });
      await expect(right).toHaveAttribute('aria-expanded', 'false');
      await expect(
        tree.getByRole('treeitem', { name: /ITC-D07 · Active$/ }),
      ).toHaveCount(0);
      await right.focus();
      await page.keyboard.press('ArrowRight');
      await expect(
        tree.getByRole('treeitem', { name: /ITC-D07 · Active$/ }),
      ).toBeVisible();
      await page
        .getByLabel('Search locations', { exact: true })
        .fill('ITC-D07');
      const selected = tree.getByRole('treeitem', {
        name: /ITC-D07 · Active$/,
      });
      await expect(right).toHaveAttribute('aria-expanded', 'true');
      const disclosure = right.getByRole('button', {
        name: 'Collapse Right Storage',
        exact: true,
      });
      await disclosure.click();
      await expect(right).toHaveAttribute('aria-expanded', 'false');
      await expect(right).toBeFocused();
      await right.press('ArrowRight');
      await expect(right).toHaveAttribute('aria-expanded', 'true');
      await right.press('ArrowRight');
      await expect(selected).toBeFocused();
      if (width === 1280 && !reduced) {
        const original = page.url();
        const context = page.context();
        const destination = new URL('/settings/locations/ITC-D07', original)
          .href;
        async function openLocationTab(action: () => Promise<void>) {
          const before = context.pages().length;
          // Browser-managed Ctrl/middle-click tabs need not retain an opener,
          // so their authoritative creation event belongs to the context.
          const tabPromise = context.waitForEvent('page');
          await action();
          const tab = await tabPromise;
          try {
            await expect(tab).toHaveURL(destination);
            expect(context.pages()).toHaveLength(before + 1);
            await expect(page).toHaveURL(original);
          } finally {
            await tab.close();
          }
          expect(context.pages()).toHaveLength(before);
        }
        await openLocationTab(() =>
          selected.getByRole('link').click({ modifiers: ['Control'] }),
        );
        await expect(selected).toBeFocused();
        await openLocationTab(() =>
          selected.getByRole('link').click({ button: 'middle' }),
        );
        await expect(selected).toBeFocused();
        await openLocationTab(() => selected.press('Control+Enter'));
        await expect(selected).toBeFocused();
      }
      await expect(selected).toHaveAttribute('aria-level', '3');
      await selected.press('Enter');
      await expect(page).toHaveURL(/\/settings\/locations\/ITC-D07$/);
      await page
        .getByRole('link', { name: 'All locations', exact: true })
        .click();
      const returned = page.getByRole('treeitem', {
        name: /ITC-D07 · Active$/,
      });
      await expect(returned).toHaveAttribute('aria-selected', 'true');
      await expect(returned).not.toHaveAttribute('aria-current');
      await expect(returned).toHaveAttribute('tabindex', '0');
      await expect(returned.getByRole('link')).toHaveAttribute(
        'tabindex',
        '-1',
      );
      await returned.focus();
      await expect(returned).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath('selected-location-tree.png'),
        fullPage: true,
      });

      await page.goto('/locations/ITC-RED?status=all');
      const actions = page.getByRole('navigation', {
        name: 'Location actions',
      });
      await expect(actions.getByRole('link')).toHaveCount(4);
      const actionLinks = actions.getByRole('link');
      await actionLinks.first().focus();
      for (let index = 1; index < 4; index++) {
        await page.keyboard.press('Tab');
        await expect(actionLinks.nth(index)).toBeFocused();
      }

      await expect(
        actions.getByRole('link', { name: 'Print label', exact: true }),
      ).toHaveAttribute('href', '/labels?location=ITC-RED');
      await expect(
        actions.getByRole('link', { name: 'History', exact: true }),
      ).toHaveAttribute('href', '/history?location=ITC-RED');
      const exportHref = await actions
        .getByRole('link', { name: 'Export', exact: true })
        .getAttribute('href');
      const exportQuery = new URL(exportHref!, page.url()).searchParams;
      expect(exportQuery.get('location')).toBe('ITC-RED');
      expect(exportQuery.get('status')).toBe('all');
      await expect(page.getByText(/Current scope:/)).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'All statuses', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('html')).toHaveAttribute(
        'data-motion',
        reduced ? 'reduced' : 'full',
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('location-actions.png'),
        fullPage: true,
      });

      await page.goto('/inventory/assets/new');
      const form = page.getByRole('form', {
        name: 'Add individual asset',
        exact: true,
      });
      await metadataReviewButton(form).click();
      const summary = form
        .getByRole('alert')
        .filter({ has: page.getByRole('list') });
      await expect(summary.getByRole('listitem')).not.toHaveCount(0);
      const links = summary.getByRole('link');
      const firstId = (await links.first().getAttribute('href'))!.slice(1);
      await expect
        .poll(() =>
          page
            .locator(`[id="${firstId}"]`)
            .evaluate(
              (field) =>
                field === document.activeElement ||
                field.contains(document.activeElement),
            ),
        )
        .toBe(true);
      await links.last().click();
      const lastId = (await links.last().getAttribute('href'))!.slice(1);
      await expect
        .poll(() =>
          page
            .locator(`[id="${lastId}"]`)
            .evaluate(
              (field) =>
                field === document.activeElement ||
                field.contains(document.activeElement),
            ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('linked-validation-errors.png'),
        fullPage: true,
      });
    });
  }
}

// Synthetic navigation-boundary fixture: rewrite only a real owned NextLink's
// non-prefetch RSC request. The record remains intact; this is not deletion proof.
interfaceTest(
  'synthetic RSC missing-resource response uses the client navigation boundary and private-safe recovery',
  async ({ page, interfaceRecord }, info) => {
    await interfaceLogin(page);
    const ownedPath = `/inventory/quantity/${interfaceRecord.id}`;
    const missingId = randomUUID();
    const missingPath = `/inventory/quantity/${missingId}`;
    const navigations: string[] = [];
    const prefetches: string[] = [];
    const intercepted: Request[] = [];
    let responseStatus: number | undefined;
    let responseTitle: string | undefined;
    const matches = (url: URL) => url.pathname === ownedPath;
    const handler = async (route: Route) => {
      const request = route.request();
      const headers = request.headers();
      const prefetch =
        headers['next-router-prefetch'] === '1' ||
        headers.purpose === 'prefetch' ||
        headers['sec-purpose']?.includes('prefetch');
      if (prefetch) prefetches.push(request.url());
      if (!prefetch && request.method() === 'GET' && headers.rsc === '1') {
        const target = new URL(request.url());
        target.pathname = missingPath;
        intercepted.push(request);
        await route.continue({ url: target.href });
      } else await route.continue();
    };
    const recordDocument = (request: Request) => {
      if (request.resourceType() === 'document')
        navigations.push(request.url());
    };
    await page.route(matches, handler);
    try {
      await page.goto(
        '/inventory?q=' + encodeURIComponent(interfaceRecord.name),
      );
      const link = page.getByRole('link', {
        name: interfaceRecord.name,
        exact: true,
      });
      await expect(link).toBeVisible();
      expect(
        new URL((await link.getAttribute('href'))!, page.url()).pathname,
      ).toBe(ownedPath);
      page.on('request', recordDocument);
      const arrived = page.waitForResponse((response) =>
        intercepted.includes(response.request()),
      );
      await link.click();
      const response = await arrived;
      responseStatus = response.status();
      expect(response.headers()['content-type']).toContain('text/x-component');
      expect(intercepted.length).toBeGreaterThan(0);
      await expect(
        page.getByRole('heading', {
          name: 'Inventory record unavailable',
          exact: true,
        }),
      ).toBeVisible();
      // Successful static layout metadata may remain when page-data notFound
      // activates the client boundary independently of metadata resolution.
      await expect(page).toHaveTitle('Quantity item · IT Inventory');
      responseTitle = await page.title();
      for (const privateValue of [
        interfaceRecord.id,
        missingId,
        interfaceRecord.name,
      ]) {
        await expectPrivateTitleExcluded(page, privateValue);
        await expect(page.locator('main')).not.toContainText(privateValue);
      }
      expect(
        navigations,
        'Client RSC arrival must not fall back to document navigation',
      ).toEqual([]);
      await page
        .getByRole('link', { name: 'Search inventory', exact: true })
        .click();
      await expect(page).toHaveURL(/\/inventory$/);
      await expect(page).toHaveTitle('Inventory · IT Inventory');
      expect(navigations).toEqual([]);
    } finally {
      page.off('request', recordDocument);
      await page.unroute(matches, handler);
      await info.attach('synthetic RSC navigation evidence', {
        body: JSON.stringify({
          synthetic: true,
          observedNavigationRsc: intercepted.length,
          untouchedPrefetches: prefetches,
          rscResponseStatus: responseStatus,
          observedClientTitle: responseTitle,
          documentNavigations: navigations,
        }),
        contentType: 'application/json',
      });
    }
  },
);

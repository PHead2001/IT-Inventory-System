import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { acceptanceFixtures } from './audit-three-acceptance-fixtures';
import { openRecordTask } from './record-task-controls';
import { isLogoutGeneration } from '../../src/lib/auth/privacy-barrier';
// No credentials or private token URLs in browser artifacts.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const command = 'inventory-assign-v1:logout-generation-e2e';
const batch = 'inventory-assign-batch-v1:logout-generation-e2e';
const labels = 'it-inventory-label-queue:v1:logout-generation-e2e';
const acknowledgement = 'inventory-logout-acknowledgement-v1';

test('same-tab sign-in after logout permits a second ordinary logout and protects inventory', async ({
  page,
}) => {
  await signIn(page, fixture.emails.staff);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    const login = page.getByRole('form', { name: 'Sign in', exact: true });
    await expect(login).toBeVisible();
    await expect(login.getByLabel('Email', { exact: true })).toBeEditable();
    await expect(login.getByLabel('Password', { exact: true })).toBeEditable();
    await expect(
      login.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeEnabled();
    if (cycle === 0) {
      // Use the resulting form in the retained tab, without navigating/reloading.
      await login
        .getByLabel('Email', { exact: true })
        .fill(fixture.emails.staff);
      await login
        .getByLabel('Password', { exact: true })
        .fill(fixture.password);
      await login.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/inventory$/);
      await expect(
        page.getByRole('button', { name: 'Sign out', exact: true }),
      ).toBeVisible();
    }
  }
  await page.goto('/inventory');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByLabel('Email', { exact: true })).toBeEditable();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(0);
});

async function signIn(page: Page, email: string = fixture.emails.viewer) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}
async function seedAndBlockFirstRead(page: Page) {
  await page.evaluate(
    ({ command, batch, labels }) => {
      sessionStorage.setItem(command, 'synthetic exact uncertain command');
      sessionStorage.setItem(batch, 'synthetic private batch');
      sessionStorage.setItem(labels, 'synthetic label');
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (
          key === 'inventory-assign-cleanup-v1' ||
          key === 'inventory-assign-scope-v1'
        )
          throw new Error('Synthetic storage denial before tombstone');
        return get.call(this, key);
      };
    },
    { command, batch, labels },
  );
}
async function reminder(page: Page) {
  return (await page.context().cookies()).find(
    (cookie) =>
      cookie.name === 'inventory-logout-local-v1' ||
      cookie.name === '__Host-inventory-logout-v1',
  );
}
function reminderGeneration(value: string) {
  // Browser cookie APIs expose the encoded wire value; Next decodes it on read.
  const decoded = decodeURIComponent(value);
  expect(decoded.startsWith('v1:')).toBe(true);
  const generation = decoded.slice(3);
  expect(isLogoutGeneration(generation)).toBe(true);
  return generation;
}
test('real logout survives a first cleanup read failure and a hard reload before tab acknowledgement', async ({
  page,
}) => {
  await signIn(page);
  await seedAndBlockFirstRead(page);
  const signedOut = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/logout' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  // Callback invalidation can expose a privacy-check alert before logout settles.
  // Confirm the actual logout receipt before checking its retained cookie.
  const response = await signedOut;
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt).toEqual({
    ok: true,
    logoutGeneration: expect.any(String),
  });
  expect(isLogoutGeneration(receipt.logoutGeneration)).toBe(true);
  await expect(
    page.getByRole('alert').filter({
      hasText: /could not clear|cannot be verified/,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const cookie = await reminder(page);
      return cookie ? decodeURIComponent(cookie.value) : null;
    })
    .toBe(`v1:${receipt.logoutGeneration}`);
  const retained = await reminder(page);
  expect(retained?.httpOnly).toBe(true);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), command),
  ).toBe('synthetic exact uncertain command');
  await page.reload();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  for (const key of [command, batch, labels])
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), key),
    ).toBeNull();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), acknowledgement),
  ).toBe(reminderGeneration(retained!.value));
  expect((await reminder(page))?.value).toBe(retained!.value);
});
test('one tab acknowledgement cannot consume another tab reminder before same-actor protected reload', async ({
  page,
  context,
}) => {
  await signIn(page);
  const other = await context.newPage();
  await other.goto('/inventory');
  await expect(
    other.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await seedAndBlockFirstRead(other);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  const retained = await reminder(page);
  expect(retained?.httpOnly).toBe(true);
  await signIn(page);
  // Both tabs share new Auth cookies; the old tab enters a protected URL directly.
  await other.reload();
  await expect(other).toHaveURL(/\/inventory$/);
  await expect(
    other.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  expect(
    await other.evaluate((key) => sessionStorage.getItem(key), command),
  ).toBeNull();
  expect(
    await other.evaluate((key) => sessionStorage.getItem(key), acknowledgement),
  ).toBe(reminderGeneration(retained!.value));
  expect((await reminder(other))?.value).toBe(retained!.value);
  // A member arriving at login cleans/checks this tab then resumes its safe destination.
  await other.goto('/login?next=%2Fdashboard');
  await expect(other).toHaveURL(/\/dashboard$/);
  await other.close();
});

test('real query-only Scan navigation withholds assignment storage bootstrap while verification is deferred', async ({
  page,
}) => {
  await signIn(page, fixture.emails.staff);
  await page.goto('/scan');
  await expect(
    page.getByRole('link', { name: 'Assign equipment', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const reads: string[] = [];
    (
      window as Window & { privacyBootstrapReads?: string[] }
    ).privacyBootstrapReads = reads;
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith('inventory-assign-batch-v1:')) reads.push(key);
      return get.call(this, key);
    };
  });
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route('**/scan*', async (route) => {
    const request = route.request();
    // This fixture deliberately defers the no-argument privacy-generation read.
    // Inspection/search actions carry business arguments and must pass through.
    let privacyRead = false;
    if (request.method() === 'POST' && request.headers()['next-action']) {
      try {
        const args: unknown = request.postDataJSON();
        privacyRead = Array.isArray(args) && args.length === 0;
      } catch {
        privacyRead = false;
      }
    }
    if (!held && privacyRead) {
      held = true;
      await deferred;
    }
    await route.continue();
  });
  try {
    await page
      .getByRole('link', { name: 'Assign equipment', exact: true })
      .click();
    await expect(page).toHaveURL(/\/scan\?mode=assign$/);
    await expect.poll(() => held).toBe(true);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { privacyBootstrapReads?: string[] })
            .privacyBootstrapReads?.length ?? -1,
      ),
    ).toBe(0);
    await expect(
      page.getByRole('form', { name: 'Inspect equipment' }),
    ).not.toBeVisible();
    release();
    await expect(
      page.getByRole('form', { name: 'Inspect equipment' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as Window & { privacyBootstrapReads?: string[] })
            .privacyBootstrapReads?.length ?? 0,
      ),
    ).toBeGreaterThan(0);
  } finally {
    release();
    await page.unroute('**/scan*');
  }
});

// This runs the real Next/Auth workspace. The late head writes and retained
// secondary-title nodes are synthetic reconciliation stimuli, not streaming proof.
async function expectRetainedTitles(page: Page, title: string) {
  await expect(page).toHaveTitle(title);
  await expect
    .poll(async () => {
      const titles = await page.locator('head title').allTextContents();
      return titles.length > 0 && titles.every((value) => value === title);
    })
    .toBe(true);
}
test('private document title clears on real privacy failure and logout, then restores the same mounted draft', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  let other: Page | undefined;
  let rejectPrivacy = false;
  const assetName = `Title privacy ${owned.suffix}`;
  const draftName = `Unsaved title draft ${owned.suffix}`;
  const lateSafeHead = async () => {
    await page.evaluate(() => {
      const nextTitle = document.createElement('title');
      nextTitle.textContent = 'Individual asset · IT Inventory';
      document.head.querySelector('title')?.replaceWith(nextTitle);
    });
  };
  const lateRetainedHead = async (privateTitle: string) => {
    await page.evaluate((privateText) => {
      const first = document.head.querySelector('title');
      if (first) first.textContent = 'IT Inventory';
      for (const value of [privateText, 'Delayed private secondary title']) {
        const title = document.createElement('title');
        title.dataset.privacyTitleFixture = 'retained';
        title.textContent = value;
        document.head.append(title);
      }
    }, privateTitle);
  };
  await page.route('**/inventory/assets/**', async (route) => {
    const request = route.request();
    let noArgumentPrivacyAction = false;
    if (request.method() === 'POST' && request.headers()['next-action']) {
      try {
        const args: unknown = request.postDataJSON();
        noArgumentPrivacyAction = Array.isArray(args) && args.length === 0;
      } catch {
        noArgumentPrivacyAction = false;
      }
    }
    if (rejectPrivacy && noArgumentPrivacyAction) await route.abort('failed');
    else await route.continue();
  });
  try {
    const assetId = await owned.asset(
      assetName,
      await owned.location('ITC-RED'),
    );
    await signIn(page, fixture.emails.staff);
    await page.goto(`/inventory/assets/${assetId}`);
    await expectRetainedTitles(page, `${assetName} · IT Inventory`);
    const form = await openRecordTask(page, 'Edit asset metadata');
    const name = form.getByLabel('Name', { exact: true });
    await name.fill(draftName);
    const retainedInput = await name.elementHandle();
    expect(retainedInput).not.toBeNull();
    // The document follows the authorized saved record, not an unsaved edit.
    await expectRetainedTitles(page, `${assetName} · IT Inventory`);
    await lateSafeHead();
    await expectRetainedTitles(page, `${assetName} · IT Inventory`);

    rejectPrivacy = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const retry = page.getByRole('button', { name: 'Retry privacy cleanup' });
    await expect(retry).toBeVisible();
    await expectRetainedTitles(page, 'IT Inventory');
    await expect(form).not.toBeVisible();
    expect(await retainedInput!.evaluate((input) => input.isConnected)).toBe(
      true,
    );
    await lateSafeHead();
    await lateRetainedHead(`${assetName} · IT Inventory`);
    await expectRetainedTitles(page, 'IT Inventory');
    expect(
      await page.locator('title[data-privacy-title-fixture]').count(),
    ).toBeGreaterThanOrEqual(2);
    rejectPrivacy = false;
    await retry.click();
    await expect(form).toBeVisible();
    await expect(name).toHaveValue(draftName);
    expect(
      await name.evaluate(
        (input, original) => input === original,
        retainedInput!,
      ),
    ).toBe(true);
    await expectRetainedTitles(page, `${assetName} · IT Inventory`);

    // Server logout changes the real generation even without a client Auth event
    // in this retained tab. The original owner's verification must revoke it.
    other = await context.newPage();
    await other.goto('/inventory');
    await other.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(other).toHaveURL(/\/login$/);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(retry).toBeVisible();
    await expectRetainedTitles(page, 'IT Inventory');
    await expect(form).not.toBeVisible();
    await lateSafeHead();
    await expectRetainedTitles(page, 'IT Inventory');
    await signIn(other, fixture.emails.staff);
    await retry.click();
    await expect(form).toBeVisible();
    await expect(name).toHaveValue(draftName);
    expect(
      await name.evaluate(
        (input, original) => input === original,
        retainedInput!,
      ),
    ).toBe(true);
    await expectRetainedTitles(page, `${assetName} · IT Inventory`);
    await lateSafeHead();
    await expectRetainedTitles(page, `${assetName} · IT Inventory`);
    const record = await owned.caller
      .from('serialized_assets')
      .select('name,version')
      .eq('id', assetId)
      .single();
    expect(record.error).toBeNull();
    expect(record.data!.name).toBe(assetName);
    expect(String(record.data!.version)).toBe('1');
  } finally {
    rejectPrivacy = false;
    await page
      .evaluate(() =>
        document.head
          .querySelectorAll('title[data-privacy-title-fixture]')
          .forEach((node) => node.remove()),
      )
      .catch(() => {});
    await page.unroute('**/inventory/assets/**');
    await other?.close();
    await owned.cleanup();
  }
});

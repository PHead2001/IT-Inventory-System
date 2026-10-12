import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { withDisposablePasswordAccount } from './disposable-password-account';
// Auth proof must never retain entered passwords or token-bearing URLs.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const fixtureEmails = fixture.emails,
  fixturePassword = fixture.password;
const localClient = (key: string) => {
  const url = new URL(process.env.LOCAL_API_URL!);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.port !== '54321'
  )
    throw new Error('Refusing nonlocal Auth test target');
  return createClient(url.href, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};
const admin = () => localClient(process.env.LOCAL_SERVICE_ROLE_KEY!);
async function capturedEmailLink(request: APIRequestContext, email: string) {
  const mailpit = 'http://127.0.0.1:54324/api/v1';
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(mailpit + '/messages');
        expect(response.ok()).toBe(true);
        const inbox = (await response.json()) as {
          messages: { ID: string; To: { Address: string }[] }[];
        };
        messageId = inbox.messages.find((message) =>
          message.To.some((recipient) => recipient.Address === email),
        )?.ID;
        return messageId;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  const response = await request.get(
    mailpit + '/message/' + encodeURIComponent(messageId!),
  );
  expect(response.ok()).toBe(true);
  const message = (await response.json()) as { HTML: string };
  const href = /href="([^"]+)"/.exec(message.HTML)?.[1];
  expect(
    href,
    'captured application email contains a confirmation link',
  ).toBeTruthy();
  return new URL(href!.replaceAll('&amp;', '&'));
}

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
test('public registration remains disabled with email sign-in enabled', async () => {
  const client = localClient(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  const result = await client.auth.signUp({
    email: 'uninvited-' + crypto.randomUUID() + '@example.test',
    password: fixturePassword,
  });
  expect(result.error?.code).toBe('signup_disabled');
  expect(result.data.session).toBeNull();
  expect(result.data.user).toBeNull();
});

test('anonymous navigation cannot browse the application', async ({ page }) => {
  await page.goto('/inventory');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
});
test('unverified password sessions offer touch-sized phone recovery controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/set-password');
  const recovery = page.getByRole('navigation', { name: 'Password recovery' });
  for (const name of ['Sign in again', 'Request a new reset email']) {
    const link = recovery.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await recovery
    .getByRole('link', { name: 'Sign in again', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?switch=1$/);
});
test('anonymous public 404 Overview recovery preserves its destination through sign-in', async ({
  page,
}) => {
  await page.goto('/audit3-missing-' + crypto.randomUUID());
  const recoveryDocument = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('link', { name: 'Open Overview', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(
    recoveryDocument,
  );
  await page.getByLabel('Email', { exact: true }).fill(fixtureEmails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
for (const role of ['staff', 'viewer'] as const)
  test(
    role + ' can read the inventory workspace and sign out',
    async ({ page }) => {
      await signIn(page, fixtureEmails[role]);
      await expect(
        page.getByRole('heading', { name: 'Inventory', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('form', { name: 'Search inventory' }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Locations', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('link', { name: 'Spaces & maps', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Spaces & maps' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
    },
  );
for (const role of ['inactive', 'nonmember'] as const)
  test(role + ' is denied despite valid Auth credentials', async ({ page }) => {
    await signIn(page, fixtureEmails[role]);
    await expect(
      page.getByRole('heading', { name: 'Access is not enabled' }),
    ).toBeVisible();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/access-denied$/);
  });
test('existing session loses access immediately after membership deactivation', async ({
  page,
}) => {
  await signIn(page, fixtureEmails.staff);
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  const client = admin();
  const listed = await client.auth.admin.listUsers();
  const user = listed.data.users.find((u) => u.email === fixtureEmails.staff)!;
  const disabled = await client
    .from('app_members')
    .update({ active: false })
    .eq('user_id', user.id);
  expect(disabled.error).toBeNull();
  try {
    await page.reload();
    await expect(page).toHaveURL(/\/access-denied$/);
  } finally {
    const restored = await client
      .from('app_members')
      .update({ active: true })
      .eq('user_id', user.id);
    expect(restored.error).toBeNull();
  }
});
test('phone navigation remains usable and has no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, fixtureEmails.viewer);
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className:
          typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));
  expect(width.document, JSON.stringify(width.offenders)).toBeLessThanOrEqual(
    width.viewport,
  );
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('link', { name: 'Spaces & maps', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Spaces & maps' }),
  ).toBeVisible();
});
for (const destination of ['default', 'preview'] as const)
  test(
    'invitation email uses ' +
      destination +
      ' destination without consuming on GET',
    async ({ page, request }) => {
      const email = 'invite-' + crypto.randomUUID() + '@example.test';
      const client = admin();
      const origin =
        destination === 'preview'
          ? process.env.APP_ORIGIN!
          : 'http://localhost:3000';
      const invited = await client.auth.admin.inviteUserByEmail(
        email,
        destination === 'preview'
          ? { redirectTo: origin + '/auth/confirm' }
          : {},
      );
      if (invited.error) throw invited.error;
      const link = await capturedEmailLink(request, email);
      expect(link.origin).toBe(origin);
      expect(link.pathname).toBe('/auth/confirm');
      expect(link.searchParams.get('type')).toBe('invite');
      await page.goto(link.href);
      await page.reload();
      await page.getByRole('button', { name: 'Continue securely' }).click();
      await expect(page).toHaveURL(origin + '/set-password');
      await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
      await page
        .getByLabel('Confirm password', { exact: true })
        .fill(fixturePassword);
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(page).toHaveURL(origin + '/login?password=updated');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(origin + '/access-denied');
    },
  );

test('recovery email returns to the requesting deployment and changes the password', async ({
  page,
  request,
}) => {
  const client = admin();
  const email = 'recover-' + crypto.randomUUID() + '@example.test';
  const created = await client.auth.admin.createUser({
    email,
    password: fixturePassword,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const membership = await client.from('app_members').insert({
    user_id: created.data.user.id,
    display_name: 'Recovery Test',
    role: 'viewer',
    active: true,
  });
  expect(membership.error).toBeNull();
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset email' }).click();
  await expect(page.getByRole('status')).toContainText(
    'If this address has an account',
  );
  const link = await capturedEmailLink(request, email);
  expect(process.env.APP_ORIGIN).not.toBe('http://localhost:3000');
  expect(link.origin).toBe(process.env.APP_ORIGIN);
  expect(link.pathname).toBe('/auth/confirm');
  expect(link.searchParams.get('type')).toBe('recovery');
  await page.goto(link.href);
  await page.reload();
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await expect(page).toHaveURL(process.env.APP_ORIGIN + '/set-password');
  const password = fixturePassword + '-reset';
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page).toHaveURL(
    process.env.APP_ORIGIN + '/login?password=updated',
  );
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
});

test('ordinary signed-in login visits return safely and explicit account switching remains usable', async ({
  page,
}) => {
  await signIn(page, fixtureEmails.staff);
  await expect(page).toHaveURL(/\/inventory$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/inventory$/);
  await page.goto('/login?next=' + encodeURIComponent('/locations/ITC'));
  await expect(page).toHaveURL(/\/locations\/ITC$/);
  await page.goto('/login?next=' + encodeURIComponent('https://evil.example'));
  await expect(page).toHaveURL(/\/inventory$/);
  await page.goto('/login?switch=1');
  await page.getByLabel('Email', { exact: true }).fill(fixtureEmails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
});

test('ordinary password changes require the current password and end the local session', async ({
  page,
}) => {
  const email = 'change-' + crypto.randomUUID() + '@example.test';
  const client = admin();
  await withDisposablePasswordAccount(
    client,
    { email, password: fixturePassword },
    async () => {
      try {
        await page.goto('/dashboard');
        if (new URL(page.url()).pathname !== '/login') {
          await page
            .getByRole('button', { name: 'Sign out', exact: true })
            .click();
          await expect(page).toHaveURL(/\/login(?:\?|$)/);
        }
      } finally {
        await page.context().clearCookies();
      }
    },
    async () => {
      await signIn(page, email);
      await expect(page).toHaveURL(/\/inventory$/);
      await page.goto('/set-password?recovery=true');
      await expect(page.getByLabel('Current password')).toBeVisible();
      await page.getByLabel('Current password').fill('IncorrectPassword123456');
      await page
        .getByLabel('Password', { exact: true })
        .fill(fixturePassword + '-new');
      await page.getByLabel('Confirm password').fill(fixturePassword + '-new');
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(
        page.getByRole('form', { name: 'Set password' }).getByRole('alert'),
      ).toContainText('Unable to update');
      await page.getByLabel('Current password').fill(fixturePassword);
      await page
        .getByLabel('Password', { exact: true })
        .fill(fixturePassword + '-new');
      await page.getByLabel('Confirm password').fill(fixturePassword + '-new');
      const authCookieCount = async () =>
        (await page.context().cookies()).filter((cookie) =>
          /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name),
        ).length;
      expect(await authCookieCount()).toBeGreaterThan(0);
      await page.evaluate(() => {
        const evidence = { cleanups: 0 };
        (
          window as Window & { passwordLogoutEvidence?: typeof evidence }
        ).passwordLogoutEvidence = evidence;
        window.addEventListener('assignment-scope-invalidated', () => {
          evidence.cleanups += 1;
        });
      });
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(page).toHaveURL(/\/login\?password=updated$/);
      // The real action deletes cookies and re-renders the password page Flight.
      // Reaching this URL with a cleanup signal proves the client result owner survived.
      expect(await authCookieCount()).toBe(0);
      expect(
        await page.evaluate(
          () =>
            (
              window as Window & {
                passwordLogoutEvidence?: { cleanups: number };
              }
            ).passwordLogoutEvidence?.cleanups ?? 0,
        ),
      ).toBeGreaterThan(0);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page
        .getByLabel('Password', { exact: true })
        .fill(fixturePassword + '-new');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/inventory$/);
    },
  );
});

test('recovery exchanges token once and keeps a fixed destination', async ({
  page,
}) => {
  const generated = await admin().auth.admin.generateLink({
    type: 'recovery',
    email: fixtureEmails.viewer,
  });
  if (generated.error) throw generated.error;
  const url =
    '/auth/confirm?type=recovery&token_hash=' +
    generated.data.properties.hashed_token +
    '&redirect_to=https://example.com';
  await page.goto(url);
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await expect(page).toHaveURL(/\/set-password$/);
  await page.goto(url);
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await expect(
    page.getByRole('form', { name: 'Continue securely' }).getByRole('alert'),
  ).toContainText('expired or has already been used');
});

test('anonymous missing asset navigation masks resource identity behind sign-in', async ({
  browser,
}) => {
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto('/inventory/assets/' + randomUUID());
    await expect(visitor).toHaveURL(/\/login/);
    await expect(visitor).toHaveTitle(/Sign in.*IT Inventory/);
    await expect(
      visitor.getByRole('heading', { name: 'Inventory record unavailable' }),
    ).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
});

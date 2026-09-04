import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json';
const fixtureEmails = fixture.emails,
  fixturePassword = fixture.password;
const admin = () =>
  createClient(
    process.env.LOCAL_API_URL!,
    process.env.LOCAL_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
test('anonymous navigation cannot browse the application', async ({ page }) => {
  await page.goto('/inventory');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
});
for (const role of ['staff', 'viewer'] as const)
  test(
    role + ' can read the foundation shell and sign out',
    async ({ page }) => {
      await signIn(page, fixtureEmails[role]);
      await expect(
        page.getByRole('heading', { name: 'Inventory workspace' }),
      ).toBeVisible();
      await expect(page.getByText('28', { exact: true })).toBeVisible();
      await expect(page.getByText('8', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Room', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Room viewer not yet available' }),
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
  });
test('existing session loses access immediately after membership deactivation', async ({
  page,
}) => {
  await signIn(page, fixtureEmails.staff);
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
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
    page.getByRole('heading', { name: 'Inventory workspace' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Room navigation' }),
  ).toBeVisible();
});
test('invitation GET does not consume token; POST sets password without granting membership', async ({
  page,
}) => {
  const email = 'invite-' + crypto.randomUUID() + '@example.test';
  const client = admin();
  const generated = await client.auth.admin.generateLink({
    type: 'invite',
    email,
  });
  if (generated.error) throw generated.error;
  const token = generated.data.properties.hashed_token;
  const url =
    '/auth/confirm?type=invite&token_hash=' + encodeURIComponent(token);
  await page.goto(url);
  await page.reload();
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await expect(page).toHaveURL(/\/set-password$/);
  await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
  await page
    .getByLabel('Confirm password', { exact: true })
    .fill(fixturePassword);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page).toHaveURL(/\/access-denied$/);
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
  await expect(page.getByRole('alert')).toContainText(
    'expired or has already been used',
  );
});

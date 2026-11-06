import { expect, test } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };

test('shared shell decoration preserves targets and becomes static with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  for (const route of [
    '/inventory',
    '/settings',
    '/sites',
    '/labels',
    '/locations',
    '/room',
  ]) {
    await page.goto(route);
    await expect(page.locator('.experience-ambient-shell')).toHaveCount(1);
    await expect(page.locator('.experience-blueprint')).toHaveCount(1);
  }
  await page.goto('/settings');
  const card = page.locator('.experience-spotlight').first();
  // Hover scrolls offscreen targets into view; establish the viewport baseline first.
  await card.scrollIntoViewIfNeeded();
  const before = await card.boundingBox();
  expect(before).not.toBeNull();
  await card.hover({ position: { x: 20, y: 20 } });
  await expect(card).toHaveAttribute('data-spotlight-active', 'true');
  const after = await card.boundingBox();
  expect(after).toEqual(before);
  for (const theme of ['light', 'dark']) {
    await page
      .getByRole('button', {
        name:
          theme === 'light' ? 'Switch to Light theme' : 'Switch to Dark theme',
        exact: true,
      })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // The theme control scrolls away from the card. Compare this hover against
    // its own viewport baseline after scrolling back, rather than the old scroll.
    await card.scrollIntoViewIfNeeded();
    const themeBefore = await card.boundingBox();
    expect(themeBefore).not.toBeNull();
    await card.hover({ position: { x: 20, y: 20 } });
    await expect(card).toHaveAttribute('data-spotlight-active', 'true');
    expect(await card.boundingBox()).toEqual(themeBefore);
    const timing = await page
      .locator('.experience-blueprint')
      .evaluate((element) => ({
        duration: getComputedStyle(element).animationDuration,
        state: getComputedStyle(element).animationPlayState,
      }));
    expect(timing).toEqual({ duration: '60s', state: 'running' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(card).not.toHaveAttribute('data-spotlight-active', 'true');
  await expect(page.locator('.experience-ambient-shell')).toHaveAttribute(
    'data-active',
    'false',
  );
  expect(
    await page
      .locator('.experience-blueprint')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.experience-ambient-shell')).toBeHidden();
});

test.describe('touch-width static equivalent', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('keeps decoration static and ordinary controls reachable in both themes', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).tap();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await page.goto('/settings');
    for (const theme of ['light', 'dark']) {
      await page
        .getByRole('button', {
          name:
            theme === 'light'
              ? 'Switch to Light theme'
              : 'Switch to Dark theme',
          exact: true,
        })
        .tap();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const proof = await page
        .locator('.experience-ambient-shell')
        .evaluate((element) => ({
          coarse: matchMedia('(pointer: coarse)').matches,
          host: getComputedStyle(element, '::before').animationName,
          grid: getComputedStyle(
            element.querySelector('.experience-blueprint')!,
          ).animationName,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
      expect(proof).toEqual({
        coarse: true,
        host: 'none',
        grid: 'none',
        overflow: false,
      });
      await expect(page.locator('[data-spotlight-active="true"]')).toHaveCount(
        0,
      );
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.experience-ambient-shell')).toHaveAttribute(
      'data-active',
      'false',
    );
  });
});

import { expect, test } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import {
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';

for (const role of ['staff', 'viewer'] as const) {
  for (const width of [1280, 390]) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`command palette: ${role} ${width}px ${reducedMotion}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion });
        await page.goto('/login');
        await page
          .getByLabel('Email', { exact: true })
          .fill(fixture.emails[role]);
        await page
          .getByLabel('Password', { exact: true })
          .fill(fixture.password);
        await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        await expect(page).toHaveURL(/\/inventory$/);
        const launcher = page.getByRole('button', {
          name: 'Search and commands',
        });
        await launcher.focus();
        await page.keyboard.press('Control+k');
        const dialog = page.getByRole('dialog', {
          name: 'Search and commands',
        });
        await expect(dialog).toBeVisible();
        const search = dialog.getByRole('combobox');
        await expect(search).toBeFocused();
        await search.fill('ITC-D01');
        const location = dialog.getByRole('option', { name: /ITC-D01/ });
        await expect(location).toBeVisible();
        await expect(dialog).not.toHaveText(/a3010000/);
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(launcher).toBeFocused();
        await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
        const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
        await expect(help).toBeVisible();
        await expect(help).toContainText('G I');
        await help
          .getByRole('checkbox', {
            name: 'Enable application keyboard shortcuts',
          })
          .uncheck();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+k');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await launcher.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(
          page.getByRole('option', { name: /Move asset or stock/ }),
        ).toHaveCount(role === 'staff' ? 1 : 0);
        await page.keyboard.press('Escape');
        await page.goto('/settings');
        await page
          .getByRole('checkbox', {
            name: 'Enable application keyboard shortcuts',
          })
          .check();
        await page.goto('/inventory');
        await page.locator('h1').focus();
        await page.keyboard.press('/');
        await expect(page.locator('[data-inventory-search]')).toBeFocused();
        const before = page.url();
        await page.keyboard.type('snl');
        await expect(page).toHaveURL(before);
      });
    }
  }
}
test('palette Move opens the established review task and consumes its intent once without a write', async ({
  page,
}) => {
  const owned = await acceptanceFixtures();
  try {
    const id = await owned.asset(
      'Palette equipment ' + owned.suffix,
      await owned.location('ITC-RED'),
    );
    await acceptanceLogin(page);
    await page.getByRole('button', { name: 'Search and commands' }).click();
    await page.getByRole('option', { name: /Move asset or stock/ }).click();
    await page
      .getByRole('combobox', { name: /Find equipment/ })
      .fill('Palette equipment ' + owned.suffix);
    await page
      .getByRole('option', {
        name: new RegExp('Palette equipment ' + owned.suffix),
      })
      .click();
    await expect(page).toHaveURL(new RegExp('/inventory/assets/' + id));
    const tasks = page.getByRole('region', { name: 'Record tasks' });
    await expect(
      tasks.getByRole('heading', { name: 'Move asset', exact: true }),
    ).toBeFocused();
    await expect(page).not.toHaveURL(/task=/);
    await tasks.getByRole('button', { name: 'Close task' }).click();
    // Keep the actual Next router mounted: native consumption must update
    // useSearchParams so an identical deliberate palette command can retry.
    await page.getByRole('button', { name: 'Search and commands' }).click();
    await page.getByRole('option', { name: /Move asset or stock/ }).click();
    await page.getByRole('combobox').fill('Palette equipment ' + owned.suffix);
    await page
      .getByRole('option', {
        name: new RegExp('Palette equipment ' + owned.suffix),
      })
      .click();
    await expect(
      tasks.getByRole('heading', { name: 'Move asset', exact: true }),
    ).toBeFocused();
    await expect(page).not.toHaveURL(/task=/);
    await tasks.getByRole('button', { name: 'Close task' }).click();
    // The supported native history wrapper must retain app state/query/hash
    // while synchronizing another absent-to-present task transition.
    await page.evaluate(() => {
      const state = { ...window.history.state, paletteUserState: 'retained' };
      delete state.__NA;
      delete state._N;
      const url = new URL(window.location.href);
      url.searchParams.set('returnTo', '/inventory');
      url.searchParams.set('task', 'asset_move');
      url.hash = 'tasks';
      window.history.replaceState(
        state,
        '',
        url.pathname + url.search + url.hash,
      );
    });
    await expect(
      tasks.getByRole('heading', { name: 'Move asset', exact: true }),
    ).toBeFocused();
    await expect(page).not.toHaveURL(/task=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/inventory');
    expect(new URL(page.url()).hash).toBe('#tasks');
    expect(
      await page.evaluate(() => window.history.state.paletteUserState),
    ).toBe('retained');
    await tasks.getByRole('button', { name: 'Close task' }).click();
    await page.reload();
    await expect(
      tasks.getByRole('heading', { name: 'Move asset', exact: true }),
    ).toHaveCount(0);
    const version = await owned.caller
      .from('serialized_assets')
      .select('version')
      .eq('id', id)
      .single();
    expect(version.error).toBeNull();
    expect(version.data!.version).toBe(1);
  } finally {
    await owned.cleanup();
  }
});
for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`phone arrows keep twenty results visible through wrap and Enter (${reducedMotion})`, async ({
    page,
  }) => {
    const owned = await acceptanceFixtures();
    try {
      const location = await owned.location('ITC-RED');
      for (let index = 0; index < 20; index++)
        await owned.asset(
          'PaletteViewport ' + owned.suffix + ' ' + index,
          location,
        );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion });
      await acceptanceLogin(page);
      await page.getByRole('button', { name: 'Search and commands' }).click();
      const dialog = page.getByRole('dialog');
      const search = dialog.getByRole('combobox');
      await search.fill('PaletteViewport ' + owned.suffix);
      const options = dialog.getByRole('option');
      await expect(options).toHaveCount(20);
      const scrollY = await page.evaluate(() => window.scrollY);
      const visibleSelection = async () => {
        const selected = dialog.locator(
          '[role="option"][aria-selected="true"]',
        );
        await expect
          .poll(async () =>
            selected.evaluate((element) => {
              const item = element.getBoundingClientRect();
              const list = element.parentElement!.getBoundingClientRect();
              return item.top >= list.top - 1 && item.bottom <= list.bottom + 1;
            }),
          )
          .toBe(true);
      };
      await search.press('ArrowUp');
      await expect(options.nth(19)).toHaveAttribute('aria-selected', 'true');
      await visibleSelection();
      await search.press('ArrowDown');
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
      await visibleSelection();
      for (let index = 0; index < 19; index++) await search.press('ArrowDown');
      await visibleSelection();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
      const selectedName = await options
        .nth(19)
        .locator('.font-semibold')
        .innerText();
      await search.press('Enter');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        selectedName,
      );
    } finally {
      await owned.cleanup();
    }
  });
}

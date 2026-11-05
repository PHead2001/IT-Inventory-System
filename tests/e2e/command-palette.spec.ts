import { expect, test, type Locator, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { withFailureGeometry } from './failure-geometry';
import { holdTaskCleanupRead } from './held-task-cleanup';
import { holdResponse } from './held-route-work';
import {
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';

async function nativeModalTabCycle(
  page: Page,
  dialog: Locator,
  first: Locator,
  last: Locator,
) {
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  // Focus the real non-tab-stop container, then use trusted browser key input.
  // Retry also reaches this focus state through its actual button handler.
  await dialog.focus();
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await dialog.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
}

function holdPaletteSession(page: Page) {
  const origin = new URL(process.env.LOCAL_API_URL!).origin;
  return holdResponse(page, (request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.origin === origin &&
      url.pathname === '/auth/v1/user'
    );
  });
}

for (const state of ['pending', 'failed', 'retry'] as const) {
  test(`native command dialog contains Tab and Shift+Tab during Add ${state}`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await acceptanceLogin(page);
    const launcher = page.getByRole('button', {
      name: 'Search and commands',
      exact: true,
    });
    await expect(launcher).toBeEnabled();
    const before = page.url();
    const session = await holdPaletteSession(page);
    let retry: Awaited<ReturnType<typeof holdPaletteSession>> | undefined;
    try {
      await launcher.focus();
      await page.keyboard.press('n');
      const dialog = page.getByRole('dialog', {
        name: 'Add item',
        exact: true,
      });
      const close = dialog.getByRole('button', {
        name: 'Close dialog',
        exact: true,
      });
      await session.arrival;
      await expect(close).toBeFocused();
      if (state !== 'pending') {
        // Hold a genuine successful read beyond the real eight-second deadline.
        // No fabricated Auth response or application timer override is involved.
        await expect(dialog.getByRole('alert')).toContainText(
          'Your session could not be checked. Try again.',
          { timeout: 12_000 },
        );
        session.release();
        await session.delivery;
        if (state === 'retry') {
          retry = await holdPaletteSession(page);
          await dialog
            .getByRole('button', { name: 'Try again', exact: true })
            .click();
          await retry.arrival;
          // The real Retry handler focuses the container before removing itself.
          await expect(dialog).toBeFocused();
        }
      }
      if (state === 'failed')
        await expect(dialog.getByRole('alert')).toContainText(
          'Your session could not be checked. Try again.',
        );
      else
        await expect(
          dialog.getByText('Checking your session…', { exact: true }),
        ).toBeVisible();
      for (const name of ['Add quantity item', 'Add individual asset']) {
        const choice = dialog.getByRole('link', { name, exact: true });
        await expect(choice).toHaveAttribute('aria-disabled', 'true');
        await expect(choice).not.toHaveAttribute('href');
      }
      expect(
        await launcher.evaluate((element) => !!element.closest('[inert]')),
      ).toBe(true);
      const last =
        state === 'failed'
          ? dialog.getByRole('button', { name: 'Try again', exact: true })
          : close;
      await nativeModalTabCycle(page, dialog, close, last);
      await expect(page).toHaveURL(before);
      if (state !== 'failed')
        await expect(
          dialog.getByText('Checking your session…', { exact: true }),
        ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toBeFocused();
    } finally {
      await retry?.dispose();
      await session.dispose();
    }
  });
}

for (const mode of ['Search', 'Help'] as const) {
  test(`native command dialog contains Tab and Shift+Tab in ${mode}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await acceptanceLogin(page);
    const invoker = page.getByRole('button', {
      name: mode === 'Search' ? 'Search and commands' : 'Keyboard shortcuts',
      exact: true,
    });
    await expect(invoker).toBeEnabled();
    const before = page.url();
    await invoker.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: mode === 'Search' ? 'Search and commands' : 'Keyboard shortcuts',
      exact: true,
    });
    const close = dialog.getByRole('button', {
      name: 'Close dialog',
      exact: true,
    });
    let last: Locator;
    if (mode === 'Search') {
      const search = dialog.getByRole('combobox');
      await expect(search).toBeFocused();
      await search.fill('ITC-D01');
      await expect(
        dialog.getByRole('option', { name: /ITC-D01/ }),
      ).toBeVisible();
      last = dialog.getByRole('option').last();
    } else {
      await expect(close).toBeFocused();
      last = dialog.getByRole('checkbox', {
        name: 'Enable application keyboard shortcuts',
        exact: true,
      });
    }
    expect(
      await invoker.evaluate((element) => !!element.closest('[inert]')),
    ).toBe(true);
    await nativeModalTabCycle(page, dialog, close, last);
    await close.focus();
    await page.keyboard.press('Tab');
    if (mode === 'Search') {
      const search = dialog.getByRole('combobox');
      await expect(search).toBeFocused();
      await search.press('Home');
      await search.press('ArrowRight');
      await search.press('Shift+ArrowRight');
      await search.press('Shift+ArrowRight');
      await search.press('Tab');
      const scope = dialog.getByRole('checkbox', { name: /Include retired/ });
      await expect(scope).toBeFocused();
      // Observe the original input while blurred; ordinary native focus may
      // choose its own selection when Shift+Tab later returns to that input.
      expect(
        await search.evaluate((input) => ({
          start: (input as HTMLInputElement).selectionStart,
          end: (input as HTMLInputElement).selectionEnd,
        })),
      ).toEqual({ start: 1, end: 3 });
      await scope.press('Shift+Tab');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('ITC-D01');
    } else {
      await expect(last).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
    }
    await expect(page).toHaveURL(before);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(invoker).toBeFocused();
  });
}

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
  let cleanup: Awaited<ReturnType<typeof holdTaskCleanupRead>> | undefined;
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
    cleanup = await holdTaskCleanupRead(
      page,
      new URL('/inventory/assets/' + id, page.url()).href,
    );
    await page
      .getByRole('option', {
        name: new RegExp('Palette equipment ' + owned.suffix),
      })
      .click();
    await expect(
      tasks.getByRole('heading', { name: 'Move asset', exact: true }),
    ).toBeFocused();
    await expect(page).not.toHaveURL(/task=/);
    await cleanup.arrival;
    await expect(
      page.getByRole('button', { name: 'Search and commands' }),
    ).toBeDisabled();
    await tasks.getByRole('button', { name: 'Close task' }).click();
    // The supported native history wrapper must retain app state/query/hash
    // while synchronizing another absent-to-present task transition.
    // The actual cleanup response is held before this assertion, so a stale
    // pre-cleanup enabled launcher cannot satisfy the next readiness check.
    cleanup.release();
    await cleanup.delivery;
    await expect(
      page.getByRole('button', { name: 'Search and commands' }),
    ).toBeEnabled();
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
    await withFailureGeometry(page, 'native-task-reentry', async () => {
      await expect(
        tasks.getByRole('heading', { name: 'Move asset', exact: true }),
      ).toBeFocused();
    });
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
  } catch (error) {
    console.error(
      'bounded-task-cleanup',
      cleanup?.diagnostic() ?? { phase: 'not-installed' },
    );
    throw error;
  } finally {
    try {
      await cleanup?.dispose();
    } finally {
      await owned.cleanup();
    }
  }
});
test('palette quantity Move consumes repeated and native intents without changing stock or history', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const owned = await acceptanceFixtures();
  let cleanup: Awaited<ReturnType<typeof holdTaskCleanupRead>> | undefined;
  try {
    const locationId = await owned.location('ITC-RED');
    const location = await owned.caller
      .from('locations')
      .select('active,can_hold_inventory')
      .eq('id', locationId)
      .single();
    expect(location.error).toBeNull();
    expect(location.data).toMatchObject({
      active: true,
      can_hold_inventory: true,
    });
    const name = 'Palette quantity ' + owned.suffix;
    const id = await owned.quantity(name, locationId, 6);
    const snapshot = async () => {
      const [item, balances, events] = await Promise.all([
        owned.caller.from('quantity_items').select('*').eq('id', id).single(),
        owned.caller
          .from('stock_balances')
          .select('*')
          .eq('item_id', id)
          .order('location_id'),
        owned.caller
          .from('quantity_events')
          .select('*')
          .eq('item_id', id)
          .order('id'),
      ]);
      for (const result of [item, balances, events])
        expect(result.error).toBeNull();
      expect(item.data).not.toBeNull();
      expect(events.data!.length).toBeGreaterThan(0);
      const lines = await owned.caller
        .from('quantity_event_lines')
        .select('*')
        .in(
          'event_id',
          events.data!.map((event) => event.id),
        )
        .order('event_id')
        .order('location_id');
      expect(lines.error).toBeNull();
      return {
        item: item.data!,
        balances: balances.data!,
        events: events.data!,
        lines: lines.data!,
      };
    };
    const before = await snapshot();
    expect(before.item.version).toBe(1);
    expect(before.balances).toEqual([
      expect.objectContaining({
        item_id: id,
        location_id: locationId,
        quantity: 6,
      }),
    ]);
    await acceptanceLogin(page);
    const launcher = page.getByRole('button', {
      name: 'Search and commands',
      exact: true,
    });
    const tasks = page.getByRole('region', { name: 'Record tasks' });
    const heading = tasks.getByRole('heading', {
      name: 'Move stock',
      exact: true,
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      await launcher.click();
      await page.getByRole('option', { name: /Move asset or stock/ }).click();
      await page.getByRole('combobox', { name: /Find equipment/ }).fill(name);
      if (repeat === 1)
        cleanup = await holdTaskCleanupRead(
          page,
          new URL('/inventory/quantity/' + id, page.url()).href,
        );
      await page.getByRole('option', { name: new RegExp(name) }).click();
      await expect(page).toHaveURL(new RegExp('/inventory/quantity/' + id));
      await expect(heading).toBeFocused();
      await expect(
        tasks
          .getByRole('form', { name: 'Move stock', exact: true })
          .getByLabel('Quantity to move', { exact: true }),
      ).toBeVisible();
      await expect(page).not.toHaveURL(/task=/);
      if (cleanup) {
        await cleanup.arrival;
        await expect(launcher).toBeDisabled();
      }
      await tasks
        .getByRole('button', { name: 'Close task', exact: true })
        .click();
      await expect(heading).toHaveCount(0);
      expect(await snapshot()).toEqual(before);
    }
    // Require the second real cleanup read to finish before native re-entry.
    // A stale pre-cleanup enabled launcher cannot stand in for fresh authority.
    cleanup!.release();
    await cleanup!.delivery;
    await expect(launcher).toBeEnabled();
    await page.evaluate(() => {
      const state = {
        ...window.history.state,
        paletteQuantityUserState: 'retained',
      };
      delete state.__NA;
      delete state._N;
      const url = new URL(window.location.href);
      url.searchParams.set('returnTo', '/inventory');
      url.searchParams.set('task', 'quantity_move');
      url.hash = 'tasks';
      window.history.replaceState(
        state,
        '',
        url.pathname + url.search + url.hash,
      );
    });
    await withFailureGeometry(page, 'native-task-reentry', async () => {
      await expect(heading).toBeFocused();
    });
    await expect(page).not.toHaveURL(/task=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/inventory');
    expect(new URL(page.url()).hash).toBe('#tasks');
    expect(
      await page.evaluate(() => window.history.state.paletteQuantityUserState),
    ).toBe('retained');
    expect(await snapshot()).toEqual(before);
    await tasks
      .getByRole('button', { name: 'Close task', exact: true })
      .click();
    await page.reload();
    await expect(heading).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
  } catch (error) {
    console.error(
      'bounded-quantity-task-cleanup',
      cleanup?.diagnostic() ?? { phase: 'not-installed' },
    );
    throw error;
  } finally {
    try {
      await cleanup?.dispose();
    } finally {
      await owned.cleanup();
    }
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

import { expect, test } from '@playwright/test';
import {
  acceptanceCommand,
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';

// Shared canonical ITC-RED is renamed and restored. Keep this spec outside the
// parallel allowlist and never run the reference round trip against hosted data.
test('local mapped storage rename keeps keyboard focus, corrects sibling collision and restores the exact original name', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  let original: {
    id: string;
    code: string;
    name: string;
    parent_id: string | null;
    version: number | string;
  } | null = null;
  try {
    const before = await owned.caller
      .from('locations')
      .select('id,code,name,parent_id,version')
      .eq('code', 'ITC-RED')
      .single();
    expect(before.error).toBeNull();
    original = before.data!;
    const sibling = await owned.caller
      .from('locations')
      .select('name,parent_id')
      .eq('code', 'ITC-BLACK')
      .single();
    expect(sibling.error).toBeNull();
    expect(sibling.data!.parent_id).toBe(before.data!.parent_id);
    const renamed = `Red container acceptance ${owned.suffix}`;
    await acceptanceLogin(page);
    await page.goto('/settings/locations');
    const search = page.getByRole('searchbox', {
      name: 'Search locations',
      exact: true,
    });
    await search.fill(before.data!.code);
    const link = page.locator(
      `a[href="/settings/locations/${before.data!.code}"]`,
    );
    await search.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    const form = page.locator('form');
    const name = form.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill(` ${sibling.data!.name.toLowerCase()} `);
    await form.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(form.getByRole('status')).toContainText(
      'Another active location with the same parent already uses that name',
    );
    await expect(name).toHaveValue(` ${sibling.data!.name.toLowerCase()} `);
    await name.click();
    await name.fill(renamed);
    await name.press('Tab');
    const save = form.getByRole('button', { name: 'Save name', exact: true });
    await expect(save).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(form.getByRole('status')).toContainText('Location renamed');
    await expect(save).toBeFocused();
    const after = await owned.caller
      .from('locations')
      .select('id,code,name,parent_id')
      .eq('id', before.data!.id)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toEqual({
      id: before.data!.id,
      code: before.data!.code,
      name: renamed,
      parent_id: before.data!.parent_id,
    });
    await page.goto('/locations/' + before.data!.code);
    await expect(
      page.getByRole('heading', { name: renamed, exact: true }),
    ).toBeVisible();
    const locationHeader = page
      .getByRole('heading', { name: renamed, level: 1, exact: true })
      .locator('..');
    const roomLink = locationHeader.locator(
      `:scope > a[href="/room?location=${before.data!.code}"]`,
    );
    await expect(roomLink).toHaveCount(1);
    await expect(roomLink).toHaveAccessibleName(
      `Show ${before.data!.code} in room`,
    );
    await roomLink.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/room' &&
        url.searchParams.get('location') === before.data!.code,
    );
    const viewer = page.getByTestId('room-viewer');
    await expect(viewer).toHaveAttribute(
      'data-selected-code',
      before.data!.code,
    );
    const showAllLabels = viewer.getByRole('button', {
      name: 'Show all labels',
      exact: true,
    });
    if ((await showAllLabels.getAttribute('aria-pressed')) !== 'true')
      await showAllLabels.click();
    const canvas = viewer.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute('data-label-layout-pending', 'false');
    const toolbar = viewer.getByRole('toolbar', {
      name: 'Room camera controls',
    });
    await toolbar
      .getByRole('button', { name: 'Center selected', exact: true })
      .click();
    const more = toolbar.getByRole('button', {
      name: 'More map controls',
      exact: true,
    });
    await more.click();
    const controls = viewer.getByRole('region', {
      name: 'More map controls',
      exact: true,
    });
    await controls
      .getByRole('button', { name: 'Free Orbit', exact: true })
      .click();
    for (let tilt = 0; tilt < 3; tilt++)
      await controls
        .getByRole('button', { name: 'Tilt down', exact: true })
        .click();
    for (let rotation = 0; rotation < 8; rotation++)
      await controls
        .getByRole('button', { name: 'Rotate right', exact: true })
        .click();
    await more.click();
    await expect(canvas).toHaveAttribute('data-label-layout-pending', 'false');
    const mapLabel = viewer
      .locator(`button[data-room-label-code="${before.data!.code}"]:visible`)
      .first();
    await info.attach('renamed-label-framing', {
      body: JSON.stringify({
        viewport: { width: 1280, height: 1100 },
        controls: [
          'Show all labels',
          'Center selected',
          'Free Orbit',
          'Tilt down ×3',
          'Rotate right ×8',
        ],
        camera: JSON.parse((await viewer.getAttribute('data-camera-view'))!),
      }),
      contentType: 'application/json',
    });
    await expect(viewer).toHaveAttribute(
      'data-selected-code',
      before.data!.code,
    );
    await expect(mapLabel).toBeVisible();
    await expect(mapLabel).toContainText(renamed);
    await info.attach('owned-local-reference-rename', {
      body: JSON.stringify({
        code: before.data!.code,
        id: before.data!.id,
        restorationRequired: true,
      }),
      contentType: 'application/json',
    });
  } finally {
    try {
      if (original) {
        const before = { data: original };
        const current = await owned.caller
          .from('locations')
          .select('name,version')
          .eq('id', before.data!.id)
          .single();
        expect(current.error).toBeNull();
        if (current.data!.name !== before.data!.name)
          await acceptanceCommand(owned.caller, 'location_rename', {
            location_id: before.data!.id,
            expected_version: String(current.data!.version),
            name: before.data!.name,
          });
        const restored = await owned.caller
          .from('locations')
          .select('name,code,parent_id')
          .eq('id', before.data!.id)
          .single();
        expect(restored.error).toBeNull();
        expect(restored.data).toEqual({
          name: before.data!.name,
          code: before.data!.code,
          parent_id: before.data!.parent_id,
        });
        await info.attach('local-reference-restored', {
          body: JSON.stringify(restored.data),
          contentType: 'application/json',
        });
      }
    } finally {
      await owned.cleanup();
    }
  }
});

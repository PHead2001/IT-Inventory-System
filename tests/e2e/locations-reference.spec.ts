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
      .select('id,code,name,parent_id,version,active')
      .eq('code', 'ITC-RED')
      .single();
    expect(before.error).toBeNull();
    expect(before.data!.active).toBe(true);
    original = before.data!;
    const sibling = await owned.caller
      .from('locations')
      .select('name,parent_id,active')
      .eq('code', 'ITC-BLACK')
      .single();
    expect(sibling.error).toBeNull();
    expect(sibling.data!.active).toBe(true);
    expect(sibling.data!.parent_id).toBe(before.data!.parent_id);
    const renamed = `Red container acceptance ${owned.suffix}`;
    await acceptanceLogin(page);
    await page.goto('/settings/locations');
    const search = page.getByRole('searchbox', {
      name: 'Search locations',
      exact: true,
    });
    await search.fill(before.data!.code);
    await search.press('Tab');
    // Search reveals matching ancestors; Tab enters the tree at its root.
    const tree = page.getByRole('tree', { name: 'Locations' });
    await expect(tree.getByRole('treeitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const location = tree.getByRole('treeitem', { name: /ITC-RED · Active$/ });
    await expect(location).toBeFocused();
    await expect(location.getByRole('link')).toHaveAttribute(
      'href',
      `/settings/locations/${before.data!.code}`,
    );
    await page.keyboard.press('Enter');
    const form = page.locator('form');
    const name = form.getByRole('textbox', { name: 'Name', exact: true });
    const collisionName = ` ${sibling.data!.name.toLowerCase()} `;
    await name.fill(collisionName);
    await expect(name).toHaveValue(collisionName);
    let submittedNameMatches = false;
    const submitted = page.waitForRequest((request) => {
      if (
        request.method() !== 'POST' ||
        !request.headers()['next-action'] ||
        new URL(request.url()).pathname !==
          `/settings/locations/${before.data!.code}`
      )
        return false;
      const body = request.postData();
      if (!body || Buffer.byteLength(body, 'utf8') > 4096) return false;
      try {
        const args: unknown = JSON.parse(body);
        if (!Array.isArray(args) || args[0]?.operation !== 'location_rename')
          return false;
        submittedNameMatches = args[0].payload?.name === collisionName;
        return true;
      } catch {
        return false;
      }
    });
    await Promise.all([
      submitted,
      form.getByRole('button', { name: 'Save name', exact: true }).click(),
    ]);
    expect(
      submittedNameMatches,
      'The actual rename action must submit the displayed sibling-collision name',
    ).toBe(true);
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
    const roomLink = page
      .getByRole('navigation', { name: 'Location actions', exact: true })
      .getByRole('link', {
        name: `Show ${before.data!.code} in room`,
        exact: true,
      });
    await expect(roomLink).toHaveCount(1);
    await expect(roomLink).toHaveAttribute(
      'href',
      `/room?location=${before.data!.code}`,
    );
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
    const showLabels = controls.getByRole('button', {
      name: 'Show labels',
      exact: true,
    });
    if ((await showLabels.getAttribute('aria-pressed')) !== 'true')
      await showLabels.click();
    await expect(showLabels).toHaveAttribute('aria-pressed', 'true');
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
          'Center selected',
          'Show labels',
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

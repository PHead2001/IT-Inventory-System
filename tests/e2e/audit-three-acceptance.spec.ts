import { expect, test } from '@playwright/test';
import {
  acceptanceCommand,
  acceptanceConfirm,
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';
import { openRecordTask } from './record-task-controls';
import { chooseLocation } from './location-picker';

test('Restore uses eligible last storage only and ambiguous Receive preserves an edited destination after real stale refresh', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  try {
    await acceptanceLogin(page);
    const red = await owned.location('ITC-RED'),
      black = await owned.location('ITC-BLACK');
    const eligible = await owned.asset(`Eligible restore ${owned.suffix}`, red);
    await page.goto(`/inventory/assets/${eligible}`);
    let form = await openRecordTask(page, 'Retire asset');
    await form
      .getByLabel('Reason (required)')
      .fill('Owned eligible restore checkpoint');
    await acceptanceConfirm(form, 'Retire asset');
    await page.reload();
    form = await openRecordTask(page, 'Restore asset');
    await expect(
      form.getByRole('combobox', {
        name: 'Confirmed current location',
        exact: true,
      }),
    ).toContainText('Red Container');
    await chooseLocation(form, 'Confirmed current location', 'ITC-BLACK');
    await form
      .getByRole('button', { name: 'Review restore asset', exact: true })
      .click();
    await expect(form.getByLabel('Reason (required)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await form
      .getByLabel('Reason (required)')
      .fill('Confirmed at the chosen storage after inspection');
    await expect(
      form.getByRole('combobox', {
        name: 'Confirmed current location',
        exact: true,
      }),
    ).toContainText('Black Container');
    await acceptanceConfirm(form, 'Restore asset');
    await page.reload();
    await expect(
      page.locator('main a[href="/locations/ITC-BLACK"]').first(),
    ).toBeVisible();

    const storage = await owned.ownedLocation(
      `Ineligible restore ${owned.suffix}`,
    );
    const ineligible = await owned.asset(
      `Ineligible restore asset ${owned.suffix}`,
      storage.id,
    );
    await page.goto(`/inventory/assets/${ineligible}`);
    form = await openRecordTask(page, 'Retire asset');
    await form
      .getByLabel('Reason (required)')
      .fill('Owned inactive-location restore checkpoint');
    await acceptanceConfirm(form, 'Retire asset');
    const inactive = await owned.admin
      .from('locations')
      .update({ active: false, can_hold_inventory: false })
      .eq('id', storage.id);
    expect(inactive.error).toBeNull();
    await page.reload();
    form = await openRecordTask(page, 'Restore asset');
    await expect(
      form.getByRole('combobox', {
        name: 'Confirmed current location',
        exact: true,
      }),
    ).toHaveText(/Select a location/);

    const site = await owned.site();
    const atSite = await acceptanceCommand(owned.caller, 'asset_site_open_v3', {
      name: `Site restore ${owned.suffix}`,
      description: null,
      category_id: owned.categoryId,
      manufacturer: null,
      model: null,
      site_id: site.id,
      asset_tag: `00-site-${owned.suffix}`,
      serial_number: null,
      expected_published_revision_id: owned.revisionId,
      custom_patch: { set: {}, unset: [] },
    });
    owned.assets.add(atSite.entity_id);
    await page.goto(`/inventory/assets/${atSite.entity_id}`);
    form = await openRecordTask(page, 'Retire asset at site');
    await form
      .getByLabel('Reason (required)')
      .fill('Owned site-held restore checkpoint');
    await acceptanceConfirm(form, 'Retire asset at site');
    await page.reload();
    form = await openRecordTask(page, 'Restore asset');
    await expect(
      form.getByRole('combobox', {
        name: 'Confirmed current location',
        exact: true,
      }),
    ).toHaveText(/Select a location/);

    const itemId = await owned.quantity(
      `Ambiguous Receive ${owned.suffix}`,
      red,
      2,
    );
    await acceptanceCommand(owned.caller, 'quantity_receive', {
      item_id: itemId,
      expected_version: 1,
      location_id: black,
      quantity: 1,
      reason: 'Second owned holding',
    });
    await page.goto(`/inventory/quantity/${itemId}`);
    form = await openRecordTask(page, 'Receive stock');
    await expect(
      form.getByRole('combobox', { name: 'Receive at', exact: true }),
    ).toHaveText(/Select a location/);
    await chooseLocation(form, 'Receive at', 'ITC-CLEAR');
    await form.getByLabel('Quantity to receive').fill('3');
    await form
      .getByLabel('Reason (required)')
      .fill('Chosen destination must survive the stale refresh');
    await form
      .getByRole('button', { name: 'Review receive stock', exact: true })
      .click();
    await acceptanceCommand(owned.caller, 'quantity_receive', {
      item_id: itemId,
      expected_version: 2,
      location_id: red,
      quantity: 1,
      reason: 'Independent real balance change',
    });
    await form
      .getByRole('button', { name: 'Confirm receive stock', exact: true })
      .click();
    await expect(form.getByRole('alert')).toContainText(/changed/);
    await form
      .getByRole('button', { name: 'Refresh latest record', exact: true })
      .click();
    await expect(
      form.getByRole('combobox', { name: 'Receive at', exact: true }),
    ).toContainText('Clear Container');
    await expect(form.getByLabel('Quantity to receive')).toHaveValue('3');
    await expect(
      form.getByRole('button', { name: 'Confirm receive stock', exact: true }),
    ).toHaveCount(0);
  } finally {
    await owned.cleanup();
  }
});

// This new spec is outside the parallel allowlist, so the canonical full gate runs
// it exclusively. Never run this reference-name round trip against hosted data.
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

test('custody Done permits another operation and revisit cannot resurrect or repeat either committed receipt', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  try {
    await acceptanceLogin(page);
    const red = await owned.location('ITC-RED'),
      site = await owned.site();
    const id = await owned.asset(`Receipt lifecycle ${owned.suffix}`, red);
    const detail = `/inventory/assets/${id}`;
    await page.goto(detail);
    let form = await openRecordTask(page, 'Assign asset to a site');
    await form.getByLabel('Destination site').selectOption(site.id);
    await acceptanceConfirm(form, 'Assign asset to a site');
    const first = page.getByRole('region', {
      name: 'Custody completion',
      exact: true,
    });
    await expect(first).toContainText('Assigned to site');
    await first.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Record tasks' })
        .getByRole('button', { name: 'Return to storage', exact: true }),
    ).toBeVisible();
    form = await openRecordTask(page, 'Return to storage');
    await expect(
      form.getByRole('button', {
        name: 'Review return',
        exact: true,
      }),
    ).toBeEnabled();
    await chooseLocation(form, 'Storage location', 'ITC-BLACK');
    await acceptanceConfirm(form, 'Return to storage');
    const second = page.getByRole('region', {
      name: 'Custody completion',
      exact: true,
    });
    await expect(second).toContainText('Returned from site');
    await second.getByRole('button', { name: 'Done', exact: true }).click();
    await page.goto('/inventory');
    await page.goto(detail);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Custody completion', exact: true }),
    ).toHaveCount(0);
    form = await openRecordTask(page, 'Assign asset to a site');
    await expect(
      form.getByRole('button', {
        name: 'Review assignment',
        exact: true,
      }),
    ).toBeVisible();
    const state = await owned.caller
      .from('serialized_assets')
      .select('version,location_id,site_id')
      .eq('id', id)
      .single();
    expect(state.error).toBeNull();
    expect(state.data).toMatchObject({
      version: 3,
      location_id: await owned.location('ITC-BLACK'),
      site_id: null,
    });
    const events = await owned.caller
      .from('assignment_events')
      .select('kind')
      .eq('asset_id', id);
    expect(events.error).toBeNull();
    expect(events.data).toHaveLength(2);
    expect(events.data!.map((event) => event.kind).sort()).toEqual([
      'issued',
      'returned',
    ]);
  } finally {
    await owned.cleanup();
  }
});

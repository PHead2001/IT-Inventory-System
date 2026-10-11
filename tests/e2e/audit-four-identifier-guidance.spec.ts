import { expect, test, type Page } from '@playwright/test';
import QRCode from 'qrcode';
import {
  acceptanceCommand,
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';
import { openRecordTask } from './record-task-controls';

type Fixture = Awaited<ReturnType<typeof acceptanceFixtures>>;
async function asset(
  f: Fixture,
  name: string,
  tag: string,
  serial: string,
  manufacturer: string,
  code = 'ITC-RED',
) {
  const created = await acceptanceCommand(f.caller, 'asset_create_v3', {
    name,
    category_id: f.categoryId,
    location_id: await f.location(code),
    asset_tag: tag,
    serial_number: serial,
    manufacturer,
    expected_published_revision_id: f.revisionId,
    custom_patch: { set: {}, unset: [] },
  });
  f.assets.add(created.entity_id);
  return created;
}
async function lookup(page: Page, text: string) {
  await page.goto('/scan');
  await page
    .getByLabel('Paste a label URL, barcode text, or exact identifier')
    .fill(text);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
}

for (const width of [1280, 390])
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`serial chooser and tag blur guidance at ${width} / ${motion}`, async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: motion });
      const f = await acceptanceFixtures();
      try {
        const serial = `A4-SERIAL-${f.suffix}`;
        const collision = `A4-COLLISION-${f.suffix}`;
        const retiredTag = `A4-RETIRED-${f.suffix}`;
        const oneName = `Identifier Dell ${f.suffix}`;
        const twoName = `Identifier Lenovo ${f.suffix}`;
        const retiredName = `Identifier retired ${f.suffix}`;
        const one = await asset(f, oneName, collision, serial, 'Dell');
        const two = await asset(
          f,
          twoName,
          `A4-SECOND-${f.suffix}`,
          serial,
          'Lenovo',
          'ITC-BLACK',
        );
        const historical = await asset(
          f,
          retiredName,
          retiredTag,
          collision,
          'Historical maker',
        );
        await acceptanceCommand(f.caller, 'asset_retire', {
          asset_id: historical.entity_id,
          expected_version: Number(historical.version),
          reason: 'Owned identifier-guidance retired fixture',
        });
        const site = await f.site();
        await acceptanceCommand(f.caller, 'asset_site_change', {
          action: 'assign',
          asset_id: two.entity_id,
          expected_version: String(two.version),
          source_location_id: await f.location('ITC-BLACK'),
          destination_site_id: site.id,
        });
        const quantity = await acceptanceCommand(
          f.caller,
          'quantity_create_v2',
          {
            name: `Identifier quantity ${f.suffix}`,
            category_id: f.categoryId,
            initial_quantity: 0,
            initial_location_id: null,
            item_code: collision,
            expected_published_revision_id: f.revisionId,
            custom_patch: { set: {}, unset: [] },
          },
        );
        f.quantities.add(quantity.entity_id);
        await acceptanceLogin(page);
        await lookup(page, `  ${serial.toLowerCase()}  `);
        await expect(page).toHaveURL(/\/scan$/);
        const matches = page.getByRole('list', { name: 'Matching records' });
        await expect(
          matches.getByRole('link', {
            name: `${oneName} (${collision})`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          matches.getByRole('link', { name: new RegExp(twoName) }),
        ).toBeVisible();
        await expect(matches).toContainText('Manufacturer: Dell');
        await expect(matches).toContainText('Red Container');
        await expect(matches).toContainText('Manufacturer: Lenovo');
        await expect(matches).toContainText(site.code);
        await page.screenshot({
          path: info.outputPath('serial-chooser.png'),
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await lookup(page, collision.toLowerCase());
        await expect(
          page
            .getByRole('list', { name: 'Matching records' })
            .getByRole('link'),
        ).toHaveCount(3);
        await expect(
          page.getByRole('list', { name: 'Matching records' }),
        ).toContainText('Retired');
        await lookup(page, `AST:${collision.toLowerCase()}`);
        await expect(page).toHaveURL(
          new RegExp(`/inventory/assets/${one.entity_id}$`),
        );
        await lookup(page, `A4-UNKNOWN-${f.suffix}`);
        await expect(page.getByRole('status')).toContainText(
          'No matching location, asset, or quantity item',
        );
        await expect(
          page.getByRole('list', { name: 'Matching records' }),
        ).toHaveCount(0);
        await page.goto('/inventory/assets/new');
        const create = page.getByRole('form', { name: 'Add individual asset' });
        await create
          .getByLabel('Category', { exact: true })
          .selectOption(f.categoryId);
        await create
          .getByLabel('Asset tag', { exact: true })
          .fill(` ${collision.toLowerCase()} `);
        await create.getByLabel('Name', { exact: true }).click();
        await expect(
          create.getByRole('link', { name: oneName, exact: true }),
        ).toBeVisible();
        const warning = create
          .getByRole('status')
          .filter({ hasText: 'Asset tag already used' });
        await expect(warning).toContainText('(active)');
        await expect(warning).not.toContainText('retired');
        await page.screenshot({
          path: info.outputPath('active-tag-warning.png'),
          fullPage: true,
        });
        await create
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        await page
          .getByRole('dialog', { name: 'Discard changes?', exact: true })
          .getByRole('button', { name: 'Discard changes', exact: true })
          .click();
        await expect(page).toHaveURL(/\/inventory$/);
        await page.goto(`/inventory/assets/${one.entity_id}`);
        const edit = await openRecordTask(page, 'Edit asset metadata');
        const tag = edit.getByLabel('Asset tag', { exact: true });
        await tag.focus();
        await edit.getByLabel('Name', { exact: true }).click();
        await expect(
          edit
            .getByRole('status')
            .filter({ hasText: 'No conflicting tag found' }),
        ).toBeVisible();
        await tag.fill(retiredTag.toLowerCase());
        await edit.getByLabel('Name', { exact: true }).click();
        await expect(
          edit.getByRole('link', { name: retiredName, exact: true }),
        ).toBeVisible();
        await expect(
          edit
            .getByRole('status')
            .filter({ hasText: 'Asset tag already used' }),
        ).toContainText('(retired)');
        await page.screenshot({
          path: info.outputPath('retired-tag-warning.png'),
          fullPage: true,
        });
        await tag.fill(`A4-NEW-${f.suffix}`);
        await expect(
          edit.getByRole('link', { name: retiredName, exact: true }),
        ).toHaveCount(0);
        await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Discard changes?', exact: true })
          .getByRole('button', { name: 'Discard changes', exact: true })
          .click();
        const unchanged = await f.caller
          .from('serialized_assets')
          .select('id,asset_tag')
          .eq('category_id', f.categoryId);
        expect(unchanged.error).toBeNull();
        expect(unchanged.data).toHaveLength(3);
        expect(
          unchanged.data!.find((row) => row.id === one.entity_id)?.asset_tag,
        ).toBe(collision);
      } finally {
        await f.cleanup();
      }
    });
  }

test('a serial at the lookup bound shows twenty choices and ordinary search guidance', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const f = await acceptanceFixtures();
  try {
    const serial = `A4-LIMIT-${f.suffix}`;
    for (let index = 0; index < 21; index++)
      await asset(
        f,
        `Bounded identifier ${String(index).padStart(2, '0')} ${f.suffix}`,
        `A4-${index}-${f.suffix}`,
        serial,
        'Bounded maker',
      );
    await acceptanceLogin(page);
    await lookup(page, serial);
    await expect(page.getByRole('status')).toContainText(
      'Lookup reached the 20-record limit. More matches may exist.',
    );
    await expect(
      page.getByRole('list', { name: 'Matching records' }).getByRole('link'),
    ).toHaveCount(20);
    await expect(
      page.getByRole('link', { name: 'Search inventory', exact: true }),
    ).toHaveAttribute('href', '/inventory');
    await expect(page).toHaveURL(/\/scan$/);
  } finally {
    await f.cleanup();
  }
});

test('a synthetic serial QR camera frame uses exact lookup and releases its stream', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const f = await acceptanceFixtures();
  try {
    const serial = `A4-CAMERA-${f.suffix}`;
    const created = await asset(
      f,
      `Camera identifier ${f.suffix}`,
      `A4-CAMERA-TAG-${f.suffix}`,
      serial,
      'Camera maker',
    );
    const qr = await QRCode.toDataURL(serial);
    const events: string[] = [];
    await page.exposeFunction('identifierCameraEvent', (event: string) => {
      events.push(event);
    });
    await page.addInitScript(
      ({ source }) => {
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          configurable: true,
          value: async () => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 640;
            const context = canvas.getContext('2d')!;
            const draw = () => {
              context.fillStyle = '#fff';
              context.fillRect(0, 0, 640, 640);
              context.drawImage(image, 120, 120, 400, 400);
            };
            draw();
            const stream = canvas.captureStream(15),
              track = stream.getVideoTracks()[0];
            const timer = setInterval(draw, 100),
              originalStop = track.stop.bind(track);
            track.stop = () => {
              clearInterval(timer);
              originalStop();
              void (
                window as typeof window & {
                  identifierCameraEvent: (value: string) => Promise<void>;
                }
              ).identifierCameraEvent('stopped');
            };
            return stream;
          },
        });
      },
      { source: qr },
    );
    await acceptanceLogin(page);
    await page.goto('/scan');
    await page
      .getByRole('button', { name: 'Start camera', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/inventory/assets/${created.entity_id}$`),
    );
    await expect.poll(() => events.includes('stopped')).toBe(true);
  } finally {
    await f.cleanup();
  }
});

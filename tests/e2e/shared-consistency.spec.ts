import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import {
  expectRecordStatus,
  expectRecordVersion,
  openRecordTask,
} from './record-task-controls';
import { displayedInstant } from '../helpers/displayed-instant';
import { exactOperationalTime as exactTime } from '../helpers/operational-time';
import { auditCreateRecord } from './audit-two-controls';
import { expectScopedInteractiveTransitions } from './interactive-style-contract';

test('interactive transitions stay scoped across workspace routes and control states', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const owned = await auditCreateRecord(
    page,
    'quantity',
    'Tools',
    'Fictional style foundation ' + randomUUID(),
  );
  const recordHref = new URL(owned.url).pathname;
  try {
    await page.goto('/settings/forms');
    const designerHref = await page
      .getByRole('link', { name: 'Tools', exact: true })
      .getAttribute('href');
    expect(designerHref).toBeTruthy();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const reduced of [false, true]) {
        await page.emulateMedia({
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        });
        for (const path of [
          '/inventory',
          '/room',
          '/settings',
          '/settings/labels',
          designerHref!,
          '/scan',
          '/labels',
          recordHref,
        ]) {
          await page.goto(path);
          await expect(page.locator('main')).toBeVisible();
          await expectScopedInteractiveTransitions(page);
          await page.mouse.move(0, 0);
          // Approved pre-refactor dark paint, asserted against the rendered cascade.
          await expect(page.locator('body')).toHaveCSS(
            'color',
            'rgb(232, 244, 255)',
          );
          await expect(page.locator('body')).toHaveCSS(
            'background-color',
            'rgb(6, 13, 24)',
          );
          if (path === '/inventory') {
            await expect(
              page.getByRole('textbox', {
                name: 'Search inventory',
                exact: true,
              }),
            ).toHaveCSS('transition-property', 'border-color, box-shadow');
          }
          if (path === '/labels') {
            const search = page.getByRole('button', {
              name: 'Search',
              exact: true,
            });
            await expect(search).toHaveCSS(
              'background-color',
              'rgb(116, 225, 237)',
            );
            await expect(search).toHaveCSS('color', 'rgb(7, 22, 34)');
            if (!reduced)
              await expect(search).toHaveCSS('transition-duration', '0s');
          }
          if (path === '/scan') {
            const camera = page.getByRole('button', {
              name: 'Start camera',
              exact: true,
            });
            await expect(camera).toHaveCSS(
              'background-color',
              'rgb(117, 226, 236)',
            );
            await expect(camera).toHaveCSS('color', 'rgb(6, 19, 29)');
          }
          if (path === recordHref) {
            await openRecordTask(page, 'Edit quantity metadata');
            await expectScopedInteractiveTransitions(page);
          }
          const disclosure = page.locator('summary:visible').first();
          if (await disclosure.count()) {
            await disclosure.click();
            await expectScopedInteractiveTransitions(page);
          }
          const control = page
            .locator('button:visible, a:visible, input:visible')
            .first();
          await control.focus();
          await expectScopedInteractiveTransitions(page);
          if (width === 1440) {
            await control.hover();
            await expectScopedInteractiveTransitions(page);
          }
        }
      }
    }
  } finally {
    await page.goto(recordHref);
    const archive = await openRecordTask(
      page,
      'Archive quantity definition and clear stock',
    );
    await archive
      .getByLabel('Reason (required)')
      .fill('Fictional style foundation fixture cleanup');
    await archive.getByRole('checkbox', { name: /I understand/ }).check();
    await archive
      .getByRole('button', { name: 'Review archive and clear stock' })
      .click();
    await archive
      .getByRole('button', { name: 'Confirm archive and clear stock' })
      .click();
    await expectRecordStatus(page, 'archived');
  }
});

async function login(page: Page, email = fixture.emails.staff) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
const settingNames = ['Label size', 'Paper size', 'Barcode type'] as const;
function localApi() {
  const api = process.env.LOCAL_API_URL!;
  const url = new URL(api);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
  expect(url.port).toBe('54321');
  return api;
}
async function options(page: Page) {
  return Promise.all(
    settingNames.map(async (name) => {
      const combobox = page.getByRole('combobox', { name, exact: true });
      await expect(combobox).toBeVisible();
      return combobox.locator('option').allTextContents();
    }),
  );
}

for (const fallback of [false, true]) {
  test(`${fallback ? 'Unresolved browser-zone fallback' : 'Browser-zone'} history and downloaded export correlate to canonical instants without hydration warnings`, async ({
    browser,
  }, info) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      timezoneId: 'America/Los_Angeles',
    });
    if (fallback)
      await context.addInitScript(() => {
        const Original = Intl.DateTimeFormat;
        const unresolvedDefault = (
          format: Intl.DateTimeFormat,
          args: unknown[],
        ) => {
          const options = args[1] as Intl.DateTimeFormatOptions | undefined;
          if (!options?.timeZone) {
            const resolved = format.resolvedOptions.bind(format);
            format.resolvedOptions = () => ({
              ...resolved(),
              timeZone: undefined as unknown as string,
            });
          }
          return format;
        };
        Intl.DateTimeFormat = new Proxy(Original, {
          construct(target, args) {
            return unresolvedDefault(
              Reflect.construct(target, args) as Intl.DateTimeFormat,
              args,
            );
          },
          apply(target, thisArg, args) {
            return unresolvedDefault(
              Reflect.apply(target, thisArg, args) as Intl.DateTimeFormat,
              args,
            );
          },
        });
      });
    const zone = fallback ? 'UTC' : 'America/Los_Angeles';
    const zoneLabel = fallback ? 'UTC fallback' : zone;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const name = 'CP4 timezone fixture ' + randomUUID();
    let detail: string | null = null;
    try {
      await login(page);
      if (fallback)
        expect(
          await page.evaluate(
            () => Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
        ).toBeUndefined();
      await page.goto('/inventory/quantity/new');
      const form = page.getByRole('form', {
        name: 'Add quantity item',
        exact: true,
      });
      await form.getByLabel('Name', { exact: true }).fill(name);
      await metadataReviewButton(form).click();
      await metadataSaveButton(form).click();
      await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
      detail = page.url();
      const time = page.locator('time').first();
      await expect(await exactTime(time)).toContainText(zoneLabel);
      const canonical = await time.getAttribute('datetime');
      expect(
        displayedInstant((await (await exactTime(time)).textContent())!),
      ).toBe(Math.floor(new Date(canonical!).getTime() / 1000) * 1000);
      await page.reload();
      await expect(time).toHaveAttribute('datetime', canonical!);
      await expect(await exactTime(time)).toContainText(zoneLabel);
      await page.getByRole('link', { name: 'View all item history' }).click();
      await expect(page).toHaveURL(/\/history\?/);
      await expect(await exactTime(page.locator('time').first())).toContainText(
        zoneLabel,
      );
      await page.screenshot({
        path: info.outputPath('history-los-angeles.png'),
        fullPage: true,
      });
      await page.goto('/inventory?q=' + encodeURIComponent(name));
      await page.getByText('Export CSV', { exact: true }).click();
      const exportLink = page.getByRole('link', {
        name: 'Filtered inventory',
        exact: true,
      });
      if (fallback)
        await expect(exportLink).not.toHaveAttribute(
          'href',
          /displayTimeZone=/,
        );
      else
        await expect(exportLink).toHaveAttribute(
          'href',
          new RegExp('displayTimeZone=' + encodeURIComponent(zone)),
        );
      const downloaded = page.waitForEvent('download');
      await exportLink.click();
      const download = await downloaded;
      const csvPath = info.outputPath('timezone-export.csv');
      await download.saveAs(csvPath);
      const rows = (await readFile(csvPath, 'utf8'))
        .replace(/^\uFEFF/, '')
        .trimEnd()
        .split(/\r?\n/)
        .map((line) =>
          (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? [])
            .slice(0, -1)
            .map((cell) =>
              cell
                .replace(/,$/, '')
                .replace(/^"|"$/g, '')
                .replaceAll('""', '"'),
            ),
        );
      expect(rows).toHaveLength(2);
      const [headers, row] = rows;
      expect(new Set(headers).size).toBe(headers.length);
      const column = (name: string) => {
        expect(headers.filter((header) => header === name)).toHaveLength(1);
        return headers.indexOf(name);
      };
      const metadataColumns = [
        'Item Code (SKU)',
        'Display timezone',
        'Exported at (display zone)',
        'Type label',
        'Status label',
        'Custody label',
      ];
      const skuColumn = column('Item Code (SKU)');
      expect(metadataColumns.map(column)).toEqual(
        metadataColumns.map((_, offset) => skuColumn + offset),
      );
      expect(row[column('Name')]).toBe(name);
      expect(row[column('Display timezone')]).toBe(
        fallback ? 'UTC (UTC fallback)' : zone,
      );
      const displayTime = row[column('Exported at (display zone)')];
      expect(displayTime).toContain(zone);
      if (fallback) expect(displayTime).toContain('UTC (UTC fallback)');
      expect(displayedInstant(displayTime)).toBe(
        Math.floor(
          new Date(row[column('Exported At (UTC)')]).getTime() / 1000,
        ) * 1000,
      );
      expect(download.suggestedFilename()).toMatch(/\d{8}T\d{6}Z\.csv$/);
      expect(
        errors.filter((error) => /hydrat|mismatch|uncaught/i.test(error)),
      ).toEqual([]);
      await info.attach('timezone-export', {
        path: csvPath,
        contentType: 'text/csv',
      });
    } finally {
      if (detail) {
        await page.goto(detail);
        const archive = await openRecordTask(
          page,
          'Archive quantity definition and clear stock',
        );
        await archive
          .getByLabel('Reason (required)')
          .fill('CP4 fictional timezone fixture cleanup');
        await archive.getByRole('checkbox', { name: /I understand/ }).check();
        await archive
          .getByRole('button', { name: 'Review archive and clear stock' })
          .click();
        await archive
          .getByRole('button', { name: 'Confirm archive and clear stock' })
          .click();
        await expectRecordStatus(page, 'archived');
        await expectRecordVersion(page, 2);
      }
      await context.close();
    }
  });
}

test('category actions retain keyboard focus and identity across long names, navigation and removal review', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const names = [
    'CP4 ' + suffix + ' Computers',
    'CP4 ' + suffix + ' Cables',
    'CP4 ' + suffix + ' ' + 'Long category accessories '.repeat(6).trim(),
  ];
  const codes: string[] = [];
  await page.setViewportSize({ width: 1180, height: 757 });
  await login(page);
  try {
    await page.goto('/settings/categories');
    await expect(
      page.getByRole('heading', { name: 'Categories', exact: true }),
    ).toHaveCount(1);
    for (const name of names) {
      await page.getByLabel('Display name', { exact: true }).fill(name);
      await page
        .getByLabel('Permanent code', { exact: true })
        .fill(`CP4-${suffix.toUpperCase()}-${codes.length}`);
      const code = await page
        .getByLabel('Permanent code', { exact: true })
        .inputValue();
      codes.push(code);
      await page
        .getByRole('button', { name: 'Add category', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Rename ' + name, exact: true }),
      ).toBeVisible();
    }
    for (const name of names) {
      await expect(
        page.getByRole('link', { name: 'Edit form for ' + name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Remove ' + name, exact: true }),
      ).toBeVisible();
    }
    const row = page.locator('li').filter({ hasText: codes[2] });
    const trigger = row.getByRole('button', {
      name: 'Rename ' + names[2],
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const input = row.getByLabel('New category name', { exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(names[2]);
    await input.fill('');
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    const renamed = 'Renamed ' + names[2];
    await page.keyboard.press('Enter');
    await input.fill(renamed);
    await row.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(
      row.getByRole('button', { name: 'Rename ' + renamed, exact: true }),
    ).toBeFocused();
    names[2] = renamed;
    await expect(
      row.getByRole('link', { name: 'Edit form for ' + renamed, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('categories-desktop.png'),
      fullPage: true,
    });
    await row.screenshot({
      path: info.outputPath('category-actions-desktop.png'),
    });
    for (const width of [390, 590]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 378 });
      await fits(page);
      await page.screenshot({
        path: info.outputPath(`categories-${width}.png`),
        fullPage: true,
      });
      await row.screenshot({
        path: info.outputPath(`category-actions-${width}.png`),
      });
    }
    // 590 CSS pixels represents the effective viewport of 1180px at 200%;
    // headless Chromium has no native browser-zoom control.
    const edit = row.getByRole('link', {
      name: 'Edit form for ' + renamed,
      exact: true,
    });
    const href = await edit.getAttribute('href');
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(href! + '$'));
    await page.goto('/settings/categories');
    await row
      .getByRole('button', { name: 'Remove ' + renamed, exact: true })
      .click();
    await expect(
      row.getByRole('button', { name: /^Remove category / }),
    ).toHaveCount(0);
    await row.getByRole('button', { name: 'Review impact' }).click();
    await expect(
      row.getByRole('region', { name: 'Removal impact review' }),
    ).toBeVisible();
    await expect(row.locator('time')).toHaveAttribute('datetime', /T/);
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    const viewer = await browser.newContext();
    try {
      const readOnly = await viewer.newPage();
      await login(readOnly, fixture.emails.viewer);
      await readOnly.goto('/settings/categories');
      await expect(readOnly.getByRole('note')).toContainText('read-only');
      await expect(
        readOnly.getByRole('button', { name: /^Rename / }),
      ).toHaveCount(0);
      await expect(
        readOnly.getByRole('link', { name: /^Edit form for / }),
      ).toHaveCount(0);
    } finally {
      await viewer.close();
    }
    const admin = createClient(
      localApi(),
      process.env.LOCAL_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const email = `cp4-no-config-${suffix}@example.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password: fixture.password,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const actorId = created.data.user!.id;
    const member = await admin.from('app_members').insert({
      user_id: actorId,
      display_name: 'CP4 temporary staff without configuration access',
      role: 'staff',
      active: true,
      can_manage_configuration: false,
    });
    expect(member.error).toBeNull();
    const staffContext = await browser.newContext();
    try {
      const staff = await staffContext.newPage();
      await login(staff, email);
      await staff.goto('/settings/categories');
      await expect(staff.getByRole('note')).toContainText('read-only');
      await expect(staff.getByRole('button', { name: /^Rename / })).toHaveCount(
        0,
      );
      await expect(staff.getByRole('button', { name: /^Remove / })).toHaveCount(
        0,
      );
      await staff.goto('/settings/labels');
      for (const name of settingNames)
        await expect(
          staff.getByRole('combobox', { name, exact: true }),
        ).toBeDisabled();
      await expect(
        staff.getByRole('button', { name: 'Save shared defaults' }),
      ).toHaveCount(0);
    } finally {
      await staffContext.close();
      const disabled = await admin
        .from('app_members')
        .update({ active: false })
        .eq('user_id', actorId);
      expect(disabled.error).toBeNull();
      const banned = await admin.auth.admin.updateUserById(actorId, {
        ban_duration: '876000h',
      });
      expect(banned.error).toBeNull();
    }
  } finally {
    for (const code of codes) {
      await page.goto('/settings/categories');
      const row = page.locator('li').filter({ hasText: code });
      if (!(await row.count())) continue;
      await row.getByRole('button', { name: /^Remove / }).click();
      await row.getByRole('button', { name: 'Review impact' }).click();
      await row.getByRole('button', { name: /^Remove category / }).click();
      await expect(row.getByRole('button', { name: /^Remove / })).toHaveCount(
        0,
      );
    }
  }
});

test('shared print defaults persist while job overrides and printable output retain their scope', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const api = localApi();
  const reader = createClient(
    api,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const auth = await reader.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(auth.error).toBeNull();
  const readDefaults = async () => {
    const result = await reader
      .from('configuration_label_defaults')
      .select('size,page,format,version')
      .single();
    expect(result.error).toBeNull();
    return result.data!;
  };
  const starting = await readDefaults();
  const selected = {
    size: starting.size === '90x50' ? '70x35' : '90x50',
    page: starting.page === 'letter' ? 'A4' : 'letter',
    format: 'qr',
  };
  let owned: typeof starting | null = null;
  const jobContext = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await login(page);
    await page.goto('/settings/labels');
    const settingsOptions = await options(page);
    for (const [index, value] of Object.values(selected).entries())
      await page
        .getByRole('combobox', { name: settingNames[index], exact: true })
        .selectOption(value);
    await page.getByRole('button', { name: 'Save shared defaults' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Label settings saved.',
    );
    owned = {
      ...selected,
      version: (BigInt(starting.version) + 1n).toString(),
    };
    expect(await readDefaults()).toEqual(owned);
    await page.reload();
    for (const [index, value] of Object.values(selected).entries())
      await expect(
        page.getByRole('combobox', { name: settingNames[index], exact: true }),
      ).toHaveValue(value);
    const job = await jobContext.newPage();
    await login(job);
    await job.goto('/labels?location=ITC');
    expect(await options(job)).toEqual(settingsOptions);
    for (const [index, value] of Object.values(selected).entries())
      await expect(
        job.getByRole('combobox', { name: settingNames[index], exact: true }),
      ).toHaveValue(value);
    await expect(
      job.locator('.label-card[data-code-ready="true"]'),
    ).toHaveCount(1);
    await expect(job).toHaveURL(/\/labels$/);
    await job
      .getByRole('combobox', { name: 'Label size', exact: true })
      .selectOption(starting.size);
    await job
      .getByRole('combobox', { name: 'Paper size', exact: true })
      .selectOption(starting.page);
    expect(await readDefaults()).toEqual(owned);
    await job.reload();
    await expect(
      job.locator('.label-card[data-code-ready="true"]'),
    ).toHaveCount(1);
    await expect(
      job.getByRole('combobox', { name: 'Label size', exact: true }),
    ).toHaveValue(starting.size);
    await expect(
      job.getByRole('combobox', { name: 'Paper size', exact: true }),
    ).toHaveValue(starting.page);
    // Another signed-in tab changes shared defaults through normal controls.
    // The saved queue belongs to this job, including its explicit overrides.
    expect(await readDefaults()).toEqual(owned);
    await page.reload();
    await page
      .getByRole('combobox', { name: 'Barcode type', exact: true })
      .selectOption('code128');
    await page.getByRole('button', { name: 'Save shared defaults' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Label settings saved.',
    );
    owned = {
      ...selected,
      format: 'code128',
      version: (BigInt(owned!.version) + 1n).toString(),
    };
    expect(await readDefaults()).toEqual(owned);
    await job.reload();
    await expect(
      job.locator('.label-card[data-code-ready="true"]'),
    ).toHaveCount(1);
    await expect(
      job.getByRole('combobox', { name: 'Label size', exact: true }),
    ).toHaveValue(starting.size);
    await expect(
      job.getByRole('combobox', { name: 'Paper size', exact: true }),
    ).toHaveValue(starting.page);
    await expect(
      job.getByRole('combobox', { name: 'Barcode type', exact: true }),
    ).toHaveValue('qr');
    await job.screenshot({
      path: info.outputPath('label-settings-preview.png'),
      fullPage: true,
    });
    await job.evaluate(() => {
      window.print = () => {
        window.dispatchEvent(new Event('beforeprint'));
        document.body.dataset.verifiedPrint =
          document
            .querySelector('.label-print-root')
            ?.getAttribute('data-print-authorized') ?? 'missing';
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await job.getByRole('button', { name: /Print selected labels/ }).click();
    await expect(job.locator('body')).toHaveAttribute(
      'data-verified-print',
      'true',
    );
    const sheet = job.locator('.label-print-root');
    await sheet.evaluate((node) =>
      node.setAttribute('data-print-authorized', 'true'),
    );
    try {
      await job.emulateMedia({ media: 'print' });
      await expect(job.locator('#job-barcode-help')).toBeHidden();
      await expect(
        job.getByRole('combobox', { name: 'Barcode type', exact: true }),
      ).toBeHidden();
      await expect(sheet).not.toContainText('Scanning a QR code');
      await expect(sheet).not.toContainText('Paper size');
      await job.screenshot({
        path: info.outputPath('print-output.png'),
        fullPage: true,
      });
      const pdfPath = info.outputPath('labels.pdf');
      await job.pdf({
        path: pdfPath,
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');
      await info.attach('labels-pdf', {
        path: pdfPath,
        contentType: 'application/pdf',
      });
    } finally {
      await sheet.evaluate((node) =>
        node.removeAttribute('data-print-authorized'),
      );
      await job.emulateMedia({ media: 'screen' });
    }
    expect(await readDefaults()).toEqual(owned);
    await job.getByRole('button', { name: 'Clear queue', exact: true }).click();
  } finally {
    await jobContext.close();
    if (owned) {
      // Never rebase cleanup onto a newer external version. The RPC atomically
      // rejects a change made after this exact run-owned version.
      expect(await readDefaults()).toEqual(owned);
      const restored = await reader.rpc('label_defaults_update', {
        p_request_id: randomUUID(),
        p_payload: {
          expected_version: owned.version,
          size: starting.size,
          page: starting.page,
          format: starting.format,
        },
      });
      expect(restored.error).toBeNull();
      expect(await readDefaults()).toEqual({
        ...starting,
        version: (BigInt(owned.version) + 1n).toString(),
      });
    }
    await reader.auth.signOut({ scope: 'local' });
  }
});

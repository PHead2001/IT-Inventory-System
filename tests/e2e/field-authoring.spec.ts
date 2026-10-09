import { expectRecordVersion, openRecordTask } from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import { instantMicros } from '../../src/features/metadata/field-value-validation';

test.use({
  actionTimeout: 15_000,
  viewport: { width: 1440, height: 960 },
});
const fields = [
  {
    type: 'Short text',
    name: 'Inspection description',
    value: 'Spare connector',
  },
  {
    type: 'Long text',
    name: 'Setup note',
    value: 'Keep the spare adapter.\nLabel before installation.',
  },
  { type: 'Whole number', name: 'Port count', value: '24' },
  { type: 'Decimal number', name: 'Cable length', value: '1.5' },
  { type: 'Checkbox', name: 'Has USB-C?', value: 'false' },
  { type: 'Date', name: 'Warranty end', value: '2027-10-01' },
  { type: 'Date & time', name: 'Appointment', value: '2026-11-01T07:30:00Z' },
  { type: 'Web link', name: 'Manual URL', value: 'https://example.com/manual' },
  { type: 'Money', name: 'Purchase price', value: '125.00' },
  { type: 'Dropdown', name: 'Condition', value: 'Good' },
  { type: 'Multiple choice', name: 'Features', value: 'USB-C' },
  { type: 'Nested dropdown', name: 'Connection type', value: 'USB-C' },
] as const;
function csvRows(csv: string): string[][] {
  csv = csv.replace(/^\uFEFF/, '');
  const rows: string[][] = [],
    row: string[] = [];
  let cell = '',
    quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && csv[index + 1] === '\n') index++;
      row.push(cell);
      rows.push([...row]);
      row.length = 0;
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  expect(quoted).toBe(false);
  return rows;
}
function choicePaths(
  field: {
    type: string;
    options: { id: string; label: string; parent_id: string | null }[];
  },
  value: unknown,
): string[][] {
  if (
    !['single_select', 'multi_select', 'hierarchical_select'].includes(
      field.type,
    )
  )
    return [];
  const path = (id: string): string[] => {
    const option = field.options.find((option) => option.id === id)!;
    return option.parent_id
      ? [...path(option.parent_id), option.label]
      : [option.label];
  };
  return (Array.isArray(value) ? value : [value]).map(path);
}
async function followHistoryLink(page: Page, name: string) {
  const link = page
    .getByRole('link', { name, exact: true, includeHidden: true })
    .first();
  if (!(await link.isVisible()))
    await link
      .locator('xpath=ancestor::details[1]')
      .locator(':scope > summary')
      .click();
  const destination = new URL((await link.getAttribute('href'))!, page.url());
  await link.click();
  await expect(page).toHaveURL(destination.href);
  const history = page.getByRole('region', { name: 'Custom history field' });
  await expect(history).toBeVisible();
  const technical = history.getByText('Technical recorded value', {
    exact: true,
  });
  if (await technical.count()) await technical.click();
  const fieldId = destination.searchParams.get('field');
  if (fieldId)
    await expect(
      history.getByText('Field: ' + fieldId, { exact: true }),
    ).toBeVisible();
}
async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png');
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function withCancelPageFixture(query: string, run: () => Promise<void>) {
  const url = new URL(process.env.LOCAL_API_URL!);
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  expect(url.port).toBe('54321');
  const caller = createClient(
    url.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await caller.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  const ids: string[] = [];
  try {
    const category = await caller
      .from('categories')
      .select('id')
      .eq('code', 'COMPUTERS')
      .eq('active', true)
      .single();
    expect(category.error).toBeNull();
    // A real second page is necessary: zero-match page=2 correctly recovers to page 1.
    for (let index = 0; index < 26; index++) {
      const created = await caller.rpc('quantity_create', {
        p_request_id: randomUUID(),
        p_payload: {
          name: query + ' ' + String(index).padStart(2, '0'),
          category_id: category.data!.id,
          initial_quantity: 0,
          initial_location_id: null,
        },
      });
      expect(created.error).toBeNull();
      ids.push((created.data as { entity_id: string }).entity_id);
    }
    await run();
    const unchanged = await caller
      .from('quantity_items')
      .select('id,version,archived')
      .in('id', ids);
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toHaveLength(26);
    for (const item of unchanged.data!)
      expect(item).toMatchObject({ version: 1, archived: false });
  } finally {
    try {
      for (const id of ids) {
        const archived = await caller.rpc('quantity_archive', {
          p_request_id: randomUUID(),
          p_payload: {
            item_id: id,
            expected_version: 1,
            reason: 'Fictional Cancel pagination fixture cleanup',
          },
        });
        expect(archived.error).toBeNull();
      }
    } finally {
      await caller.auth.signOut({ scope: 'local' });
    }
  }
}
async function rule(dialog: Locator, name: string, value: string) {
  await dialog.getByLabel('Use ' + name.toLowerCase(), { exact: true }).check();
  await dialog.getByLabel(name, { exact: true }).fill(value);
}
async function option(dialog: Locator, name: string, parent?: string) {
  if (parent)
    await dialog
      .getByRole('button', {
        name: 'Add child option to ' + parent,
        exact: true,
      })
      .click();
  else
    await dialog
      .getByRole('button', { name: 'Add option', exact: true })
      .click();
  const input = dialog.getByRole('textbox', {
    name: 'Option name: New option',
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill(name);
}
async function addField(
  page: Page,
  designer: Locator,
  config: (typeof fields)[number],
) {
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add field', exact: true });
  await dialog.getByRole('button', { name: config.type, exact: true }).click();
  await dialog.getByLabel('Field name', { exact: true }).fill(config.name);
  await dialog
    .getByLabel('Description shown below this field')
    .fill('Staff help for ' + config.name);
  await expect(
    dialog.getByRole('region', { name: 'New field preview' }),
  ).toContainText('Staff help for ' + config.name);
  if (config.type === 'Dropdown') {
    await option(dialog, 'Good');
    await option(dialog, 'Worn');
  }
  if (config.type === 'Multiple choice') {
    await option(dialog, 'Wi-Fi');
    await option(dialog, 'USB-C');
  }
  if (config.type === 'Nested dropdown') {
    await option(dialog, 'Connection');
    await option(dialog, 'USB', 'Connection');
    await option(dialog, 'USB-C', 'USB');
    await option(dialog, 'Network');
    await option(dialog, 'Ethernet', 'Network');
  }
  if (config.type === 'Checkbox')
    await dialog.getByLabel('Required', { exact: true }).check();
  await dialog.getByText('Optional rules', { exact: true }).click();
  if (config.type === 'Date & time') {
    const initial = dialog.getByRole('group', {
      name: 'Starts with (optional)',
      exact: true,
    });
    await initial.getByLabel('Display timezone').selectOption('UTC');
    await initial.getByLabel('Date', { exact: true }).fill('2026-11-01');
    await initial.getByLabel('Time', { exact: true }).fill('07:30:00');
    await dialog
      .getByLabel('Use earliest allowed date and time', { exact: true })
      .check();
    const earliest = dialog.getByRole('group', {
      name: 'Earliest allowed date and time',
      exact: true,
    });
    await earliest.getByLabel('Display timezone').selectOption('UTC');
    await earliest.getByLabel('Date', { exact: true }).fill('2026-10-01');
    await earliest.getByLabel('Time', { exact: true }).fill('00:00:00');
    await dialog
      .getByLabel('Use latest allowed date and time', { exact: true })
      .check();
    const latest = dialog.getByRole('group', {
      name: 'Latest allowed date and time',
      exact: true,
    });
    await latest.getByLabel('Display timezone').selectOption('UTC');
    await latest.getByLabel('Date', { exact: true }).fill('2026-12-01');
    await latest.getByLabel('Time', { exact: true }).fill('23:59:00');
  } else if (config.type === 'Checkbox')
    await dialog
      .getByRole('combobox', { name: 'Starts with (optional)', exact: true })
      .selectOption('false');
  else if (config.type === 'Dropdown')
    await dialog
      .getByRole('combobox', { name: 'Starts with (optional)', exact: true })
      .selectOption({ label: config.value });
  else if (config.type === 'Multiple choice')
    await dialog
      .getByRole('group', { name: 'Starts with (optional)', exact: true })
      .getByRole('checkbox', { name: config.value, exact: true })
      .check();
  else if (config.type === 'Nested dropdown')
    await dialog
      .getByRole('group', { name: 'Starts with (optional)', exact: true })
      .getByRole('button', { name: config.value, exact: true })
      .click();
  else
    await dialog
      .getByLabel('Starts with (optional)', { exact: true })
      .fill(config.value);
  if (config.type === 'Short text') {
    await rule(dialog, 'Minimum characters', '2');
    await rule(dialog, 'Maximum characters', '80');
  }
  if (config.type === 'Long text')
    await rule(dialog, 'Maximum characters', '500');
  if (config.type === 'Whole number') {
    await rule(dialog, 'Minimum value', '-');
    await expect(dialog.getByRole('alert')).toContainText('whole number');
    await expect(
      dialog.getByLabel('Minimum value', { exact: true }),
    ).toHaveValue('-');
    await dialog
      .getByRole('button', { name: 'Add to form', exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel('Minimum value', { exact: true }),
    ).toHaveValue('-');
    await dialog.getByLabel('Minimum value', { exact: true }).fill('0');
    await rule(dialog, 'Maximum value', '48');
  }
  if (config.type === 'Decimal number') {
    await dialog
      .getByRole('combobox', { name: 'Decimal places', exact: true })
      .selectOption('2');
    await rule(dialog, 'Minimum value', '0');
    await rule(dialog, 'Maximum value', '10');
  }
  if (config.type === 'Money') {
    await dialog
      .getByRole('combobox', { name: 'Currency', exact: true })
      .selectOption('USD');
    await dialog
      .getByRole('combobox', { name: 'Decimal places', exact: true })
      .selectOption('2');
    await rule(dialog, 'Minimum amount', '0');
    await rule(dialog, 'Maximum amount', '999.99');
  }
  if (config.type === 'Date') {
    await rule(dialog, 'Earliest allowed date', '2026-10-01');
    await rule(dialog, 'Latest allowed date', '2028-10-01');
  }
  if (config.type === 'Multiple choice')
    await rule(dialog, 'Maximum selections', '2');
  await dialog
    .getByRole('button', { name: 'Add to form', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const control = designer.locator('[data-control-id]').filter({
    has: page.getByRole('button', {
      name: 'Drag ' + config.name,
      exact: true,
    }),
  });
  await expect(control).toHaveAttribute('data-selected', 'true');
  await expect(control).toContainText('Staff help for ' + config.name);
  await expect(
    designer
      .getByTestId('designer-inspector')
      .getByLabel('Field name', { exact: true }),
  ).toHaveValue(config.name);
}
async function confirm(form: Locator) {
  await metadataReviewButton(form).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await metadataSaveButton(form).click();
}
function metadataAnswer(page: Page, label: string) {
  return page
    .getByRole('region', { name: 'Custom metadata', exact: true })
    .locator('dl > div')
    .filter({
      has: page.locator('dt').filter({
        hasText: new RegExp(
          '^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
        ),
      }),
    })
    .locator('dd')
    .first();
}

async function expectMetadataAnswer(page: Page, label: string, value: string) {
  const answer = metadataAnswer(page, label);
  if (label !== 'Manual URL') {
    await expect(answer).toHaveText(value);
    return;
  }
  await expect(answer.getByText(value, { exact: true })).toBeVisible();
  const open = answer.getByRole('link', {
    name: `Open ${value} in a new tab`,
    exact: true,
  });
  await expect(open).toHaveAttribute('href', value);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(
    answer.getByRole('button', { name: `Copy ${value}`, exact: true }),
  ).toBeVisible();
}

test('authors all twelve types through the UI and preserves their preview, create/edit, history and export contracts', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const suffix = randomUUID().slice(0, 8);
  const category = 'Field acceptance ' + suffix;
  const record = 'Authored quantity ' + suffix;
  const client = createClient(
    process.env.LOCAL_API_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  await login(page);
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Category added.');
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  // Cancelled additions never enter the field catalog and preserve the unrelated section edit.
  await designer
    .getByRole('button', { name: 'Add section', exact: true })
    .click();
  const section = designer.locator('[data-section-id]').last();
  await section.getByLabel('Section heading').fill('Custom details');
  await section
    .getByRole('button', { name: 'Add field to Custom details', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add field' });
  await dialog.getByLabel('Field name').fill('Cancelled phantom');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(section.getByLabel('Section heading')).toHaveValue(
    'Custom details',
  );
  await expect(
    designer.getByRole('button', { name: 'Drag Cancelled phantom' }),
  ).toHaveCount(0);
  for (const config of fields)
    await test.step('Author ' + config.type, async () =>
      addField(page, designer, config),
    );
  await capture(page, info, 'all-types-authored-canvas');
  await designer.getByText(/^Try form|^Live preview ·/).click();
  const preview = designer.getByRole('form', {
    name: 'Preview quantity metadata',
  });
  const checkbox = preview.getByRole('checkbox', {
    name: 'Has USB-C? (required)',
    exact: true,
  });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await checkbox.uncheck();
  const checkboxContainer = checkbox.locator(
    'xpath=ancestor::div[contains(@class,"space-y-2")][1]',
  );
  await checkboxContainer.getByRole('button', { name: 'Clear answer' }).click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
  await checkbox.check();
  await checkbox.uncheck();
  await expect(preview.getByText('Yes / No')).toHaveCount(0);
  const nested = preview.getByRole('group', {
    name: 'Connection type',
    exact: true,
  });
  await nested
    .getByRole('button', { name: 'USB — Choose this option', exact: true })
    .click();
  await expect(nested).toContainText('Selected: Connection / USB');
  await nested.getByRole('button', { name: 'Ethernet', exact: true }).click();
  await expect(nested).toContainText('Selected: Network / Ethernet');
  await preview.getByLabel('Port count', { exact: true }).fill('-');
  await expect(preview.getByRole('alert')).toContainText('whole number');
  await expect(preview.getByLabel('Port count', { exact: true })).toHaveValue(
    '-',
  );
  await preview.getByLabel('Port count', { exact: true }).fill('1.5');
  await expect(preview.getByRole('alert')).toContainText('whole number');
  await preview.getByLabel('Port count', { exact: true }).fill('0');
  await capture(page, info, 'interactive-preview-checkbox-nested-help');
  await designer
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  const impact = designer.getByRole('region', { name: 'Form save impact' });
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: /Saved active form revision|Review the effect/ }),
  ).toContainText(/Saved active form revision|Review the effect/);
  if (await impact.isVisible())
    await impact
      .getByRole('button', { name: 'Confirm and save changes' })
      .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toContainText('Saved active form revision');
  await page.reload();
  for (const config of fields)
    await expect(
      designer
        .locator('[data-control-id]')
        .filter({
          has: page.getByRole('button', {
            name: 'Drag ' + config.name,
            exact: true,
            includeHidden: true,
          }),
        })
        .getByTestId('designer-control-preview'),
    ).toContainText(config.name);
  await page.goto('/inventory/quantity/new');
  let form = page.getByRole('form', { name: 'Add quantity item' });
  await form
    .getByLabel('Category', { exact: true })
    .selectOption({ label: category });
  await form.getByLabel('Name', { exact: true }).fill(record);
  await expect(form.getByLabel('Port count', { exact: true })).toHaveValue(
    '24',
  );
  await expect(form.getByLabel('Cable length', { exact: true })).toHaveValue(
    '1.5',
  );
  await expect(form.getByLabel('Setup note', { exact: true })).toHaveValue(
    fields[1].value,
  );
  await expect(
    form.getByRole('checkbox', { name: 'Has USB-C? (required)' }),
  ).not.toBeChecked();
  await expect(
    form.getByRole('group', { name: 'Connection type' }),
  ).toContainText('Selected: Connection / USB / USB-C');
  await capture(page, info, 'quantity-defaults-live-entry');
  await confirm(form);
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const quantityUrl = page.url(),
    quantityId = quantityUrl.split('/').at(-1)!;
  for (const config of fields)
    await expect(
      page
        .getByRole('region', { name: 'Custom metadata' })
        .locator('dt')
        .filter({ hasText: config.name }),
    ).toHaveCount(1);
  await page.reload();
  await expect(metadataAnswer(page, 'Port count')).toHaveText('24');
  await expect(metadataAnswer(page, 'Has USB-C?')).toHaveText('No');
  await expect(metadataAnswer(page, 'Setup note')).toHaveText(fields[1].value);
  const before = await client
    .from('quantity_items')
    .select('custom_values')
    .eq('id', quantityId)
    .single();
  expect(before.error).toBeNull();
  const fieldsRead = await client
    .from('categories')
    .select('id')
    .eq('name', category)
    .single();
  expect(fieldsRead.error).toBeNull();
  const envelope = await client.rpc('metadata_form_get_v2', {
    p_category_id: fieldsRead.data!.id,
  });
  expect(envelope.error).toBeNull();
  const definition = (
    envelope.data as unknown as {
      published_revision_id: string;
      published_definition: {
        fields: {
          id: string;
          label: string;
          type: string;
          default: unknown;
          options: { id: string; label: string; parent_id: string | null }[];
        }[];
      };
    }
  ).published_definition;
  const ids = Object.fromEntries(
    definition.fields.map((field) => [field.label, field.id]),
  );
  expect(Object.keys(before.data!.custom_values)).toHaveLength(12);
  const optionId = (label: string, option: string) =>
    definition.fields
      .find((field) => field.label === label)!
      .options.find((value) => value.label === option)!.id;
  for (const field of definition.fields) {
    const saved = before.data!.custom_values[field.id].value;
    if (field.label === 'Appointment')
      expect(instantMicros(saved)).toBe(instantMicros(field.default));
    else expect(saved).toEqual(field.default);
  }
  const initialDetail: Record<string, string> = {
    'Inspection description': 'Spare connector',
    'Setup note': fields[1].value,
    'Port count': '24',
    'Cable length': '1.5',
    'Has USB-C?': 'No',
    'Warranty end': '2027-10-01',
    'Manual URL': 'https://example.com/manual',
    'Purchase price': '125.00 USD',
    Condition: 'Good',
    Features: 'USB-C',
    'Connection type': 'Connection / USB / USB-C',
  };
  for (const [label, value] of Object.entries(initialDetail))
    await expectMetadataAnswer(page, label, value);
  await expect(metadataAnswer(page, 'Appointment')).toContainText('2026');
  await openRecordTask(page, 'Edit quantity metadata');
  form = await openRecordTask(page, 'Edit quantity metadata');
  await form
    .getByLabel('Inspection description', { exact: true })
    .fill('Edited connector');
  await form
    .getByLabel('Setup note', { exact: true })
    .fill('Edited quantity note\nKeep both lines.');
  await form.getByLabel('Warranty end', { exact: true }).fill('2027-11-02');
  await form
    .getByRole('checkbox', { name: 'Has USB-C? (required)', exact: true })
    .check();
  await form.getByLabel('Port count', { exact: true }).fill('0');
  await form.getByLabel('Cable length', { exact: true }).fill('1.25');
  await form.getByLabel('Purchase price', { exact: true }).fill('0.00');
  await form
    .getByLabel('Manual URL', { exact: true })
    .fill('https://example.com/updated-manual');
  await form
    .getByLabel('Condition', { exact: true })
    .selectOption({ label: 'Worn' });
  await form
    .getByRole('group', { name: 'Features', exact: true })
    .getByRole('checkbox', { name: 'USB-C', exact: true })
    .uncheck();
  await form
    .getByRole('group', { name: 'Connection type', exact: true })
    .getByRole('button', { name: 'USB — Choose this option', exact: true })
    .click();
  const appointment = form.getByRole('group', {
    name: 'Appointment',
    exact: true,
  });
  await appointment
    .getByLabel('Display timezone')
    .selectOption('America/Chicago');
  await expect(appointment.getByLabel('Time', { exact: true })).toHaveValue(
    /^01:30:00(?:\.000)?$/,
  );
  await capture(page, info, 'edit-zero-empty-selection-parent-timezone');
  await confirm(form);
  await expectRecordVersion(page, 2);
  await page.reload();
  await expect(metadataAnswer(page, 'Port count')).toHaveText('0');
  await expect(metadataAnswer(page, 'Cable length')).toHaveText('1.25');
  await expect(metadataAnswer(page, 'Purchase price')).toHaveText('0.00 USD');
  await expect(metadataAnswer(page, 'Connection type')).toHaveText(
    'Connection / USB',
  );
  const after = await client
    .from('quantity_items')
    .select('custom_values')
    .eq('id', quantityId)
    .single();
  expect(after.error).toBeNull();
  expect(after.data!.custom_values[ids.Appointment]).toEqual(
    before.data!.custom_values[ids.Appointment],
  );
  expect(after.data!.custom_values[ids.Features].value).toEqual([]);
  expect(after.data!.custom_values[ids['Has USB-C?']].value).toBe(true);
  const expectedEdited: Record<string, unknown> = {
    'Inspection description': 'Edited connector',
    'Setup note': 'Edited quantity note\nKeep both lines.',
    'Port count': 0,
    'Cable length': '1.25',
    'Has USB-C?': true,
    'Warranty end': '2027-11-02',
    Appointment: before.data!.custom_values[ids.Appointment].value,
    'Manual URL': 'https://example.com/updated-manual',
    'Purchase price': { amount: '0.00', currency: 'USD' },
    Condition: optionId('Condition', 'Worn'),
    Features: [],
    'Connection type': optionId('Connection type', 'USB'),
  };
  for (const [label, value] of Object.entries(expectedEdited))
    expect(after.data!.custom_values[ids[label]].value).toEqual(value);
  const editedDetail: Record<string, string> = {
    ...initialDetail,
    'Inspection description': 'Edited connector',
    'Setup note': 'Edited quantity note\nKeep both lines.',
    'Port count': '0',
    'Cable length': '1.25',
    'Has USB-C?': 'Yes',
    'Warranty end': '2027-11-02',
    'Manual URL': 'https://example.com/updated-manual',
    'Purchase price': '0.00 USD',
    Condition: 'Worn',
    'Connection type': 'Connection / USB',
  };
  delete editedDetail.Features;
  for (const [label, value] of Object.entries(editedDetail))
    await expectMetadataAnswer(page, label, value);
  expect(after.data!.custom_values[ids['Port count']].value).toBe(0);
  await page.goto('/history?entityId=' + quantityId);
  await followHistoryLink(
    page,
    'Custom metadata changed — inspect before and after',
  );
  const eventKey = new URL(page.url()).searchParams.get('event')!;
  const eventId = eventKey.split(':')[1];
  const recordedEvent = await client
    .from('quantity_events')
    .select('before_metadata,after_metadata')
    .eq('id', eventId)
    .single();
  expect(recordedEvent.error).toBeNull();
  expect(recordedEvent.data!.before_metadata.custom_values).toEqual(
    before.data!.custom_values,
  );
  expect(recordedEvent.data!.after_metadata.custom_values).toEqual(
    after.data!.custom_values,
  );
  expect(recordedEvent.data!.before_metadata.category_id).toBe(
    fieldsRead.data!.id,
  );
  expect(recordedEvent.data!.after_metadata.category_id).toBe(
    fieldsRead.data!.id,
  );
  const seenHistory: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const historyField = page.getByRole('region', {
      name: 'Custom history field',
    });
    const label = await historyField
      .getByRole('heading', { level: 2 })
      .innerText();
    const historicalField = definition.fields.find(
      (field) => field.label === label,
    )!;
    expect(historicalField).toBeTruthy();
    seenHistory.push(historicalField.id);
    for (const [side, expected] of [
      ['before', before.data!.custom_values],
      ['after', after.data!.custom_values],
    ] as const) {
      await followHistoryLink(
        page,
        side === 'before' ? 'Before event' : 'After event',
      );
      await expect(
        historyField.getByText(
          side === 'before' ? 'Before event' : 'After event',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        historyField.getByText('Field: ' + historicalField.id, { exact: true }),
      ).toBeVisible();
      await expect(historyField.locator('pre')).toBeVisible();
      expect(
        JSON.parse((await historyField.locator('pre').textContent())!),
      ).toEqual(expected[historicalField.id].value);
      await expect(
        historyField.getByText(
          'Validated revision: ' +
            expected[historicalField.id].validated_revision_id,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        historyField.getByText('Type: ' + historicalField.type, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        historyField.getByText('Field owner category: ' + fieldsRead.data!.id, {
          exact: true,
        }),
      ).toBeVisible();
      if (
        ['single_select', 'multi_select', 'hierarchical_select'].includes(
          historicalField.type,
        )
      ) {
        const paths = choicePaths(
          historicalField,
          expected[historicalField.id].value,
        );
        await expect(
          historyField.getByText(
            paths.length
              ? paths.map((path) => path.join(' / ')).join('; ')
              : 'No options selected',
            { exact: true },
          ),
        ).toBeVisible();
      }
    }
    if (index < fields.length - 1)
      await followHistoryLink(page, 'Next custom field');
  }
  expect(seenHistory.sort()).toEqual(
    definition.fields.map((field) => field.id).sort(),
  );
  // The first update changed eleven types; timezone-only viewing preserved the complete datetime envelope.
  expect(
    recordedEvent.data!.before_metadata.custom_values[ids.Appointment],
  ).toEqual(recordedEvent.data!.after_metadata.custom_values[ids.Appointment]);
  await capture(page, info, 'metadata-history');
  await page.goto(quantityUrl);
  await openRecordTask(page, 'Edit quantity metadata');
  form = await openRecordTask(page, 'Edit quantity metadata');
  const editedAppointment = form.getByRole('group', {
    name: 'Appointment',
    exact: true,
  });
  await editedAppointment
    .getByLabel('Display timezone')
    .selectOption('America/Chicago');
  await editedAppointment.getByLabel('Time', { exact: true }).fill('03:30:00');
  await form
    .getByRole('checkbox', { name: 'Has USB-C? (required)', exact: true })
    .uncheck();
  await confirm(form);
  await expectRecordVersion(page, 3);
  await page.reload();
  const finalValues = await client
    .from('quantity_items')
    .select('custom_values')
    .eq('id', quantityId)
    .single();
  expect(finalValues.error).toBeNull();
  expect(
    instantMicros(finalValues.data!.custom_values[ids.Appointment].value),
  ).toBe(instantMicros('2026-11-01T09:30:00Z'));
  expectedEdited.Appointment =
    finalValues.data!.custom_values[ids.Appointment].value;
  expectedEdited['Has USB-C?'] = false;
  for (const [label, value] of Object.entries(expectedEdited))
    expect(finalValues.data!.custom_values[ids[label]].value).toEqual(value);
  await expect(metadataAnswer(page, 'Has USB-C?')).toHaveText('No');
  await expect(metadataAnswer(page, 'Appointment')).toContainText('2026');
  await page.goto('/history?entityId=' + quantityId);
  await followHistoryLink(
    page,
    'Custom metadata changed — inspect before and after',
  );
  const timeEventId = new URL(page.url()).searchParams
    .get('event')!
    .split(':')[1];
  const timeEvent = await client
    .from('quantity_events')
    .select('before_metadata,after_metadata')
    .eq('id', timeEventId)
    .single();
  expect(timeEvent.error).toBeNull();
  expect(timeEvent.data!.before_metadata.custom_values).toEqual(
    after.data!.custom_values,
  );
  expect(timeEvent.data!.after_metadata.custom_values).toEqual(
    finalValues.data!.custom_values,
  );
  for (
    let index = 0;
    index < fields.length &&
    !(await page
      .getByRole('heading', { name: 'Appointment', exact: true })
      .isVisible());
    index++
  )
    await followHistoryLink(page, 'Next custom field');
  await expect(
    page.getByRole('heading', { name: 'Appointment', exact: true }),
  ).toBeVisible();
  for (const [side, snapshot] of [
    ['before', after.data!.custom_values],
    ['after', finalValues.data!.custom_values],
  ] as const) {
    await followHistoryLink(
      page,
      side === 'before' ? 'Before event' : 'After event',
    );
    expect(JSON.parse((await page.locator('pre').textContent())!)).toEqual(
      snapshot[ids.Appointment].value,
    );
    await expect(
      page.getByText(
        'Validated revision: ' +
          snapshot[ids.Appointment].validated_revision_id,
        { exact: true },
      ),
    ).toBeVisible();
  }
  await page.goto('/inventory?q=' + encodeURIComponent(record));
  const downloadEvent = page.waitForEvent('download');
  await page.getByText('Export CSV', { exact: true }).click();
  await page
    .getByRole('link', { name: 'Filtered inventory', exact: true })
    .click();
  const downloaded = await downloadEvent;
  const csvPath = info.outputPath('base-export.csv');
  await downloaded.saveAs(csvPath);
  const baseRows = csvRows(readFileSync(csvPath, 'utf8'));
  expect(baseRows[0]).not.toContain('Custom Fields JSON');
  const baseRow = baseRows
    .slice(1)
    .find((row) => row[baseRows[0].indexOf('Record ID')] === quantityId)!;
  expect(baseRow[baseRows[0].indexOf('Name')]).toBe(record);
  expect(baseRow[baseRows[0].indexOf('Type')]).toBe('Quantity');
  expect(baseRow[baseRows[0].indexOf('Category')]).toBe(category);
  const customDownloadEvent = page.waitForEvent('download');
  await page
    .getByRole('link', { name: 'Inventory with custom fields', exact: true })
    .click();
  const customDownloaded = await customDownloadEvent;
  const customCsvPath = info.outputPath('custom-export.csv');
  await customDownloaded.saveAs(customCsvPath);
  const csv = readFileSync(customCsvPath, 'utf8');
  expect(csv).toContain('Custom Fields JSON');
  expect(csv).toContain('Edited connector');
  expect(csv).toContain('0.00');
  const exportRows = csvRows(csv),
    exportHeaders = exportRows[0];
  const exportedRow = exportRows
    .slice(1)
    .find((row) => row[exportHeaders.indexOf('Record ID')] === quantityId)!;
  const exportedCustom = JSON.parse(
    exportedRow[exportHeaders.indexOf('Custom Fields JSON')],
  );
  expect(Object.keys(exportedCustom).sort()).toEqual(
    definition.fields.map((field) => field.id).sort(),
  );
  const publishedRevision = (
    envelope.data as unknown as { published_revision_id: string }
  ).published_revision_id;
  for (const field of definition.fields) {
    const saved = finalValues.data!.custom_values[field.id];
    const optionPaths = choicePaths(field, saved.value);
    expect(exportedCustom[field.id]).toEqual({
      value: saved.value,
      validated_revision_id: saved.validated_revision_id,
      label: field.label,
      field_type: field.type,
      option_paths: optionPaths,
      legacy: false,
      category_id: fieldsRead.data!.id,
      current_published_revision_id: publishedRevision,
    });
  }
  await info.attach('custom-export.csv', {
    path: customCsvPath,
    contentType: 'text/csv',
  });
  await page.goto('/inventory/assets/new');
  form = page.getByRole('form', { name: 'Add individual asset' });
  await form
    .getByLabel('Category', { exact: true })
    .selectOption({ label: category });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Authored asset ' + suffix);
  await chooseLocation(form, 'Current location', 'ITC-S1A');
  await confirm(form);
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  await page.reload();
  await expect(metadataAnswer(page, 'Purchase price')).toHaveText('125.00 USD');
  await openRecordTask(page, 'Edit asset metadata');
  form = await openRecordTask(page, 'Edit asset metadata');
  await form
    .getByLabel('Setup note', { exact: true })
    .fill('Asset note\nSecond line');
  await confirm(form);
  await expectRecordVersion(page, 2);
  await page.reload();
  await expect(metadataAnswer(page, 'Setup note')).toHaveText(
    'Asset note\nSecond line',
  );
  await capture(page, info, 'serialized-reload-all-types');
  const assetUrl = page.url(),
    assetId = assetUrl.split('/').at(-1)!;
  const assetSnapshot = await client
    .from('serialized_assets')
    .select('custom_values')
    .eq('id', assetId)
    .single();
  expect(assetSnapshot.error).toBeNull();
  const quantitySnapshot = finalValues.data!.custom_values;
  const assertRetained = async () => {
    const quantity = await client
      .from('quantity_items')
      .select('custom_values')
      .eq('id', quantityId)
      .single();
    const asset = await client
      .from('serialized_assets')
      .select('custom_values')
      .eq('id', assetId)
      .single();
    expect(quantity.error).toBeNull();
    expect(asset.error).toBeNull();
    expect(quantity.data!.custom_values).toEqual(quantitySnapshot);
    expect(asset.data!.custom_values).toEqual(
      assetSnapshot.data!.custom_values,
    );
  };
  const saveDesigner = async () => {
    await designer
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await expect(
      designer
        .getByRole('status')
        .filter({ hasText: /Saved active form revision|Review the effect/ }),
    ).toContainText(/Saved active form revision|Review the effect/);
    const impact = designer.getByRole('region', { name: 'Form save impact' });
    if (await impact.isVisible())
      await impact
        .getByRole('button', { name: 'Confirm and save changes' })
        .click();
    await expect(
      designer
        .getByRole('status')
        .filter({ hasText: 'Saved active form revision' }),
    ).toContainText('Saved active form revision');
  };
  await page.goto('/settings/forms/' + fieldsRead.data!.id);
  for (const config of fields) {
    await designer
      .getByTestId('designer-library')
      .getByRole('button')
      .filter({ hasText: config.name + ' ·' })
      .click();
    if (config.type === 'Checkbox')
      page.once('dialog', (dialog) => dialog.accept());
    await designer
      .getByRole('complementary', { name: 'Designer inspector' })
      .getByRole('button', { name: 'Hide from form', exact: true })
      .click();
  }
  await saveDesigner();
  await page.reload();
  await assertRetained();
  for (const [url, kind] of [
    [quantityUrl, 'quantity'],
    [assetUrl, 'asset'],
  ] as const) {
    await page.goto(url);
    await openRecordTask(page, 'Edit ' + kind + ' metadata');
    const hiddenForm = page.getByRole('form', {
      name: 'Edit ' + kind + ' metadata',
    });
    await expect(
      hiddenForm.getByLabel('Inspection description', { exact: true }),
    ).toHaveCount(0);
    await hiddenForm
      .getByLabel('Manufacturer', { exact: true })
      .fill('Core edit while twelve fields hidden');
    await confirm(hiddenForm);
    await expectRecordVersion(page, kind === 'quantity' ? 4 : 3);
    await page.reload();
    await assertRetained();
  }
  await page.goto('/settings/forms/' + fieldsRead.data!.id);
  await designer
    .locator('summary')
    .filter({ hasText: /^Hidden fields/ })
    .click();
  for (const config of fields)
    await designer
      .getByRole('button', { name: 'Show ' + config.name, exact: true })
      .click();
  await saveDesigner();
  await page.reload();
  await assertRetained();
  for (const [url, kind] of [
    [quantityUrl, 'quantity'],
    [assetUrl, 'asset'],
  ] as const) {
    await page.goto(url);
    await page.reload();
    for (const config of fields)
      await expect(
        page
          .getByRole('region', { name: 'Custom metadata' })
          .locator('dt')
          .filter({ hasText: config.name }),
      ).toHaveCount(1);
    await openRecordTask(page, 'Edit ' + kind + ' metadata');
    await expect(
      page
        .getByRole('form', { name: 'Edit ' + kind + ' metadata' })
        .getByLabel('Inspection description', { exact: true }),
    ).toBeVisible();
  }
  await capture(page, info, 'all-twelve-restored-after-unrelated-core-edits');
  await page.context().clearCookies();
  await login(page, 'viewer');
  await page.goto('/inventory/quantity/new');
  await expect(page.getByText(/Staff membership is required/)).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Add quantity item' }),
  ).toHaveCount(0);
});

test('whole-form Cancel preserves inventory filters, dirty drafts and focus at narrow/zoomed widths', async ({
  page,
}, info) => {
  await login(page);
  const query = 'Cancel example ' + randomUUID().slice(0, 8);
  await withCancelPageFixture(query, async () => {
    await page.goto(
      '/inventory?q=' + encodeURIComponent(query) + '&type=quantity&page=2',
    );
    await expect(
      page.getByText('26 matching rows', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Pagination' }),
    ).toContainText('Page 2 of 2');
    await expect(
      page.getByRole('link', { name: query + ' 25', exact: true }),
    ).toHaveCount(1);
    await page.getByLabel('Add item', { exact: true }).click();
    await page.getByRole('link', { name: 'Add quantity item' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(
        '/inventory\\?q=' +
          query.replaceAll(' ', '\\+') +
          '&type=quantity&page=2',
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/inventory/assets/new');
    const form = page.getByRole('form', { name: 'Add individual asset' });
    await form.getByLabel('Name', { exact: true }).fill(query);
    await noOverflow(page);
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Keep editing' }),
    ).toBeFocused();
    await capture(page, info, 'narrow-dirty-cancel');
    await page.keyboard.press('Escape');
    await expect(
      form.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue(query);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await capture(page, info, 'zoom200-cancel');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1';
    });
    const siteCode = 'CANCEL-' + randomUUID().slice(0, 8).toUpperCase();
    await page.goto('/settings/sites');
    const siteForm = page.locator('form').filter({
      has: page.getByRole('heading', {
        name: 'Add property/site',
        exact: true,
      }),
    });
    await siteForm.getByLabel('Name', { exact: true }).fill('Cancel property');
    await siteForm.getByLabel('Permanent code', { exact: true }).fill(siteCode);
    await siteForm.getByRole('button', { name: 'Save site' }).click();
    const receipt = page.getByRole('region', {
      name: 'Site creation complete',
    });
    await expect(
      receipt.getByRole('heading', { name: 'Site created', exact: true }),
    ).toBeVisible();
    await expect(receipt.getByRole('status')).toContainText(siteCode);
    await page.goto('/sites/' + siteCode);
    await page
      .getByText('Record equipment already at this site', { exact: true })
      .click();
    await page
      .getByRole('link', {
        name: 'Record existing quantity item',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/sites/' + siteCode + '$'));
    await page
      .getByText('Record equipment already at this site', { exact: true })
      .click();
    await page
      .getByRole('link', {
        name: 'Record existing individual asset',
        exact: true,
      })
      .click();
    await page
      .getByLabel('Name', { exact: true })
      .fill('Discarded opening asset');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(new RegExp('/sites/' + siteCode + '$'));
    await expect(
      page.getByRole('group', { name: 'Grouped current holdings' }),
    ).toHaveCount(0);
    const holdings = page.getByRole('region', {
      name: 'Current holdings',
      exact: true,
    });
    await expect(holdings).toContainText(
      'No equipment is currently assigned to this site.',
    );
    await expect(
      holdings.getByRole('link', {
        name: 'Discarded opening asset',
        exact: true,
      }),
    ).toHaveCount(0);
    for (const label of [
      'Current assigned quantity units',
      'Current individual assets',
    ])
      await expect(
        page
          .locator('dl > div')
          .filter({
            has: page
              .locator('dt')
              .filter({ hasText: new RegExp('^' + label + '$') }),
          })
          .locator('dd'),
      ).toHaveText('0');
    await capture(page, info, 'cancel-site-opening-no-holding');
  });
});

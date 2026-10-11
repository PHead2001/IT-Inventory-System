import { randomUUID } from 'node:crypto';
import { expectPrivateTitleExcluded } from '../helpers/private-title';
import { interfaceTest, interfaceLogin } from './interface-fixtures';
import { withinViewport } from './viewport-controls';
import {
  acceptanceCommand,
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';
import {
  beginNewRecordTransaction,
  expectStableReceiptAction,
  expectRecordVersion,
  expectRecordStatus,
  openRecordTask,
} from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { expect, test, type Page, type Locator } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import { createClient } from '@supabase/supabase-js';

async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function choose(form: Locator, label: string, code: string) {
  await chooseLocation(form, label, code);
}
async function openForm(page: Page, name: string) {
  return openRecordTask(page, name);
}
async function openRecordHistory(
  page: Page,
  name: 'View all item history' | 'View all asset history',
) {
  const link = page.getByRole('link', { name, exact: true });
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  const target = new URL(href!, page.url()).href;
  await link.click();
  await expect(page).toHaveURL(target);
  // The outgoing detail timeline remains usable during same-binding admission.
  // Its event headings/disclosures also exist on the incoming history page.
  await expect(
    page.getByRole('heading', { name: 'Inventory history', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Filter history' }),
  ).toBeVisible();
}
async function confirm(form: Locator, name: string) {
  if (
    name === 'Add quantity item' ||
    name === 'Add individual asset' ||
    name === 'Edit quantity metadata' ||
    name === 'Edit asset metadata'
  ) {
    await metadataReviewButton(form).click();
    await expect(
      form.getByRole('region', { name: 'Metadata review' }),
    ).toBeVisible();
    await metadataSaveButton(form).click();
    return;
  }
  const action =
    name === 'Restore quantity definition' ? 'Restore quantity item' : name;
  await form
    .getByRole('button', {
      name: 'Review ' + action.toLowerCase(),
      exact: true,
    })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes' }),
  ).toBeVisible();
  await form
    .getByRole('button', {
      name: 'Confirm ' + action.toLowerCase(),
      exact: true,
    })
    .click();
}
async function version(page: Page, value: number) {
  await expectRecordVersion(page, value);
}
async function createQuantity(
  page: Page,
  name: string,
  count = 0,
  locationCode = 'ITC-S1A',
) {
  await page.goto('/inventory/quantity/new');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const form = page.getByRole('form', {
    name: 'Add quantity item',
    exact: true,
  });
  await form.getByLabel('Name', { exact: true }).fill(name);
  if (count) {
    await form.getByLabel('Initial quantity').fill(String(count));
    await choose(form, 'Initial location', locationCode);
  }
  await confirm(form, 'Add quantity item');
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await version(page, 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test('empty normalized edits leave history unchanged, Receive defaults once, and Move/Issue expose source availability', async ({
  page,
}) => {
  await login(page);
  await createQuantity(
    page,
    'Edit integrity browser ' + crypto.randomUUID(),
    8,
  );
  const detailUrl = page.url();
  const itemId = detailUrl.split('/').at(-1)!;
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['127.0.0.1', 'localhost']).toContain(api.hostname);
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    expect(
      (
        await client.auth.signInWithPassword({
          email: fixture.emails.staff,
          password: fixture.password,
        })
      ).error,
    ).toBeNull();
    const before = await client
      .from('quantity_items')
      .select('name,version,updated_at')
      .eq('id', itemId)
      .single();
    expect(before.error).toBeNull();
    const events = await client
      .from('quantity_events')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId);
    const edit = await openForm(page, 'Edit quantity metadata');
    await expect(edit.getByText('Nothing to save.')).toBeVisible();
    await edit
      .getByLabel('Name', { exact: true })
      .fill('  ' + before.data!.name + '  ');
    await expect(edit.getByText('Nothing to save.')).toBeVisible();
    await expect(
      edit.getByRole('button', { name: 'Confirm save' }),
    ).toHaveCount(0);
    await edit.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = await client
      .from('quantity_items')
      .select('name,version,updated_at')
      .eq('id', itemId)
      .single();
    expect(after.data).toEqual(before.data);
    expect(
      (
        await client
          .from('quantity_events')
          .select('id', { count: 'exact', head: true })
          .eq('item_id', itemId)
      ).count,
    ).toBe(events.count);
    const receive = await openForm(page, 'Receive stock');
    await expect(
      receive.getByRole('combobox', { name: 'Receive at', exact: true }),
    ).toContainText('1A');
    await choose(receive, 'Receive at', 'ITC-S1B');
    await receive.getByLabel('Quantity to receive').fill('13');
    await receive
      .getByLabel('Reason (required)')
      .fill('Second holding fixture');
    await confirm(receive, 'Receive stock');
    // Confirm clicks dispatch the action; wait for its committed result before
    // a new document reads the holdings used to choose the next Receive default.
    await expect(
      receive.getByRole('status').filter({ hasText: 'Saved successfully.' }),
    ).toBeVisible();
    await version(page, 2);
    await page.goto(detailUrl);
    const multiple = await openForm(page, 'Receive stock');
    await expect(
      multiple.getByRole('combobox', { name: 'Receive at', exact: true }),
    ).toContainText('Select a location');
    await page.goto(detailUrl);
    const move = await openForm(page, 'Move stock');
    await move
      .getByRole('combobox', { name: 'Source location', exact: true })
      .click();
    await move
      .getByRole('combobox', { name: 'Search locations' })
      .fill('ITC-S1');
    await expect(
      move.getByRole('option', { name: /1A.*8 units available/ }),
    ).toBeVisible();
    await expect(
      move.getByRole('option', { name: /1B.*13 units available/ }),
    ).toBeVisible();
    await page.goto(detailUrl);
    const issue = await openForm(page, 'Issue stock to a site');
    await issue
      .getByRole('combobox', { name: 'Storage source', exact: true })
      .click();
    await issue
      .getByRole('combobox', { name: 'Search locations' })
      .fill('ITC-S1');
    await expect(
      issue.getByRole('option', { name: /1A.*8 units available/ }),
    ).toBeVisible();
    await expect(
      issue.getByRole('option', { name: /1B.*13 units available/ }),
    ).toBeVisible();
  } finally {
    // This SDK client owns a separate session from the browser and parallel
    // fixtures sharing the staff account. End only its own fixture session.
    await client.auth.signOut({ scope: 'local' });
    await archiveFixture(page, detailUrl);
  }
});

async function archiveFixture(
  page: Page,
  detailUrl: string,
  finalVersion?: number,
) {
  await page.goto(detailUrl);
  const form = await openForm(
    page,
    'Archive quantity definition and clear stock',
  );
  await form
    .getByLabel('Reason (required)')
    .fill('Checkpoint fictional fixture cleanup');
  await form.getByRole('checkbox', { name: /I understand/ }).check();
  await form
    .getByRole('button', { name: 'Review archive and clear stock' })
    .click();
  await form
    .getByRole('button', { name: 'Confirm archive and clear stock' })
    .click();
  await expectRecordStatus(page, 'archived');
  if (finalVersion !== undefined) await version(page, finalVersion);
}

test('a saved event link survives more than one page of newer history and later insertions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  await createQuantity(page, 'Stable history link ' + crypto.randomUUID());
  const detailUrl = page.url();
  const itemId = detailUrl.split('/').at(-1)!;
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['127.0.0.1', 'localhost']).toContain(api.hostname);
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const signed = await client.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    expect(signed.error).toBeNull();
    const location = await client
      .from('inventory_locations')
      .select('id')
      .eq('code', 'ITC-S1A')
      .single();
    expect(location.error).toBeNull();
    let currentVersion = 1;
    async function receive(reason: string) {
      const result = await client.rpc('quantity_receive', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          item_id: itemId,
          expected_version: currentVersion,
          location_id: location.data!.id,
          quantity: 1,
          reason,
        },
      });
      expect(result.error).toBeNull();
      const committed = result.data as { version: number; event_id: string };
      expect(committed.event_id).toMatch(/^[0-9a-f-]{36}$/);
      currentVersion = committed.version;
      return committed.event_id;
    }
    const eventId = await receive('Original receipt for stable link');
    await page.reload();
    const original = page
      .getByRole('heading', { name: 'Stock received', exact: true })
      .locator('xpath=ancestor::li[1]');
    await original.getByText('View event details', { exact: true }).click();
    const href = await original
      .getByRole('link', { name: 'Open recorded event' })
      .getAttribute('href');
    expect(href).toBe('/history/events/quantity/' + eventId);
    for (let index = 0; index < 30; index++)
      await receive('Newer receipt ' + index);
    await page.goto('/history?type=quantity&entityId=' + itemId);
    await expect(
      page.locator('#history-event-quantity-' + eventId),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Next', exact: true }),
    ).toBeVisible();
    await page.goto(href!);
    await expect(
      page.getByRole('heading', { name: 'Inventory event', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('listitem')).toContainText(
      'Reason: Original receipt for stable link',
    );
    await expect(page.getByRole('listitem')).toContainText('0 → 1 unit (+1)');
    await receive('Insertion after event navigation');
    await page.reload();
    await expect(page.getByRole('listitem')).toContainText(
      'Reason: Original receipt for stable link',
    );
    await expect(page.getByRole('listitem')).toContainText('0 → 1 unit (+1)');
    await expect(
      page.getByRole('link', { name: 'View all record history' }),
    ).toHaveAttribute('href', '/history?type=quantity&entityId=' + itemId);
  } finally {
    await client.auth.signOut({ scope: 'local' });
    await archiveFixture(page, detailUrl);
  }
});

test('quantity move rejects an overdraw and retains committed receipt through data refresh and reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await createQuantity(
    page,
    'Checkpoint movement ' + crypto.randomUUID(),
    2,
    'ITC-RED',
  );
  const detailUrl = page.url();
  try {
    let form = await openForm(page, 'Move stock');
    const amount = form.getByLabel('Quantity to move');
    await expect(
      form.getByText('Recorded source availability: 2 units.'),
    ).toBeVisible();
    await amount.fill('3');
    await form.getByRole('button', { name: 'Review move stock' }).click();
    await expect(
      form.getByText(/This source has only 2 units available/),
    ).toBeVisible();
    await expect(
      form.getByRole('link', { name: 'Destination location', exact: true }),
    ).toBeVisible();
    await expect(
      form.getByRole('link', { name: 'Quantity to move', exact: true }),
    ).toBeVisible();
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(
      form.getByRole('button', { name: 'Confirm move stock' }),
    ).toHaveCount(0);
    await amount.fill('1');
    await expect(amount).toBeFocused();
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true');
    await expect(
      form.getByRole('link', { name: 'Quantity to move', exact: true }),
    ).toHaveCount(0);
    await expect(
      form.getByRole('link', { name: 'Destination location', exact: true }),
    ).toBeVisible();
    await choose(form, 'Destination location', 'ITC-BLACK');
    await expect(form.getByRole('alert')).toHaveCount(0);
    await confirm(form, 'Move stock');
    await version(page, 2);
    await expect(form.getByRole('status')).toContainText(
      'Moved 1 unit from Red Container to Black Container',
    );
    await expect(form.getByRole('status')).toContainText(
      'After this move: Red Container 1 unit; Black Container 1 unit',
    );
    await expect(form.getByRole('status')).toBeFocused();
    await form.getByRole('button', { name: 'Refresh balances' }).click();
    await expect(form.getByRole('status')).toContainText('move completed');
    await expect(
      form.getByRole('button', { name: 'Review move stock' }),
    ).toHaveCount(0);
    await page.reload();
    form = await openForm(page, 'Move stock');
    await expect(
      form.getByText('Previous move receipt', { exact: true }),
    ).toBeVisible();
    await expect(form.locator('time')).toBeVisible();
    await expect(form.getByRole('status')).toContainText(
      'After this move: Red Container 1 unit; Black Container 1 unit',
    );
    await expectStableReceiptAction(page, 'Move more');
    await version(page, 2);
    await beginNewRecordTransaction(page, 'Move more');
    await expect(form.getByLabel('Quantity to move')).toHaveValue('');
    await choose(form, 'Source location', 'ITC-RED');
    await choose(form, 'Destination location', 'ITC-BLACK');
    await form.getByLabel('Quantity to move').fill('1');
    await confirm(form, 'Move stock');
    await version(page, 3);
    await expect(form.getByRole('status')).toContainText(
      'After this move: Red Container 0 units; Black Container 2 units',
    );
    await form.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(form).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith('it-inventory-move-completion:v1:'),
          ).length,
      ),
    ).toBe(0);
    // Done clears the committed transaction; a new form uses its normal quantity default.
    form = await openForm(page, 'Move stock');
    await expect(form.getByLabel('Quantity to move')).toHaveValue('1');
    await expect(
      form.getByText('Previous move receipt', { exact: true }),
    ).toHaveCount(0);
    await openRecordHistory(page, 'View all item history');
    await expect(
      page.getByRole('heading', { name: 'Physically moved', exact: true }),
    ).toHaveCount(2);
  } finally {
    await archiveFixture(page, detailUrl);
  }
});

test('a separate authenticated writer changes stock after move review and rejection keeps unsaved intent', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await createQuantity(
    page,
    'Checkpoint conflict ' + crypto.randomUUID(),
    2,
    'ITC-RED',
  );
  const detailUrl = page.url();
  const context = await browser.newContext();
  try {
    const form = await openForm(page, 'Move stock');
    await choose(form, 'Destination location', 'ITC-BLACK');
    await form.getByLabel('Quantity to move').fill('2');
    await form.getByRole('button', { name: 'Review move stock' }).click();
    const writer = await context.newPage();
    await login(writer);
    await writer.goto(detailUrl);
    const correction = await openForm(writer, 'Correct physical count');
    await choose(correction, 'Counted location', 'ITC-RED');
    await correction.getByLabel('Observed physical count').fill('1');
    await correction
      .getByLabel('Reason (required)')
      .fill('Independent checkpoint stock recount');
    await confirm(correction, 'Correct physical count');
    await version(writer, 2);
    await form.getByRole('button', { name: 'Confirm move stock' }).click();
    await expect(form.getByRole('alert')).toContainText('changed');
    await expect(form.getByLabel('Quantity to move')).toHaveValue('2');
    await expect(
      form.getByRole('button', { name: 'Confirm move stock' }),
    ).toHaveCount(0);
    await form.getByRole('button', { name: 'Refresh latest record' }).click();
    await expect(
      form.getByText('Recorded source availability: 1 unit.'),
    ).toBeVisible();
    await form.getByRole('button', { name: 'Review move stock' }).click();
    await expect(
      form
        .getByRole('alert')
        .getByRole('link', { name: 'Quantity to move', exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel('Quantity to move')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(
      form.getByLabel('Quantity to move'),
    ).toHaveAccessibleDescription(/only 1 unit/);
    await expect(form.getByLabel('Quantity to move')).toHaveValue('2');
    await expect(
      form.getByRole('button', { name: 'Confirm move stock' }),
    ).toHaveCount(0);
    await page.reload();
    await openRecordHistory(page, 'View all item history');
    await expect(
      page.getByRole('heading', { name: 'Physically moved', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        name: 'Physical count corrected',
        exact: true,
      }),
    ).toHaveCount(1);
  } finally {
    try {
      await context.close();
    } finally {
      await archiveFixture(page, detailUrl);
    }
  }
});

test('a real committed move with a lost response retries the original command once after rapid double confirmation', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await createQuantity(
    page,
    'Checkpoint lost move ' + crypto.randomUUID(),
    2,
    'ITC-RED',
  );
  const detailUrl = page.url();
  const itemId = detailUrl.split('/').at(-1)!;
  const actionUrl = '**/inventory/quantity/' + itemId;
  let release = () => {};
  try {
    const form = await openForm(page, 'Move stock');
    await choose(form, 'Destination location', 'ITC-BLACK');
    await form.getByLabel('Quantity to move').fill('1');
    await form.getByRole('button', { name: 'Review move stock' }).click();
    const commands: string[] = [];
    let acknowledge!: () => void;
    let rejectAcknowledgment!: (error: unknown) => void;
    const acknowledged = new Promise<void>((resolve, reject) => {
      acknowledge = resolve;
      rejectAcknowledgment = reject;
    });
    const responseBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(actionUrl, async (route) => {
      const request = route.request();
      const body = request.postData();
      if (request.method() !== 'POST' || !body?.includes('quantity_move')) {
        await route.continue();
        return;
      }
      commands.push(body);
      if (commands.length !== 1) {
        await route.continue();
        return;
      }
      try {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const committedResponse = await response.text();
        expect(committedResponse).toContain('"ok":true');
        expect(committedResponse).toContain('"eventId":');
        acknowledge();
        await responseBarrier;
        await route.abort('failed');
      } catch (error) {
        rejectAcknowledgment(error);
        throw error;
      }
    });
    await form.getByRole('button', { name: 'Confirm move stock' }).dblclick();
    await acknowledged;
    expect(commands).toHaveLength(1);
    const tasks = page.getByRole('region', { name: 'Record tasks' });
    await expect(
      tasks.getByRole('button', { name: 'Receive stock', exact: true }),
    ).toBeDisabled();
    await expect(
      tasks.getByRole('button', { name: 'Close task', exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      form.getByRole('button', { name: 'Retry this move safely' }),
    ).toBeEnabled();
    await expect(form.getByLabel('Quantity to move')).toBeDisabled();
    await expect(
      tasks.getByRole('button', { name: 'Receive stock', exact: true }),
    ).toBeDisabled();
    await expect(
      tasks.getByRole('button', { name: 'Close task', exact: true }),
    ).toBeDisabled();
    await form.getByRole('button', { name: 'Retry this move safely' }).click();
    await expect(form.getByRole('status')).toContainText(
      'After this move: Red Container 1 unit; Black Container 1 unit',
    );
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBe(commands[0]);
    await version(page, 2);
    await openRecordHistory(page, 'View all item history');
    await expect(
      page.getByRole('heading', { name: 'Physically moved', exact: true }),
    ).toHaveCount(1);
  } finally {
    release();
    try {
      await page.unroute(actionUrl);
    } finally {
      await archiveFixture(page, detailUrl);
    }
  }
});
test('archiving stocked quantity clears every location in one reviewed operation', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const name = 'Archive browser stock ' + crypto.randomUUID();
  await createQuantity(page, name, 8);
  const detailUrl = page.url();
  const receive = await openForm(page, 'Receive stock');
  await choose(receive, 'Receive at', 'ITC-S1B');
  await receive.getByLabel('Quantity to receive').fill('4');
  await receive.getByLabel('Reason (required)').fill('Second shelf delivery');
  await confirm(receive, 'Receive stock');
  await version(page, 2);
  await page.reload();
  const archive = await openForm(
    page,
    'Archive quantity definition and clear stock',
  );
  await expect(
    archive.getByRole('heading', { name: '12 units to remove' }),
  ).toBeVisible();
  await expect(archive.getByText(/1A.*8 → 0 units/)).toBeVisible();
  await expect(archive.getByText(/1B.*4 → 0 units/)).toBeVisible();
  await archive.getByLabel('Reason (required)').fill('Obsolete item removed');
  await archive.getByRole('checkbox', { name: /I understand/ }).check();
  await archive
    .getByRole('button', { name: 'Review archive and clear stock' })
    .click();
  await expect(
    archive.getByRole('region', { name: 'Review changes' }),
  ).toContainText('12 units from 2 locations');
  await archive
    .getByRole('button', { name: 'Confirm archive and clear stock' })
    .click();
  await version(page, 3);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 0 available in storage',
    }),
  ).toBeVisible();
  await expect(page.getByText(/Quantity item/).first()).toBeVisible();
  await expectRecordStatus(page, 'archived');
  await expectRecordVersion(page, 3);
  await openRecordHistory(page, 'View all item history');
  const event = page.locator('li').filter({
    has: page.getByRole('heading', { name: 'Quantity item archived' }),
  });
  await event.getByText('View event details', { exact: true }).click();
  await expect(
    event.getByText('Removed 12 units across 2 locations.'),
  ).toBeVisible();
  await expect(event.getByText(/8 → 0 units \(-8\)/)).toBeVisible();
  await expect(event.getByText(/4 → 0 units \(-4\)/)).toBeVisible();
  await page.goto(detailUrl);
  const restore = await openForm(page, 'Restore quantity definition');
  await restore.getByLabel('Reason (required)').fill('Definition needed again');
  await confirm(restore, 'Restore quantity definition');
  await version(page, 4);
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 0 available in storage',
    }),
  ).toBeVisible();
});

test('inventory destination tree navigates ancestors without accepting them as destinations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Add quantity item' });
  await form.getByLabel('Initial quantity').fill('1');
  const trigger = form.getByLabel('Initial location', { exact: true }).first();
  await trigger.click();
  const tree = form.getByRole('tree', { name: 'Initial location' });
  const root = tree.getByRole('treeitem', { name: /IT Closet.*group.*ITC$/ });
  const left = tree.getByRole('treeitem', {
    name: /Left Storage.*group.*ITC-L$/,
  });
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await expect(left).toHaveAttribute('aria-expanded', 'false');
  await left.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(left).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).not.toContainText('ITC-L');
  const shelf = tree.getByRole('treeitem', { name: /Shelf 1.*group.*ITC-S1$/ });
  await shelf.focus();
  await shelf.press('ArrowRight');
  await expect(
    tree.getByRole('treeitem', { name: /1A.*ITC-S1A$/ }),
  ).toBeVisible();
  await shelf.press('ArrowLeft');
  await expect(
    tree.getByRole('treeitem', { name: /1A.*ITC-S1A$/ }),
  ).toHaveCount(0);
  const search = form.getByRole('combobox', { name: 'Search locations' });
  await search.fill('ITC-S1A');
  const leaf = form.getByRole('option', { name: /1A.*ITC-S1A$/ });
  await expect(leaf).toContainText('IT Closet / Left Storage / Shelf 1 / 1A');
  await leaf.click();
  await expect(trigger).toContainText('ITC-S1A');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test('quantity core persists multi-location receives, partial and all transfers, counts, metadata and lifecycle', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const name = 'Browser cables ' + crypto.randomUUID();
  await createQuantity(page, name, 10);
  const url = page.url();
  let form = await openForm(page, 'Receive stock');
  await choose(form, 'Receive at', 'ITC-S1B');
  await form.getByLabel('Quantity to receive').fill('5');
  await form.getByLabel('Reason (required)').fill('New stock delivery');
  await confirm(form, 'Receive stock');
  await version(page, 2);
  const receivedHistory = page
    .getByRole('heading', { name: 'Stock received', exact: true })
    .locator('xpath=ancestor::li[1]');
  await expect(receivedHistory).toContainText(
    /5 units received · IT Closet.*1B/,
  );
  await expect(receivedHistory.locator('time')).toHaveText('Just now');
  await receivedHistory
    .getByText('View event details', { exact: true })
    .click();
  await expect(receivedHistory).toContainText('0 → 5 units (+5)');
  await expect(receivedHistory).not.toContainText('Amount not recorded');
  await expect(receivedHistory).not.toContainText('No recorded destination');
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 15 available in storage',
    }),
  ).toBeVisible();
  form = await openForm(page, 'Move stock');
  await choose(form, 'Source location', 'ITC-S1A');
  await choose(form, 'Destination location', 'ITC-S1B');
  await form.getByLabel('Quantity to move').fill('3');
  await confirm(form, 'Move stock');
  await version(page, 3);
  const movedHistory = page
    .getByRole('heading', { name: 'Physically moved', exact: true })
    .locator('xpath=ancestor::li[1]');
  await expect(movedHistory).toContainText(
    /3 units · IT Closet.*1A → IT Closet.*1B/,
  );
  await expect(movedHistory.locator('time')).toHaveText('Just now');
  await movedHistory.getByText('View event details', { exact: true }).click();
  await expect(movedHistory).toContainText('10 → 7 units (-3)');
  await expect(movedHistory).toContainText('5 → 8 units (+3)');
  await expect(movedHistory).not.toContainText('Amount not recorded');
  await expect(movedHistory).not.toContainText('No recorded source');
  await page.reload();
  form = await openForm(page, 'Move stock');
  await form.getByRole('button', { name: 'Move more' }).click();
  await choose(form, 'Source location', 'ITC-S1A');
  await choose(form, 'Destination location', 'ITC-S1C');
  await form.getByLabel('Move All from this source location').check();
  await confirm(form, 'Move stock');
  await version(page, 4);
  await page.reload();
  const stock = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Current stock — 15 available in storage',
    }),
  });
  await expect(stock.getByText('8 units', { exact: true })).toBeVisible();
  await expect(stock.getByText('7 units', { exact: true })).toBeVisible();
  await expect(stock.getByRole('link', { name: /ITC-S1A/ })).toHaveCount(0);
  form = await openForm(page, 'Correct physical count');
  await choose(form, 'Counted location', 'ITC-S1B');
  await form.getByLabel('Observed physical count').fill('6');
  await form.getByLabel('Reason (required)').fill('Verified physical count');
  await confirm(form, 'Correct physical count');
  await version(page, 5);
  await beginNewRecordTransaction(page, 'New transaction');
  form = await openForm(page, 'Edit quantity metadata');
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await form.getByLabel('Name', { exact: true }).fill(name + ' updated');
  await confirm(form, 'Edit quantity metadata');
  await version(page, 6);
  await expect(page.getByText('Changed: Name', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Record details updated', { exact: true }),
  ).toHaveCount(0);
  await page.goto('/inventory?q=' + encodeURIComponent(name));
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toHaveCount(2);
  const filter = page.getByRole('form', { name: 'Search inventory' });
  const unfilteredUrl = page.url();
  await filter.getByRole('button', { name: 'More filters' }).click();
  await expect(
    filter.getByRole('button', { name: 'Fewer filters' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await chooseLocation(filter, 'Location', 'ITC-L');
  expect(page.url()).toBe(unfilteredUrl);
  await filter.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/location=ITC-L/);
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toHaveCount(2);
  await chooseLocation(filter, 'Location', 'ITC-S1C');
  await filter.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/location=ITC-S1C/);
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole('link', { name: /IT Closet.*ITC-S1C/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: '1C', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toBeVisible();
  await page.goto(url);
  for (const [index, code] of ['ITC-S1B', 'ITC-S1C'].entries()) {
    form = await openForm(page, 'Correct physical count');
    await choose(form, 'Counted location', code);
    await form.getByLabel('Observed physical count').fill('0');
    await form
      .getByLabel('Reason (required)')
      .fill('Stock consumed and counted');
    await confirm(form, 'Correct physical count');
    await version(page, 7 + index);
    await page.reload();
  }
  form = await openForm(page, 'Archive quantity definition and clear stock');
  await form
    .getByLabel('Reason (required)')
    .fill('Definition no longer needed');
  await form.getByRole('checkbox', { name: /I understand/ }).check();
  await form
    .getByRole('button', { name: 'Review archive and clear stock' })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes' }),
  ).toBeVisible();
  await form
    .getByRole('button', { name: 'Confirm archive and clear stock' })
    .click();
  await version(page, 9);
  await expect(page.getByText(/Quantity item/).first()).toBeVisible();
  await expectRecordStatus(page, 'archived');
  await beginNewRecordTransaction(page, 'New transaction');
  form = await openForm(page, 'Restore quantity definition');
  await form.getByLabel('Reason (required)').fill('Needed again');
  await confirm(form, 'Restore quantity definition');
  await version(page, 10);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 0 available in storage',
    }),
  ).toBeVisible();
  await openRecordHistory(page, 'View all item history');
  await expect(
    page.getByRole('heading', { name: 'Stock received', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(2);
  // Later corrections and consumption must not replace historical quantities with current balances.
  const originalMove = page
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { name: 'Physically moved', exact: true }),
    })
    .filter({ hasText: /3 units · IT Closet.*1A → IT Closet.*1B/ });
  await expect(originalMove).toHaveCount(1);
  await originalMove.getByText('View event details', { exact: true }).click();
  await expect(originalMove).toContainText('10 → 7 units (-3)');
  await expect(originalMove).toContainText('5 → 8 units (+3)');
  await expect(
    page.getByRole('heading', {
      name: 'Physical count corrected',
      exact: true,
    }),
  ).toHaveCount(3);
  await expect(
    page.getByRole('heading', { name: 'Quantity item archived', exact: true }),
  ).toBeVisible();
  const historyFilter = page.getByRole('form', { name: 'Filter history' });
  await chooseLocation(historyFilter, 'Location', 'ITC-L');
  await historyFilter
    .getByRole('button', { name: 'Filter history', exact: true })
    .click();
  await expect(page).toHaveURL(/location=ITC-L/);
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(2);
  await chooseLocation(historyFilter, 'Location', 'ITC-S1C');
  await historyFilter
    .getByRole('button', { name: 'Filter history', exact: true })
    .click();
  await expect(page).toHaveURL(/location=ITC-S1C/);
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(1);
});
test('serialized core allows duplicate serials and persists distinct moves, corrections and retirement', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const suffix = crypto.randomUUID(),
    name = 'Browser switch ' + suffix,
    serial = '001-' + suffix;
  async function create(name: string, tag: string) {
    await page.goto('/inventory/assets/new');
    const form = page.getByRole('form', {
      name: 'Add individual asset',
      exact: true,
    });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Asset tag').fill(tag);
    await form.getByLabel('Serial number').fill(serial);
    await choose(form, 'Current location', 'ITC-RACK');
    return form;
  }
  let form = await create(name, 'A-' + suffix);
  await confirm(form, 'Add individual asset');
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const first = page.url();
  form = await create(name + ' duplicate', 'B-' + suffix);
  await metadataReviewButton(form).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toContainText(name);
  await expect(form.getByText(/Serial also recorded on/)).toContainText(name);
  await metadataSaveButton(form).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: 'Duplicate serial warning' }),
  ).toBeVisible();
  await page.goto(first);
  form = await openForm(page, 'Move asset');
  await choose(form, 'Destination location', 'ITC-D01');
  await confirm(form, 'Move asset');
  await version(page, 2);
  await beginNewRecordTransaction(page, 'New transaction');
  form = await openForm(page, 'Correct recorded location');
  await choose(form, 'Destination location', 'ITC-D02');
  await form.getByLabel('Reason (required)').fill('Found in adjacent drawer');
  await confirm(form, 'Correct recorded location');
  await version(page, 3);
  await beginNewRecordTransaction(page, 'New transaction');
  form = await openForm(page, 'Edit asset metadata');
  await expect(form.getByLabel('Model')).toBeEnabled();
  await form.getByLabel('Model').fill('Managed switch');
  await confirm(form, 'Edit asset metadata');
  await version(page, 4);
  await expect(form.getByRole('status')).toHaveText('Details saved.');
  await form.getByRole('button', { name: 'Done', exact: true }).click();
  form = await openForm(page, 'Retire asset');
  await form.getByLabel('Reason (required)').fill('Removed from service');
  await confirm(form, 'Retire asset');
  await version(page, 5);
  await page.reload();
  await expect(
    page.locator('dt').filter({ hasText: /^Last recorded custody$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Move asset', exact: true }),
  ).toHaveCount(0);
  form = await openForm(page, 'Restore asset');
  await choose(form, 'Confirmed current location', 'ITC-RACK');
  await form
    .getByLabel('Reason (required)')
    .fill('Tested and returned to service');
  await confirm(form, 'Restore asset');
  await version(page, 6);
  await page.reload();
  const currentCustody = page.locator('section').filter({
    has: page.locator('dt').filter({ hasText: /^Current custody$/ }),
  });
  await expect(currentCustody).toBeVisible();
  await expect(
    currentCustody.locator('a[href="/locations/ITC-RACK"]'),
  ).toBeVisible();
  await expect(
    page
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'Asset details', exact: true }),
      })
      .getByText(/Managed switch/),
  ).toBeVisible();
  await openRecordHistory(page, 'View all asset history');
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('heading', {
      name: 'Recorded location corrected',
      exact: true,
    }),
  ).toHaveCount(1);
  const corrected = page.locator('li').filter({
    has: page.getByRole('heading', {
      name: 'Recorded location corrected',
      exact: true,
    }),
  });
  await corrected.getByText('View event details', { exact: true }).click();
  await expect(
    corrected.getByText('Reason: Found in adjacent drawer'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Asset retired', exact: true }),
  ).toBeVisible();
});
test('overlapping two-page edits renew field choices after further races and viewers retain read-only access', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await login(page);
  const name = 'Browser concurrency ' + crypto.randomUUID();
  await createQuantity(page, name);
  const detailUrl = page.url();
  const firstForm = await openForm(page, 'Edit quantity metadata');
  await firstForm.getByLabel('Name', { exact: true }).fill(name + ' my edit');
  const other = await context.newPage();
  await other.goto(detailUrl);
  const otherForm = await openForm(other, 'Edit quantity metadata');
  await otherForm
    .getByLabel('Name', { exact: true })
    .fill(name + ' concurrent');
  await confirm(otherForm, 'Edit quantity metadata');
  await version(other, 2);
  await confirm(firstForm, 'Edit quantity metadata');
  await expect(
    firstForm
      .getByRole('alert')
      .filter({ hasText: 'Name was changed elsewhere' }),
  ).toContainText(name + ' concurrent');
  await expect(firstForm.getByLabel('Name', { exact: true })).toHaveValue(
    name + ' my edit',
  );
  await firstForm.getByRole('button', { name: 'Use my Name edit' }).click();
  await expect(metadataReviewButton(firstForm)).toBeEnabled();
  // Each new overlapping commit invalidates the previous choice. A stale "mine"
  // decision must never silently overwrite a subsequently observed value.
  for (const nextVersion of [3, 4]) {
    await expect(otherForm.getByRole('status')).toHaveText('Details saved.');
    await otherForm.getByRole('button', { name: 'Done', exact: true }).click();
    await openForm(other, 'Edit quantity metadata');
    await otherForm
      .getByLabel('Name', { exact: true })
      .fill(name + ' concurrent ' + nextVersion);
    await confirm(otherForm, 'Edit quantity metadata');
    await version(other, nextVersion);
    await confirm(firstForm, 'Edit quantity metadata');
    const conflict = firstForm
      .getByRole('alert')
      .filter({ hasText: 'Name was changed elsewhere' });
    await expect(conflict).toContainText(name + ' concurrent ' + nextVersion);
    await expect(metadataReviewButton(firstForm)).toBeDisabled();
    await expect(firstForm.getByLabel('Name', { exact: true })).toHaveValue(
      name + ' my edit',
    );
    await firstForm.getByRole('button', { name: 'Use my Name edit' }).click();
    await expect(metadataReviewButton(firstForm)).toBeEnabled();
  }
  await other.close();
  await metadataReviewButton(firstForm).click();
  await expect(
    firstForm.getByRole('region', { name: 'Metadata review' }),
  ).toContainText(name + ' my edit');
  await metadataSaveButton(firstForm).click();
  await version(page, 5);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await login(page, 'viewer');
  await page.goto(detailUrl);
  await expect(
    page.getByRole('heading', { name: name + ' my edit', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Record tasks' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', {
      name: /^(Receive stock|Move stock|Edit details)$/,
    }),
  ).toHaveCount(0);
  await openRecordHistory(page, 'View all item history');
  await expect(
    page.getByRole('heading', { name: 'Details updated', exact: true }),
  ).toHaveCount(4);
  await page.goto('/inventory/quantity/new');
  await expect(page.getByText(/Read-only access/)).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Add quantity item' }),
  ).toHaveCount(0);
});

test('ambiguous Receive preserves an edited destination after real stale refresh', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  try {
    await acceptanceLogin(page);
    const red = await owned.location('ITC-RED'),
      black = await owned.location('ITC-BLACK');
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
    const form = await openRecordTask(page, 'Receive stock');
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

test('inventory search location picker exposes keyboard paths and stays framed on a narrow viewport', async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/inventory');
  const form = page.getByRole('form', {
    name: 'Search inventory',
    exact: true,
  });
  await form.getByRole('button', { name: 'More filters', exact: true }).click();
  const trigger = form.getByLabel('Location', { exact: true });
  await trigger.click();
  const search = form.getByRole('combobox', { name: 'Search locations' });
  await expect(search).toBeFocused();
  await withinViewport(search);
  const pickerTree = form.getByRole('tree', { name: 'Location', exact: true });
  await withinViewport(pickerTree);
  await search.press('Home');
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    (await pickerTree
      .getByRole('treeitem', { name: 'All locations, no location filter' })
      .getAttribute('id'))!,
  );
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    (await pickerTree.getByRole('treeitem').nth(1).getAttribute('id'))!,
  );
  const pickerRoot = pickerTree.getByRole('treeitem', { name: /, ITC$/ });
  await pickerRoot.press('ArrowRight');
  await expect(pickerRoot).toHaveAttribute('aria-expanded', 'true');
  await search.fill('ITC-D07');
  const option = form.getByRole('option', { name: /, ITC-D07$/ });
  await expect(option).toBeVisible();
  await withinViewport(option);
  await search.press('Enter');
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('ITC-D07');
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('location') === 'ITC-D07',
  );
  await trigger.click();
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(search).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

interfaceTest(
  'missing resources keep direct transport status and private-safe identity with client recovery',
  async ({ page }, info) => {
    await interfaceLogin(page);
    for (const [path, heading] of [
      ['/audit-three-missing-' + randomUUID(), 'Page not found'],
      ['/inventory/quantity/' + randomUUID(), 'Inventory record unavailable'],
      ['/inventory/assets/' + randomUUID(), 'Inventory record unavailable'],
    ]) {
      const response = await page.goto(path);
      expect(
        response!.status(),
        `Direct missing-resource status for ${path}`,
      ).toBe(404);
      await expect(
        page.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page).toHaveTitle(/IT Inventory/);
      await expectPrivateTitleExcluded(page, path.split('/').at(-1)!);
      await page.screenshot({
        path: info.outputPath(
          `missing-${path.includes('quantity') ? 'quantity' : path.includes('assets') ? 'asset' : 'route'}.png`,
        ),
        fullPage: true,
      });
      await page
        .getByRole('link', { name: 'Search inventory', exact: true })
        .click();
      await expect(page).toHaveURL(/\/inventory$/);
      await expect(page).toHaveTitle('Inventory · IT Inventory');
    }
    for (const [path, title] of [
      ['/scan', 'Scan'],
      ['/labels', 'Labels'],
      ['/history', 'History'],
    ]) {
      await page.goto(path);
      await expect(page).toHaveTitle(`${title} · IT Inventory`);
    }
    const icon = page.locator('link[rel="icon"]').first();
    const iconResponse = await page.request.get(
      (await icon.getAttribute('href'))!,
    );
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()['content-type']).toMatch(/image/);
  },
);

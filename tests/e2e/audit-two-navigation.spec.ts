import { expect, test, type Page } from '@playwright/test';
import {
  auditCategory,
  auditCreateRecord,
  auditLogin,
  auditReadback,
  seedAuditCalendarEvents,
} from './audit-two-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { auditOpenMetadataTask } from './audit-two-controls';

test.use({ timezoneId: 'America/Chicago' });

async function editEnvelope(page: Page, entity: string) {
  return page.evaluate((id) => {
    const entries = Object.keys(sessionStorage)
      .filter((key) => key.startsWith('inventory-metadata-edit-v1:'))
      .map((key) => JSON.parse(sessionStorage.getItem(key)!));
    const entry = entries.find((entry) => entry.scope.entity === id);
    if (!entry) throw new Error('Missing edit recovery for owned record');
    return entry;
  }, entity);
}

for (const kind of ['quantity', 'asset'] as const) {
  test(`${kind} saved-record edits retain filtered return, Back/Forward, reload and their original version`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    page.on('dialog', (dialog) => void dialog.accept());
    await auditLogin(page);
    const category = await auditCategory(page);
    const name = 'Audit two edit ' + crypto.randomUUID();
    const record = await auditCreateRecord(page, kind, category.name, name);
    const scope = `/inventory?${new URLSearchParams({ q: name, type: kind, category: category.id, page: '1' })}`;
    await page.goto(scope);
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === new URL(record.url).pathname &&
        url.searchParams.get('returnTo') === scope + '#inventory-row-1',
    );
    const scopedRecord = page.url();
    const formName = `Edit ${kind} metadata`;
    let form = await auditOpenMetadataTask(page, formName);
    await form
      .getByLabel('Manufacturer', { exact: true })
      .fill('Recovered maker');
    const original = await editEnvelope(page, record.id);
    expect(original.baseline.version).toBe(1);
    await page.getByRole('button', { name: 'Close task', exact: true }).click();
    await page
      .getByRole('button', { name: 'Stay with this task', exact: true })
      .click();
    await expect(form.getByLabel('Manufacturer', { exact: true })).toHaveValue(
      'Recovered maker',
    );
    await page.getByRole('link', { name: 'Back to results' }).click();
    await expect(page).toHaveURL(
      new URL(scope + '#inventory-row-1', page.url()).href,
    );
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(
      Object.fromEntries(new URL(scope, page.url()).searchParams),
    );
    await page.goBack();
    await expect(page).toHaveURL(scopedRecord);
    form = await auditOpenMetadataTask(page, formName);
    await expect(form.getByLabel('Manufacturer', { exact: true })).toHaveValue(
      'Recovered maker',
    );
    await page.goForward();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await page.goBack();
    await page.reload();
    form = await auditOpenMetadataTask(page, formName);
    await expect(form.getByLabel('Manufacturer', { exact: true })).toHaveValue(
      'Recovered maker',
    );
    expect((await editEnvelope(page, record.id)).baseline).toEqual(
      original.baseline,
    );

    // A second real editor commits independently while the original tab is away.
    const other = await context.newPage();
    await other.goto(record.url);
    const competing = await auditOpenMetadataTask(other, formName);
    await competing
      .getByLabel('Model', { exact: true })
      .fill('Independent model');
    await metadataReviewButton(competing).click();
    await metadataSaveButton(competing).click();
    await expect(
      competing.getByRole('status').filter({ hasText: /^Details saved\.$/ }),
    ).toBeVisible();
    await other.close();
    await page.reload();
    form = await auditOpenMetadataTask(page, formName);
    await expect(
      form
        .getByRole('alert')
        .filter({ hasText: 'record changed since this draft began' }),
    ).toBeVisible();
    expect((await editEnvelope(page, record.id)).baseline.version).toBe(1);
    await expect(form.getByLabel('Manufacturer', { exact: true })).toHaveValue(
      'Recovered maker',
    );
    await form.getByRole('button', { name: 'Review current details' }).click();
    await expect(form.getByLabel('Model', { exact: true })).toHaveValue(
      'Independent model',
    );
    await metadataReviewButton(form).click();
    const summary = form.getByRole('region', { name: 'Changed details' });
    await expect(summary).toContainText('Original maker');
    await expect(summary).toContainText('Recovered maker');
    await expect(summary).not.toContainText('Independent model');
    await metadataSaveButton(form).click();
    await expect(
      form.getByRole('status').filter({ hasText: /^Details saved\.$/ }),
    ).toBeVisible();
    await form.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    form = await auditOpenMetadataTask(page, formName);
    await expect(form.getByLabel('Manufacturer', { exact: true })).toHaveValue(
      'Recovered maker',
    );
    await expect(form.getByLabel('Model', { exact: true })).toHaveValue(
      'Independent model',
    );
    await form
      .getByLabel('Manufacturer', { exact: true })
      .fill('Explicitly discarded maker');
    await page.getByRole('button', { name: 'Close task', exact: true }).click();
    await page
      .getByRole('button', { name: 'Discard and close', exact: true })
      .click();
    await page.reload();
    form = await auditOpenMetadataTask(page, formName);
    await expect(form.getByLabel('Manufacturer', { exact: true })).toHaveValue(
      'Recovered maker',
    );
  });

  test(`${kind} metadata response loss reloads and retries the exact committed command once`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    page.on('dialog', (dialog) => void dialog.accept());
    await auditLogin(page);
    const category = await auditCategory(page);
    const record = await auditCreateRecord(
      page,
      kind,
      category.name,
      'Audit two uncertain ' + crypto.randomUUID(),
    );
    const client = await auditReadback();
    const table = kind === 'quantity' ? 'quantity_items' : 'serialized_assets';
    const eventsTable =
      kind === 'quantity' ? 'quantity_events' : 'asset_events';
    const entityColumn = kind === 'quantity' ? 'item_id' : 'asset_id';
    const read = async () => {
      const current = await client
        .from(table)
        .select('version,manufacturer')
        .eq('id', record.id)
        .single();
      const events = await client
        .from(eventsTable)
        .select('id,kind')
        .eq(entityColumn, record.id);
      expect(current.error).toBeNull();
      expect(events.error).toBeNull();
      return { record: current.data!, events: events.data! };
    };
    const before = await read();
    let form = await auditOpenMetadataTask(page, `Edit ${kind} metadata`);
    await form
      .getByLabel('Manufacturer', { exact: true })
      .fill('Committed despite lost response');
    await metadataReviewButton(form).click();
    const commands: string[] = [];
    const expectedOperation =
      kind === 'asset' ? 'asset_update_v3' : 'quantity_update_v2';
    const routePattern =
      '**/inventory/' +
      (kind === 'asset' ? 'assets' : 'quantity') +
      '/' +
      record.id +
      '**';
    await page.route(routePattern, async (route) => {
      const request = route.request();
      const body = request.postData();
      if (request.method() !== 'POST' || !body?.includes(expectedOperation))
        return route.continue();
      commands.push(body);
      if (commands.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const committed = await read();
      expect(committed.record.version).toBe(before.record.version + 1);
      expect(committed.events).toHaveLength(before.events.length + 1);
      await route.abort('failed');
    });
    await metadataSaveButton(form).click();
    await expect(
      form.getByRole('button', { name: 'Retry same save' }),
    ).toBeVisible();
    const submitted = await editEnvelope(page, record.id);
    expect(submitted.status).toBe('submitted');
    expect(submitted.command.operation).toBe(expectedOperation);
    expect(submitted.command.payload.expected_version).toBe(1);
    await page.reload();
    form = await auditOpenMetadataTask(page, `Edit ${kind} metadata`);
    await expect(
      form.getByRole('button', { name: 'Retry same save' }),
    ).toBeVisible();
    expect((await editEnvelope(page, record.id)).command).toEqual(
      submitted.command,
    );
    await expect(
      form.getByLabel('Manufacturer', { exact: true }),
    ).toBeDisabled();
    await form.getByRole('button', { name: 'Retry same save' }).click();
    await expect(
      form.getByRole('status').filter({ hasText: /^Details saved\.$/ }),
    ).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBe(commands[0]);
    const resolved = await read();
    expect(resolved.record.version).toBe(2);
    expect(resolved.record.manufacturer).toBe(
      'Committed despite lost response',
    );
    expect(resolved.events).toHaveLength(before.events.length + 1);
    await info.attach(`${kind}-exact-retry.json`, {
      body: JSON.stringify({
        requestId: submitted.command.requestId,
        ...resolved,
      }),
      contentType: 'application/json',
    });
    await page.unroute(routePattern);
    await client.auth.signOut({ scope: 'local' });
  });
}

test('activity presets resolve local calendar boundaries across both DST transitions and year rollover without drifting on reload', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await auditLogin(page);
  const category = await auditCategory(page);
  const code = 'A2-DATE-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  await page.goto('/settings/sites');
  const siteForm = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'Add property/site',
      exact: true,
    }),
  });
  await siteForm
    .getByLabel('Name', { exact: true })
    .fill('Audit two calendar ' + code);
  await siteForm.getByLabel('Permanent code', { exact: true }).fill(code);
  await siteForm
    .getByRole('button', { name: 'Save site', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toBeVisible();
  const base = '/sites/' + code;
  const cases = [
    [
      '2026-03-08T18:00:00Z',
      'today',
      '2026-03-08T06:00:00.000Z',
      '2026-03-09T05:00:00.000Z',
    ],
    [
      '2026-03-09T05:01:00Z',
      'yesterday',
      '2026-03-08T06:00:00.000Z',
      '2026-03-09T05:00:00.000Z',
    ],
    [
      '2026-03-09T17:00:00Z',
      'last7',
      '2026-03-03T06:00:00.000Z',
      '2026-03-10T05:00:00.000Z',
    ],
    [
      '2026-11-01T18:00:00Z',
      'today',
      '2026-11-01T05:00:00.000Z',
      '2026-11-02T06:00:00.000Z',
    ],
    [
      '2026-11-02T06:01:00Z',
      'yesterday',
      '2026-11-01T05:00:00.000Z',
      '2026-11-02T06:00:00.000Z',
    ],
    [
      '2026-11-02T18:00:00Z',
      'last7',
      '2026-10-27T05:00:00.000Z',
      '2026-11-03T06:00:00.000Z',
    ],
    [
      '2027-01-01T05:59:00Z',
      'last7',
      '2026-12-25T06:00:00.000Z',
      '2027-01-01T06:00:00.000Z',
    ],
    [
      '2027-01-01T06:01:00Z',
      'today',
      '2027-01-01T06:00:00.000Z',
      '2027-01-02T06:00:00.000Z',
    ],
  ];
  const utcRange = {
    from: '2027-01-03T00:00:00.000Z',
    until: '2027-01-04T00:00:00.000Z',
  };
  const boundaries = (from: string, until: string) => [
    new Date(Date.parse(from) - 1).toISOString(),
    from,
    new Date(Date.parse(until) - 1).toISOString(),
    until,
  ];
  const fixture = await seedAuditCalendarEvents(category.id, code, [
    ...cases.flatMap(([, , from, until]) => boundaries(from, until)),
    ...boundaries(utcRange.from, utcRange.until),
    // Actual instants on either side of the spring gap and both occurrences
    // of the repeated fall hour must remain distinct without changing dates.
    '2026-03-08T07:59:59.999Z',
    '2026-03-08T08:00:00.000Z',
    '2026-11-01T06:30:00.000Z',
    '2026-11-01T07:30:00.000Z',
  ]);
  const client = await auditReadback();
  const timestamps = async () => {
    const assignments = await client
      .from('assignment_events')
      .select('id,item_id,quantity,created_at,reference')
      .in(
        'id',
        fixture.events.map((event) => event.assignmentId),
      )
      .order('id');
    const events = await client
      .from('quantity_events')
      .select('id,item_id,version,created_at')
      .in(
        'id',
        fixture.events.map((event) => event.eventId),
      )
      .order('id');
    expect(assignments.error).toBeNull();
    expect(events.error).toBeNull();
    expect(assignments.data).toHaveLength(fixture.events.length);
    expect(events.data).toHaveLength(fixture.events.length);
    for (const event of fixture.events) {
      const assignment = assignments.data!.find(
        (entry) => entry.id === event.assignmentId,
      )!;
      const original = events.data!.find(
        (entry) => entry.id === event.eventId,
      )!;
      expect(new Date(assignment.created_at).toISOString()).toBe(event.at);
      expect(new Date(original.created_at).toISOString()).toBe(event.at);
      expect(assignment.item_id).toBe(event.itemId);
      expect(assignment.quantity).toBe(event.units);
      expect(original.version).toBe(1);
    }
    return { assignments: assignments.data, events: events.data };
  };
  const before = await timestamps();
  const totalUnits = fixture.events.reduce(
    (total, event) => total + event.units,
    0,
  );
  const activity = page.getByRole('region', {
    name: 'Assignment activity',
    exact: true,
  });
  const verifyActivity = async (from: string, until: string) => {
    const expected = fixture.events.filter(
      (event) =>
        Date.parse(event.at) >= Date.parse(from) &&
        Date.parse(event.at) < Date.parse(until),
    );
    expect(expected.length).toBeGreaterThan(0);
    const rows = activity.locator('ol > li');
    await expect(rows).toHaveCount(expected.length);
    for (const event of fixture.events) {
      const row = rows.filter({ hasText: event.reference });
      if (expected.includes(event)) {
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(
          event.units === 1 ? '1 unit' : `${event.units} units`,
        );
        expect(
          new Date(
            (await row.locator('time').getAttribute('datetime'))!,
          ).toISOString(),
        ).toBe(event.at);
      } else await expect(row).toHaveCount(0);
    }
    const breakdown = activity.locator('details').filter({
      has: page.locator('summary').filter({ hasText: /^Activity breakdown/ }),
    });
    await expect(breakdown.locator('summary')).toHaveText(
      `Activity breakdown · ${expected.length} ${expected.length === 1 ? 'event' : 'events'}`,
    );
    if ((await breakdown.getAttribute('open')) === null)
      await breakdown.locator('summary').click();
    await expect(
      breakdown
        .getByText('Opening quantity units', { exact: true })
        .locator('..')
        .locator('dd'),
    ).toHaveText(
      String(expected.reduce((total, event) => total + event.units, 0)),
    );
    await expect(
      breakdown
        .getByText('Storage-issued quantity units', { exact: true })
        .locator('..')
        .locator('dd'),
    ).toHaveText('0');
    await expect(
      breakdown
        .getByText('Returned quantity units', { exact: true })
        .locator('..')
        .locator('dd'),
    ).toHaveText('0');
    await expect(
      page
        .getByText('Current assigned quantity units', { exact: true })
        .locator('..')
        .locator('dd'),
    ).toHaveText(String(totalUnits));
    await expect(
      page.getByRole('region', { name: 'Current holdings', exact: true }),
    ).toBeVisible();
  };
  for (const [now, preset, from, until] of cases) {
    await page.clock.setFixedTime(new Date(now));
    await page.goto(base);
    // Browser-zone resolution also establishes hydration before a native
    // select event; selecting the server-rendered control can lose its change.
    await expect(page.getByLabel('Display / preset timezone')).toHaveValue(
      'America/Chicago',
    );
    await page
      .getByRole('combobox', { name: 'Activity range', exact: true })
      .selectOption(preset);
    await expect(
      page.getByRole('combobox', { name: 'Activity range', exact: true }),
    ).toHaveValue(preset);
    await page.getByRole('button', { name: 'Filter activity' }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('from') === from &&
        url.searchParams.get('until') === until,
    );
    await expect(
      page.getByText(/^Applied range \(America\/Chicago\):/),
    ).toContainText('inclusive');
    await verifyActivity(from, until);
    const applied = page.url();
    await page.clock.setFixedTime(new Date('2027-01-03T18:00:00Z'));
    await page.reload();
    await expect(page).toHaveURL(applied);
    await expect(
      page.getByRole('combobox', { name: 'Activity range', exact: true }),
    ).toHaveValue('custom');
    await verifyActivity(from, until);
  }
  await page.goto(base);
  await expect(page.getByLabel('Display / preset timezone')).toHaveValue(
    'America/Chicago',
  );
  await page
    .getByRole('combobox', { name: 'Activity range', exact: true })
    .selectOption('today');
  await page.getByLabel('Display / preset timezone').selectOption('UTC');
  await page.getByRole('button', { name: 'Filter activity' }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('from') === '2027-01-03T00:00:00.000Z' &&
      url.searchParams.get('until') === '2027-01-04T00:00:00.000Z' &&
      url.searchParams.get('zone') === 'UTC',
  );
  await verifyActivity(utcRange.from, utcRange.until);
  for (const [from, until] of [
    ['2026-10-08T00:00:00Z', '2026-10-07T00:00:00Z'],
    ['2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z'],
    ['2026-02-30T00:00:00Z', 'bad-date'],
  ]) {
    await page.goto(base + '?' + new URLSearchParams({ from, until }));
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Check the activity date filters' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Current holdings', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('From (UTC, inclusive)')).toHaveValue(from);
    await expect(page.getByLabel('Until (UTC, exclusive)')).toHaveValue(until);
    await expect(
      page.getByText('Service unavailable', { exact: true }),
    ).toHaveCount(0);
  }
  await page.getByLabel('From (UTC, inclusive)').fill('2026-10-07T00:00:00Z');
  await page.getByLabel('Until (UTC, exclusive)').fill('2026-10-08T00:00:00Z');
  await page.getByRole('button', { name: 'Filter activity' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Check the activity date filters' }),
  ).toHaveCount(0);
  // Read/filter navigation never changes the original event instants or versions.
  expect(await timestamps()).toEqual(before);
  await info.attach('calendar-boundary-read-filter-fixtures.json', {
    body: JSON.stringify({
      proof:
        'Local read/filter integration fixture; not mutation authorization proof',
      siteId: fixture.siteId,
      cases,
      utcRange,
      events: fixture.events,
    }),
    contentType: 'application/json',
  });
  await client.auth.signOut({ scope: 'local' });
});

import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { auditLogin, auditReadback } from './audit-two-controls';
import { chooseLocation } from './location-picker';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { openRecordTask } from './record-task-controls';

type StaffClient = Awaited<ReturnType<typeof auditReadback>>;
type OwnedSite = { code: string; name: string };
type OwnedItem = { id: string; name: string };

const ownedSite = (): OwnedSite => {
  const code = 'A2-REVIEW-' + randomUUID().toUpperCase();
  return { code, name: 'Fictional review site ' + code };
};
const addSiteForm = (page: Page) =>
  page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Add property/site', exact: true }),
  });

async function createSite(page: Page, site: OwnedSite) {
  await page.goto('/settings/sites');
  const form = addSiteForm(page);
  await form.getByLabel('Name', { exact: true }).fill(site.name);
  await form.getByLabel('Permanent code', { exact: true }).fill(site.code);
  await form.getByRole('button', { name: 'Save site', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toContainText(site.name);
}

async function readSite(client: StaffClient, site: OwnedSite) {
  const result = await client
    .from('sites')
    .select('id,code,name,notes,version,active')
    .eq('code', site.code)
    .maybeSingle();
  expect(result.error).toBeNull();
  if (result.data)
    expect(result.data).toMatchObject({ code: site.code, name: site.name });
  return result.data;
}

// Strict attempt-owned identities only. Cleanup uses ordinary audited mutations;
// no history rows are changed/deleted and no fixture credentials target hosted DBs.
async function cleanup(client: StaffClient, site: OwnedSite, item?: OwnedItem) {
  const currentSite = await readSite(client, site);
  const errors: unknown[] = [];
  try {
    if (item) {
      let current = await client
        .from('quantity_items')
        .select('id,name,version,archived')
        .eq('id', item.id)
        .single();
      expect(current.error).toBeNull();
      expect(current.data!.name).toBe(item.name);
      if (currentSite) {
        const holding = await client
          .from('site_quantity_holdings')
          .select('quantity')
          .eq('item_id', item.id)
          .eq('site_id', currentSite.id)
          .maybeSingle();
        expect(holding.error).toBeNull();
        if (holding.data && holding.data.quantity > 0) {
          const cleared = await client.rpc('quantity_site_change', {
            p_request_id: randomUUID(),
            p_payload: {
              action: 'correct',
              item_id: item.id,
              expected_version: String(current.data!.version),
              source_site_id: currentSite.id,
              observed_quantity: 0,
              reason: 'Completed disposable review regression fixture',
            },
          });
          expect(cleared.error).toBeNull();
          current = await client
            .from('quantity_items')
            .select('id,name,version,archived')
            .eq('id', item.id)
            .single();
          expect(current.error).toBeNull();
        }
      }
      if (!current.data!.archived) {
        const archived = await client.rpc('quantity_archive_and_clear', {
          p_request_id: randomUUID(),
          p_payload: {
            item_id: item.id,
            expected_version: String(current.data!.version),
            confirm_clear_stock: true,
            reason: 'Completed disposable review regression fixture',
          },
        });
        expect(archived.error).toBeNull();
      }
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    if (currentSite?.active) {
      const archived = await client.rpc('site_set_active', {
        p_request_id: randomUUID(),
        p_payload: {
          site_id: currentSite.id,
          expected_version: String(currentSite.version),
          active: false,
          reason: 'Completed disposable review regression fixture',
        },
      });
      expect(archived.error).toBeNull();
    }
  } catch (error) {
    errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(errors, 'Owned review fixture cleanup failed');
}

test('35 pristine site visits through Settings do not exhaust recovery before a dirty create and exact draft reload', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  });
  await auditLogin(page);
  const client = await auditReadback();
  const site = ownedSite();
  try {
    await page.goto('/settings');
    const drafts = new Set<string>();
    for (let visit = 0; visit < 35; visit++) {
      await page
        .getByRole('link', {
          name: 'Properties & sites Configure properties and site codes.',
          exact: true,
        })
        .click();
      const form = addSiteForm(page);
      await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
      await expect(page).toHaveURL((url) =>
        /^[0-9a-f-]{36}$/i.test(url.searchParams.get('siteDraft') ?? ''),
      );
      drafts.add(new URL(page.url()).searchParams.get('siteDraft')!);
      await expect(form.getByLabel('Name', { exact: true })).toHaveValue('');
      await expect(
        form.getByRole('textbox', { name: 'Notes', exact: true }),
      ).toHaveValue('');
      await expect(form.getByRole('alert')).toHaveCount(0);
      await page
        .locator('main')
        .getByRole('link', { name: 'Settings', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true }),
      ).toBeVisible();
    }
    expect(drafts.size).toBe(35);
    await page
      .getByRole('link', {
        name: 'Properties & sites Configure properties and site codes.',
        exact: true,
      })
      .click();
    const form = addSiteForm(page);
    await expect(page).toHaveURL((url) =>
      /^[0-9a-f-]{36}$/i.test(url.searchParams.get('siteDraft') ?? ''),
    );
    const originalDraft = page.url();
    const notes = 'Original dirty draft retained after pristine visits';
    await form.getByLabel('Name', { exact: true }).fill(site.name);
    await form.getByLabel('Permanent code', { exact: true }).fill(site.code);
    await form.getByRole('textbox', { name: 'Notes', exact: true }).fill(notes);
    await page.reload();
    await expect(page).toHaveURL(originalDraft);
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue(
      site.name,
    );
    await expect(
      form.getByLabel('Permanent code', { exact: true }),
    ).toHaveValue(site.code);
    await expect(
      form.getByRole('textbox', { name: 'Notes', exact: true }),
    ).toHaveValue(notes);
    await expect(form.getByRole('alert')).toHaveCount(0);
    expect(await readSite(client, site)).toBeNull();
    await form.getByRole('button', { name: 'Save site', exact: true }).click();
    const completion = page.getByRole('region', {
      name: 'Site creation complete',
    });
    await expect(completion).toContainText(site.name);
    const saved = await readSite(client, site);
    expect(saved).toMatchObject({ notes, active: true, version: 1 });
    await page.reload();
    await expect(page).toHaveURL(originalDraft);
    await expect(completion).toContainText(site.code);
    expect(await readSite(client, site)).toEqual(saved);
    await completion.screenshot({
      path: info.outputPath('recovered-site-creation-complete.png'),
    });
    await expect(
      page.getByRole('button', { name: 'Save site', exact: true }),
    ).toHaveCount(0);
  } finally {
    try {
      await cleanup(client, site);
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  }
});

function receiptCount(receipt: Locator, label: string) {
  return receipt
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::dd');
}

test('site count corrections show authoritative signed before and after counts, including zero and unchanged observed counts', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await auditLogin(page);
  const client = await auditReadback();
  const site = ownedSite();
  let item: OwnedItem | undefined;
  try {
    await createSite(page, site);
    const savedSite = (await readSite(client, site))!;
    const name = 'Fictional corrected cables ' + randomUUID();
    await page.goto('/inventory/quantity/new');
    const add = page.getByRole('form', {
      name: 'Add quantity item',
      exact: true,
    });
    await add.getByLabel('Name', { exact: true }).fill(name);
    await add.getByLabel('Initial quantity', { exact: true }).fill('10');
    await chooseLocation(add, 'Initial location', 'ITO-GENERAL');
    await metadataReviewButton(add).click();
    await metadataSaveButton(add).click();
    await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]{36}$/);
    item = { id: new URL(page.url()).pathname.split('/').at(-1)!, name };
    const detail = page.url();
    const issue = await openRecordTask(page, 'Issue stock to a site');
    await issue
      .getByLabel('Destination site', { exact: true })
      .selectOption(savedSite.id);
    await issue.getByLabel('Units', { exact: true }).fill('4');
    await issue
      .getByRole('button', {
        name: 'Review issue stock to a site',
        exact: true,
      })
      .click();
    await issue
      .getByRole('button', {
        name: 'Confirm issue stock to a site',
        exact: true,
      })
      .click();
    const completion = page.getByRole('region', {
      name: 'Custody completion',
      exact: true,
    });
    await expect(completion).toContainText('Custody saved');
    const issueReceipt = completion.getByRole('region', {
      name: 'Committed custody receipt',
    });
    await expect(issueReceipt).toContainText('4 units');
    await expect(issueReceipt).toContainText('→ ' + site.name);
    await page.reload();
    const readState = async () => {
      const [holding, stock, events, current] = await Promise.all([
        client
          .from('site_quantity_holdings')
          .select('quantity')
          .eq('item_id', item!.id)
          .eq('site_id', savedSite.id)
          .single(),
        client
          .from('stock_balances')
          .select('quantity')
          .eq('item_id', item!.id),
        client
          .from('assignment_events')
          .select(
            'quantity_event_id,kind,quantity,from_site_id,to_site_id,reference',
          )
          .eq('item_id', item!.id)
          .order('created_at'),
        client
          .from('quantity_items')
          .select('version')
          .eq('id', item!.id)
          .single(),
      ]);
      for (const result of [holding, stock, events, current])
        expect(result.error).toBeNull();
      return {
        assigned: holding.data!.quantity,
        storage: stock.data!.reduce((sum, row) => sum + row.quantity, 0),
        events: events.data!,
        version: current.data!.version,
      };
    };
    await expect(
      page.getByRole('heading', {
        name: 'Current stock — 6 available in storage',
        exact: true,
      }),
    ).toBeVisible();
    expect((await readState()).assigned).toBe(4);
    const correctionReferences: string[] = [];
    for (const [before, after] of [
      [4, 7],
      [7, 2],
      [2, 2],
      [2, 0],
    ]) {
      await page.goto(detail);
      const previous = await readState();
      const reason = `Fictional observed count ${before} to ${after}`;
      const reference = 'A2-CORRECT-' + randomUUID();
      const form = await openRecordTask(page, 'Correct recorded site holding');
      await form
        .getByLabel('Source site', { exact: true })
        .selectOption(savedSite.id);
      await form
        .getByLabel('Observed units at site', { exact: true })
        .fill(String(after));
      await form.getByLabel('Reason (required)', { exact: true }).fill(reason);
      await form
        .getByLabel('Ticket number reference (optional)', { exact: true })
        .fill(reference);
      await form
        .getByRole('button', {
          name: 'Review correct recorded site holding',
          exact: true,
        })
        .click();
      const review = form.getByRole('region', {
        name: 'Review changes',
        exact: true,
      });
      await expect(review).toBeVisible();
      await expect(review).toContainText(name);
      await expect(review).toContainText(reason);
      await expect(review).toContainText(reference);
      await form
        .getByRole('button', {
          name: 'Confirm correct recorded site holding',
          exact: true,
        })
        .click();
      await expect(completion).toContainText('Custody saved');
      await expect(completion).toContainText(
        'Count correction at ' + site.name,
      );
      await expect(completion).not.toContainText('→');
      await expect(completion).not.toContainText('No destination');
      const delta = after - before;
      const current = await readState();
      expect(current.assigned).toBe(after);
      expect(current.storage).toBe(6);
      if (delta === 0) {
        await expect(completion).toContainText('No balance change was needed.');
        await expect(
          completion.getByRole('region', { name: 'Committed custody receipt' }),
        ).toHaveCount(0);
        expect(current).toEqual(previous);
      } else {
        const receipt = completion.getByRole('region', {
          name: 'Committed custody receipt',
        });
        await expect(
          receiptCount(receipt, 'Count before correction'),
        ).toHaveText(`${before} units`);
        await expect(receiptCount(receipt, 'Signed adjustment')).toHaveText(
          `${delta > 0 ? '+' : ''}${delta} units`,
        );
        await expect(
          receiptCount(receipt, 'Observed count after correction'),
        ).toHaveText(`${after} units`);
        await expect(receipt).toContainText('Reason: ' + reason);
        expect(current.events).toHaveLength(previous.events.length + 1);
        const event = current.events.find(
          (row) => row.reference === reference,
        )!;
        expect(event).toMatchObject({
          kind: 'corrected',
          quantity: Math.abs(delta),
          from_site_id: savedSite.id,
          to_site_id: null,
        });
        const line = await client
          .from('site_quantity_event_lines')
          .select('before_quantity,delta,after_quantity')
          .eq('event_id', event.quantity_event_id!)
          .eq('site_id', savedSite.id)
          .single();
        expect(line.error).toBeNull();
        expect(line.data).toEqual({
          before_quantity: before,
          delta,
          after_quantity: after,
        });
        correctionReferences.push(reference);
      }
      await completion.screenshot({
        path: info.outputPath(
          `site-count-correction-${before}-to-${after}.png`,
        ),
      });
      await page.reload();
      await expect(
        page.getByRole('heading', {
          name: 'Current stock — 6 available in storage',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          `${after} assigned to sites · ${6 + after} total recorded across storage and sites. Inactive storage remains included in availability until moved.`,
          { exact: true },
        ),
      ).toBeVisible();
      expect(await readState()).toEqual(current);
      if (delta !== 0) {
        const summary = 'Count corrected at ' + site.name;
        const custodyRow = page
          .getByRole('region', { name: 'Custody history', exact: true })
          .locator('p')
          .filter({ hasText: 'Reason: ' + reason });
        await expect(custodyRow).toContainText(summary);
        await expect(custodyRow).not.toContainText('→');
        await expect(custodyRow).not.toContainText('No destination');
        const recentRow = page
          .getByRole('heading', { name: 'Site custody corrected', exact: true })
          .locator('xpath=ancestor::li[1]')
          .filter({ hasText: 'Reason: ' + reason });
        await expect(
          recentRow.getByText(summary, { exact: true }),
        ).toBeVisible();
        await recentRow
          .getByText('View event details', { exact: true })
          .click();
        await expect(
          recentRow.getByText('Custody: ' + summary, { exact: true }),
        ).toBeVisible();
        await expect(recentRow).not.toContainText('→');
        await expect(recentRow).not.toContainText('No recorded destination');
        await expect(recentRow).not.toContainText('Custody quantity:');
        await recentRow.screenshot({
          path: info.outputPath(`correction-history-${before}-to-${after}.png`),
        });
      }
    }
    await page.goto('/sites/' + site.code);
    const activity = page.getByRole('region', {
      name: 'Assignment activity',
      exact: true,
    });
    for (const reference of correctionReferences) {
      const row = activity.locator('ol > li').filter({ hasText: reference });
      await expect(
        row.getByText('Count corrected at ' + site.name, { exact: true }),
      ).toBeVisible();
      await expect(row).not.toContainText('→');
      await expect(row).not.toContainText('No destination');
    }
    await activity.screenshot({
      path: info.outputPath('site-correction-activity.png'),
    });
  } finally {
    try {
      await cleanup(client, site, item);
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  }
});

test('custom activity filters preserve microsecond boundaries through apply and reload without rounding query strings', async ({
  page,
}, info) => {
  await auditLogin(page);
  const client = await auditReadback();
  const site = ownedSite();
  try {
    await createSite(page, site);
    const from = '2026-10-07T12:34:56.123456Z';
    const until = '2026-10-07T12:34:56.123457Z';
    const base = '/sites/' + site.code;
    const params = new URLSearchParams({ from, until, zone: 'UTC' });
    await page.goto(base + '?' + params.toString());
    const fromInput = page.getByLabel('From (UTC, inclusive)', { exact: true });
    const untilInput = page.getByLabel('Until (UTC, exclusive)', {
      exact: true,
    });
    await expect(fromInput).toHaveValue(from);
    await expect(untilInput).toHaveValue(until);
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Filter activity', exact: true })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === base &&
        url.search === '?' + params.toString() &&
        url.hash === '#activity-heading',
    );
    const applied = page.url();
    await page.reload();
    await expect(page).toHaveURL(applied);
    await expect(fromInput).toHaveValue(from);
    await expect(untilInput).toHaveValue(until);
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByText('No activity in this date range.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Current holdings', exact: true }),
    ).toBeVisible();
    await fromInput.locator('xpath=ancestor::form').screenshot({
      path: info.outputPath('microsecond-activity-filter-reloaded.png'),
    });
    // This proves browser URL/input retention. The separate query-layer regression
    // proves PostgreSQL's inclusive/exclusive microsecond predicate semantics.
  } finally {
    try {
      await cleanup(client, site);
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  }
});

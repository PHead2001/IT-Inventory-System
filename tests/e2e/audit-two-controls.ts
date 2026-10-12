import { createClient } from '@supabase/supabase-js';
import { expect, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { openRecordTask } from './record-task-controls';

/** Use the canonical task helper's attachment/actionability contract on revisit. */
export async function auditOpenMetadataTask(page: Page, formName: string) {
  return openRecordTask(page, formName);
}

export async function auditLogin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

/** Readback uses the same staff boundary and refuses hosted fixture credentials. */
export async function auditReadback() {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const auth = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(auth.error).toBeNull();
  return client;
}

export async function auditCategory(page: Page) {
  const name = 'Audit two browser ' + crypto.randomUUID();
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();
  const added = `Category added: ${name}.`;
  await expect(page.getByRole('status').filter({ hasText: added })).toHaveText(
    added,
  );
  await page.goto('/settings/forms');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `${name} form`, exact: true }),
  ).toBeVisible();
  return {
    name,
    url: page.url(),
    id: new URL(page.url()).pathname.split('/').at(-1)!,
  };
}

export async function auditCreateRecord(
  page: Page,
  kind: 'quantity' | 'asset',
  category: string,
  name: string,
  identifier?: string,
) {
  await page.goto(`/inventory/${kind === 'asset' ? 'assets' : 'quantity'}/new`);
  const form = page.getByRole('form', {
    name: kind === 'asset' ? 'Add individual asset' : 'Add quantity item',
    exact: true,
  });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form
    .getByLabel('Category', { exact: true })
    .selectOption({ label: category });
  await form.getByLabel('Manufacturer', { exact: true }).fill('Original maker');
  if (identifier)
    await form
      .getByLabel(kind === 'asset' ? 'Asset tag' : 'Item code (SKU)', {
        exact: true,
      })
      .fill(identifier);
  if (kind === 'asset')
    await chooseLocation(form, 'Current location', 'ITC-RED');
  await metadataReviewButton(form).click();
  await metadataSaveButton(form).click();
  await expect(page).toHaveURL(/\/inventory\/(quantity|assets)\/[0-9a-f-]+$/);
  return {
    url: page.url(),
    id: new URL(page.url()).pathname.split('/').at(-1)!,
  };
}

export async function auditSaveDesigner(designer: Locator) {
  await designer
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: /Saved active form revision|Review the effect/ }),
  ).toBeVisible();
  const impact = designer.getByRole('region', { name: 'Form save impact' });
  if (await impact.isVisible())
    await impact
      .getByRole('button', { name: 'Confirm and save changes' })
      .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toBeVisible();
}

export type AuditCalendarEvent = {
  itemId: string;
  eventId: string;
  assignmentId: string;
  at: string;
  units: number;
  reference: string;
};

/**
 * Local read/filter fixture, not custody mutation or authorization proof.
 * New fictional opening snapshots are inserted coherently at their original
 * timestamps. No existing history is rewritten and no trigger is disabled.
 * The canonical disposable DB reset removes these append-only fixtures.
 */
export async function seedAuditCalendarEvents(
  categoryId: string,
  siteCode: string,
  instants: string[],
) {
  const target = new URL(process.env.LOCAL_DB_URL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
  expect(target.port).toBe('54322');
  expect(target.pathname).toBe('/postgres');
  expect(categoryId).toMatch(/^[0-9a-f-]{36}$/);
  expect(siteCode).toMatch(/^A2-DATE-[A-F0-9]{8}$/);
  const events: AuditCalendarEvent[] = [...new Set(instants)]
    .sort()
    .map((at, index) => ({
      itemId: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
      assignmentId: crypto.randomUUID(),
      at: new Date(at).toISOString(),
      units: index + 1,
      reference: `${siteCode}-EVENT-${String(index + 1).padStart(2, '0')}`,
    }));
  expect(events.length).toBeGreaterThan(0);
  expect(events.length).toBeLessThanOrEqual(50);
  const db = new Client({
    connectionString: target.href,
    application_name: 'audit-two-calendar-read-fixture',
  });
  await db.connect();
  try {
    await db.query('begin');
    const guards = await db.query<{ tgname: string; tgenabled: string }>(
      `select tgname,tgenabled from pg_trigger
       where tgrelid in ('public.quantity_events'::regclass,
         'public.assignment_events'::regclass,'public.site_quantity_event_lines'::regclass)
       and tgname in ('quantity_events_append_only','quantity_site_link_required',
         'assignment_events_append_only','assignment_link','site_quantity_event_lines_append_only')`,
    );
    expect(guards.rows).toHaveLength(5);
    expect(guards.rows.every((guard) => guard.tgenabled === 'O')).toBe(true);
    const actor = await db.query<{ user_id: string; display_name: string }>(
      `select m.user_id,m.display_name from public.app_members m
       join auth.users u on u.id=m.user_id
       where u.email=$1 and m.active and m.role='staff'`,
      [fixture.emails.staff],
    );
    expect(actor.rows).toHaveLength(1);
    const category = await db.query<{
      name: string;
      published_form_revision_id: string;
    }>(
      `select name,published_form_revision_id from public.categories
       where id=$1 and name like 'Audit two browser %' and active
         and removed_at is null`,
      [categoryId],
    );
    expect(category.rows).toHaveLength(1);
    const site = await db.query<{ id: string; name: string }>(
      `select id,name from public.sites
       where code=$1 and name=$2 and active`,
      [siteCode, 'Audit two calendar ' + siteCode],
    );
    expect(site.rows).toHaveLength(1);
    const siteId = site.rows[0].id;
    const empty = await db.query<{ count: string }>(
      `select count(*) from public.assignment_events
       where from_site_id=$1 or to_site_id=$1`,
      [siteId],
    );
    expect(empty.rows[0].count).toBe('0');
    for (const event of events) {
      const name = 'Fictional calendar holding ' + event.reference;
      await db.query(
        `insert into public.quantity_items
         (id,name,category_id,custom_values,validated_form_revision_id,
          needs_metadata,created_at,updated_at)
         values($1,$2,$3,'{}'::jsonb,$4,false,$5,$5)`,
        [
          event.itemId,
          name,
          categoryId,
          category.rows[0].published_form_revision_id,
          event.at,
        ],
      );
      await db.query(
        `insert into public.site_quantity_holdings(item_id,site_id,quantity)
         values($1,$2,$3)`,
        [event.itemId, siteId, event.units],
      );
      const after = {
        name,
        description: null,
        category_id: categoryId,
        category_name: category.rows[0].name,
        manufacturer: null,
        model: null,
        reorder_threshold: null,
        item_code: null,
        custom_values: {},
        form_revision_id: category.rows[0].published_form_revision_id,
      };
      await db.query(
        `insert into public.quantity_events
         (id,item_id,kind,actor_id,actor_name,reason,before_metadata,
          after_metadata,version,created_at)
         values($1,$2,'site_opened',$3,$4,$5,null,$6::jsonb,1,$7)`,
        [
          event.eventId,
          event.itemId,
          actor.rows[0].user_id,
          actor.rows[0].display_name,
          'Fictional initial calendar read/filter fixture',
          JSON.stringify(after),
          event.at,
        ],
      );
      await db.query(
        `insert into public.site_quantity_event_lines
         (event_id,site_id,delta,before_quantity,after_quantity)
         values($1,$2,$3,0,$3)`,
        [event.eventId, siteId, event.units],
      );
      await db.query(
        `insert into public.assignment_events
         (id,quantity_event_id,item_id,kind,actor_id,actor_name,reason,
          reference,to_site_id,to_label,quantity,created_at)
         values($1,$2,$3,'opened',$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          event.assignmentId,
          event.eventId,
          event.itemId,
          actor.rows[0].user_id,
          actor.rows[0].display_name,
          'Fictional initial calendar read/filter fixture',
          event.reference,
          siteId,
          site.rows[0].name,
          event.units,
          event.at,
        ],
      );
    }
    // Force deferred assignment-link validation before the fixture is visible.
    await db.query('set constraints all immediate');
    await db.query('commit');
    return { siteId, events };
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    await db.end();
  }
}

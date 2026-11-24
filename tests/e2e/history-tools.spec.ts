import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { resolveActivityPreset } from '../../src/features/custody/activity-range';
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';

test('person plus last-week movements downloads matching full ledger at 390px', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const api = new URL(
    localCommandPaletteTarget(process.env.LOCAL_API_URL, 'api'),
  );
  const db = new URL(
    localCommandPaletteTarget(process.env.LOCAL_DB_URL, 'database'),
  );
  const caller = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await caller.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  const actor = signed.data.user!.id;
  const owner = new Client({ connectionString: db.href });
  await owner.connect();
  const item = randomUUID(),
    createdId = randomUUID(),
    moveId = randomUUID();
  const name = 'History phone ' + randomUUID().slice(0, 8);
  const range = resolveActivityPreset('lastweek', 'UTC');
  const instant = new Date(
    new Date(range.from).getTime() + 86400000,
  ).toISOString();
  try {
    // Explicitly fictional immutable historical events on disposable loopback DB.
    // No existing timestamps/history are rewritten to make a preset pass.
    await owner.query('begin');
    await owner.query(
      `insert into public.quantity_items(id,name,category_id,version,created_at)
      select $1,$2,id,2,$3 from public.categories where code='CABLES'`,
      [item, name, range.from],
    );
    await owner.query(
      `insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at)
      select $1,$2,'created',$3,display_name,1,$4 from public.app_members where user_id=$3`,
      [createdId, item, actor, range.from],
    );
    await owner.query(
      `insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at)
      select $1,$2,'moved',$3,display_name,2,$4 from public.app_members where user_id=$3`,
      [moveId, item, actor, instant],
    );
    await owner.query(
      `insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
      select $1,id,6,0,6 from public.locations where code='ITC-RED'`,
      [createdId],
    );
    await owner.query(
      `insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
      select $1,id,case when code='ITC-RED' then -3 else 3 end,
      case when code='ITC-RED' then 6 else 0 end,3 from public.locations where code in ('ITC-RED','ITC-BLACK')`,
      [moveId],
    );
    await owner.query(
      `insert into public.stock_balances(item_id,location_id,quantity)
      select $1,id,3 from public.locations where code in ('ITC-RED','ITC-BLACK')`,
      [item],
    );
    await owner.query('commit');
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await page.goto('/history?entityId=' + item + '&zone=UTC');
    await page
      .getByRole('combobox', { name: 'Person', exact: true })
      .selectOption(actor);
    await expect(page).toHaveURL(new RegExp('actor=' + actor));
    await page
      .getByRole('combobox', { name: 'Activity range' })
      .selectOption('movements-lastweek');
    await expect(page).toHaveURL(/eventType=movements/);
    await expect(
      page.getByText('1 matching event', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Physically moved', exact: true }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const expected = await caller.rpc('inventory_history_export_snapshot', {
      p_type: 'quantity',
      p_entity_id: item,
      p_actor_id: actor,
      p_event_type: 'movements',
      p_from: range.from,
      p_until: range.until,
    });
    expect(expected.error).toBeNull();
    expect((expected.data as { event_count: number }).event_count).toBe(1);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export history CSV' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const raw = await readFile(path!);
    expect(raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(
      true,
    );
    const csv = raw.toString('utf8');
    expect(csv).toContain('"event","' + moveId + '"');
    expect(csv.match(/"quantity_line","/g)).toHaveLength(2);
    expect(csv).toContain('ITC-RED');
    expect(csv).toContain('ITC-BLACK');
    expect(csv).toContain(',6,-3,3,');
    expect(csv).toContain(instant.replace('.000Z', '.000000Z'));
    expect(csv).not.toContain(createdId);
    await testInfo.attach('history-390px', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach('history-filtered.csv', {
      body: raw,
      contentType: 'text/csv',
    });
  } finally {
    await owner.query('rollback').catch(() => undefined);
    const current = await caller
      .from('quantity_items')
      .select('version,archived')
      .eq('id', item)
      .maybeSingle();
    if (current.data && !current.data.archived) {
      const cleanup = await caller.rpc('quantity_archive_and_clear', {
        p_request_id: randomUUID(),
        p_payload: {
          item_id: item,
          expected_version: current.data.version,
          confirm_clear_stock: true,
          reason: 'History tools fictional fixture cleanup',
        },
      });
      expect(cleanup.error).toBeNull();
    }
    await owner.end();
    await caller.auth.signOut({ scope: 'local' });
  }
});

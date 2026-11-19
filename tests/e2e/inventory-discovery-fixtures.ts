import { randomUUID } from 'node:crypto';
import { expect, type Page, type Route } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { countFeedback } from './count-feedback-support';

/** Caller-scoped RPCs prepare fictional rows; discovery assertions use the UI. */
export async function discoveryFixture() {
  const endpoint = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(endpoint.hostname);
  expect(endpoint.port).toBe('45321');
  const caller = createClient(
    endpoint.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await caller.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signedIn.error).toBeNull();
  const category = await caller
    .from('categories')
    .select('id')
    .eq('active', true)
    .order('sort_order')
    .limit(1)
    .single();
  expect(category.error).toBeNull();
  const prefix = 'Audit3Discovery-' + randomUUID().slice(0, 8);
  const ids: string[] = [];
  const names: string[] = [];
  async function mutate(operation: string, payload: Record<string, unknown>) {
    const result = await caller.rpc(operation, {
      p_request_id: randomUUID(),
      p_payload: payload,
    });
    expect(result.error, `${operation} fixture operation`).toBeNull();
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  async function cleanup() {
    try {
      for (const id of ids) {
        const record = await caller
          .from('quantity_items')
          .select('version,archived')
          .eq('id', id)
          .single();
        expect(record.error).toBeNull();
        if (!record.data!.archived)
          await mutate('quantity_archive_and_clear', {
            item_id: id,
            expected_version: record.data!.version,
            confirm_clear_stock: true,
            reason: 'Audit 3 fictional discovery fixture cleanup',
          });
      }
    } finally {
      await caller.auth.signOut({ scope: 'local' });
    }
  }
  try {
    for (let index = 0; index < 26; index++) {
      const name = `${prefix} ${index < 24 ? 'Alpha' : 'Beta'} ${String(index).padStart(2, '0')}`;
      const created = await mutate('quantity_create', {
        name,
        category_id: category.data!.id,
        initial_quantity: 0,
        initial_location_id: null,
      });
      ids.push(z.uuid().parse(created.entity_id));
      names.push(name);
    }
    return { prefix, names, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Hold one real search response without removing an in-flight route handler. */
export async function holdFirstSearch(page: Page, query: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  const active = new Set<Promise<void>>();
  let held = false;
  const matches = (url: URL) => url.pathname === '/inventory';
  const handler = async (route: Route) => {
    const work = (async () => {
      const request = route.request();
      if (request.method() === 'GET' && request.headers().rsc === '1') {
        const value = new URL(request.url()).searchParams.get('q') ?? '';
        requests.push(value);
        if (!held && value === query) {
          held = true;
          await gate;
        }
      }
      await route.continue();
    })();
    active.add(work);
    try {
      await work;
    } finally {
      active.delete(work);
    }
  };
  await page.route(matches, handler);
  return {
    requests,
    isHeld: () => held,
    release,
    async dispose() {
      release();
      while (active.size) await Promise.all([...active]);
      await page.unroute(matches, handler);
    },
  };
}

export async function appliedSearch(page: Page, query: string, count: number) {
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === query);
  await expect(
    page.getByRole('textbox', { name: 'Search inventory', exact: true }),
  ).toHaveValue(query);
  await expect(countFeedback(page, `${count} matching rows`)).toBeVisible();
  await expect(
    page.getByText('Results and CSV use the applied search.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Active inventory filters' }),
  ).toContainText(`Search: ${query}`);
}

export async function exportScope(page: Page, query: string) {
  const summary = page.locator('summary').filter({ hasText: 'Export CSV' });
  const link = page.getByRole('link', {
    name: 'Filtered inventory',
    exact: true,
  });
  if (!(await link.isVisible())) await summary.click();
  await expect(link).toHaveAttribute('href', /\/api\/exports\/inventory\?/);
  const href = await link.getAttribute('href');
  expect(new URL(href!, page.url()).searchParams.get('q')).toBe(query);
  return link;
}

export function csvRows(text: string) {
  return text
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split(/\r?\n/)
    .map((line) =>
      (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? [])
        .slice(0, -1)
        .map((cell) =>
          cell.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'),
        ),
    );
}

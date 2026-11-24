import { randomUUID } from 'node:crypto';
import { expect, type Page, type Request, type Route } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { countFeedback } from './count-feedback-support';

type CleanupStep = { name: string; run: () => Promise<unknown> };

export async function runDiscoveryCleanup(
  steps: CleanupStep[],
  primaryFailure?: { cause: unknown },
) {
  const failures: { name: string; cause: unknown }[] = [];
  for (const { name, run } of steps) {
    try {
      await run();
    } catch (cause) {
      failures.push({ name, cause });
    }
  }
  if (!failures.length) return;
  if (!primaryFailure && failures.length === 1) throw failures[0].cause;
  const message = primaryFailure
    ? 'Discovery operation and cleanup failed.'
    : 'Discovery cleanup failed.';
  const details = failures.map(
    ({ name, cause }) =>
      `${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  // Playwright reports Error.cause and the outer message, but not AggregateError.errors.
  throw new Error(
    [message, ...details].join('\n'),
    primaryFailure ?? failures[0],
  );
}

function discoveryFetch(origin: string): typeof fetch {
  return (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (url.origin !== origin)
      throw new Error('Discovery fixture request left the local backend.');
    const callerSignal =
      init?.signal ??
      (input instanceof globalThis.Request ? input.signal : undefined);
    const deadline = AbortSignal.timeout(8_000);
    return fetch(input, {
      ...init,
      redirect: 'error',
      signal: callerSignal
        ? AbortSignal.any([callerSignal, deadline])
        : deadline,
    });
  };
}

/** Caller-scoped RPCs prepare fictional rows; discovery assertions use the UI. */
export async function discoveryFixture() {
  const endpoint = new URL(process.env.LOCAL_API_URL!);
  expect(endpoint.protocol).toBe('http:');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(endpoint.hostname);
  expect(endpoint.port).toBe('45321');
  const caller = createClient(
    endpoint.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: discoveryFetch(endpoint.origin) },
    },
  );
  const prefix = 'Audit3Discovery-' + randomUUID().slice(0, 8);
  const ids: string[] = [];
  const names: string[] = [];
  async function mutate(
    operation: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const command = caller.rpc(operation, {
      p_request_id: randomUUID(),
      p_payload: payload,
    });
    const result = await (signal ? command.abortSignal(signal) : command);
    expect(result.error, `${operation} fixture operation`).toBeNull();
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  async function cleanup() {
    // All owned rows share one retirement budget. Sign-out has its own request deadline.
    const retirementDeadline = AbortSignal.timeout(30_000);
    await runDiscoveryCleanup([
      ...ids.map((id, index) => ({
        name: `Retire owned discovery record ${index + 1}`,
        run: async () => {
          if (retirementDeadline.aborted)
            throw new Error(
              'Not attempted because the shared retirement deadline expired.',
            );
          const record = await caller
            .from('quantity_items')
            .select('version,archived')
            .eq('id', id)
            .abortSignal(retirementDeadline)
            .retry(false)
            .single();
          expect(record.error).toBeNull();
          if (!record.data!.archived) {
            if (retirementDeadline.aborted)
              throw new Error(
                'Archive request skipped because the shared retirement deadline expired.',
              );
            await mutate(
              'quantity_archive_and_clear',
              {
                item_id: id,
                expected_version: record.data!.version,
                confirm_clear_stock: true,
                reason: 'Audit 3 fictional discovery fixture cleanup',
              },
              retirementDeadline,
            );
          }
        },
      })),
      {
        name: 'Sign out of fixture session',
        run: async () => {
          const signedOut = await caller.auth.signOut({ scope: 'local' });
          expect(signedOut.error).toBeNull();
        },
      },
    ]);
  }
  try {
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
  } catch (cause) {
    await runDiscoveryCleanup(
      [{ name: 'Archive owned discovery data', run: cleanup }],
      { cause },
    );
    throw cause;
  }
}

/** Hold the first matching search Flight while observing later requests passively. */
export async function holdFirstSearch(page: Page, query: string) {
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const requests: string[] = [];
  const origin = new URL(page.url()).origin;
  let continuation: Promise<void> | undefined;
  let held = false;
  const searchQuery = (request: Request) => {
    const url = new URL(request.url());
    return url.origin === origin &&
      url.pathname === '/inventory' &&
      request.method() === 'GET' &&
      request.headers().rsc === '1'
      ? (url.searchParams.get('q') ?? '')
      : null;
  };
  const observe = (request: Request) => {
    const value = searchQuery(request);
    if (value !== null) requests.push(value);
  };
  const matches = (url: URL) =>
    url.origin === origin &&
    url.pathname === '/inventory' &&
    url.searchParams.get('q') === query &&
    url.searchParams.has('_rsc');
  const handler = (route: Route) => {
    continuation = (async () => {
      expect(searchQuery(route.request())).toBe(query);
      held = true;
      await gate;
      await route.continue();
    })();
    return continuation;
  };
  // Playwright updates interception after its one-shot handler settles.
  // Explicit unroute on a held route would also continue it from the dispatcher.
  await page.route(matches, handler, { times: 1 });
  page.on('request', observe);
  const release = async () => {
    openGate();
    await continuation;
  };
  return {
    requests,
    isHeld: () => held,
    release,
    async dispose() {
      page.off('request', observe);
      if (continuation) {
        await release();
      } else if (!page.isClosed()) {
        // Removing an unused route synchronously drops the local handler
        // before awaiting the dispatcher, so it cannot start during cleanup.
        try {
          await page.unroute(matches, handler);
        } catch (error) {
          if (!page.isClosed()) throw error;
        }
      }
    },
  };
}

export async function appliedSearch(page: Page, query: string, count: number) {
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === query);
  await expect(
    page.getByRole('textbox', { name: 'Search inventory', exact: true }),
  ).toHaveValue(query);
  await expect(countFeedback(page, `${count} items`)).toBeVisible();
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
    name: 'Matching holdings rows',
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

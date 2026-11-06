import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { parseOverviewProjection } from '../../src/features/overview/contracts';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { setLocalReducedMotion } from './motion-settings';

async function signIn(page: Page, role: 'staff' | 'viewer') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}

// Exclusive by the existing default scheduler: this compares real authenticated
// reads of mutable data. No fixture/account writes or mocked browser responses.
for (const role of ['staff', 'viewer'] as const) {
  test(`${role} Overview shows real caller data, exact daily tables, usable phone actions and access-loss clearing`, async ({
    page,
  }, info) => {
    const api = new URL(process.env.LOCAL_API_URL!);
    expect(['localhost', '127.0.0.1']).toContain(api.hostname);
    expect(api.port).toBe('45321');
    const caller = createClient(
      api.href,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const login = await caller.auth.signInWithPassword({
      email: fixture.emails[role],
      password: fixture.password,
    });
    expect(login.error).toBeNull();
    try {
      const read = await caller.rpc('overview_snapshot_v1', {
        p_time_zone: 'UTC',
      });
      expect(read.error).toBeNull();
      const expected = parseOverviewProjection(read.data);
      await signIn(page, role);
      await page.goto('/dashboard');
      await expect(
        page.getByRole('heading', { name: 'Overview', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      const attention = page.getByRole('region', {
        name: 'Items needing attention',
      });
      for (const row of expected.stock.attention) {
        const item = attention.locator('li').filter({
          has: page.getByRole('link', { name: row.name, exact: true }),
        });
        await expect(item).toContainText(
          `Available ${row.available} · Threshold ${row.threshold} · ${row.available === row.threshold ? 'At threshold' : `Shortfall ${row.shortfall}`}`,
        );
      }
      const recent = page.getByRole('region', { name: 'Recent changes' });
      await expect(recent.locator('ol > li')).toHaveCount(
        expected.recentEvents.length,
      );
      for (const event of expected.recentEvents)
        await expect(
          recent.locator(
            `a[href="/history/events/${event.recordKind}/${event.eventId}"]`,
          ),
        ).toContainText(event.name || 'Record name unavailable');
      const sites = page.getByRole('region', { name: 'Equipment at sites' });
      for (const row of expected.atSites.rows)
        await expect(
          sites.locator('li').filter({
            has: page.locator(
              `a[href="/inventory/${row.kind === 'asset' ? 'assets' : 'quantity'}/${row.entityId}"]`,
            ),
          }),
        ).toContainText(
          `${row.siteName}${row.siteActive ? '' : ' (inactive)'} · ${row.quantity}`,
        );
      await page
        .getByText('View daily activity table', { exact: true })
        .click();
      const activity = page.getByRole('table', {
        name: 'Recorded inventory events · each event counted once',
      });
      await expect(activity.locator('tbody tr')).toHaveCount(14);
      for (const point of expected.activity.points.slice(0, -1))
        await expect(
          activity.locator('tr').filter({ hasText: point.date }),
        ).toContainText(point.value ?? 'Not available');
      for (const trend of expected.stockTrends) {
        await page
          .getByText(`View daily stock table for ${trend.name}`, {
            exact: true,
          })
          .click();
        const table = page.getByRole('table', {
          name: `${trend.name} · available in storage`,
        });
        await expect(table.locator('tbody tr')).toHaveCount(14);
        for (const point of trend.points)
          await expect(
            table.locator('tr').filter({ hasText: point.date }),
          ).toContainText(point.value ?? 'Not available');
      }
      const main = page.locator('#main-content');
      expect(await main.innerText()).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
      await expect(page.getByText('Add item', { exact: true })).toHaveCount(
        role === 'staff' ? 1 : 0,
      );
      await expect(
        page
          .getByRole('navigation', { name: 'Overview quick actions' })
          .getByRole('link', { name: 'Scan', exact: true }),
      ).toHaveAttribute('href', '/scan');
      await expect(
        page
          .getByRole('navigation', { name: 'Overview quick actions' })
          .getByRole('link', { name: 'Print labels', exact: true }),
      ).toHaveAttribute('href', '/labels');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      let localReduced = false;
      for (const width of [1280, 390])
        for (const reduced of [false, true]) {
          await page.setViewportSize({ width, height: 844 });
          if (localReduced !== reduced)
            await setLocalReducedMotion(page, reduced);
          localReduced = reduced;
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          ).toBeLessThanOrEqual(1);
          await page.screenshot({
            path: info.outputPath(
              `overview-${role}-${width}-${reduced ? 'reduced' : 'full'}.png`,
            ),
            fullPage: true,
          });
        }
      await page
        .getByRole('button', { name: 'Refresh overview', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Overview refreshed.' }),
      ).toBeVisible();
      await page.context().clearCookies();
      await page
        .getByRole('button', { name: 'Refresh overview', exact: true })
        .click();
      await expect(page.getByRole('alert')).toContainText(
        'Private Overview data has been cleared',
      );
      await expect(
        page.getByRole('region', { name: 'Recent changes' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Equipment at sites' }),
      ).toHaveCount(0);
    } finally {
      await caller.auth.signOut({ scope: 'local' });
    }
  });
}

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import type { BuildProvenance } from '../../src/features/build-info/provenance';

test('compiled provenance probe preserves the snapshot across runtime changes', () => {
  test.setTimeout(75_000);
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      'tests/build-provenance-compiled.test.mjs',
    ],
    { encoding: 'utf8', timeout: 70_000, maxBuffer: 128 * 1024 },
  );
  // Assert only bounded status/known TAP markers; never echo subprocess diagnostics.
  expect(
    !result.error,
    'Compiled probe must start and finish before its deadline',
  ).toBe(true);
  expect(result.status, 'Compiled probe must exit successfully').toBe(0);
  expect(
    result.signal,
    'Compiled probe must finish without termination',
  ).toBeNull();
  expect(
    /^# pass 1\r?$/m.test(result.stdout),
    'Compiled probe must execute its regression',
  ).toBe(true);
  expect(
    /^# fail 0\r?$/m.test(result.stdout),
    'Compiled probe must report no failures',
  ).toBe(true);
});

test('Settings identifies the compiled served build for active viewers at narrow widths', async ({
  page,
}) => {
  const manifest = JSON.parse(
    await readFile('.next/required-server-files.json', 'utf8'),
  );
  const expected: BuildProvenance = JSON.parse(
    manifest.config.env.APP_BUILD_PROVENANCE,
  );
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(
    page.getByRole('region', { name: 'Build & environment' }),
  ).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Sign-in's server action must finish before a new document navigation.
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  await page.goto('/settings');
  await page.setViewportSize({ width: 375, height: 812 });
  const section = page.getByRole('region', { name: 'Build & environment' });
  await expect(section).toContainText(
    `${expected.environment} · Version ${expected.version}`,
  );
  await section.getByText('Build support details').focus();
  await page.keyboard.press('Enter');
  await expect(section.locator('details')).toHaveAttribute('open', '');
  await expect(section).toContainText(expected.commit ?? 'Unavailable');
  await expect(section.locator('time')).toHaveAttribute(
    'datetime',
    expected.buildStarted!,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await section.getByText('Build support details').click();
  await expect(section.locator('time')).toHaveAttribute(
    'datetime',
    expected.buildStarted!,
  );
});

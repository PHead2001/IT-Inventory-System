import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { freemem } from 'node:os';
import {
  routePrimaryFixture,
  type RoutePrimaryFixtureKind,
} from '../helpers/route-primary-fixture';

declare global {
  interface Window {
    routePrimary: {
      begin(): void;
      policy(full: boolean, admitted: boolean): void;
      proof: {
        starts: number;
        ready: boolean;
        finished: boolean;
        errors: string[];
        names: string[];
        callbacks: string[];
        auxiliaryNames: string[];
        releaseCount: number;
      };
    };
  }
}

let memoryTimer: ReturnType<typeof setInterval> | undefined;
let admissionFreeGiB = 0;
let minimumFreeGiB = 0;
let resourceStopped = false;
// Opt-in local resource policy, checked before requesting a browser fixture.
test.beforeAll(() => {
  if (process.env.NATIVE_GEOMETRY_MEMORY_GUARD === '1') {
    admissionFreeGiB = freemem() / 1024 ** 3;
    expect(admissionFreeGiB).toBeGreaterThanOrEqual(6);
  }
});
test.beforeEach(({ browser }) => {
  if (process.env.NATIVE_GEOMETRY_MEMORY_GUARD !== '1') return;
  minimumFreeGiB = freemem() / 1024 ** 3;
  resourceStopped = false;
  memoryTimer = setInterval(() => {
    minimumFreeGiB = Math.min(minimumFreeGiB, freemem() / 1024 ** 3);
    if (minimumFreeGiB < 4) {
      resourceStopped = true;
      void browser.close().catch(() => {});
    }
  }, 2000);
});
test.afterEach(async ({}, info) => {
  if (memoryTimer) clearInterval(memoryTimer);
  memoryTimer = undefined;
  if (process.env.NATIVE_GEOMETRY_MEMORY_GUARD !== '1') return;
  minimumFreeGiB = Math.min(minimumFreeGiB, freemem() / 1024 ** 3);
  const resource = {
    admissionFreeGiB,
    minimumFreeGiB,
    resourceStopped,
    startGiB: 6,
    stopGiB: 4,
  };
  await info.attach('local-resource', {
    body: JSON.stringify(resource),
    contentType: 'application/json',
  });
  console.log(JSON.stringify({ localNativeResource: resource }));
});

async function mount(page: Page, kind: RoutePrimaryFixtureKind, width: number) {
  const css = await readFile(resolve('src/app/globals.css'), 'utf8');
  const start = css.indexOf('@keyframes route-content-in');
  const end = css.indexOf("html[data-motion='reduced'] *,", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const token = (name: string) => {
    const match = css.match(new RegExp(name + ':\\s*([^;]+);'));
    expect(match).not.toBeNull();
    return match![1];
  };
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent(
    `<style>:root{--motion-route:${token('--motion-route')};--ease-workspace:${token('--ease-workspace')}}html,body{margin:0}${css.slice(start, end)}</style><div id="root"></div>`,
  );
  const fixture = await routePrimaryFixture(kind);
  await page.addScriptTag({ content: fixture.script });
  await expect(
    page.getByRole('heading', { name: fixture.sourceRoute }),
  ).toBeVisible();
}

for (const width of [1280, 390]) {
  test(`React initiates one primary region capture through the routed Slot topology at ${width}px`, async ({
    page,
  }) => {
    await mount(page, 'primary', width);
    await page.evaluate(() => window.routePrimary.begin());
    await expect
      .poll(() => page.evaluate(() => window.routePrimary.proof.ready))
      .toBe(true);
    const proof = await page.evaluate(() => window.routePrimary.proof);
    expect(proof.starts).toBe(1);
    expect(proof.errors).toEqual([]);
    for (const name of [
      'route-primary-fixture',
      'route-primary-fixture-header',
    ]) {
      expect(proof.names).toContain(`::view-transition-old(${name})`);
      expect(proof.names).toContain(`::view-transition-new(${name})`);
      expect(proof.callbacks).toContain(name);
    }
    expect(proof.auxiliaryNames).toEqual([]);
    expect(
      proof.names.some((name) => name.includes('primary-fixture-title')),
    ).toBe(false);
    await expect(page.getByRole('heading', { name: '/history' })).toBeVisible();
    expect(
      await page
        .locator('canvas')
        .evaluate((node) => getComputedStyle(node).viewTransitionName),
    ).toBe('none');
    await expect
      .poll(() => page.evaluate(() => window.routePrimary.proof.finished))
      .toBe(true);
    expect(await page.evaluate(() => window.routePrimary.proof.starts)).toBe(1);
  });
}

for (const kind of ['paired', 'history', 'location'] as const) {
  test(`${kind} source keeps its paired title and auxiliary header/body without activating enclosing primary boundaries`, async ({
    page,
  }) => {
    await mount(page, kind, 1280);
    await page.evaluate(() => window.routePrimary.begin());
    await expect
      .poll(() => page.evaluate(() => window.routePrimary.proof.ready))
      .toBe(true);
    const proof = await page.evaluate(() => window.routePrimary.proof);
    expect(proof.starts).toBe(1);
    expect(proof.errors).toEqual([]);
    for (const name of [
      'primary-fixture-title',
      'primary-fixture-title-content',
      'primary-fixture-title-content-header',
    ]) {
      expect(proof.names).toContain(`::view-transition-old(${name})`);
      expect(proof.names).toContain(`::view-transition-new(${name})`);
    }
    expect(proof.callbacks).toEqual([]);
    expect(proof.auxiliaryNames).toEqual(
      expect.arrayContaining([
        'primary-fixture-title-content',
        'primary-fixture-title-content-header',
      ]),
    );
    expect(
      proof.names.some((name) => name.includes('route-primary-fixture')),
    ).toBe(false);
    await expect
      .poll(() => page.evaluate(() => window.routePrimary.proof.finished))
      .toBe(true);
    expect(
      await page.evaluate(() => window.routePrimary.proof.releaseCount),
    ).toBe(1);
  });
}

for (const policy of ['reduced', 'private'] as const) {
  test(`${policy} routed replacement remains instant without initiating native capture`, async ({
    page,
  }) => {
    await mount(page, 'primary', 1280);
    await page.evaluate((policy) => {
      window.routePrimary.policy(policy !== 'reduced', policy !== 'private');
      window.routePrimary.begin();
    }, policy);
    await expect(page.getByRole('heading', { name: '/history' })).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => window.routePrimary.proof.starts)).toBe(0);
  });
}

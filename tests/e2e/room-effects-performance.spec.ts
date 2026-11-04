import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { acceptanceLogin } from './audit-three-acceptance-fixtures';
import {
  observeRoomScene,
  captureRoomEffects,
} from './room-visibility-witness';
import {
  installRoomDrawObservation,
  summarizeRoomDraws,
  type RoomDrawEvidence,
} from './room-draw-observation';

// Explicit hardware comparison, not a CI frame-rate threshold or a fake-clock run.
test('record matched real-time room draw and contact performance', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.SPATIAL_PERF !== '1',
    'Opt-in matched reference-hardware capture',
  );
  test.setTimeout(150_000);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  expect(process.env.SPATIAL_PERF_SHA, 'explicit exact revision').toBe(sha);
  const kind = process.env.SPATIAL_PERF_KIND;
  expect(['baseline', 'candidate']).toContain(kind);
  const quality = process.env.SPATIAL_PERF_QUALITY ?? 'standard';
  expect(['standard', 'low', 'off']).toContain(quality);
  if (kind === 'baseline') expect(quality).toBe('standard');
  await observeRoomScene(page);
  await page.addInitScript(installRoomDrawObservation);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await acceptanceLogin(page);
  if (kind === 'candidate') {
    await page.goto('/settings');
    await page
      .getByLabel('Room appearance in this browser', { exact: true })
      .selectOption(quality);
  }
  await page.goto('/room?space=it-closet&location=ITC-RED');
  const viewer = page.getByTestId('room-viewer');
  const show = page.getByRole('button', { name: 'Show room', exact: true });
  if (await show.isVisible()) await show.click();
  const canvas = viewer.locator('canvas');
  await expect(canvas).toHaveAttribute('data-camera-position', /\[/);
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-RED');
  if (kind === 'candidate') {
    await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
    await expect(canvas).toHaveAttribute(
      'data-contact-status',
      quality === 'off' ? 'off' : 'cached',
    );
    if (quality === 'standard')
      await expect(canvas).toHaveAttribute('data-bloom-status', 'active');
  }
  const readyAt = await page.evaluate(() => performance.now());
  const initial = await captureRoomEffects(page);
  const more = viewer.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  await more.click();
  await viewer.getByRole('button', { name: 'Free Orbit', exact: true }).click();
  await more.click();
  const interact = viewer.getByRole('button', {
    name: 'Interact with map',
    exact: true,
  });
  if (await interact.isVisible()) await interact.click();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const drag = async () => {
    const x = box!.x + box!.width * 0.5;
    const y = box!.y + box!.height * 0.5;
    await page.mouse.move(x, y);
    const before = await canvas.getAttribute('data-camera-position');
    await page.mouse.down();
    await page.mouse.move(x + box!.width * 0.12, y, { steps: 30 });
    await expect(canvas).not.toHaveAttribute('data-camera-position', before!);
    await page.mouse.move(x, y, { steps: 30 });
    await page.mouse.up();
    await page.mouse.move(0, 0);
  };
  // Identical warmup on both revisions. No camera-state injection.
  await drag();
  await page.waitForTimeout(1500);
  const samples: {
    draws: RoomDrawEvidence;
    effects: Awaited<ReturnType<typeof captureRoomEffects>>;
  }[] = [];
  try {
    for (let run = 0; run < 5; run++) {
      await page.evaluate(() => window.__roomDrawObservation!.reset());
      await drag();
      await page.waitForTimeout(500);
      const draws = await page.evaluate(() =>
        window.__roomDrawObservation!.snapshot(),
      );
      expect(draws.installed).toBeGreaterThan(0);
      expect(draws.overflow).toBe(false);
      expect(draws.frames.length).toBeGreaterThan(0);
      samples.push({ draws, effects: await captureRoomEffects(page) });
    }
    // Separate bounded capture/selection spikes from steady camera interactions.
    const captures = [];
    const browser = page.getByRole('navigation', { name: 'Location browser' });
    for (const code of ['ITC-D07', 'ITC-RED', 'ITC-D07', 'ITC-RED']) {
      await page.evaluate(() => window.__roomDrawObservation!.reset());
      await browser
        .getByRole('searchbox', { name: 'Browse locations' })
        .fill(code);
      await browser
        .getByRole('button', { name: new RegExp(`${code}$`) })
        .click();
      await expect(viewer).toHaveAttribute('data-focused-code', code);
      if (kind === 'candidate') {
        await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
        await expect(canvas).toHaveAttribute(
          'data-contact-status',
          quality === 'off' ? 'off' : 'cached',
        );
      }
      await page.waitForTimeout(500);
      const draws = await page.evaluate(() =>
        window.__roomDrawObservation!.snapshot(),
      );
      expect(draws.overflow).toBe(false);
      captures.push({ code, draws, effects: await captureRoomEffects(page) });
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__roomDrawObservation!.reset());
    await page.waitForTimeout(2000);
    const idle = await page.evaluate(() =>
      window.__roomDrawObservation!.snapshot(),
    );
    expect(idle.overflow).toBe(false);
    expect(idle.frames).toHaveLength(0);
    const final = await captureRoomEffects(page);
    const renderer = final.runtime.renderer.name;
    const software =
      /swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer);
    const harness = [
      'room-effects-performance.spec.ts',
      'room-draw-observation.ts',
      'room-visibility-witness.ts',
    ].map((name) => ({
      name,
      sha256: createHash('sha256')
        .update(readFileSync(`tests/e2e/${name}`))
        .digest('hex'),
    }));
    await testInfo.attach('room-effects-performance', {
      body: JSON.stringify({
        schema: 1,
        sha,
        kind,
        quality,
        harness,
        buildMode: 'production-next-start',
        readyAt,
        viewport: page.viewportSize(),
        runtime: final.runtime,
        softwareRenderer: software,
        rendererIdentification: software
          ? 'software'
          : final.runtime.renderer.unmaskedAvailable
            ? 'unmasked-reported'
            : 'unidentified',
        timingMeaning:
          'Native draw CPU submission and draw-bearing browser frame intervals; not GPU execution time. Observation overhead is present on both revisions.',
        initial,
        active: samples.map((sample) => ({
          ...sample,
          summary: summarizeRoomDraws(sample.draws),
        })),
        captures,
        idle,
        final,
      }),
      contentType: 'application/json',
    });
  } finally {
    await page.evaluate(() => window.__roomDrawObservation?.stop());
  }
});

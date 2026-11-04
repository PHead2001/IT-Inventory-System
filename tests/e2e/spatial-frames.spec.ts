import { expect, test } from '@playwright/test';
import { armSpatialFrames } from './spatial-composition-observations';

test('spatial sampling arms before a paused clock advances through three real frames', async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent('<canvas data-spatial-phase="settled"></canvas>');
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  const canvas = page.locator('canvas');
  await canvas.evaluate((element) => {
    let frame = 0;
    const update = () => {
      element.dataset.spatialRequest = String(++frame);
      if (frame < 3) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  });
  const capture = await armSpatialFrames(canvas, 3);
  try {
    // Change after arming to prove values come from the actual frame callbacks.
    await canvas.evaluate((element) => {
      element.dataset.spatialOpenCode = 'ITC-S1A';
    });
    await page.clock.runFor(64);
    const samples = await capture.read();
    expect(samples).toHaveLength(3);
    expect(samples).toEqual(
      Array.from({ length: 3 }, (_, index) => ({
        phase: 'settled',
        open: 'ITC-S1A',
        request: String(index + 1),
      })),
    );
  } finally {
    await capture.dispose();
  }
});

test('disposing an armed spatial sampler cancels its pending browser frame', async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent('<canvas></canvas>');
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  // Observe scheduling only; the sampler still uses real browser RAF functions.
  await page.evaluate(() => {
    const pending = new Set<number>();
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        pending.delete(id);
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
    Object.assign(window, { pendingSpatialFrames: pending });
  });
  const capture = await armSpatialFrames(page.locator('canvas'), 3);
  const pendingCount = () =>
    page.evaluate(
      () =>
        (window as Window & { pendingSpatialFrames?: Set<number> })
          .pendingSpatialFrames!.size,
    );
  expect(await pendingCount()).toBe(1);
  await capture.dispose();
  expect(await pendingCount()).toBe(0);
  await page.clock.runFor(64);
  expect(await pendingCount()).toBe(0);
});

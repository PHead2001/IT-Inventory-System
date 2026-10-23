import { expect, test } from '@playwright/test';
import { measureRoomLabelName } from './room-label-name';

test('drawer name measurement excludes badge fragments and detects actual name wrapping', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      button { font: 16px/20px Arial; text-align: left; }
      [data-room-label-full] { display: block; width: 220px; }
      [data-badge] { display: block; }
      #wrapped [data-room-label-full] { width: 45px; }
    </style>
    <button id="normal"><span data-room-label-full>Drawer 4<span data-badge>1 product / 31 units / 0 assets</span></span></button>
    <button id="wrapped"><span data-room-label-full>Drawer 4<span data-badge>1 product / 31 units / 0 assets</span></span></button>
    <button id="badge-only"><span data-room-label-full><span data-badge>Drawer 4</span></span></button>
    <button id="hidden"><span data-room-label-full style="visibility: hidden">Drawer 4</span></button>
  `);
  const fullContentRects = await page.locator('#normal').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    return range.getClientRects().length;
  });
  expect(fullContentRects).toBeGreaterThan(1);
  const normal = await page.locator('#normal').evaluate(measureRoomLabelName);
  expect(normal.text).toBe('Drawer 4');
  expect(normal.visible).toBe(true);
  expect(normal.rects).toHaveLength(1);
  expect(normal.rects[0].width).toBeGreaterThan(0);
  expect(normal.rects[0].height).toBeGreaterThan(0);
  const wrapped = await page.locator('#wrapped').evaluate(measureRoomLabelName);
  expect(wrapped.text).toBe('Drawer 4');
  expect(wrapped.visible).toBe(true);
  expect(wrapped.rects.length).toBeGreaterThan(1);
  const badgeOnly = await page
    .locator('#badge-only')
    .evaluate(measureRoomLabelName);
  expect(badgeOnly.text).toBe('');
  expect(badgeOnly.rects).toHaveLength(0);
  const hidden = await page.locator('#hidden').evaluate(measureRoomLabelName);
  expect(hidden.visible).toBe(false);
});

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps measured popup geometry synchronous under the global reduced-motion duration', () => {
  const css = readFileSync('src/features/room/room-visual.module.css', 'utf8');
  const globals = readFileSync('src/app/globals.css', 'utf8');
  const reduced = globals.match(
    /html\[data-motion='reduced'\] \*,[\s\S]*?\{([^}]+)\}/,
  );
  expect(reduced).not.toBeNull();
  const sheet = document.createElement('style');
  // jsdom does not supply CSS initial transition values or evaluate media queries.
  // Supply only that initial value, then apply the actual room stylesheet and
  // the explicit Reduced preference's same global duration override.
  sheet.textContent = `* { transition-property: all; } ${css} html[data-motion='reduced'] * { ${reduced![1]} }`;
  const panel = document.createElement('div');
  panel.className = 'moreMenu';
  document.documentElement.dataset.motion = 'reduced';
  document.head.append(sheet);
  document.body.append(panel);
  try {
    const computed = getComputedStyle(panel);
    expect(computed.transitionDuration).toBe('0.01ms');
    const properties = computed.transitionProperty
      .split(',')
      .map((part) => part.trim());
    // A positive transition of any placement input can leave demand-rendered
    // scene masks stale after the toolbar's synchronous invalidation.
    for (const property of ['all', 'top', 'left', 'width', 'max-height']) {
      expect(properties).not.toContain(property);
    }
  } finally {
    panel.remove();
    sheet.remove();
    delete document.documentElement.dataset.motion;
  }
});

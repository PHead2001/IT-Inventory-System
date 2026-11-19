// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const dark = readFileSync(
  new URL('../../app/globals.css', import.meta.url),
  'utf8',
).split('body {')[0];
const light = readFileSync(
  new URL('./theme-palette.css', import.meta.url),
  'utf8',
);
function values(source: string) {
  return Object.fromEntries(
    Array.from(source.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g), (match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}
function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => parseInt(channel, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}
it('supplies every original semantic screen token in Light and preserves the graphics parser subset', () => {
  const tokens = values(dark);
  const alternate = values(light);
  for (const token of Object.keys(tokens).filter(
    (name) => !/^--(?:motion-|font-|text-|ease-|transition-)/.test(name),
  ))
    expect(alternate, token).toHaveProperty(token);
  for (const token of [
    '--room-selection-emissive',
    '--room-selected-edge',
    '--room-dimmed-edge',
    '--room-edge',
    '--room-canvas-background',
    '--room-fill-light',
    '--room-grid',
  ])
    expect(alternate[token], token).toMatch(/^#[0-9a-f]{6}$/);
});
it('proves the opaque semantic Light text/on-accent pairs and meaningful control borders numerically', () => {
  const tokens = values(light);
  for (const token of [
    '--foreground',
    '--muted',
    '--accent',
    '--warning',
    '--danger',
    '--color-slate-100',
    '--color-slate-200',
    '--color-slate-300',
    '--color-slate-400',
    '--color-slate-500',
  ]) {
    for (const background of ['--background', '--surface'])
      expect(
        contrast(tokens[token], tokens[background]),
        `${token} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
  }
  for (const prefix of ['labels', 'scan'])
    expect(
      contrast(
        tokens[`--${prefix}-primary-button-text`],
        tokens[`--${prefix}-primary-button-background`],
      ),
      prefix,
    ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrast(tokens['--workspace-field-border'], tokens['--surface']),
  ).toBeGreaterThanOrEqual(3);
  for (const token of Object.keys(tokens).filter(
    (name) =>
      name.endsWith('-text') && !/selection-text|primary.*text/.test(name),
  )) {
    expect(
      contrast(tokens[token], tokens['--surface']),
      token,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

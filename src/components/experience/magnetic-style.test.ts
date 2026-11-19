import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(
  'src/components/experience/surface-atmosphere.css',
  'utf8',
);
it('keeps native hit owners stationary and moves only pointer-transparent direct decorative children', () => {
  const host = /\.experience-magnetic\s*\{([^}]+)\}/.exec(css)?.[1];
  for (const property of ['transform', 'translate', 'scale'])
    expect(host).toMatch(new RegExp(`${property}: none !important`));
  expect(css).toMatch(
    /\.experience-magnetic-face,\s*\.experience-magnetic-visual,\s*\.experience-tilt-visual\s*\{\s*pointer-events: none;/,
  );
  expect(css).toMatch(
    /\.experience-magnetic\[data-pointer-active='true'\]\s*> \.experience-magnetic-visual/,
  );
  expect(css).toMatch(
    /\.experience-tilt\[data-pointer-active='true'\]\s*> \.experience-tilt-visual/,
  );
});
it('clamps central intensities and hard movement caps under fine-hover Full admission', () => {
  expect(css).toContain('@media (hover: hover) and (pointer: fine)');
  expect(css).toContain("html[data-motion='full']");
  expect(css).toMatch(/clamp\(0, var\(--magnetic-intensity\), 1\)/);
  expect(css).toMatch(/clamp\(0, var\(--tilt-intensity\), 1\)/);
  expect(css).toMatch(/clamp\(\s*-4px,[\s\S]*?4px\s*\)/);
  expect(css).toMatch(/clamp\(\s*-6deg,[\s\S]*?6deg\s*\)/);
  expect(css).toContain(
    'transition: transform var(--motion-feedback) var(--ease-workspace)',
  );
  expect(css).toMatch(
    /data-pointer-withdrawn='true'[\s\S]*?transition: none !important/,
  );
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transform: none !important/,
  );
});

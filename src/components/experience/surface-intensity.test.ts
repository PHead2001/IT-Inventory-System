import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { afterEach, expect, it } from 'vitest';

const tokens = [
  '--spotlight-intensity',
  '--aurora-intensity',
  '--grain-intensity',
  '--blueprint-intensity',
  '--ripple-intensity',
];
const cssRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../app/globals.css',
);

/** Expand the actual relative imports in source order; the bare Tailwind import
 * does not own these application tokens. Keep actual selectors/declarations for
 * CSSOM evaluation, rather than inventing a second specificity algorithm. */
function intensityRules(file = cssRoot): { owner: string; css: string }[] {
  const rules: { owner: string; css: string }[] = [];
  postcss.parse(readFileSync(file, 'utf8')).each((node) => {
    if (node.type === 'atrule' && node.name === 'import') {
      const imported = /^['"]([^'"]+)['"]$/.exec(node.params)?.[1];
      if (imported?.startsWith('.'))
        rules.push(...intensityRules(resolve(dirname(file), imported)));
    } else if (node.type === 'rule') {
      const declarations = node.nodes.filter(
        (child) => child.type === 'decl' && tokens.includes(child.prop),
      );
      if (declarations.length)
        rules.push({
          owner: file,
          css: `${node.selector}{${declarations.map(String).join(';')}}`,
        });
    }
  });
  return rules;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.querySelector('[data-intensity-cascade-test]')?.remove();
});

it('has exactly one Dark and one Light owner for each effect intensity', () => {
  const rules = intensityRules();
  for (const token of tokens) {
    const declarations = rules.filter((rule) => rule.css.includes(`${token}:`));
    expect(declarations, token).toHaveLength(2);
    expect(declarations[0].owner).toMatch(/surface-atmosphere\.css$/);
    expect(declarations[1].owner).toMatch(/theme-palette\.css$/);
  }
});

it.each([
  ['dark', ['0.12', '0.5', '0.29', '0.65', '0.18']],
  ['light', ['0.055', '0.2', '0.12', '0.5', '0.1']],
] as const)(
  'resolves the actual %s import cascade to the documented values',
  (theme, expected) => {
    const style = document.createElement('style');
    style.dataset.intensityCascadeTest = '';
    style.textContent = intensityRules()
      .map((rule) => rule.css)
      .join('\n');
    document.head.append(style);
    document.documentElement.dataset.theme = theme;
    const computed = getComputedStyle(document.documentElement);
    expect(
      tokens.map((token) => computed.getPropertyValue(token).trim()),
    ).toEqual(expected);
  },
);

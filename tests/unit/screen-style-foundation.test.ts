import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const unresolvedTokens = (source: string, globals: ReadonlySet<string>) => {
  const localDeclarations = new Set(
    Array.from(
      source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
      (match) => match[1],
    ),
  );
  return Array.from(
    source.matchAll(/var\((--[\w-]+)\)/g),
    (match) => match[1],
  ).filter((token) => !globals.has(token) && !localDeclarations.has(token));
};

describe('semantic screen palette budget', () => {
  it('allows only shared or same-module declarations', () => {
    const globals = new Set(['--surface']);
    expect(
      unresolvedTokens(
        '--offset: 1rem; top: var(--offset); color: var(--surface);',
        globals,
      ),
    ).toEqual([]);
    expect(unresolvedTokens('color: var(--missing);', globals)).toEqual([
      '--missing',
    ]);
    expect(unresolvedTokens('top: var(--offset);', globals)).toEqual([
      '--offset',
    ]);
  });
  it('keeps module and illustration colors in the shared palette', () => {
    for (const path of [
      'src/features/labels/label-workspace.module.css',
      'src/features/scan/scan-visual.module.css',
      'src/features/metadata/designer.module.css',
      'src/features/inventory/components/inventory-visual.module.css',
      'src/components/experience/closet-preview.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/input.tsx',
    ]) {
      expect(read(path), path).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    }
  });

  it('resolves every module screen token and preserves Three-compatible scene values', () => {
    const globals = read('src/app/globals.css');
    const declarations = new Map(
      Array.from(globals.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), (match) => [
        match[1],
        match[2].trim(),
      ]),
    );
    for (const path of [
      'src/features/labels/label-workspace.module.css',
      'src/features/scan/scan-visual.module.css',
      'src/features/metadata/designer.module.css',
      'src/features/inventory/components/inventory-visual.module.css',
      'src/components/experience/closet-preview.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/input.tsx',
    ]) {
      expect(
        unresolvedTokens(read(path), new Set(declarations.keys())),
        path,
      ).toEqual([]);
    }
    for (const match of read(
      'src/features/room/scene/scene-palette.tsx',
    ).matchAll(/'(--room-[\w-]+)'/g)) {
      let value = declarations.get(match[1])!;
      for (
        let remaining = 8;
        value.startsWith('var(') && remaining;
        remaining--
      ) {
        value = declarations.get(value.slice(4, -1))!;
      }
      expect(value, match[1]).toMatch(
        /^(?:#[\da-f]{3}|#[\da-f]{6}|rgb\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+\s*\))$/i,
      );
    }
  });
});

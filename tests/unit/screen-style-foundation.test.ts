import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('semantic screen palette budget', () => {
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
      for (const match of read(path).matchAll(/var\((--[\w-]+)\)/g)) {
        expect(declarations.has(match[1]), `${path}: ${match[1]}`).toBe(true);
      }
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

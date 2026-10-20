import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('the actual clock and geometry helpers satisfy strict installed DOM types', () => {
  const declarations = [
    'declare function cancelRouteSnapshots(): void;',
    'declare function registerRouteSnapshotClock(animations: Animation[], valid: () => boolean, unsupported?: () => void): () => void;',
  ];
  const source = [
    'route-snapshot-clock',
    'route-content-motion',
    'shared-title-motion',
  ]
    .map((name, index) => {
      const actual = readFileSync(
        `src/components/experience/${name}.ts`,
        'utf8',
      ).replace(/^import .*;\r?\n/gm, '');
      return `namespace Helper${index} {\n${declarations.slice(0, index === 0 ? 1 : 2).join('\n')}\n${actual}\n}`;
    })
    .join('\n');
  const path = '/route-snapshot-clock-types.ts';
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.dom.d.ts', 'lib.esnext.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, onError, createNew) =>
    name === path
      ? ts.createSourceFile(name, source, language, true)
      : getSource(name, language, onError, createNew);
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram([path], options, host),
  );
  expect(
    diagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    ),
  ).toEqual([]);
});

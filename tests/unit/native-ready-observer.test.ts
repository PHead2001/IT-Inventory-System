import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Exercise the actual browser-serialized observer closures without importing a
// Playwright spec or launching a browser. Keep DOM timing types authoritative.
function declaration(path: string, name: string) {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node: ts.Node): ts.Node | undefined {
    if (
      (ts.isVariableDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name.getText(file) === name
    )
      return node;
    return ts.forEachChild(node, visit);
  }
  const found = visit(file);
  if (!found) throw new Error(`Missing observer declaration: ${name}`);
  return found.getText(file).replace(/^export /, '');
}
const source = [
  declaration('tests/e2e/native-ready.ts', 'NativeReadyEvidence'),
  'declare const entry: { old: { name: string }[]; next: { name: string }[] };',
  'const ' + declaration('tests/e2e/route-motion.spec.ts', 'liveEffects') + ';',
  'const ' + declaration('tests/e2e/route-motion.spec.ts', 'running') + ';',
].join('\n');

it('the serialized observer satisfies strict evidence types using the installed DOM library', () => {
  const path = '/native-ready-observer.ts';
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

it.each([undefined, null, 0, 0.5])(
  'missing/null progress stays inactive while actual progress %s keeps its value',
  (progress) => {
    const js = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const observe = new Function(
      'document',
      'entry',
      js +
        '\nconst effects = liveEffects(); return { effects, active: running(effects) };',
    );
    const animation = {
      playState: 'running',
      startTime: 100,
      currentTime: 20,
      effect: {
        pseudoElement: '::view-transition-new(owned)',
        getComputedTiming: () => ({
          activeDuration: 200,
          endTime: 200,
          progress,
        }),
      },
    };
    const result = observe(
      { getAnimations: () => [animation] },
      { old: [{ name: 'owned' }], next: [] },
    );
    expect(result.effects[0].progress).toBe(progress ?? null);
    expect(result.active).toBe(progress !== undefined && progress !== null);
  },
);

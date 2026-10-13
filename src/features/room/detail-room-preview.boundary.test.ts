// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const project = resolve('.');
function dependencies(path: string) {
  if (!/\.tsx?$/.test(path)) return { client: false, paths: [] as string[] };
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const paths: string[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    )
      continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      const clause = statement.importClause;
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((entry) => entry.isTypeOnly)
      )
        continue;
    } else if (statement.isTypeOnly) continue;
    const name = specifier.text;
    const base = name.startsWith('@/')
      ? resolve(project, 'src', name.slice(2))
      : name.startsWith('.')
        ? resolve(dirname(path), name)
        : null;
    if (!base) continue;
    const dependency = [
      base,
      base + '.ts',
      base + '.tsx',
      resolve(base, 'index.ts'),
      resolve(base, 'index.tsx'),
    ].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );
    if (!dependency)
      throw new Error(
        `Unresolved static dependency ${name} from ${relative(project, path)}`,
      );
    paths.push(dependency);
  }
  const first = source.statements[0];
  return {
    client:
      !!first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === 'use client',
    paths,
  };
}

it('keeps every eager client entry, including server-provided link nodes, free of room geometry until the optional chunk loads', () => {
  const visited = new Set<string>();
  const clientEntries = new Set<string>();
  function discover(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const sourceModule = dependencies(path);
    if (sourceModule.client) clientEntries.add(path);
    else sourceModule.paths.forEach(discover);
  }
  discover(resolve(project, 'src/features/room/detail-room-preview.tsx'));
  const eager = new Set<string>();
  function clientGraph(path: string) {
    if (eager.has(path)) return;
    eager.add(path);
    dependencies(path).paths.forEach(clientGraph);
  }
  clientEntries.forEach(clientGraph);
  expect(clientEntries.size).toBeGreaterThan(0);
  expect(
    [...eager]
      .map((path) => relative(project, path).replaceAll('\\', '/'))
      .filter(
        (path) =>
          path.startsWith('data/rooms/') ||
          /features\/room\/(load|spaces|room-map-model|bindings)\.ts$/.test(
            path,
          ),
      ),
  ).toEqual([]);
});

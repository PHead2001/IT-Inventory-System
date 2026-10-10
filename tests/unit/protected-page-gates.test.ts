import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve('src/app/(protected)');
function protectedPages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? protectedPages(path)
      : entry.name === 'page.tsx'
        ? [path]
        : [];
  });
}

// An ungated new route would mount storage consumers while the retained layout
// rechecks a logout generation. Check every success/empty/access-denied branch,
// including routes added later, without wrapping the unresolved server slot.
it.each(protectedPages(root))(
  'gates all private page returns in %s',
  (path) => {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const page = source.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) &&
        !!node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        ),
    );
    expect(page?.body).toBeDefined();
    let returns = 0;
    function visit(node: ts.Node) {
      if (node !== page!.body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) {
        let expression = node.expression;
        while (ts.isParenthesizedExpression(expression))
          expression = expression.expression;
        expect(ts.isJsxElement(expression)).toBe(true);
        if (ts.isJsxElement(expression))
          expect(expression.openingElement.tagName.getText(source)).toBe(
            'ProtectedPrivacyContent',
          );
        returns++;
      }
      ts.forEachChild(node, visit);
    }
    visit(page!.body!);
    expect(returns).toBeGreaterThan(0);
  },
);

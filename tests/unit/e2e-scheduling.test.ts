import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { e2eScheduling, parallelSpecs } from '../../scripts/e2e-scheduling';

type DiscoveredSpec = {
  file: string;
  line: number;
  column: number;
  title: string;
  tests: { projectName: string }[];
};
type DiscoveredSuite = {
  specs?: DiscoveredSpec[];
  suites?: DiscoveredSuite[];
};

function unsafeFixtureSignOuts(source: string) {
  const file = ts.createSourceFile(
    'fixture.ts',
    source,
    ts.ScriptTarget.Latest,
  );
  const unsafe: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'signOut' &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'auth'
    ) {
      const options = node.arguments[0];
      const local =
        options &&
        ts.isObjectLiteralExpression(options) &&
        options.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            property.name.text === 'scope' &&
            ts.isStringLiteral(property.initializer) &&
            property.initializer.text === 'local',
        );
      if (!local)
        unsafe.push(
          file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return unsafe;
}

function discover(
  fullSuite: boolean,
  args: string[] = [],
  captureEvidence = false,
) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run scheduling checks through npm run test.');
  const result = spawnSync(
    process.execPath,
    [npmCli, 'run', 'test:e2e:list', '--', '--reporter=json', ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        E2E_FULL_SUITE: fullSuite ? '1' : '0',
        E2E_CAPTURE_EVIDENCE: captureEvidence ? '1' : '0',
      },
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    const excerpt = (value: unknown) => {
      const text = stripVTControlCharacters(String(value ?? ''))
        .replace(
          /\b(?:postgres(?:ql)?|https?):\/\/[^\s\/]+:[^\s@]+@[^\s]+/gi,
          '[redacted credential URL]',
        )
        .replace(
          /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
          '[redacted token]',
        )
        .replace(
          /((?:authorization|password|token|secret)\s*["']?\s*[:=]\s*)[^\r\n,}]+/gi,
          '$1[redacted]',
        );
      return text.length <= 4096
        ? text
        : text.slice(0, 2048) + '\n[truncated]\n' + text.slice(-2048);
    };
    let discoveryErrors: string[] | undefined;
    try {
      const report = JSON.parse(
        result.stdout.slice(result.stdout.indexOf('{')),
      );
      discoveryErrors = report.errors
        ?.slice(0, 3)
        .map((error: { message?: string }) => excerpt(error.message ?? error));
    } catch {
      // Non-JSON output retains the bounded diagnostic excerpt below.
    }
    throw new Error(
      'Browser discovery did not complete successfully: ' +
        JSON.stringify({
          fullSuite,
          captureEvidence,
          args,
          status: result.status,
          signal: result.signal,
          error: result.error
            ? {
                name: result.error.name,
                code: (result.error as NodeJS.ErrnoException).code,
                message: excerpt(result.error.message),
              }
            : null,
          stdout: discoveryErrors?.length
            ? discoveryErrors
            : excerpt(result.stdout),
          stderr: excerpt(result.stderr),
        }),
    );
  }
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  if (report.errors?.length)
    throw new Error('Browser discovery reported errors.');
  const entries: { key: string; project: string; file: string }[] = [];
  const visit = (suite: DiscoveredSuite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests)
        entries.push({
          key: `${spec.file}:${spec.line}:${spec.column}:${spec.title}`,
          project: test.projectName,
          file: spec.file,
        });
    for (const nested of suite.suites ?? []) visit(nested);
  };
  for (const suite of report.suites) visit(suite);
  return entries;
}

describe('browser scheduling', () => {
  it('keeps independently authenticated fixture-client cleanup local in parallel specs', () => {
    expect(
      unsafeFixtureSignOuts("caller.auth.signOut({ scope: 'local' });"),
    ).toEqual([]);
    for (const source of [
      'caller.auth.signOut();',
      "caller.auth.signOut({ scope: 'global' });",
      "caller.auth.signOut({ scope: 'others' });",
    ])
      expect(unsafeFixtureSignOuts(source)).toEqual([1]);
    for (const spec of [
      ...parallelSpecs,
      'interface-fixtures.ts',
      'inventory-discovery-fixtures.ts',
      'audit-three-acceptance-fixtures.ts',
    ])
      expect(
        unsafeFixtureSignOuts(readFileSync('tests/e2e/' + spec, 'utf8')),
        spec,
      ).toEqual([]);
  });
  it('discovers exactly the same tests once in both modes and retains focused selection', () => {
    const baseline = discover(false);
    const scheduled = discover(true);
    expect(discover(false, [], true)).toEqual(baseline);
    expect(discover(true, [], true)).toEqual(scheduled);
    const recordings = baseline.filter(
      (entry) => entry.file === 'experience-recordings.spec.ts',
    );
    expect(recordings).toHaveLength(2);
    expect(baseline.length).toBeGreaterThan(0);
    expect(new Set(scheduled.map((entry) => entry.key)).size).toBe(
      scheduled.length,
    );
    expect(scheduled.map((entry) => entry.key).sort()).toEqual(
      baseline.map((entry) => entry.key).sort(),
    );
    const parallelFiles = [
      ...new Set(
        scheduled
          .filter((entry) => entry.project === 'chromium-parallel')
          .map((entry) => entry.file),
      ),
    ];
    expect(parallelFiles[0]).toBe('00-room.spec.ts');
    expect(parallelFiles).toEqual(
      [...parallelFiles].sort((a, b) => a.localeCompare(b)),
    );
    const reviewed = new Set<string>(parallelSpecs);
    for (const entry of scheduled)
      expect(entry.project).toBe(
        reviewed.has(entry.file) ? 'chromium-parallel' : 'chromium-exclusive',
      );
    // These reviewed additions must retain every real case in the parallel
    // partition; deriving this only from the allowlist would miss their removal.
    for (const [file, count] of [
      ['audit-four-identifier-guidance.spec.ts', 7],
      ['audit-four-vocabulary.spec.ts', 4],
      ['route-content-native.spec.ts', 13],
      ['skip-link.spec.ts', 2],
    ] as const) {
      const cases = scheduled.filter((entry) => entry.file === file);
      expect(cases, file).toHaveLength(count);
      expect(
        cases.every((entry) => entry.project === 'chromium-parallel'),
        file,
      ).toBe(true);
    }
    const focused = discover(false, ['tests/e2e/00-room.spec.ts']);
    expect(focused.map((entry) => entry.key).sort()).toEqual(
      baseline
        .filter((entry) => entry.file === '00-room.spec.ts')
        .map((entry) => entry.key)
        .sort(),
    );
    expect(new Set(focused.map((entry) => entry.project))).toEqual(
      new Set(['chromium']),
    );
  }, 60_000);
  it('keeps focused invocations in one project without dependency expansion', () => {
    expect(e2eScheduling(false)).toEqual({
      workers: 1,
      projects: [{ name: 'chromium' }],
    });
  });

  it('runs visual readers of unowned global records before concurrent record mutations', () => {
    const visual = discover(true, ['tests/e2e/experience-visual.spec.ts']);
    expect(visual.length).toBeGreaterThan(0);
    for (const entry of visual) {
      expect(entry.file).toBe('experience-visual.spec.ts');
      expect(entry.project).toBe('chromium-exclusive');
    }
    const [exclusive, parallel] = e2eScheduling(true).projects;
    expect(exclusive.workers).toBe(1);
    expect(parallel.dependencies).toContain(exclusive.name);
  }, 60_000);

  it('keeps shared reference and category-schema fixtures exclusive after consolidation', () => {
    const references = discover(true, [
      'tests/e2e/locations-reference.spec.ts',
      'tests/e2e/inventory-search.spec.ts',
    ]);
    const rename = references.filter(
      (entry) => entry.file === 'locations-reference.spec.ts',
    );
    expect(rename).toHaveLength(1);
    expect(rename[0].project).toBe('chromium-exclusive');
    const search = references.filter(
      (entry) => entry.file === 'inventory-search.spec.ts',
    );
    expect(search).toHaveLength(1);
    expect(search[0].project).toBe('chromium-exclusive');
    for (const file of [
      'audit-three-acceptance.spec.ts',
      'audit-three-discovery.spec.ts',
      'audit-three-interface.spec.ts',
    ])
      expect(readdirSync('tests/e2e')).not.toContain(file);
  }, 60_000);

  it('caps full-suite concurrency and finishes exclusive files first', () => {
    const scheduling = e2eScheduling(true);
    expect(scheduling.workers).toBe(2);
    expect(scheduling.projects).toHaveLength(2);
    const [exclusive, parallel] = scheduling.projects;
    expect(exclusive.workers).toBe(1);
    expect(parallel.workers).toBe(2);
    expect(parallel.dependencies).toEqual([exclusive.name]);
    expect(exclusive.testIgnore).toEqual(parallel.testMatch);
  });

  it('places every current spec once, keeping shared-state files and future specs exclusive', () => {
    const specs = readdirSync('tests/e2e').filter((file) =>
      file.endsWith('.spec.ts'),
    );
    const reviewed = new Set<string>(parallelSpecs);
    expect(reviewed.size).toBe(parallelSpecs.length);
    for (const file of reviewed) expect(specs).toContain(file);
    const independent = specs.filter((file) => reviewed.has(file));
    const exclusive = specs.filter((file) => !reviewed.has(file));
    expect([...independent, ...exclusive].sort()).toEqual(specs.sort());
    expect(exclusive).toEqual(
      expect.arrayContaining([
        'configuration.spec.ts',
        'build-info.spec.ts',
        'custody.spec.ts',
        'experience-visual.spec.ts',
        'files.spec.ts',
        'files-recovery.spec.ts',
        'foundation.spec.ts',
        'locations-reference.spec.ts',
        'inventory-search.spec.ts',
        'metadata-designer.spec.ts',
        'route-motion.spec.ts',
      ]),
    );
    const scheduling = e2eScheduling(true);
    const unknown = '**/future-shared-state.spec.ts';
    expect(scheduling.projects[0].testIgnore).not.toContain(unknown);
    expect(scheduling.projects[1].testMatch).not.toContain(unknown);
  });
});

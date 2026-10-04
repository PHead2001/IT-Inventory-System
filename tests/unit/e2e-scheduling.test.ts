import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

function discover(fullSuite: boolean, args: string[] = []) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run scheduling checks through npm run test.');
  const result = spawnSync(
    process.execPath,
    [npmCli, 'run', 'test:e2e:list', '--', '--reporter=json', ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, E2E_FULL_SUITE: fullSuite ? '1' : '0' },
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('Browser discovery did not complete successfully.');
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
  it('discovers exactly the same tests once in both modes and retains focused selection', () => {
    const baseline = discover(false);
    const scheduled = discover(true);
    expect(baseline.length).toBeGreaterThan(0);
    expect(new Set(scheduled.map((entry) => entry.key)).size).toBe(
      scheduled.length,
    );
    expect(scheduled.map((entry) => entry.key).sort()).toEqual(
      baseline.map((entry) => entry.key).sort(),
    );
    const reviewed = new Set<string>(parallelSpecs);
    for (const entry of scheduled)
      expect(entry.project).toBe(
        reviewed.has(entry.file) ? 'chromium-parallel' : 'chromium-exclusive',
      );
    const focused = discover(false, ['tests/e2e/room.spec.ts']);
    expect(focused.map((entry) => entry.key).sort()).toEqual(
      baseline
        .filter((entry) => entry.file === 'room.spec.ts')
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
        'custody.spec.ts',
        'files.spec.ts',
        'files-recovery.spec.ts',
        'foundation.spec.ts',
        'metadata-designer.spec.ts',
      ]),
    );
    const scheduling = e2eScheduling(true);
    const unknown = '**/future-shared-state.spec.ts';
    expect(scheduling.projects[0].testIgnore).not.toContain(unknown);
    expect(scheduling.projects[1].testMatch).not.toContain(unknown);
  });
});

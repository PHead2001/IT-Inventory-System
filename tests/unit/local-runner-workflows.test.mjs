import { readFileSync, readdirSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { foundationGates } from '../../scripts/ci-gates.mjs';

const readWorkflow = (name) =>
  readFileSync(`.github/workflows/${name}`, 'utf8');
const ci = readWorkflow('ci.yml');
const preview = readWorkflow('preview-access.yml');
const pilot = readWorkflow('local-runner-pilot.yml');
const pilotLabel =
  "${{ format('it-inventory-pilot-{0}', github.event.pull_request.head.sha || github.sha) }}";
const profileLabels = new Set([
  'it-inventory-light',
  'it-inventory-mid',
  'it-inventory-heavy',
]);

function auditWorkflowRouting(name, source) {
  const workflow = load(source);
  if (
    !workflow?.jobs ||
    typeof workflow.jobs !== 'object' ||
    Array.isArray(workflow.jobs) ||
    Object.keys(workflow.jobs).length === 0
  )
    throw new Error(`${name}: missing job inventory`);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    const identity = `${name}:${jobName}`;
    // A job-level reusable workflow hides its routing behind another workflow.
    // None are approved; step-level uses remains an ordinary action.
    if (!job || typeof job !== 'object' || Object.hasOwn(job, 'uses'))
      throw new Error(`${identity}: unexamined reusable workflow job`);
    const labels = job['runs-on'];
    if (
      !Array.isArray(labels) ||
      labels.length !== 2 ||
      labels[0] !== 'self-hosted' ||
      typeof labels[1] !== 'string'
    )
      throw new Error(`${identity}: unapproved runs-on`);
    const reviewedPilot =
      name === 'local-runner-pilot.yml' &&
      jobName === 'pilot' &&
      labels[1] === pilotLabel;
    if (!profileLabels.has(labels[1]) && !reviewedPilot)
      throw new Error(`${identity}: unapproved runs-on`);
  }
  return Object.keys(workflow.jobs).length;
}

describe('disposable local runner workflow contracts', () => {
  it('audits every job in every YAML workflow, including future files, without reusable workflow bypasses', () => {
    const workflows = readdirSync('.github/workflows').filter((name) =>
      /\.ya?ml$/i.test(name),
    );
    expect(workflows.length).toBeGreaterThan(0);
    let jobs = 0;
    for (const name of workflows)
      jobs += auditWorkflowRouting(name, readWorkflow(name));
    expect(jobs).toBeGreaterThan(0);
  });

  it.each([
    ['hosted scalar', 'runs-on: ubuntu-latest'],
    ['hosted array', 'runs-on: [ubuntu-latest, it-inventory-light]'],
    ['dynamic scalar', "runs-on: '${{ matrix.runner }}'"],
    ['dynamic profile', "runs-on: [self-hosted, '${{ inputs.runner }}']"],
    ['unapproved label', 'runs-on: [self-hosted, it-inventory-ephemeral]'],
    ['runner group', 'runs-on: {group: arbitrary, labels: it-inventory-light}'],
    ['missing routing', 'steps: []'],
    ['reusable workflow', 'uses: ./.github/workflows/ci.yml'],
    [
      'remote reusable workflow',
      'uses: owner/repo/.github/workflows/ci.yml@main',
    ],
    [
      'pilot expression outside reviewed job',
      `runs-on:\n      - self-hosted\n      - ${pilotLabel}`,
    ],
  ])('rejects a newly added workflow/job with %s', (_name, body) => {
    const futureWorkflow = `name: Newly added workflow\non: workflow_dispatch\njobs:\n  future_job:\n    ${body}\n`;
    expect(() => auditWorkflowRouting('future.yaml', futureWorkflow)).toThrow();
  });

  it('accepts fixed normal profiles for a new workflow but rejects an added hosted sibling job', () => {
    const futureWorkflow =
      'jobs:\n  future_job:\n    runs-on: [self-hosted, it-inventory-light]\n    steps:\n      - uses: actions/checkout@reviewed\n';
    expect(auditWorkflowRouting('future.yaml', futureWorkflow)).toBe(1);
    expect(() =>
      auditWorkflowRouting(
        'future.yaml',
        `${futureWorkflow}  overlooked_job:\n    runs-on: windows-latest\n`,
      ),
    ).toThrow('future.yaml:overlooked_job');
  });

  it('routes the four validation/preview jobs to fixed profiles without a hosted fallback or Actions cache', () => {
    const workflows = ['ci.yml', 'preview-access.yml'];
    const profiles = {
      required: 'heavy',
      production_database: 'light',
      discover: 'light',
      provision: 'light',
    };
    let jobs = 0;
    for (const name of workflows) {
      const workflow = readWorkflow(name);
      expect(workflow, name).not.toMatch(/\bcache:\s*npm|actions\/cache@/);
      const jobSource = workflow.split(/\r?\njobs:\r?\n/)[1];
      const definitions = [
        ...jobSource.matchAll(
          /^  ([\w-]+):\s*\r?\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm,
        ),
      ];
      expect(definitions.length, name).toBeGreaterThan(0);
      for (const [, job, body] of definitions) {
        expect(profiles[job], `${name}:${job}`).toBeDefined();
        expect(body.match(/^    runs-on:.*$/gm), `${name}:${job}`).toEqual([
          `    runs-on: [self-hosted, it-inventory-${profiles[job]}]`,
        ]);
      }
      expect(workflow, name).not.toContain('it-inventory-ephemeral');
      jobs += definitions.length;
    }
    expect(jobs).toBe(4);
  });

  it('isolates the pilot on a SHA-specific runner label without the generic assignment', () => {
    const pilotJobs = pilot.split(/\r?\njobs:\r?\n/)[1];
    expect(pilotJobs.match(/^  [\w-]+:\s*$/gm)).toEqual(['  pilot:']);
    expect(pilotJobs.match(/^    runs-on:[\s\S]*?(?=^    \S)/gm)).toEqual([
      "    runs-on:\n      - self-hosted\n      - ${{ format('it-inventory-pilot-{0}', github.event.pull_request.head.sha || github.sha) }}\n".replaceAll(
        '\n',
        pilot.includes('\r\n') ? '\r\n' : '\n',
      ),
    ]);
    expect(pilot).not.toContain('it-inventory-ephemeral');
    expect(pilot).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(pilot).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    );
  });

  it('makes only diagnostic uploads best-effort and preserves failing test gates', () => {
    const required = ci
      .split('  required:')[1]
      .split('  production_database:')[0];
    const artifact = required.split(
      '      - uses: actions/upload-artifact@',
    )[1];
    expect(artifact).toMatch(
      /id: failure_artifact[\s\S]*if: failure\(\) \|\| cancelled\(\)[\s\S]*continue-on-error: true/,
    );
    expect(artifact).toContain(
      "always() && steps.failure_artifact.outcome == 'failure'",
    );
    expect(artifact).toContain('::warning::Failure diagnostics');
    expect(required).toContain('run: npm run test:db');
    expect(required).toContain('run: npm run test:e2e');
    expect(required).toMatch(/if: always\(\)\s*\n\s*run: npm run db:stop/);
    expect(ci.match(/continue-on-error:/g)).toHaveLength(1);
    const workflow = load(ci);
    const steps = workflow.jobs.required.steps;
    const completion = steps.find(
      (step) => step.run === 'node scripts/ci-gates.mjs',
    );
    expect(completion.if).toBe('always()');
    for (const gate of foundationGates) {
      const step = steps.find((entry) => entry.id === gate);
      expect(step, gate).toBeDefined();
      expect(step['continue-on-error'], gate).not.toBe(true);
      expect(completion.env['FOUNDATION_' + gate.toUpperCase()]).toBe(
        '${{ steps.' + gate + '.outcome }}',
      );
    }
    expect(steps.filter((step) => step.run === 'npm ci')).toHaveLength(1);
    expect(steps.find((step) => step.id === 'app').run).toBe(
      'npm run validate:app',
    );
    expect(workflow.jobs.required.env).toBeUndefined();
    expect(steps.find((step) => step.id === 'app').env).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
      APP_ENV: 'ci',
    });
    expect(steps.find((step) => step.id === 'e2e').env).toBeUndefined();
    expect(workflow.jobs.required.environment).toBeUndefined();
    expect(JSON.stringify(workflow.jobs.required)).not.toContain('secrets.');
    expect(workflow.jobs.required.needs).toBeUndefined();
  });

  it('preserves exact-SHA and trusted-main secret boundaries', () => {
    expect(ci).toContain(
      'TESTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}',
    );
    expect(ci.match(/ref: \$\{\{ env\.TESTED_SHA \}\}/g)).toHaveLength(2);
    expect(ci).toContain('test "$(git rev-parse HEAD)" = "$TESTED_SHA"');
    expect(ci).toContain('environment: production-database');
    expect(ci).toContain('needs: [required]');
    expect(ci).toContain(
      "always() && github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(ci).toContain('run: test "$REQUIRED_RESULT" = success');
    expect(ci).not.toMatch(/paths(?:-ignore)?:/);
    expect(preview.match(/ref: refs\/heads\/main/g)).toHaveLength(2);
    expect(preview.match(/github.ref == 'refs\/heads\/main'/g)).toHaveLength(2);
    expect(preview).toContain('environment: preview-access');
    const discovery = preview.split('  discover:')[1].split('  provision:')[0];
    expect(discovery).not.toMatch(/\benvironment:|secrets\./);
  });
});

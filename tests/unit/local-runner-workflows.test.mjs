import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  foundationGates,
  foundationStepNames,
  workflowSourceStepPrefix,
} from '../../scripts/ci-gates.mjs';

const readWorkflow = (name) =>
  readFileSync(`.github/workflows/${name}`, 'utf8');
const ci = readWorkflow('ci.yml');
const preview = readWorkflow('preview-access.yml');
const pilot = readWorkflow('local-runner-pilot.yml');
const pilotLabel =
  "${{ format('it-inventory-pilot-{0}', github.event.pull_request.head.sha || github.sha) }}";
const reuseLabel =
  "${{ needs.reuse_evidence.result == 'success' && needs.reuse_evidence.outputs.reuse == 'true' && 'it-inventory-light' || 'it-inventory-heavy' }}";
const fullOnly = "needs.reuse_evidence.outputs.reuse != 'true'";
const profileLabels = new Set([
  'it-inventory-light',
  'it-inventory-mid',
  'it-inventory-heavy',
]);
const foundation = load(ci);
const npmSetup = foundation.jobs.required.steps.find(
  (step) => step.id === 'npm_setup',
).run;

function exerciseNpmSetup(version, probeStatus = 0, installStatus = 0) {
  const bash =
    process.platform === 'win32'
      ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe')
      : 'bash';
  // Exercise the real workflow shell with a function fixture; never invoke npm.
  return spawnSync(
    bash,
    [
      '--noprofile',
      '--norc',
      '-e',
      '-o',
      'pipefail',
      '-c',
      `npm() {
        if [ "$*" = '--version' ]; then
          printf '%s\\n' "$FIXTURE_NPM_VERSION"
          return "$FIXTURE_PROBE_STATUS"
        fi
        printf '%s\\n' "$*"
        return "$FIXTURE_INSTALL_STATUS"
      }
      ${npmSetup}`,
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        FIXTURE_NPM_VERSION: version,
        FIXTURE_PROBE_STATUS: String(probeStatus),
        FIXTURE_INSTALL_STATUS: String(installStatus),
      },
    },
  );
}

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
    const reviewedReuse =
      name === 'ci.yml' && jobName === 'required' && labels[1] === reuseLabel;
    if (!profileLabels.has(labels[1]) && !reviewedPilot && !reviewedReuse)
      throw new Error(`${identity}: unapproved runs-on`);
  }
  return Object.keys(workflow.jobs).length;
}

describe('disposable local runner workflow contracts', () => {
  it('pins every application Node setup to the checked-out exact version', () => {
    expect(readFileSync('.nvmrc', 'utf8').trim()).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of ['ci.yml', 'preview-access.yml', 'staging-sync.yml']) {
      const jobs = load(readWorkflow(name)).jobs;
      const setups = Object.values(jobs).flatMap((job) =>
        (job.steps ?? []).filter((step) =>
          step.uses?.startsWith('actions/setup-node@'),
        ),
      );
      expect(setups.length, name).toBeGreaterThan(0);
      for (const setup of setups) {
        expect(setup.with['node-version-file'], name).toBe('.nvmrc');
        expect(setup.with['node-version'], name).toBeUndefined();
        expect(setup.with.cache, name).toBeUndefined();
        expect(setup.with['package-manager-cache'], name).toBe(false);
      }
    }
  });

  it.each(['required', 'production_database'])(
    'retains a fresh lockfile install whenever full %s validation runs',
    (name) => {
      const steps = foundation.jobs[name].steps;
      const installs = steps.filter((step) => /^npm ci\b/.test(step.run ?? ''));
      expect(installs).toHaveLength(1);
      expect(installs[0].run).toBe('npm ci --prefer-offline');
      expect(installs[0].if).toBe(name === 'required' ? fullOnly : undefined);
      expect(installs[0]['continue-on-error']).toBeUndefined();
      expect(steps.find((step) => step.run?.includes('npm@11.11.0')).run).toBe(
        npmSetup,
      );
    },
  );

  it.each([
    ['11.11.0', 0, ''],
    ['11.10.0', 0, 'install --global npm@11.11.0\n'],
    ['', 1, 'install --global npm@11.11.0\n'],
    ['11.11.0', 1, 'install --global npm@11.11.0\n'],
  ])(
    'sets up exact npm from version %s and probe status %s',
    (version, status, output) => {
      const result = exerciseNpmSetup(version, status);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(output);
    },
  );

  it('fails npm setup when the required version cannot be installed', () => {
    const result = exerciseNpmSetup('11.10.0', 0, 23);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(23);
    expect(result.stdout).toBe('install --global npm@11.11.0\n');
  });

  it('keeps browser preparation mandatory on the full path with a verified-cache helper', () => {
    const browser = foundation.jobs.required.steps.find(
      (step) => step.id === 'browser_install',
    );
    expect(browser.run).toBe('node scripts/install-ci-browser.mjs');
    expect(browser.if).toBe(fullOnly);
    expect(browser['continue-on-error']).toBeUndefined();
  });

  it.each([
    [0, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 27, 27, undefined],
  ])(
    'reuses the exact pilot image or pulls a miss (%s, %s)',
    (cachedStatus, pullStatus, status, pulls) => {
      const run = load(pilot).jobs.pilot.steps.find((step) =>
        step.run?.includes('docker pull'),
      ).run;
      const image = run.match(/image='(alpine@sha256:[a-f0-9]{64})'/)[1];
      const fragment = run.match(
        /if ! timeout 30s docker image inspect[^]*?\n\s*fi/,
      )[0];
      const bash =
        process.platform === 'win32'
          ? join(process.env.ProgramFiles, 'Git/bin/bash.exe')
          : 'bash';
      const result = spawnSync(
        bash,
        [
          '--noprofile',
          '--norc',
          '-e',
          '-o',
          'pipefail',
          '-c',
          `
      pulls=0
      timeout() { shift; "$@"; }
      docker() {
        if [ "$1" = image ]; then return "$FIXTURE_CACHED_STATUS"; fi
        if [ "$1" = pull ]; then pulls=$((pulls+1)); return "$FIXTURE_PULL_STATUS"; fi
        return 99
      }
      image='${image}'
      ${fragment}
      printf '%s' "$pulls"
    `,
        ],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            FIXTURE_CACHED_STATUS: String(cachedStatus),
            FIXTURE_PULL_STATUS: String(pullStatus),
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(status);
      if (pulls !== undefined) expect(result.stdout).toBe(String(pulls));
      expect(run).toContain('docker create --name "$container"');
      expect(run).toContain('docker start --attach "$container"');
      expect(run).toContain('docker rm "$container"');
    },
  );

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

  it('routes validation/preview jobs to reviewed profiles without a hosted fallback or Actions cache', () => {
    const workflows = ['ci.yml', 'preview-access.yml'];
    const profiles = {
      required: 'dynamic',
      reuse_evidence: 'light',
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
        if (job === 'required')
          expect(load(workflow).jobs.required['runs-on']).toEqual([
            'self-hosted',
            reuseLabel,
          ]);
        else
          expect(body.match(/^    runs-on:.*$/gm), `${name}:${job}`).toEqual([
            `    runs-on: [self-hosted, it-inventory-${profiles[job]}]`,
          ]);
      }
      expect(workflow, name).not.toContain('it-inventory-ephemeral');
      jobs += definitions.length;
    }
    expect(jobs).toBe(5);
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

  it('supersedes older pilot runs per PR while keeping PRs and manual main dispatches separate', () => {
    const { concurrency } = load(pilot);
    const expression = '${{ github.event.pull_request.number || github.ref }}';
    expect(concurrency).toEqual({
      group: `local-runner-pilot-${expression}`,
      'cancel-in-progress': true,
    });

    const groupFor = ({ pullRequestNumber, ref }) =>
      concurrency.group.replace(expression, String(pullRequestNumber || ref));
    expect(
      groupFor({
        pullRequestNumber: 53,
        ref: 'refs/pull/53/merge',
        headSha: 'older-head-sha',
      }),
    ).toBe(
      groupFor({
        pullRequestNumber: 53,
        ref: 'refs/pull/53/merge',
        headSha: 'newer-head-sha',
      }),
    );
    expect(
      groupFor({ pullRequestNumber: 54, ref: 'refs/pull/54/merge' }),
    ).not.toBe(groupFor({ pullRequestNumber: 53, ref: 'refs/pull/53/merge' }));
    expect(groupFor({ ref: 'refs/heads/main' })).toBe(
      'local-runner-pilot-refs/heads/main',
    );
    expect(pilot).not.toMatch(/uses:\s*actions\/checkout@|secrets\./);
  });

  it('makes only diagnostics and future-reuse inspection best-effort and preserves failing test gates', () => {
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
    expect(required).toMatch(
      /if: \$\{\{ always\(\) && needs.reuse_evidence.outputs.reuse != 'true' \}\}\s*\n\s*run: npm run db:stop/,
    );
    expect(ci.match(/continue-on-error:/g)).toHaveLength(2);
    const workflow = load(ci);
    const steps = workflow.jobs.required.steps;
    const sourceInspection = steps.find(
      (step) => step.id === 'workflow_source_inspection',
    );
    const sourceMarker = steps.find((step) => step.id === 'workflow_source');
    expect(sourceInspection['continue-on-error']).toBe(true);
    expect(sourceInspection.if).toBe(fullOnly);
    expect(sourceInspection.run).toBe(
      'node scripts/ci-reuse.mjs --workflow-source',
    );
    expect(sourceMarker.if).toBe(
      fullOnly +
        " && steps.workflow_source_inspection.outcome == 'success' && steps.workflow_source_inspection.outputs.verified == 'true'",
    );
    expect(sourceMarker.name).toBe(
      workflowSourceStepPrefix + '${{ github.workflow_sha }}',
    );
    expect(sourceMarker['continue-on-error']).toBeUndefined();
    const completion = steps.find(
      (step) => step.run === 'node scripts/ci-gates.mjs',
    );
    expect(completion.if).toBe(
      "${{ always() && needs.reuse_evidence.outputs.reuse != 'true' }}",
    );
    for (const gate of foundationGates) {
      const step = steps.find((entry) => entry.id === gate);
      expect(step, gate).toBeDefined();
      expect(step['continue-on-error'], gate).not.toBe(true);
      expect(step.name, gate).toBe(
        gate === 'workflow_source'
          ? workflowSourceStepPrefix + '${{ github.workflow_sha }}'
          : foundationStepNames[gate],
      );
      expect(step.if, gate).toBe(
        ['checkout', 'node_setup'].includes(gate)
          ? undefined
          : gate === 'db_stop'
            ? "${{ always() && needs.reuse_evidence.outputs.reuse != 'true' }}"
            : fullOnly,
      );
      expect(completion.env['FOUNDATION_' + gate.toUpperCase()]).toBe(
        '${{ steps.' + gate + '.outcome }}',
      );
    }
    expect(
      steps.filter((step) => step.run === 'npm ci --prefer-offline'),
    ).toHaveLength(1);
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
    expect(workflow.jobs.required.needs).toEqual(['reuse_evidence']);
    expect(workflow.jobs.required.if).toBe('${{ always() && !cancelled() }}');
    const decision = steps.find(
      (step) => step.run === 'node scripts/ci-required.mjs',
    );
    expect(decision.if).toBe('always()');
    expect(steps.find((step) => step.id === 'recheck').run).toBe(
      'node scripts/ci-reuse.mjs --reverify',
    );
    expect(steps.find((step) => step.id === 'recheck').if).toBe(
      "needs.reuse_evidence.outputs.reuse == 'true'",
    );
    expect(workflow.jobs.reuse_evidence.if).toBe(
      "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    );
    expect(workflow.jobs.reuse_evidence.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      'pull-requests': 'read',
    });
    expect(workflow.jobs.required.permissions).toEqual(
      workflow.jobs.reuse_evidence.permissions,
    );
  });

  it('preserves exact-SHA and trusted-main secret boundaries', () => {
    expect(ci).toContain(
      'TESTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}',
    );
    expect(ci.match(/ref: \$\{\{ env\.TESTED_SHA \}\}/g)).toHaveLength(3);
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

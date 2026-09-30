import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readWorkflow = (name) =>
  readFileSync(`.github/workflows/${name}`, 'utf8');
const ci = readWorkflow('ci.yml');
const preview = readWorkflow('preview-access.yml');
const pilot = readWorkflow('local-runner-pilot.yml');

describe('disposable local runner workflow contracts', () => {
  it('routes all six normal jobs to their fixed resource profiles without a hosted fallback or Actions cache', () => {
    const workflows = readdirSync('.github/workflows').filter((name) =>
      /\.ya?ml$/.test(name),
    );
    expect(workflows.sort()).toEqual([
      'ci.yml',
      'local-runner-pilot.yml',
      'preview-access.yml',
    ]);
    const profiles = {
      app: 'mid',
      database: 'heavy',
      required: 'light',
      production_database: 'light',
      discover: 'light',
      provision: 'light',
    };
    let jobs = 0;
    for (const name of workflows) {
      const workflow = readWorkflow(name);
      expect(workflow, name).not.toMatch(/\bcache:\s*npm|actions\/cache@/);
      if (name === 'local-runner-pilot.yml') continue;
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
    expect(jobs).toBe(6);
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
    const database = ci.split('  database:')[1].split('  required:')[0];
    const artifact = database.split(
      '      - uses: actions/upload-artifact@',
    )[1];
    expect(artifact).toMatch(
      /id: failure_artifact[\s\S]*if: failure\(\) \|\| cancelled\(\)[\s\S]*continue-on-error: true/,
    );
    expect(artifact).toContain(
      "always() && steps.failure_artifact.outcome == 'failure'",
    );
    expect(artifact).toContain('::warning::Failure diagnostics');
    expect(database).toContain('run: npm run test:db');
    expect(database).toContain('run: npm run test:e2e');
    expect(database).toMatch(/if: always\(\)\s*\n\s*run: npm run db:stop/);
    expect(ci.match(/continue-on-error:/g)).toHaveLength(1);
    expect(ci).toContain('needs: [app, database]');
    expect(ci).toContain('test "$APP_RESULT" = success');
    expect(ci).toContain('test "$DATABASE_RESULT" = success');
  });

  it('preserves exact-SHA and trusted-main secret boundaries', () => {
    expect(ci).toContain(
      'TESTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}',
    );
    expect(ci.match(/ref: \$\{\{ env\.TESTED_SHA \}\}/g)).toHaveLength(3);
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

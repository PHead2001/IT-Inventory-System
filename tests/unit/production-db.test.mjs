import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deliverDatabase,
  parseMigrationList,
  PRODUCTION_PROJECT_REF,
} from '../../scripts/production-db.mjs';

const sha = 'a'.repeat(40);
const files = [
  '20260904000100_foundation.sql',
  '20260904000200_reference_data.sql',
];
const validEnv = {
  ENABLE_PRODUCTION_DB_DELIVERY: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'PHead2001/IT-Inventory-System',
  GITHUB_SHA: sha,
  TESTED_SHA: sha,
  SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF,
  SUPABASE_ACCESS_TOKEN: 'test-token',
  SUPABASE_DB_PASSWORD: 'test-password',
};

function history(remote) {
  return [
    ' LOCAL │ REMOTE │ TIME (UTC)',
    ...files.map((file) => {
      const version = file.slice(0, 14);
      return `${version} │ ${remote.includes(version) ? version : ''} │ 2026-09-04 00:00:00`;
    }),
  ].join('\n');
}

function harness(
  outputs = [
    history([]),
    history([]),
    history(files.map((file) => file.slice(0, 14))),
  ],
) {
  const commands = [];
  let list = 0;
  const run = (command, args) => {
    commands.push([command, ...args]);
    if (command === 'git') return sha;
    if (args.includes('list')) return outputs[list++];
    return '';
  };
  const deliver = (env = validEnv) =>
    deliverDatabase({ env, run, migrationFiles: () => files });
  return { commands, deliver };
}

describe('production database delivery', () => {
  it('fails closed before linking for disabled, missing or wrong target and untrusted context', () => {
    for (const change of [
      { ENABLE_PRODUCTION_DB_DELIVERY: 'false' },
      { ENABLE_PRODUCTION_DB_DELIVERY: undefined },
      { SUPABASE_ACCESS_TOKEN: undefined },
      { SUPABASE_DB_PASSWORD: undefined },
      { SUPABASE_PROJECT_REF: 'another-project' },
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_REF: 'refs/heads/other' },
      { GITHUB_REPOSITORY: 'someone/fork' },
      { TESTED_SHA: 'b'.repeat(40) },
    ]) {
      const { commands, deliver } = harness();
      expect(() => deliver({ ...validEnv, ...change })).toThrow();
      expect(commands.some((args) => args.includes('link'))).toBe(false);
    }
  });

  it('links the pinned project, checks unchanged history, applies only forward migrations, and verifies', () => {
    const { commands, deliver } = harness();
    expect(deliver()).toBe(`Production database ready at ${sha}`);
    expect(commands.filter((args) => args.includes('list'))).toHaveLength(3);
    expect(commands.filter((args) => args.includes('push'))).toHaveLength(2);
    expect(commands[1]).toContain(PRODUCTION_PROJECT_REF);
    for (const args of commands) {
      expect(args.join(' ')).not.toMatch(
        /--include-all|--include-seed|--include-roles|repair|reset/,
      );
      expect(args.join(' ')).not.toContain(validEnv.SUPABASE_DB_PASSWORD);
    }
    expect(
      commands.find(
        (args) => args.includes('push') && args.includes('--dry-run'),
      ),
    ).toContain('--skip-vault');
  });

  it('stops before apply if dry-run fails or history changes before push', () => {
    const failingCommands = [];
    expect(() =>
      deliverDatabase({
        env: validEnv,
        migrationFiles: () => files,
        run: (command, args) => {
          failingCommands.push([command, ...args]);
          if (command === 'git') return sha;
          if (args.includes('--dry-run')) throw new Error('CLI failed');
          return args.includes('list') ? history([]) : '';
        },
      }),
    ).toThrow('CLI failed');
    expect(
      failingCommands.filter((args) => args.includes('push')),
    ).toHaveLength(1);
    const drift = harness([history([]), history([files[0].slice(0, 14)])]);
    expect(() => drift.deliver()).toThrow('changed before apply');
    expect(drift.commands.filter((args) => args.includes('push'))).toHaveLength(
      1,
    );
  });

  it('rejects remote-only, out-of-order and incomplete histories', () => {
    const extra = `${history([])}\n │ 20260903000000 │ 2026-09-03 00:00:00`;
    const wrong = history([files[1].slice(0, 14)]);
    for (const output of [extra, wrong]) {
      const scenario = harness([output]);
      expect(() => scenario.deliver()).toThrow();
      expect(scenario.commands.some((args) => args.includes('push'))).toBe(
        false,
      );
    }
    const incomplete = harness([
      history([]),
      history([]),
      history([files[0].slice(0, 14)]),
    ]);
    expect(() => incomplete.deliver()).toThrow('not fully applied');
    expect(
      incomplete.commands.filter((args) => args.includes('push')),
    ).toHaveLength(2);
    expect(() => parseMigrationList('unexpected CLI output')).toThrow();
  });

  it('keeps the PR aggregate independent and gates main readiness on its success', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('needs: [required]');
    expect(workflow).toContain(
      "always() && github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(workflow).toContain('REQUIRED_RESULT: ${{ needs.required.result }}');
    expect(workflow).toContain('run: test "$REQUIRED_RESULT" = success');
    expect(workflow).toContain(
      "github.event_name == 'push' && 'Production database ready'",
    );
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(workflow).not.toMatch(/paths(?:-ignore)?:/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { pushedCommits, runPrePush } from '../../scripts/pre-push.mjs';
import { installGitHooks } from '../../scripts/install-git-hooks.mjs';

const head = 'a'.repeat(40);
const other = 'b'.repeat(40);
const zero = '0'.repeat(40);
const update = (sha = head, remote = 'refs/heads/feature') =>
  `refs/heads/feature ${sha} ${remote} ${zero}\n`;

function fixture({ heads = [head, head], statuses = ['', ''] } = {}) {
  const validate = vi.fn();
  const git = vi.fn((args) =>
    args[0] === 'rev-parse' ? heads.shift() : statuses.shift(),
  );
  return { validate, git };
}

describe('repository-local pre-push validation', () => {
  it('runs the cheap gate once for all refs at the exact current clean HEAD', () => {
    const f = fixture();
    runPrePush({ ...f, input: update() + update(head, 'refs/heads/another') });
    expect(f.validate).toHaveBeenCalledOnce();
    expect(f.git.mock.calls.map(([args]) => args[0])).toEqual([
      'rev-parse',
      'status',
      'rev-parse',
      'status',
    ]);
  });

  it('permits clone/no-updates and deletion-only pushes without running checks', () => {
    for (const input of ['', update(zero)]) {
      const f = fixture();
      runPrePush({ ...f, input });
      expect(f.validate).not.toHaveBeenCalled();
      expect(f.git).not.toHaveBeenCalled();
    }
  });

  it('checks a mixed deletion/update push and allows an exact-HEAD main ref', () => {
    const f = fixture();
    runPrePush({ ...f, input: update(zero) + update(head, 'refs/heads/main') });
    expect(f.validate).toHaveBeenCalledOnce();
  });

  it('rejects any pushed revision that was not checked out', () => {
    const f = fixture();
    expect(() => runPrePush({ ...f, input: update() + update(other) })).toThrow(
      'checked-out HEAD',
    );
    expect(f.validate).not.toHaveBeenCalled();
  });

  it.each([' M file', 'M  file', '?? new-file'])(
    'rejects dirty or staged input %s before validating the wrong bytes',
    (status) => {
      const f = fixture({ statuses: [status] });
      expect(() => runPrePush({ ...f, input: update() })).toThrow(
        'clean worktree',
      );
      expect(f.validate).not.toHaveBeenCalled();
    },
  );

  it('propagates failed validation to prevent the push', () => {
    const f = fixture();
    f.validate.mockImplementation(() => {
      throw new Error('gate failed');
    });
    expect(() => runPrePush({ ...f, input: update() })).toThrow('gate failed');
    expect(f.git).toHaveBeenCalledTimes(2);
  });

  it('rejects HEAD or working file changes made during validation', () => {
    for (const f of [
      fixture({ heads: [head, other] }),
      fixture({ statuses: ['', ' M changed'] }),
    ])
      expect(() => runPrePush({ ...f, input: update() })).toThrow(
        /HEAD changed|clean worktree/,
      );
  });

  it.each([
    'bad input',
    `refs/heads/x nope refs/heads/x ${zero}`,
    update().trim() + ' extra',
  ])('fails closed on malformed ref input %s', (input) =>
    expect(() => pushedCommits(input)).toThrow('Invalid pre-push'),
  );

  it('keeps the opt-in separate from install/build and the cheap gate free of builds/databases/browser work', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['validate:push']).toBe(
      'npm run typecheck && npm run lint && npm run format:check && npm run test',
    );
    expect(pkg.scripts['hooks:install']).toBe(
      'node scripts/install-git-hooks.mjs',
    );
    expect(pkg.scripts.postinstall).not.toMatch(/hook|git config/);
    expect(readFileSync('.githooks/pre-push', 'utf8')).toBe(
      '#!/bin/sh\nexec npm run --silent validate:push:hook\n',
    );
  });
});

describe('explicit hook installation', () => {
  const fixture = ({
    configured = '',
    entries = [],
    cwd = '/repo',
    effectiveAfterWrite = '.githooks',
  } = {}) => {
    let current = configured;
    return {
      cwd,
      realpath: (value) => value,
      exists: (path) =>
        path === '/repo/.git/hooks' ||
        (path === '/repo/.git/hooks/pre-push' && entries.includes('pre-push')),
      list: vi.fn(() => entries),
      git: vi.fn((args) => {
        if (args[0] === 'config') {
          if (args.includes('--local')) {
            current = effectiveAfterWrite;
            return '';
          }
          return current;
        }
        return args.includes('--show-toplevel')
          ? '/repo'
          : '/repo/.git/' + args[2];
      }),
    };
  };

  it('writes only repository-local configuration after explicit installation', () => {
    const f = fixture();
    installGitHooks(f);
    expect(f.git).toHaveBeenCalledWith([
      'config',
      '--local',
      'core.hooksPath',
      '.githooks',
    ]);
  });

  it.each(['pre-commit', 'commit-msg', 'pre-rebase', 'unknown-hook-backup'])(
    'refuses an existing default %s even without pre-push',
    (name) => {
      const f = fixture({ entries: [name] });
      expect(() => installGitHooks(f)).toThrow('existing');
      expect(f.git.mock.calls.some(([args]) => args.includes('--local'))).toBe(
        false,
      );
    },
  );

  it('allows only default sample entries and reads the resolved hook directory', () => {
    const f = fixture({
      entries: ['pre-commit.sample', 'commit-msg.sample', 'pre-push.sample'],
    });
    installGitHooks(f);
    expect(f.list).toHaveBeenCalledWith('/repo/.git/hooks');
    expect(f.git).toHaveBeenCalledWith([
      'config',
      '--local',
      'core.hooksPath',
      '.githooks',
    ]);
  });

  it('is idempotent for the existing opt-in without touching inactive default hooks', () => {
    const f = fixture({ configured: '.githooks', entries: ['pre-commit'] });
    expect(() => installGitHooks(f)).not.toThrow();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.git).toHaveBeenLastCalledWith([
      'config',
      '--get',
      'core.hooksPath',
    ]);
  });

  it('verifies the effective path after writing and refuses a conflicting override', () => {
    const f = fixture({ effectiveAfterWrite: '/worktree-hooks' });
    expect(() => installGitHooks(f)).toThrow('effective path differs');
    expect(
      f.git.mock.calls.filter(([args]) => args.includes('--local')),
    ).toHaveLength(1);
    expect(f.git).toHaveBeenLastCalledWith([
      'config',
      '--get',
      'core.hooksPath',
    ]);
  });

  it.each([
    { configured: '/custom' },
    { entries: ['pre-push'] },
    { cwd: '/another' },
  ])('preserves an existing hook or unrelated checkout %j', (options) => {
    const f = fixture(options);
    expect(() => installGitHooks(f)).toThrow();
    expect(f.git.mock.calls.some(([args]) => args.includes('--local'))).toBe(
      false,
    );
  });
});

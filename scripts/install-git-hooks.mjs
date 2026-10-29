import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function installGitHooks({
  git,
  exists = existsSync,
  list = readdirSync,
  cwd = process.cwd(),
  realpath = realpathSync,
}) {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  if (realpath(root) !== realpath(cwd))
    throw new Error('Install hooks from the repository root.');
  const configured = git(['config', '--get', 'core.hooksPath'], true).trim();
  if (configured && configured !== '.githooks')
    throw new Error(
      'An existing hooksPath is configured. Integrate the pre-push hook explicitly before changing it.',
    );
  if (!configured) {
    const hooks = git(['rev-parse', '--git-path', 'hooks']).trim();
    // Changing hooksPath disables every default hook. Conservatively preserve
    // all non-sample entries, without guessing platform execution semantics.
    if (exists(hooks) && list(hooks).some((name) => !name.endsWith('.sample')))
      throw new Error(
        'An existing default hook must be integrated explicitly before installation.',
      );
  }
  git(['config', '--local', 'core.hooksPath', '.githooks']);
  if (git(['config', '--get', 'core.hooksPath']).trim() !== '.githooks')
    throw new Error(
      'Repository-local hooksPath was set, but the effective path differs. Review worktree or command configuration before relying on push checks.',
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    installGitHooks({
      git: (args, allowMissing = false) => {
        const result = spawnSync('git', args, { encoding: 'utf8' });
        if (
          result.error ||
          (result.status !== 0 && !(allowMissing && result.status === 1))
        )
          throw new Error('Local hook installation failed.');
        return result.stdout;
      },
    });
    console.log(
      'Repository-local hooksPath set; effective .githooks verified in this worktree.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

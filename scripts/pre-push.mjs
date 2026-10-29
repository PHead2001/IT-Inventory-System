import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { npm } from './runtime.mjs';

const objectId = /^[0-9a-f]{40}$/;
const deleted = '0'.repeat(40);

export function pushedCommits(input) {
  if (typeof input !== 'string') throw new Error('Invalid pre-push input.');
  return input
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const fields = line.split(' ');
      if (
        fields.length !== 4 ||
        !fields[0] ||
        !fields[2]?.startsWith('refs/') ||
        !objectId.test(fields[1]) ||
        !objectId.test(fields[3])
      )
        throw new Error('Invalid pre-push ref update.');
      return fields[1];
    })
    .filter((sha) => sha !== deleted);
}

export function runPrePush({ input, git, validate }) {
  const commits = pushedCommits(input);
  if (!commits.length) return;
  const head = git(['rev-parse', '--verify', 'HEAD']).trim();
  if (!objectId.test(head) || commits.some((sha) => sha !== head))
    throw new Error(
      'Push checks require every updated ref to point to the checked-out HEAD. Check out the revision being pushed first.',
    );
  const requireClean = () => {
    if (git(['status', '--porcelain', '--untracked-files=normal']).trim())
      throw new Error(
        'Push checks require a clean worktree, including staged changes and untracked files. Commit or stash changes first.',
      );
  };
  requireClean();
  validate();
  if (git(['rev-parse', '--verify', 'HEAD']).trim() !== head)
    throw new Error('HEAD changed during push checks. Run the push again.');
  requireClean();
}

export function gitOutput(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0)
    throw new Error('Local Git check failed.');
  return result.stdout;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    runPrePush({
      input: readFileSync(0, 'utf8'),
      git: gitOutput,
      validate: () => npm(['run', 'validate:push']),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

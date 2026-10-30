import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const runDefault = ({ executable, args, cwd }) =>
  new Promise((done) => {
    execFile(
      executable,
      args,
      { cwd, windowsHide: true, timeout: 10000, maxBuffer: 8192 },
      (error, stdout, stderr) =>
        done({
          status: error
            ? Number.isInteger(error.code)
              ? error.code
              : null
            : 0,
          stdout,
          stderr,
          cleanup_proven: !error?.killed,
        }),
    );
  });

export async function runPreparedStageTests({
  sourceRoot = here,
  fixtureRoot = tmpdir(),
  runCase = runDefault,
} = {}) {
  const source = (
    await readFile(join(sourceRoot, 'Image.Prepare.sh'), 'utf8')
  ).replaceAll('\r\n', '\n');
  const prefix = source.slice(0, source.indexOf('[[ $# == 0'));
  if (
    !prefix.includes('trap image_failure_exit EXIT') ||
    prefix.includes('BASH_COMMAND')
  )
    throw Error('IMAGE_STAGE_PREFIX');
  const stages = [...source.matchAll(/^image_stage=([a-z-]+)$/gm)].map(
    (m) => m[1],
  );
  if (new Set(stages).size !== 12) throw Error('IMAGE_STAGE_COVERAGE');
  const browserInstall = source.match(
    /^image_stage=browser-install\n([^\n]+)$/m,
  )?.[1];
  if (!browserInstall?.includes('node_modules/playwright/cli.js install'))
    throw Error('IMAGE_BROWSER_INSTALL_COMMAND');
  const root = join(fixtureRoot, `ITIR-stage-${randomUUID()}`);
  await mkdir(root);
  let cleanupSafe = true;
  const results = [];
  try {
    const cases = stages.map((stage) => ({
      name: stage,
      body: `image_stage=${stage}\nexit 7`,
      code: 7,
      stage,
    }));
    cases.push(
      { name: 'success', body: 'exit 0', code: 0, stage: null },
      {
        name: 'unknown',
        body: 'image_stage=PRIVATE_SECRET\nexit 7',
        code: 7,
        stage: 'unknown',
      },
      {
        name: 'command-substitution',
        body: 'image_stage=node\nvalue=$(exit 9)',
        code: 9,
        stage: 'node',
      },
      {
        name: 'pipeline',
        body: 'image_stage=npm\nfalse | true',
        code: 1,
        stage: 'npm',
      },
      {
        name: 'cleanup-fails',
        body: 'image_cleanup=true\nrm(){ return 3; }\nexit 0',
        code: 1,
        stage: 'cleanup',
      },
      {
        name: 'cleanup-preserves-failure',
        body: 'image_stage=inputs\nimage_cleanup=true\nrm(){ return 3; }\nexit 7',
        code: 7,
        stage: 'inputs',
      },
    );
    for (const [prior, code] of [
      [null, 0],
      ['30000', 0],
      ['30000', 23],
      [null, 124],
    ]) {
      cases.push({
        name: `browser-command-${prior ?? 'unset'}-${code}`,
        body: `${prior === null ? 'unset PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT' : 'export PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=' + prior}
timeout() { [[ $1 == 900 ]] || return 81; shift; "$@"; }
node() {
  [[ \${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT-unset} == 120000 ]] || return 82
  [[ $# == 5 && $1 == node_modules/playwright/cli.js && $2 == install && $3 == --with-deps && $4 == --only-shell && $5 == chromium ]] || return 83
  return ${code}
}
image_stage=browser-install
${browserInstall}
[[ \${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT-unset} == ${prior ?? 'unset'} ]] || exit 84
exit 0`,
        code,
        stage: code === 0 ? null : 'browser-install',
      });
    }
    for (const test of cases) {
      const path = join(root, `${test.name}.sh`);
      await writeFile(path, `${prefix}\n${test.body}\n`);
      const result = await runCase({
        name: test.name,
        executable:
          process.platform === 'win32'
            ? 'C:/Program Files/Git/usr/bin/bash.exe'
            : '/bin/bash',
        args: ['--noprofile', '--norc', path],
        cwd: root,
      });
      if (!result.cleanup_proven || result.recoveryRequired) {
        cleanupSafe = false;
        throw Error('IMAGE_STAGE_CHILD_UNCLOSED');
      }
      const expected = test.stage
        ? `\nITIR_IMAGE_FAILURE_STAGE=${test.stage}\n`
        : '';
      if (
        result.status !== test.code ||
        result.stdout ||
        result.stderr !== expected
      )
        throw Error('IMAGE_STAGE_RESULT');
      results.push({
        name: test.name,
        exit: result.status,
        stage: test.stage,
        cleanupProven: true,
      });
    }
    return { success: true, cases: results };
  } finally {
    if (cleanupSafe) await rm(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await runPreparedStageTests()));
  } catch {
    console.error('IMAGE_STAGE_TEST_FAILED');
    process.exitCode = 1;
  }
}

// Execute actual PS-generated readiness commands with Bash functions only.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
const shellLiteral = (value) =>
  `'${value.replaceAll('\\', '/').replaceAll("'", `'"'"'`)}'`;
async function runDefault({ executable, args, cwd }) {
  return await new Promise((resolveResult) =>
    execFile(
      executable,
      args,
      { cwd, windowsHide: true, timeout: 10000, maxBuffer: 8192 },
      (error, stdout, stderr) =>
        resolveResult({
          status: error
            ? Number.isInteger(error.code)
              ? error.code
              : null
            : 0,
          stdout,
          stderr,
          stopped: Boolean(error?.killed),
          cleanup_proven: true,
        }),
    ),
  );
}
export async function runReadinessShellTests({
  sourceRoot = here,
  runCase = runDefault,
  onlyCases = null,
} = {}) {
  const bash = 'C:/Program Files/Git/bin/bash.exe';
  try {
    await access(bash);
  } catch {
    throw Error('READINESS_GIT_BASH_UNAVAILABLE');
  }
  const root = resolve(
    tmpdir(),
    `ITIR-readiness-shell-${randomUUID().replaceAll('-', '')}`,
  );
  await mkdir(root);
  let cleanupSafe = true;
  const results = [];
  try {
    const generator = join(root, 'generate.ps1');
    const generated = join(root, 'commands.json');
    await writeFile(
      generator,
      `Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
foreach ($file in @('Common.ps1','Runner.ps1')) {
  $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path ${psLiteral(sourceRoot)} $file),[ref]$null,[ref]$errors)
  if ($errors.Count) { throw 'READINESS_SOURCE_PARSE' }
  foreach ($node in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
    if ($node.Name -cin @('Get-RunnerResourceProfile','Get-RunnerGuestMtu','Get-RunnerGuestPrerequisites','Get-RunnerGuestReadinessCommand')) { . ([scriptblock]::Create($node.Extent.Text)) }
  }
}
$commands=[ordered]@{light=(Get-RunnerGuestReadinessCommand 'it-inventory-light');mid=(Get-RunnerGuestReadinessCommand 'it-inventory-mid');heavy=(Get-RunnerGuestReadinessCommand 'it-inventory-heavy');legacy=(Get-RunnerGuestReadinessCommand 'it-inventory-ephemeral');pilot=(Get-RunnerGuestReadinessCommand ('it-inventory-pilot-'+('a'*40)))}
[IO.File]::WriteAllText(${psLiteral(generated)},(ConvertTo-Json -InputObject $commands -Compress),[Text.UTF8Encoding]::new($false))
`,
    );
    const invoke = async (mode, executable, args) => {
      const value = await runCase({ mode, executable, args, cwd: root });
      if (value.cleanup_proven === false || value.recoveryRequired) {
        cleanupSafe = false;
        throw Error('READINESS_CHILD_CLOSURE_UNPROVEN');
      }
      return value;
    };
    const generation = await invoke(
      'generate',
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        generator,
      ],
    );
    if (
      generation.status !== 0 ||
      generation.stopped ||
      generation.stdout ||
      generation.stderr
    )
      throw Error('READINESS_GENERATION_FAILED');
    const commands = JSON.parse(await readFile(generated, 'utf8'));
    if (
      commands.light !== commands.mid ||
      commands.heavy !== commands.legacy ||
      commands.heavy !== commands.pilot
    )
      throw Error('READINESS_PROFILE_FAMILY_CHANGED');
    const stages = [
      'cloud25',
      'id',
      'curl',
      'git',
      'unzip',
      'mtu',
      'socket',
      'docker10',
    ];
    const cases = [
      ['cloud-timeout', 71, stages.slice(0, 1)],
      ['cloud-nonzero', 72, stages.slice(0, 1)],
      ['wrong-user', 73, stages.slice(0, 2)],
      ['missing-curl', 74, stages.slice(0, 3)],
      ['missing-git', 75, stages.slice(0, 4)],
      ['missing-unzip', 76, stages.slice(0, 5)],
      ['missing-mtu', 80, stages.slice(0, 6)],
      ['wrong-mtu', 80, stages.slice(0, 6)],
      ['malformed-mtu', 80, stages.slice(0, 6)],
      ['empty-mtu', 80, stages.slice(0, 6)],
      ['light-missing-mtu', 80, stages.slice(0, 6)],
      ['missing-socket', 77, stages.slice(0, 7)],
      ['docker-timeout', 78, stages],
      ['docker-nonzero', 79, stages],
      ['heavy-passed', 0, stages],
      ['pilot-passed', 0, stages],
      ['light-passed', 0, stages.slice(0, 6)],
      ['light-no-docker', 0, stages.slice(0, 6)],
    ];
    for (const [mode, expectedExit, expectedStages] of cases) {
      if (onlyCases && !onlyCases.includes(mode)) continue;
      const trace = join(root, `${mode}.trace`);
      const fixture = join(root, `${mode}.sh`);
      const command = mode.startsWith('light-')
        ? commands.light
        : mode.startsWith('pilot-')
          ? commands.pilot
          : commands.heavy;
      await writeFile(
        fixture,
        `set +e
trace=${shellLiteral(trace)}
mode=${shellLiteral(mode)}
timeout() {
  if [[ "$#:$1:$2:$3:$4" = '4:25:cloud-init:status:--wait' ]]; then
    builtin printf 'cloud25\\n' >> "$trace"
    builtin printf 'PRIVATE_SENTINEL\\n' >&2
    [[ "$mode" = cloud-timeout ]] && return 124
    [[ "$mode" = cloud-nonzero ]] && return 2
    return 0
  elif [[ "$#:$1:$2:$3" = '3:10:docker:info' ]]; then
    builtin printf 'docker10\\n' >> "$trace"
    builtin printf 'PRIVATE_SENTINEL\\n' >&2
    [[ "$mode" = docker-timeout ]] && return 124
    [[ "$mode" = docker-nonzero ]] && return 1
    return 0
  fi
  builtin printf 'bad-timeout\\n' >> "$trace"; return 99
}
id() { builtin printf 'id\\n' >> "$trace"; [[ "$#:$1" = '1:-un' ]] || return 99; if [[ "$mode" = wrong-user ]]; then builtin printf 'other-user'; else builtin printf 'runner'; fi; }
command() {
  [[ "$#:$1" = '2:-v' ]] || return 99
  builtin printf '%s\\n' "$2" >> "$trace"
  [[ "$mode" = "missing-$2" ]] && return 1
  builtin printf 'PRIVATE_SENTINEL\\n'; return 0
}
cat() {
  [[ "$#:$1" = '1:/sys/class/net/runner0/mtu' ]] || return 99
  builtin printf 'mtu\\n' >> "$trace"
  builtin printf 'PRIVATE_SENTINEL\\n' >&2
  [[ "$mode" = missing-mtu || "$mode" = light-missing-mtu ]] && return 1
  [[ "$mode" = empty-mtu ]] && return 0
  if [[ "$mode" = wrong-mtu ]]; then builtin printf '1500\\n'; elif [[ "$mode" = malformed-mtu ]]; then builtin printf '14O0\\n'; else builtin printf '1400\\n'; fi
}
test() { if [[ "$#:$1:$2" = '2:-S:/var/run/docker.sock' ]]; then builtin printf 'socket\\n' >> "$trace"; [[ "$mode" != missing-socket && "$mode" != light-no-docker ]]; else builtin test "$@"; fi; }
${command}
`,
      );
      const observation = await invoke(mode, bash, [
        '--noprofile',
        '--norc',
        fixture,
      ]);
      if (
        observation.stopped ||
        observation.status !== expectedExit ||
        observation.stdout ||
        observation.stderr
      )
        throw Error(
          `READINESS_${mode.toUpperCase().replaceAll('-', '_')}_EXPECTED_${expectedExit}_ACTUAL_${observation.status}`,
        );
      const observedStages = (await readFile(trace, 'utf8'))
        .trim()
        .split(/\r?\n/);
      if (JSON.stringify(observedStages) !== JSON.stringify(expectedStages))
        throw Error('READINESS_CHECK_ORDER_OR_TIMEOUT_CHANGED');
      results.push({
        mode,
        exitCode: observation.status,
        stages: observedStages,
      });
    }
    return { success: true, results, fakeCommandsOnly: true };
  } finally {
    if (cleanupSafe) {
      if (
        dirname(root) !== resolve(tmpdir()) ||
        !/^ITIR-readiness-shell-[0-9a-f]{32}$/.test(basename(root))
      )
        throw Error('READINESS_CLEANUP_REFUSED');
      await rm(root, { recursive: true, force: true });
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await runReadinessShellTests()));
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        code: /^READINESS_[A-Za-z0-9_]+$/.test(error.message)
          ? error.message
          : 'READINESS_TEST_FAILED',
      }),
    );
    process.exitCode = 1;
  }
}

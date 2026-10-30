// Full production scaffold in constructed, credential-free PS5 fixtures only.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cases = [
  ['common-import', 61],
  ['instance-containment', 62],
  ['instance-identity', 63],
  ['instance-acl', 64],
  ['instance-acl-command-unavailable', 67],
  ['acl-read-access-denied', 68],
  ['acl-read-security', 68],
  ['acl-read-other', 69],
  ['acl-read-wrapped-command', 67],
  ['acl-read-wrapped-denied', 68],
  ['acl-read-unknown-wrapper', 69],
  ['acl-owner-read', 70],
  ['acl-owner-rejected', 71],
  ['acl-enumeration', 72],
  ['acl-sid-translation', 73],
  ['acl-allow-rejected', 74],
  ['acl-classifier-fallback', 64],
  ['result-precondition', 65],
  ['result-path', 65],
  ['result-publication', 66],
  ['result-publication-command', 66],
  ['network-failed', 0],
  ['listener-failed', 0],
  ['passed', 0],
];
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function defaultRun({ executable, args, cwd }) {
  return await new Promise((resolveResult) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill();
    }, 10000);
    for (const [stream, field] of [
      [child.stdout, 'stdout'],
      [child.stderr, 'stderr'],
    ]) {
      stream.on('data', (data) => {
        if (field === 'stdout') stdout += data;
        else stderr += data;
        if (stdout.length + stderr.length > 8192) {
          stopped = true;
          child.kill();
        }
      });
    }
    child.once('error', () => {
      stopped = true;
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr, stopped, cleanup_proven: true });
    });
  });
}

export async function runWorkerBootstrapTests({
  sourceRoot = here,
  runCase = defaultRun,
  onlyCases = null,
} = {}) {
  if (process.platform !== 'win32') throw Error('SCAFFOLD_WINDOWS_REQUIRED');
  const source = await readFile(
    join(sourceRoot, 'Network.Recovery.Probe.ps1'),
    'utf8',
  );
  const importText = ". (Join-Path $PSScriptRoot 'Common.ps1')";
  const constructor = '[Net.Sockets.TcpListener]::new($gateway, 0)';
  if (
    source.split(importText).length !== 2 ||
    source.split(constructor).length !== 2 ||
    !source.includes('param(')
  )
    throw Error('SCAFFOLD_SOURCE_CONTRACT_CHANGED');
  const root = resolve(
    tmpdir(),
    `ITIR-probe-scaffold-${randomUUID().replaceAll('-', '')}`,
  );
  await mkdir(root);
  let cleanupSafe = true;
  const results = [];
  try {
    for (const [mode, expectedExit] of cases) {
      if (onlyCases && !onlyCases.includes(mode)) continue;
      const directory = join(root, mode);
      const runnerRoot = join(directory, 'runner');
      const instance = join(
        runnerRoot,
        'instances',
        mode === 'instance-identity'
          ? 'invalid-instance'
          : `ITIR-${'a'.repeat(32)}`,
      );
      await mkdir(instance, { recursive: true });
      const workerPath = join(directory, 'Worker.ps1');
      const resultPath = join(instance, `probe-${'b'.repeat(32)}.json`);
      const stopPath = join(directory, 'listener-stopped');
      const fixtureCommon = `
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
class FixtureAccessFailure : System.Collections.IEnumerable {
    [System.Collections.IEnumerator] GetEnumerator() { throw [InvalidOperationException]::new('PRIVATE_ENUMERATOR') }
}
if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { throw 'PRIVATE_RUNTIME' }
$script:mode=${literal(mode)}
if ($script:mode -ceq 'common-import') { throw 'PRIVATE_IMPORT' }
$script:RunnerRoot=${literal(runnerRoot)}
$script:ownedCalls=0; $script:nativeCalls=0; $script:stopCalls=0
function Assert-OwnedPath([string] $Path) {
    $script:ownedCalls++
    if ($script:mode -ceq 'instance-containment' -or ($script:mode -ceq 'instance-acl' -and @((Get-PSCallStack) | Where-Object FunctionName -CEQ 'Assert-RunnerProtectedPath').Count -gt 0) -or ($script:mode -ceq 'result-path' -and [IO.Path]::GetFileName($Path) -like 'probe-*')) { throw 'PRIVATE_CONTAINMENT' }
    $full=[IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith(($script:RunnerRoot+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'PRIVATE_ESCAPE' }
    return $full
}
foreach ($node in ([Management.Automation.Language.Parser]::ParseFile(${literal(join(sourceRoot, 'Common.ps1'))},[ref]$null,[ref]$null)).FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
    if ($node.Name -cin @('Get-RunnerSessionPaths','Assert-RunnerSessionTrustedPaths','Assert-RunnerProtectedPath','Get-RunnerProbeAclFailureExitCode')) { . ([scriptblock]::Create($node.Extent.Text)) }
}
if ($script:mode -ceq 'acl-classifier-fallback') { function Get-RunnerProbeAclFailureExitCode { throw 'PRIVATE_CLASSIFIER' } }
function Get-Acl([string] $LiteralPath) {
    switch ($script:mode) {
        'instance-acl-command-unavailable' { throw [Management.Automation.CommandNotFoundException]::new('PRIVATE_MODULE') }
        'acl-classifier-fallback' { throw [Management.Automation.CommandNotFoundException]::new('PRIVATE_MODULE') }
        'acl-read-access-denied' { throw [UnauthorizedAccessException]::new('PRIVATE_ACL') }
        'acl-read-security' { throw [Security.SecurityException]::new('PRIVATE_ACL') }
        'acl-read-other' { throw [IO.IOException]::new('PRIVATE_COMMANDNOTFOUNDEXCEPTION access denied') }
        'acl-read-wrapped-command' { throw [Reflection.TargetInvocationException]::new([Management.Automation.RuntimeException]::new('PRIVATE',[Management.Automation.CommandNotFoundException]::new('PRIVATE'))) }
        'acl-read-wrapped-denied' { throw [Reflection.TargetInvocationException]::new([Management.Automation.RuntimeException]::new('PRIVATE',[UnauthorizedAccessException]::new('PRIVATE'))) }
        'acl-read-unknown-wrapper' { throw [IO.IOException]::new('PRIVATE',[UnauthorizedAccessException]::new('PRIVATE')) }
    }
    $acl=[pscustomobject]@{}
    $acl | Add-Member ScriptMethod GetOwner {
        param($Type)
        if ($script:mode -ceq 'acl-owner-read') { throw 'PRIVATE_OWNER' }
        return [pscustomobject]@{ Value=$(if ($script:mode -ceq 'acl-owner-rejected') {'S-1-5-21-999'} else {'S-1-5-18'}) }
    }
    if ($script:mode -ceq 'acl-enumeration') { $acl | Add-Member NoteProperty Access ([FixtureAccessFailure]::new()) }
    else { $acl | Add-Member ScriptProperty Access {
        $identity=[pscustomobject]@{}
        $identity | Add-Member ScriptMethod Translate {
            param($Type)
            if ($script:mode -ceq 'acl-sid-translation') { throw 'PRIVATE_SID' }
            return [pscustomobject]@{Value=$(if ($script:mode -ceq 'acl-allow-rejected') {'S-1-5-21-999'} else {'S-1-5-18'})}
        }
        return @([pscustomobject]@{IdentityReference=$identity;AccessControlType='Allow'})
    }}
    return $acl
}
function New-FixtureListener {
    $listener=[pscustomobject]@{ LocalEndpoint=[Net.IPEndPoint]::new([ipaddress]::Parse('172.30.240.1'),42037) }
    $listener | Add-Member ScriptMethod Start { if ($script:mode -ceq 'listener-failed') { throw 'PRIVATE_LISTENER' } }
    $listener | Add-Member ScriptMethod Pending { return $false }
    $listener | Add-Member ScriptMethod Stop { $script:stopCalls++; [IO.File]::WriteAllText(${literal(stopPath)},[string]$script:stopCalls) }
    return $listener
}
function Invoke-RunnerNative([string] $Executable,[string[]] $Arguments,[int] $TimeoutSeconds) {
    if ($Executable -cne 'ssh.exe' -or $TimeoutSeconds -ne 12) { throw 'PRIVATE_NATIVE_CONTRACT' }
    $script:nativeCalls++
    if ($script:mode -ceq 'network-failed' -and $script:nativeCalls -eq 1) { return 255 }
    return 0
}
function Write-RunnerJson([string] $Path,$Value) {
    if ($script:mode -ceq 'result-publication') { throw [IO.IOException]::new('PRIVATE_PUBLICATION') }
    if ($script:mode -ceq 'result-publication-command') { throw [Management.Automation.CommandNotFoundException]::new('PRIVATE_PUBLICATION') }
    [IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Value -Depth 5 -Compress),[Text.UTF8Encoding]::new($false))
}
`;
      await writeFile(join(directory, 'Fixture.Common.ps1'), fixtureCommon);
      await writeFile(
        workerPath,
        source
          .replace(
            importText,
            ". (Join-Path $PSScriptRoot 'Fixture.Common.ps1')",
          )
          .replace(constructor, '(New-FixtureListener)'),
      );
      if (mode === 'result-precondition')
        await writeFile(resultPath, 'occupied');
      const observation = await runCase({
        mode,
        executable: join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          workerPath,
          '-InstancePath',
          instance,
          '-LayoutVersion',
          '2',
          '-ProbeId',
          'b'.repeat(32),
          '-Generation',
          '6',
        ],
        cwd: directory,
      });
      if (
        observation.cleanup_proven === false ||
        observation.recoveryRequired
      ) {
        cleanupSafe = false;
        throw Error('SCAFFOLD_CHILD_CLOSURE_UNPROVEN');
      }
      if (
        observation.stopped ||
        observation.status !== expectedExit ||
        observation.stdout ||
        observation.stderr
      ) {
        throw Error(
          `SCAFFOLD_${mode.toUpperCase().replaceAll('-', '_')}_EXPECTED_${expectedExit}_ACTUAL_${observation.status}_OUTPUT_${Boolean(observation.stdout || observation.stderr)}`,
        );
      }
      const stopped = await exists(stopPath);
      let published = false;
      if (expectedExit === 0) {
        const bytes = await readFile(resultPath);
        const result = JSON.parse(bytes);
        const expectedWorker =
          mode === 'passed'
            ? 'passed'
            : mode === 'listener-failed'
              ? 'listener-error'
              : 'isolation-command-failed';
        if (
          bytes.length > 256 ||
          result.generation !== 6 ||
          result.probeId !== 'b'.repeat(32) ||
          result.success !== (mode === 'passed') ||
          result.detail.code !== expectedWorker ||
          !stopped ||
          (await readFile(stopPath, 'utf8')) !== '1'
        )
          throw Error('SCAFFOLD_RESULT_OR_CLEANUP_CHANGED');
        published = true;
      } else if (mode === 'result-precondition') {
        if ((await readFile(resultPath, 'utf8')) !== 'occupied')
          throw Error('SCAFFOLD_PRIOR_RESULT_CHANGED');
      } else if (await exists(resultPath))
        throw Error('SCAFFOLD_FAILED_BOOTSTRAP_PUBLISHED');
      if (mode.startsWith('result-publication') && !stopped)
        throw Error('SCAFFOLD_PUBLICATION_SKIPPED_CLEANUP');
      results.push({
        mode,
        exitCode: observation.status,
        published,
        listenerStopped: stopped,
      });
    }
    return { success: true, results, constructedFixturesOnly: true };
  } finally {
    if (cleanupSafe) {
      if (
        dirname(root) !== resolve(tmpdir()) ||
        !/^ITIR-probe-scaffold-[0-9a-f]{32}$/.test(basename(root))
      )
        throw Error('SCAFFOLD_CLEANUP_REFUSED');
      await rm(root, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await runWorkerBootstrapTests()));
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        code: /^SCAFFOLD_[A-Za-z0-9_]+$/.test(error.message)
          ? error.message
          : 'SCAFFOLD_TEST_FAILED',
      }),
    );
    process.exitCode = 1;
  }
}

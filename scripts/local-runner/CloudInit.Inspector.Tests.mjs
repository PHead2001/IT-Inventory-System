// Run the literal production inspector with a disposable status subprocess.
// Fixed status argv is substituted. Log fixtures use real bounded file I/O;
// Linux-only open flags and ownership metadata are simulated on Windows.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
const literal = (value) => JSON.stringify(value);
export async function runCloudInitInspectorTests({
  sourceRoot,
  fixtureRoot,
  python,
  runCase,
  projectionPath,
}) {
  const text = await readFile(join(sourceRoot, 'Runner.ps1'), 'utf8');
  const match = text.match(
    /function Get-RunnerCloudInitInspector \{[\s\S]*?return @'\r?\n([\s\S]*?)\r?\n'@/,
  );
  if (!match) throw Error('CLOUD_INIT_INSPECTOR_LITERAL_MISSING');
  const source = match[1].replaceAll('\r\n', '\n');
  const fixed = "['cloud-init','status','--format=json']";
  if (source.split(fixed).length !== 2)
    throw Error('CLOUD_INIT_FIXED_ARGV_CHANGED');
  const root = resolve(
    fixtureRoot,
    `ITIR-inspector-${randomUUID().replaceAll('-', '')}`,
  );
  await mkdir(root);
  let cleanupSafe = true;
  const status = {
    status: 'done',
    extended_status: 'degraded done',
    errors: [],
    recoverable_errors: {},
    'modules-config': {
      errors: [],
      recoverable_errors: {
        WARNING: [
          'Group docker already exists; cc_users_groups ProcessExecutionError',
        ],
      },
    },
  };
  const cases = [
    [
      'recoverable-reason',
      status,
      2,
      'complete',
      'Group already exists.',
      'json',
    ],
    [
      'terminal-error',
      { ...status, status: 'error', extended_status: 'error - done' },
      1,
      'complete',
      'Group already exists.',
      'json',
    ],
    [
      'running-not-terminal',
      { ...status, status: 'running', extended_status: 'degraded running' },
      2,
      'complete',
      'Group already exists.',
      'json',
    ],
    [
      'success-is-not-readiness',
      { status: 'done', extended_status: 'done', errors: [] },
      0,
      'complete',
      null,
      'json',
    ],
    [
      'unknown-status',
      {
        status: 'PRIVATE_UNKNOWN',
        extended_status: 'PRIVATE_UNKNOWN',
        errors: [],
      },
      3,
      'complete',
      null,
      'json',
    ],
    [
      'excluded-keys',
      {
        ...status,
        detail: 'PRIVATE_DETAIL',
        datasource: 'PRIVATE_DATASOURCE',
        userdata: 'PRIVATE_USERDATA',
        log: 'PRIVATE_LOG',
        command: ['PRIVATE_COMMAND'],
      },
      2,
      'complete',
      'Group already exists.',
      'json',
    ],
    [
      'url-ip-path-email',
      {
        ...status,
        errors: [
          'Failed to fetch https://user:PRIVATE_PASSWORD@host.invalid/PRIVATE_URL from 192.0.2.1 /PRIVATE_PATH C:\\PRIVATE_PATH admin@PRIVATE.example',
        ],
      },
      2,
      'complete',
      'Package fetch failed.',
      'json',
    ],
    [
      'apt-lock',
      {
        ...status,
        errors: [
          'Could not get lock /var/lib/dpkg/lock; apt package installation failed',
        ],
      },
      2,
      'complete',
      'Package manager lock was unavailable.',
      'json',
    ],
    [
      'dns',
      {
        ...status,
        errors: [
          'Temporary failure in name resolution for https://PRIVATE_HOST.invalid/private',
        ],
      },
      2,
      'complete',
      'DNS resolution failed.',
      'json',
    ],
    [
      'credential-assignment',
      { ...status, errors: ['Package install failed token=PRIVATE_VALUE'] },
      2,
      'complete',
      'reason-withheld',
      'json',
    ],
    [
      'unsafe-private-key',
      { ...status, errors: ['Failed -----BEGIN PRIVATE KEY----- PRIVATE_KEY'] },
      2,
      'complete',
      'reason-withheld',
      'json',
    ],
    [
      'unsafe-configuration',
      { ...status, errors: ['Failed #cloud-config\nruncmd: PRIVATE_COMMAND'] },
      2,
      'complete',
      'reason-withheld',
      'json',
    ],
    [
      'unknown-reason',
      { ...status, errors: ['PRIVATE_UNKNOWN_CONTENT'] },
      2,
      'complete',
      'reason-withheld',
      'json',
    ],
    [
      'long-dns-tail',
      {
        ...status,
        errors: [
          'PRIVATE_SECRET '.repeat(1500) +
            '\nFailed to fetch https://PRIVATE_HOST/PRIVATE_PATH\nTemporary failure resolving PRIVATE_HOST',
        ],
      },
      2,
      'complete',
      'DNS resolution failed.',
      'json',
    ],
    ['malformed-json', {}, 1, 'status-invalid', null, 'invalid'],
    ['bounded-overflow', {}, 1, 'status-overflow', null, 'overflow'],
    ['bounded-timeout', {}, 1, 'status-timeout', null, 'timeout'],
    [
      'discard-stderr',
      status,
      2,
      'complete',
      'Group already exists.',
      'stderr',
    ],
  ];
  for (const [name, input, expected] of [
    ['opaque-error', 'Error PRIVATE_UNKNOWN_CONTENT', 'reason-withheld'],
    [
      'opaque-command',
      'Failed running command echo hunter2 PRIVATE_COMMAND',
      'reason-withheld',
    ],
    [
      'no-package-candidate',
      'Package PRIVATE_PACKAGE has no installation candidate',
      'Package has no installation candidate.',
    ],
    [
      'package-not-found',
      'Unable to locate package PRIVATE_PACKAGE',
      'Package was not found.',
    ],
    [
      'permission',
      'Permission denied for PRIVATE_PATH',
      'Permission was denied.',
    ],
    [
      'schema',
      'Invalid cloud-config schema PRIVATE_VALUE',
      'Cloud configuration schema was invalid.',
    ],
    [
      'resize',
      'Failed to resize filesystem PRIVATE_DEVICE',
      'Filesystem resize failed.',
    ],
  ])
    cases.push([
      name,
      { ...status, errors: [input] },
      2,
      'complete',
      expected,
      'json',
    ]);
  cases.push([
    'reason-count-cap',
    {
      ...status,
      errors: Array.from(
        { length: 20 },
        () => 'Temporary failure in name resolution PRIVATE_HOST',
      ),
    },
    2,
    'complete',
    'DNS resolution failed.',
    'json',
  ]);
  for (const [name, input, expected] of [
    [
      'multiline-dns',
      'Group PRIVATE_GROUP already exists\nFailed to fetch https://PRIVATE_HOST/PRIVATE_PATH\nTemporary failure resolving PRIVATE_HOST',
      'DNS resolution failed.',
    ],
    [
      'multiline-unreachable',
      'Could not connect to PRIVATE_HOST - network is unreachable',
      'Network was unreachable.',
    ],
    [
      'multiline-timeout',
      'Could not connect to PRIVATE_HOST - connection timed out',
      'Connection timed out.',
    ],
    [
      'multiline-refused',
      'Could not connect to PRIVATE_HOST - connection refused',
      'Connection was refused.',
    ],
    [
      'multiline-connect-failure',
      'Unable to connect to PRIVATE_HOST',
      'Connection failed.',
    ],
    [
      'multiline-fetch-failure',
      'Failed to fetch https://PRIVATE_HOST/PRIVATE_PATH',
      'Package fetch failed.',
    ],
    [
      'multiline-index-fetch-failure',
      'Some index files failed to download PRIVATE_PATH',
      'Package fetch failed.',
    ],
    [
      'multiline-dpkg-exit',
      'E: Sub-process /usr/bin/dpkg returned an error code (1)',
      'Package manager exited with an error.',
    ],
    [
      'multiline-apt-exit',
      'Command apt-get update\nExit code: 100',
      'Package manager exited with an error.',
    ],
    [
      'multiline-no-route',
      'Could not connect to PRIVATE_HOST - no route to host',
      'Network was unreachable.',
    ],
    [
      'multiline-tls',
      'Failed to fetch https://PRIVATE_HOST - Certificate verification failed',
      'TLS validation or handshake failed.',
    ],
    [
      'multiline-gpg',
      'GPG error: PRIVATE_REPO NO_PUBKEY PRIVATE_KEY',
      'Package repository signature verification failed.',
    ],
    [
      'multiline-release',
      'The repository PRIVATE_REPO does not have a Release file',
      'Package repository Release file was unavailable.',
    ],
    [
      'multiline-hash',
      'Failed to fetch PRIVATE_PACKAGE - Hash Sum mismatch',
      'Package hash verification failed.',
    ],
    [
      'multiline-disk',
      'Failed to fetch PRIVATE_PACKAGE - No space left on device',
      'Disk space was exhausted.',
    ],
    [
      'multiline-interrupted',
      'dpkg was interrupted PRIVATE_COMMAND',
      'Package manager was interrupted.',
    ],
    [
      'multiline-dependencies',
      'apt-get failed: unmet dependencies PRIVATE_PACKAGE',
      'Package dependencies could not be satisfied.',
    ],
    [
      'multiline-opaque',
      'Error PRIVATE_UNKNOWN_CONTENT\nFailed running command echo hunter2',
      'reason-withheld',
    ],
  ]) {
    const error = `ProcessExecutionError: cc_package_update_upgrade_install\nCommand: ['apt-get','PRIVATE_ARGUMENT']\nAuthorization: PRIVATE_SECRET\npassword=hunter2\n-----BEGIN PRIVATE KEY-----\n${input}\napt-get exited with non-zero error PRIVATE_TAIL`;
    // The unknown case must remain unknown, without the generic apt exit suffix.
    const entry =
      name === 'multiline-opaque'
        ? error.replace(/\napt-get exited[\s\S]*$/, '')
        : error;
    cases.push([
      name,
      {
        ...status,
        'modules-config': {},
        'modules-final': { errors: [entry], recoverable_errors: {} },
      },
      1,
      'complete',
      expected,
      'json',
    ]);
  }
  cases.push([
    'control-dns',
    {
      ...status,
      errors: [
        'PRIVATE_SECRET\u0000\u0001Temporary failure resolving PRIVATE_HOST',
      ],
    },
    1,
    'complete',
    'DNS resolution failed.',
    'json',
  ]);
  const generic = 'ProcessExecutionError: apt-get exited with non-zero error';
  const terminal = {
    status: 'error',
    extended_status: 'error - done',
    errors: [generic],
    'modules-final': {
      errors: [generic],
      recoverable_errors: {
        WARNING: [
          'PRIVATE_UNKNOWN',
          'PRIVATE_UNKNOWN',
          'cc_package_update_upgrade_install failed',
        ],
      },
    },
    recoverable_errors: {
      WARNING: [
        'PRIVATE_UNKNOWN',
        'PRIVATE_UNKNOWN',
        'cc_package_update_upgrade_install failed',
      ],
    },
  };
  for (const [name, log, expected, extra = {}] of [
    [
      'dns',
      'Temporary failure resolving PRIVATE_HOST',
      'DNS resolution failed.',
    ],
    [
      'candidate',
      'Package PRIVATE_PACKAGE has no installation candidate',
      'Package has no installation candidate.',
    ],
    [
      'lock',
      'Could not get lock PRIVATE_PATH',
      'Package manager lock was unavailable.',
    ],
    ['unknown', 'PRIVATE_SECRET hunter2', null],
    ['generic', 'apt-get exited with non-zero error', null],
    ['unrelated', 'Group PRIVATE_GROUP already exists', null],
    ['missing', '', null, { missing: true }],
    ['denied', '', null, { denied: true }],
    ['nofollow', '', null, { denied: true }],
    [
      'nonregular',
      'Temporary failure resolving PRIVATE_HOST',
      null,
      { nonregular: true },
    ],
    [
      'nonroot',
      'Temporary failure resolving PRIVATE_HOST',
      null,
      { nonroot: true },
    ],
    [
      'writable',
      'Temporary failure resolving PRIVATE_HOST',
      null,
      { writable: true },
    ],
    [
      'large',
      'PRIVATE_PREFIX '.repeat(10000) +
        '\nE: Unable to locate package PRIVATE_PACKAGE\n',
      'Package was not found.',
      { truncated: true },
    ],
    [
      'discard-partial',
      'x'.repeat(10000) +
        'Temporary failure resolving PRIVATE_HOST' +
        'x'.repeat(65500) +
        '\nPRIVATE_UNKNOWN',
      null,
    ],
    [
      'running',
      'Temporary failure resolving PRIVATE_HOST',
      null,
      { running: true },
    ],
    [
      'no-module',
      'Temporary failure resolving PRIVATE_HOST',
      null,
      { noModule: true },
    ],
    [
      'specific-status',
      'Temporary failure resolving PRIVATE_HOST',
      null,
      { specific: true },
    ],
  ]) {
    const value = JSON.parse(JSON.stringify(terminal));
    if (extra.running) {
      value.status = 'running';
      value.extended_status = 'error - running';
    }
    if (extra.noModule) {
      value['modules-final'].recoverable_errors = {};
      value.recoverable_errors = {};
    }
    if (extra.specific) {
      value.errors = ['Hash Sum mismatch'];
      value['modules-final'].errors = ['Hash Sum mismatch'];
    }
    cases.push([
      `tail-${name}`,
      value,
      1,
      'complete',
      expected ??
        (extra.specific
          ? 'Package hash verification failed.'
          : 'Package manager exited with an error.'),
      'json',
      { log, expected, ...extra },
    ]);
  }
  const results = [];
  const projections = [];
  try {
    const child = join(root, 'status.py');
    await writeFile(
      child,
      `import json,os,sys,time\nfixture=json.load(open(sys.argv[1],encoding='utf-8'))\nmode=fixture['mode']\nif mode=='timeout': time.sleep(30)\nelif mode=='overflow':\n os.write(1,b'x'*70000)\n time.sleep(30)\nelif mode=='invalid': os.write(1,b'PRIVATE_INVALID_JSON')\nelse:\n if mode=='stderr': os.write(2,b'PRIVATE_STDERR')\n os.write(1,json.dumps(fixture['status']).encode('utf-8'))\nsys.exit(fixture['exit'])\n`,
    );
    for (const [name, value, exit, capture, reason, mode, tail] of cases) {
      const fixture = join(root, `${name}.json`);
      const entry = join(root, `${name}.py`);
      const proof = join(root, `${name}.closed.json`);
      const log = join(root, `${name}.log`);
      await writeFile(log, tail?.log ?? 'PRIVATE_DEFAULT');
      await writeFile(fixture, JSON.stringify({ status: value, exit, mode }));
      const constructed = source.replace(
        fixed,
        `[sys.executable,${literal(child)},${literal(fixture)}]`,
      );
      // The finally records actual owned status-child termination. It also closes
      // that child if a defect in the inspector raises before its own finally.
      const fileFixture = `import os,stat,types\nlog_options=json.loads(${literal(JSON.stringify(tail ?? { missing: true }))})\nlog_fd=None\nlog_reads=[]\nlog_opens=0\nlog_closed=False\noriginal_open=os.open\noriginal_fstat=os.fstat\noriginal_read=os.read\noriginal_close=os.close\nos.O_NOFOLLOW=getattr(os,'O_NOFOLLOW',0x20000000)\nos.O_NONBLOCK=getattr(os,'O_NONBLOCK',0x10000000)\ndef fixture_open(path,flags,*args,**kwargs):\n global log_fd,log_opens\n if path!='/var/log/cloud-init-output.log': return original_open(path,flags,*args,**kwargs)\n log_opens+=1\n if flags!=(os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK): raise AssertionError('FLAGS')\n if log_options.get('missing') or log_options.get('denied'): raise OSError('PRIVATE_FILE_FAILURE')\n log_fd=original_open(${literal(log)},os.O_RDONLY|os.O_BINARY); return log_fd\ndef fixture_fstat(fd):\n info=original_fstat(fd)\n if fd!=log_fd: return info\n return types.SimpleNamespace(st_mode=(stat.S_IFIFO if log_options.get('nonregular') else stat.S_IFREG)|(0o666 if log_options.get('writable') else 0o640),st_uid=1000 if log_options.get('nonroot') else 0,st_size=info.st_size)\ndef fixture_read(fd,count):\n if fd==log_fd:\n  log_reads.append(count)\n  if count>65536: raise AssertionError('BOUND')\n return original_read(fd,count)\ndef fixture_close(fd):\n global log_closed\n if fd==log_fd: log_closed=True\n return original_close(fd)\nos.open=fixture_open\nos.fstat=fixture_fstat\nos.read=fixture_read\nos.close=fixture_close\n`;
      await writeFile(
        entry,
        `import subprocess,json\n${fileFixture}\nowned=[]\noriginal=subprocess.Popen\ndef fixture_popen(*args,**kwargs):\n child=original(*args,**kwargs); owned.append(child); return child\nsubprocess.Popen=fixture_popen\ntry:\n exec(compile(${literal(constructed)},'actual-inspector','exec'))\nfinally:\n for child in owned:\n  if child.poll() is None: child.kill()\n  child.wait(timeout=2)\n with open(${literal(proof)},'w',encoding='utf-8') as stream: json.dump({'count':len(owned),'closed':all(p.poll() is not None for p in owned),'exits':[p.returncode for p in owned],'logOpens':log_opens,'logReads':log_reads,'logClosed':log_closed,'logOpened':log_fd is not None},stream)\n`,
      );
      const result = await runCase({
        name,
        executable: python,
        args: [entry],
        cwd: root,
      });
      if (!result.cleanup_proven || result.recoveryRequired) {
        cleanupSafe = false;
        throw Error('CLOUD_INIT_PARENT_CLOSURE_UNPROVEN');
      }
      let closed;
      try {
        closed = JSON.parse(await readFile(proof, 'utf8'));
      } catch {
        cleanupSafe = false;
        throw Error('CLOUD_INIT_STATUS_CHILD_CLOSURE_UNPROVEN');
      }
      if (!closed.closed || closed.count !== 1) {
        cleanupSafe = false;
        throw Error('CLOUD_INIT_STATUS_CHILD_CLOSURE_UNPROVEN');
      }
      if (
        result.status !== 0 ||
        result.stderr ||
        result.stopped ||
        Buffer.byteLength(result.stdout) > 4096 ||
        /PRIVATE|hunter2/.test(result.stdout)
      )
        throw Error(`CLOUD_INIT_FIXTURE_${name.replaceAll('-', '_')}`);
      const projected = JSON.parse(result.stdout);
      if (closed.logOpened && !closed.logClosed)
        throw Error('CLOUD_INIT_LOG_NOT_CLOSED');
      if (tail) {
        const shouldOpen = !(tail.running || tail.noModule || tail.specific);
        const shouldRead =
          shouldOpen &&
          !(
            tail.missing ||
            tail.denied ||
            tail.nonregular ||
            tail.nonroot ||
            tail.writable
          );
        if (
          closed.logOpens !== Number(shouldOpen) ||
          closed.logReads.length !== Number(shouldRead) ||
          closed.logReads.some((n) => n !== 65536)
        )
          throw Error('CLOUD_INIT_LOG_BOUNDARY');
        const enriched = projected.reasons.filter(
          (r) => r.source !== undefined,
        );
        if (
          tail.expected
            ? enriched.length !== 2 ||
              enriched.some(
                (r) =>
                  r.source !== 'cloud-init-output-tail' ||
                  r.reason !== tail.expected ||
                  r.truncated !== Boolean(tail.truncated),
              )
            : enriched.length !== 0
        )
          throw Error('CLOUD_INIT_LOG_PROVENANCE');
        if (!tail.noModule && projected.reasons.length !== 8)
          throw Error('CLOUD_INIT_LOG_REASON_CAP');
      }
      projections.push(projected);
      if (
        projected.capture !== capture ||
        projected.reasons.length > 8 ||
        projected.reasons.some((r) => r.reason.length > 256)
      )
        throw Error('CLOUD_INIT_PROJECTION_MISMATCH');
      if (reason && !projected.reasons.some((r) => r.reason.includes(reason)))
        throw Error('CLOUD_INIT_REASON_MISSING');
      if (
        name.startsWith('multiline-') &&
        (projected.reasons.length !== 1 ||
          !projected.reasons.some(
            (r) =>
              r.stage === 'modules-final' &&
              r.module === 'package-update-upgrade-install' &&
              r.exception === 'ProcessExecutionError' &&
              r.reason === reason,
          ))
      )
        throw Error('CLOUD_INIT_MULTILINE_CLASSIFICATION_MISSING');
      if (capture === 'complete' && projected.cloudInitExit !== exit)
        throw Error('CLOUD_INIT_EXIT_LOST');
      if (
        name === 'recoverable-reason' &&
        !projected.reasons.some(
          (r) =>
            r.module === 'users-groups' &&
            r.exception === 'ProcessExecutionError',
        )
      )
        throw Error('CLOUD_INIT_CLASSIFICATION_MISSING');
      results.push({
        name,
        capture,
        inspectorExit: result.status,
        statusChildExit: closed.exits[0],
        statusChildClosed: true,
        outputBytes: Buffer.byteLength(result.stdout),
        logOpenAttempts: closed.logOpens,
        logReadSizes: closed.logReads,
        logDescriptorClosed: !closed.logOpened || closed.logClosed,
      });
    }
    if (projectionPath)
      await writeFile(projectionPath, JSON.stringify(projections));
    return { success: true, cases: results, cleanupSafe };
  } finally {
    if (cleanupSafe) await rm(root, { recursive: true, force: true });
  }
}

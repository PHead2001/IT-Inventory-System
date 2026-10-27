// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertLocalUrl } from '../../scripts/runtime.mjs';
import {
  LOCAL_SUPABASE_PORTS,
  excludedTcpRanges,
  verifiedPublishedBindings,
  assertAvailableLocalPorts,
  parseWindowsListeners,
  publicationCoversListener,
  preflightLocalSupabasePorts,
} from '../../scripts/local-supabase-ports.mjs';

const table = (rows = '') =>
  `Start Port End Port\n---------- --------\n${rows}\n* - Administered port exclusions.\n`;
const noConflict = { ranges: [], listening: [], publications: [] };
const container = (overrides = {}) => ({
  name: '/supabase_db_it-inventory',
  project: 'it-inventory',
  running: true,
  health: 'healthy',
  ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '45322' }] },
  ...overrides,
});

describe('canonical local Supabase targets', () => {
  it('matches config and public example without changing project or database version', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');
    for (const [section, key, port] of [
      ['api', 'port', LOCAL_SUPABASE_PORTS.api],
      ['db', 'port', LOCAL_SUPABASE_PORTS.db],
      ['db', 'shadow_port', LOCAL_SUPABASE_PORTS.shadow],
      ['studio', 'port', LOCAL_SUPABASE_PORTS.studio],
      ['local_smtp', 'port', LOCAL_SUPABASE_PORTS.mail],
    ]) {
      const block = config.split(`[${section}]`)[1].split(/^\[/m)[0];
      expect(block).toMatch(new RegExp(`^${key} = ${port}$`, 'm'));
    }
    expect(config).toContain('project_id = "it-inventory"');
    expect(config).toContain('major_version = 17');
    expect(readFileSync('.env.example', 'utf8')).toContain(
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:45321',
    );
    const db = readFileSync('scripts/db.mjs', 'utf8');
    expect(db.indexOf('preflightLocalSupabasePorts();')).toBeLessThan(
      db.indexOf('installLocalStorageVersion();'),
    );
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts only the new exact %s endpoints',
    (host) => {
      expect(assertLocalUrl(`http://${host}:45321`, 45321)).toBe(
        `http://${host}:45321`,
      );
      const db = `postgresql://fixture:synthetic@${host}:45322/postgres`;
      expect(assertLocalUrl(db, 45322)).toBe(db);
    },
  );

  it.each([
    ['http://127.0.0.1:54321', 54321],
    ['postgresql://fixture:synthetic@127.0.0.1:54322/postgres', 54322],
    ['http://127.0.0.1:54321', 45321],
    ['postgresql://fixture:synthetic@127.0.0.1:54322/postgres', 45322],
    ['http://localhost:45320', 45321],
    ['https://localhost:45321', 45321],
    ['http://remote.example:45321', 45321],
    ['http://localhost.remote.example:45321', 45321],
    ['http://localhost:45321@remote.example:45321', 45321],
    ['http://fixture:synthetic@localhost:45321', 45321],
    ['http://localhost:45321/other', 45321],
    ['http://localhost:45321?host=remote.example', 45321],
    ['http://localhost:45321#fragment', 45321],
    ['postgresql://fixture:synthetic@remote.example:45322/postgres', 45322],
    ['postgresql://fixture:synthetic@localhost:45322/other', 45322],
    [
      'postgresql://fixture:synthetic@localhost:45322/postgres?host=remote.example',
      45322,
    ],
    [
      'postgresql://fixture:synthetic@localhost:45322/postgres?port=5432',
      45322,
    ],
    ['postgresql://fixture:synthetic@localhost:45322/postgres#fragment', 45322],
  ])(
    'refuses stale or hostile target without echoing credentials: %s',
    (url, port) => {
      let error;
      try {
        assertLocalUrl(url, port);
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).toMatch(/Refusing nonlocal.*45321.*45322/);
      expect(error.message).not.toContain('synthetic');
    },
  );
});

describe('read-only Windows port preflight', () => {
  it('preserves listener addresses using fixed module-free numeric/IP serialization', () => {
    expect(parseWindowsListeners('45322\t127.0.0.1\r\n45322\t::\r\n')).toEqual([
      { port: 45322, address: '127.0.0.1' },
      { port: 45322, address: '::' },
    ]);
    expect(parseWindowsListeners('')).toEqual([]);
  });
  it.each([
    '45322',
    '0\t127.0.0.1',
    '65536\t::',
    '45322\tlocalhost',
    '45322\t127.0.0.1\textra',
    '[45322]',
  ])('rejects malformed listener enumeration: %s', (output) => {
    expect(() => parseWindowsListeners(output)).toThrow('enumeration');
  });
  it.each([
    ['127.0.0.1', '127.0.0.1', true],
    ['127.0.0.1', '192.0.2.1', false],
    ['192.0.2.1', '127.0.0.1', false],
    ['127.0.0.1', '0.0.0.0', false],
    ['0.0.0.0', '0.0.0.0', true],
    ['0.0.0.0', '127.0.0.1', true],
    ['0.0.0.0', '192.0.2.1', true],
    ['0.0.0.0', '::', false],
    ['0.0.0.0', '::ffff:127.0.0.1', false],
    ['::1', '::1', true],
    ['::1', '::', false],
    ['::', '::1', true],
    ['0:0:0:0:0:0:0:0', '::1', true],
    ['::', '127.0.0.1', false],
    ['::', '0.0.0.0', false],
    ['2001:db8::1', '2001:0db8:0:0:0:0:0:1', true],
    ['2001:db8::1', '2001:db8::2', false],
    ['fe80::1%3', 'fe80::1%4', false],
  ])(
    'requires actual publication coverage %s → %s: %s',
    (published, observed, expected) => {
      expect(
        publicationCoversListener(
          { port: 45322, address: published },
          { port: 45322, address: observed },
        ),
      ).toBe(expected);
      expect(
        publicationCoversListener(
          { port: 45321, address: published },
          { port: 45322, address: observed },
        ),
      ).toBe(false);
    },
  );
  it('refuses another interface listener even with a healthy matching numeric-port publication', () => {
    const publications = verifiedPublishedBindings([
      container({
        ports: { '5432/tcp': [{ HostIp: '192.0.2.1', HostPort: '45322' }] },
      }),
    ]);
    expect(() =>
      assertAvailableLocalPorts({
        ranges: [],
        listening: [{ port: 45322, address: '127.0.0.1' }],
        publications,
      }),
    ).toThrow('45322 already has');
  });
  it('requires every address on a numeric port to be explained by a verified publication', () => {
    const listening = [
      { port: 45322, address: '0.0.0.0' },
      { port: 45322, address: '::' },
    ];
    const ipv4 = verifiedPublishedBindings([container()]);
    expect(() =>
      assertAvailableLocalPorts({ ranges: [], listening, publications: ipv4 }),
    ).toThrow('45322 already has');
    const both = verifiedPublishedBindings([
      container({
        ports: {
          '5432/tcp': [
            { HostIp: '0.0.0.0', HostPort: '45322' },
            { HostIp: '::', HostPort: '45322' },
          ],
        },
      }),
    ]);
    expect(() =>
      assertAvailableLocalPorts({
        ranges: [[45322, 45322]],
        listening,
        publications: both,
      }),
    ).not.toThrow();
  });
  it('parses numeric ranges with localized headings, CRLF and administered markers', () => {
    expect(
      excludedTcpRanges(
        'Anfang Ende\r\n------ -----\r\n 54202 54301\r\n 54302 54401 *\r\n',
      ),
    ).toEqual([
      [54202, 54301],
      [54302, 54401],
    ]);
    expect(() =>
      assertAvailableLocalPorts({
        ...noConflict,
        ranges: [
          [54202, 54301],
          [54302, 54401],
        ],
      }),
    ).not.toThrow();
    expect(excludedTcpRanges(table())).toEqual([]);
  });
  it.each(['unrecognized output', table('65536 65537'), table('45324 45320')])(
    'fails closed on malformed output',
    (output) => {
      expect(() => excludedTcpRanges(output)).toThrow();
    },
  );
  it.each(Object.values(LOCAL_SUPABASE_PORTS))(
    'rejects excluded or listening canonical port %s',
    (port) => {
      expect(() =>
        assertAvailableLocalPorts({ ...noConflict, ranges: [[port, port]] }),
      ).toThrow(`${port} is excluded`);
      expect(() =>
        assertAvailableLocalPorts({
          ...noConflict,
          listening: [{ port, address: '127.0.0.1' }],
        }),
      ).toThrow(`${port} already has`);
    },
  );
  it('keeps an already-owned stack idempotent, including a service without HEALTHCHECK', () => {
    const publications = verifiedPublishedBindings([
      container(),
      container({
        name: '/supabase_studio_it-inventory',
        health: null,
        ports: { '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '45323' }] },
      }),
    ]);
    expect(publications).toEqual([
      { port: 45322, address: '0.0.0.0' },
      { port: 45323, address: '0.0.0.0' },
    ]);
    expect(() =>
      assertAvailableLocalPorts({
        ranges: [[45320, 45324]],
        listening: [
          { port: 45322, address: '127.0.0.1' },
          { port: 45323, address: '0.0.0.0' },
        ],
        publications,
      }),
    ).toThrow('45320 is excluded');
    expect(() =>
      assertAvailableLocalPorts({
        ranges: [[45322, 45323]],
        listening: [
          { port: 45322, address: '127.0.0.1' },
          { port: 45323, address: '0.0.0.0' },
        ],
        publications,
      }),
    ).not.toThrow();
  });
  it.each([
    { name: '/supabase_db_other-project' },
    { project: 'other-project' },
    { running: false },
    { health: 'unhealthy' },
    { health: 'starting' },
    { health: undefined },
    { ports: { '5432/tcp': [{ HostPort: '54322' }] } },
    { ports: { '5432/tcp': [{ HostPort: '45322' }, { HostPort: '54322' }] } },
    { ports: { '5432/tcp': [] } },
    { ports: { '5432/tcp': [{ HostPort: '45322' }] } },
    { ports: { '5432/tcp': [{ HostIp: 'localhost', HostPort: '45322' }] } },
    { ports: { '8000/tcp': [{ HostPort: '45322' }] } },
  ])('rejects an unowned, unhealthy or wrong binding: %s', (overrides) => {
    expect(verifiedPublishedBindings([container(overrides)]).length).toBe(0);
  });
  it('rejects duplicate service identities', () => {
    expect(verifiedPublishedBindings([container(), container()]).length).toBe(
      0,
    );
  });
  it('uses bounded read-only commands and needs no Docker inspection without listeners', () => {
    const calls = [];
    preflightLocalSupabasePorts({
      platform: 'win32',
      execute(file, args, options) {
        calls.push({ file, args, options });
        return { status: 0, stdout: file === 'netsh.exe' ? table() : '' };
      },
    });
    expect(calls.map(({ file }) => file)).toEqual([
      'netsh.exe',
      'netsh.exe',
      'powershell.exe',
    ]);
    expect(calls[0].args).toEqual([
      'interface',
      'ipv4',
      'show',
      'excludedportrange',
      'protocol=tcp',
    ]);
    expect(calls[1].args[1]).toBe('ipv6');
    const command = calls[2].args.at(-1);
    expect(command).toContain('foreach ($listener in ');
    expect(command).toContain('[Console]::WriteLine(');
    expect(command).toContain('$listener.Address.ToString()');
    expect(command).toContain('[char]9');
    expect(command).not.toMatch(
      /ConvertTo-Json|ForEach-Object|Get-NetTCPConnection|Import-Module/,
    );
    for (const { options } of calls)
      expect(options).toMatchObject({
        timeout: 10000,
        maxBuffer: 1048576,
        windowsHide: true,
      });
  });
  it.each([
    ['PSModulePath', 'Docker_Context', 'Docker_Host'],
    ['psmodulepath', 'docker_context', 'docker_host'],
    ['PsMoDuLePaTh', 'DoCkEr_CoNtExT', 'DoCkEr_HoSt'],
  ])(
    'keeps mixed-case %s independent of module availability without changing parent environment',
    (moduleKey, contextKey, hostKey) => {
      const environment = {
        [moduleKey]: 'C:\\PS7-only-modules',
        [contextKey]: 'rancher-desktop',
        [hostKey]: 'tcp://hostile.example:2375',
        OTHER: 'retained',
      };
      const before = { ...environment };
      const calls = [];
      preflightLocalSupabasePorts({
        platform: 'win32',
        environment,
        execute(file, args, options) {
          calls.push({ file, args, options });
          expect(options.env).not.toBe(environment);
          expect(options.env[moduleKey]).toBe(before[moduleKey]);
          expect(
            Object.keys(options.env).map((key) => key.toLowerCase()),
          ).not.toContain('docker_host');
          expect(
            Object.keys(options.env).map((key) => key.toLowerCase()),
          ).not.toContain('docker_context');
          if (file === 'netsh.exe') return { status: 0, stdout: table() };
          if (file === 'powershell.exe') {
            // Simulate unavailable PS5 modules: only engine/.NET syntax is allowed.
            expect(args.at(-1)).not.toMatch(
              /ConvertTo-Json|ForEach-Object|Import-Module/,
            );
            return { status: 0, stdout: '45322\t127.0.0.1\r\n' };
          }
          if (args[0] === 'context')
            return {
              status: 0,
              stdout: JSON.stringify('npipe:////./pipe/docker_engine'),
            };
          return { status: 0, stdout: JSON.stringify(container()) };
        },
      });
      expect(environment).toEqual(before);
      expect(calls[3].args).toContain('rancher-desktop');
      expect(calls[4].args.slice(0, 2)).toEqual([
        '--host',
        'npipe:////./pipe/docker_engine',
      ]);
    },
  );
  it('rejects ambiguous case-duplicate Docker overrides without changing parent environment', () => {
    const environment = {
      DOCKER_HOST: 'npipe:////./pipe/docker_engine',
      docker_host: 'tcp://remote.example:2375',
    };
    const before = { ...environment };
    expect(() =>
      preflightLocalSupabasePorts({
        platform: 'win32',
        environment,
        execute(file) {
          return {
            status: 0,
            stdout: file === 'netsh.exe' ? table() : '45322\t127.0.0.1\r\n',
          };
        },
      }),
    ).toThrow('publications');
    expect(environment).toEqual(before);
  });
  it('uses explicit local Docker endpoint ownership and preserves no-healthcheck services', () => {
    const calls = [];
    preflightLocalSupabasePorts({
      platform: 'win32',
      environment: {
        DOCKER_CONTEXT: 'rancher-desktop',
        DOCKER_HOST: 'tcp://hostile.example:2375',
      },
      execute(file, args, options) {
        calls.push({ file, args, options });
        if (file === 'netsh.exe') return { status: 0, stdout: table() };
        if (file === 'powershell.exe')
          return { status: 0, stdout: '45322\t127.0.0.1\r\n' };
        if (args[0] === 'context')
          return {
            status: 0,
            stdout: JSON.stringify('npipe:////./pipe/docker_engine'),
          };
        return { status: 0, stdout: JSON.stringify(container()) };
      },
    });
    expect(calls[3].args).toContain('rancher-desktop');
    expect(calls[4].args.slice(0, 2)).toEqual([
      '--host',
      'npipe:////./pipe/docker_engine',
    ]);
    expect(calls[4].options.env.DOCKER_HOST).toBeUndefined();
    expect(calls[4].options.env.DOCKER_CONTEXT).toBeUndefined();
  });
  it.each(['tcp://remote.example:2375', 'tcp://localhost:2375'])(
    'refuses listener exemptions via %s',
    (endpoint) => {
      expect(() =>
        preflightLocalSupabasePorts({
          platform: 'win32',
          environment: { DOCKER_HOST: endpoint },
          execute(file) {
            return {
              status: 0,
              stdout: file === 'netsh.exe' ? table() : '45322\t127.0.0.1\r\n',
            };
          },
        }),
      ).toThrow('publications');
    },
  );
  it.each([
    { status: 1, stderr: 'secret must not echo' },
    { error: new Error('secret must not echo') },
  ])(
    'fails before startup on unavailable or timed-out enumeration',
    (result) => {
      expect(() =>
        preflightLocalSupabasePorts({
          platform: 'win32',
          execute: () => result,
        }),
      ).toThrow('read-only Windows');
    },
  );
  it('does not run Windows commands on other operating systems', () => {
    preflightLocalSupabasePorts({
      platform: 'linux',
      execute: () => {
        throw new Error('must not execute');
      },
    });
  });
});

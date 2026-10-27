import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';

export const LOCAL_SUPABASE_PORTS = Object.freeze({
  shadow: 45320,
  api: 45321,
  db: 45322,
  studio: 45323,
  mail: 45324,
});

// netsh's headings are localized; the numeric table rows are not. Refuse a
// missing table separator rather than silently treating unexpected output as free.
export function excludedTcpRanges(output) {
  if (!/^\s*-{3,}\s+-{3,}\s*$/m.test(output))
    throw new Error('Could not read Windows excluded TCP port ranges.');
  return [...output.matchAll(/^\s*(\d+)\s+(\d+)\s*\*?\s*$/gm)].map(
    ([, first, last]) => {
      const range = [Number(first), Number(last)];
      if (range[0] < 1 || range[1] > 65535 || range[0] > range[1])
        throw new Error('Invalid Windows excluded TCP port range.');
      return range;
    },
  );
}

const services = [
  ['kong', LOCAL_SUPABASE_PORTS.api, '8000/tcp'],
  ['db', LOCAL_SUPABASE_PORTS.db, '5432/tcp'],
  ['studio', LOCAL_SUPABASE_PORTS.studio, '3000/tcp'],
  ['inbucket', LOCAL_SUPABASE_PORTS.mail, '8025/tcp'],
];

export function verifiedPublishedBindings(containers) {
  const publications = [];
  for (const [service, port, containerPort] of services) {
    const expectedName = `/supabase_${service}_it-inventory`;
    const matching = containers.filter((entry) => entry.name === expectedName);
    if (matching.length !== 1) continue;
    const entry = matching[0];
    // Some CLI services have no Docker HEALTHCHECK. A present check must pass.
    if (
      entry.project !== 'it-inventory' ||
      entry.running !== true ||
      (entry.health !== null && entry.health !== 'healthy')
    )
      continue;
    const bindings = entry.ports?.[containerPort];
    if (
      Array.isArray(bindings) &&
      bindings.length > 0 &&
      bindings.every(
        (binding) => binding.HostPort === String(port) && isIP(binding.HostIp),
      )
    )
      publications.push(
        ...bindings.map((binding) => ({
          port,
          address: binding.HostIp,
        })),
      );
  }
  return publications;
}

export function parseWindowsListeners(output) {
  if (!output.trim()) return [];
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(\d{1,5})\t([^\s]+)$/.exec(line);
      if (
        !match ||
        !isIP(match[2]) ||
        Number(match[1]) < 1 ||
        Number(match[1]) > 65535
      )
        throw new Error('Invalid local TCP listener enumeration.');
      return { port: Number(match[1]), address: match[2] };
    });
}

function normalizedAddress(address) {
  // .NET and Docker may use equivalent compressed/expanded IPv6 notation.
  // Scoped addresses retain their interface suffix and require exact equality.
  return isIP(address) === 6 && !address.includes('%')
    ? new URL(`http://[${address}]`).hostname.slice(1, -1)
    : address.toLowerCase();
}

export function publicationCoversListener(publication, listener) {
  const family = isIP(publication.address);
  if (
    !family ||
    family !== isIP(listener.address) ||
    publication.port !== listener.port
  )
    return false;
  return (
    normalizedAddress(publication.address) ===
      normalizedAddress(listener.address) ||
    (family === 4 && publication.address === '0.0.0.0') ||
    (family === 6 && normalizedAddress(publication.address) === '::')
  );
}

export function assertAvailableLocalPorts({ ranges, listening, publications }) {
  const conflicts = [];
  for (const port of Object.values(LOCAL_SUPABASE_PORTS)) {
    const listeners = listening.filter((listener) => listener.port === port);
    // Every observed address must be covered by a verified publication. This
    // explains the observed binding, not the listener's PID or a future bind.
    // IPv6 wildcard publication never implies IPv4/dual-stack coverage.
    if (
      listeners.length > 0 &&
      listeners.every((listener) =>
        publications.some((publication) =>
          publicationCoversListener(publication, listener),
        ),
      )
    )
      continue;
    if (ranges.some(([first, last]) => port >= first && port <= last))
      conflicts.push(`${port} is excluded by Windows`);
    else if (listeners.length > 0)
      conflicts.push(`${port} already has an unrelated or unhealthy listener`);
  }
  if (conflicts.length)
    throw new Error(
      `Local Supabase port preflight failed: ${conflicts.join('; ')}. Stop the conflicting local service or review the Windows reservation with the owner. No network settings were changed. Do not reset the database to repair a port binding.`,
    );
}

export function preflightLocalSupabasePorts({
  platform = process.platform,
  execute = spawnSync,
  environment = process.env,
} = {}) {
  if (platform !== 'win32') return;
  const childEnv = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !['docker_context', 'docker_host'].includes(key.toLowerCase()),
    ),
  );
  const environmentValue = (name) => {
    const matches = Object.entries(environment).filter(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    if (matches.length > 1)
      throw new Error('Ambiguous Docker environment override.');
    return matches[0]?.[1];
  };
  const read = (file, args, optional = false) => {
    const result = execute(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: childEnv,
    });
    if (result.error || result.status !== 0) {
      if (optional) return '';
      throw new Error(
        'Could not complete the read-only Windows local-port preflight. Check netsh and Windows PowerShell availability; no network settings were changed.',
      );
    }
    return result.stdout;
  };
  const ranges = ['ipv4', 'ipv6'].flatMap((family) =>
    excludedTcpRanges(
      read('netsh.exe', [
        'interface',
        family,
        'show',
        'excludedportrange',
        'protocol=tcp',
      ]),
    ),
  );
  // Engine syntax and .NET only: no module auto-loading, ConvertTo-Json or
  // ForEach-Object. PS7's inherited PSModulePath therefore cannot break PS5.
  // Only fixed numeric/IP fields are serialized, never process/environment data.
  const raw = read('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$ErrorActionPreference = 'Stop'; foreach ($listener in [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()) { [Console]::WriteLine($listener.Port.ToString([System.Globalization.CultureInfo]::InvariantCulture) + [char]9 + $listener.Address.ToString()) }",
  ]);
  let listening, containers;
  try {
    listening = parseWindowsListeners(raw);
    containers = [];
    if (
      listening.some(({ port }) =>
        Object.values(LOCAL_SUPABASE_PORTS).includes(port),
      )
    ) {
      const context = environmentValue('DOCKER_CONTEXT');
      const endpoint = context
        ? JSON.parse(
            read('docker', [
              'context',
              'inspect',
              context,
              '--format',
              '{{json .Endpoints.docker.Host}}',
            ]),
          )
        : environmentValue('DOCKER_HOST') ||
          JSON.parse(
            read('docker', [
              'context',
              'inspect',
              '--format',
              '{{json .Endpoints.docker.Host}}',
            ]),
          );
      // Windows-owned listener exemptions require the local named-pipe daemon.
      // A remote daemon with matching labels cannot establish host ownership.
      if (
        typeof endpoint !== 'string' ||
        !/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(endpoint)
      )
        throw new Error();
      const inspected = read(
        'docker',
        [
          '--host',
          endpoint,
          'inspect',
          '--type',
          'container',
          '--format',
          '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"ports":{{json .NetworkSettings.Ports}}}',
          ...services.map(([service]) => `supabase_${service}_it-inventory`),
        ],
        true,
      );
      containers = inspected
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }
  } catch {
    throw new Error(
      'Could not verify local TCP listener publications; no network settings were changed.',
    );
  }
  assertAvailableLocalPorts({
    ranges,
    listening,
    publications: verifiedPublishedBindings(containers),
  });
}

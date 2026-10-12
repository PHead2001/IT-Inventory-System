const stages = [
  'build-input',
  'auth-signin',
  'auth-signout',
  'backend',
  'prepare',
  'listen',
  'request-1',
  'request-2',
  'response-1',
  'response-2',
  'tree-1',
  'tree-2',
  'server-close',
  'app-close',
  'child',
  'unknown',
];
const reasons = [
  'failure',
  'origin',
  'status',
  'content-type',
  'size',
  'framing',
  'json',
  'tree',
  'literal',
  'deadline',
  'spawn',
  'cleanup',
  'unknown',
];
export function probeFailureMarker(stage, reason) {
  return stages.includes(stage) && reasons.includes(reason)
    ? `probe-failure:${stage}.${reason}`
    : 'probe-failure:unknown.unknown';
}
export function extractProbeFailure(transcript) {
  const bounded =
    typeof transcript === 'string' ? transcript.slice(0, 128 * 1024) : '';
  return (
    bounded.match(
      new RegExp(
        `\\bprobe-failure:(${stages.join('|')})\\.(${reasons.join('|')})(?![\\w.-])`,
      ),
    )?.[0] ?? 'probe-failure:unknown.unknown'
  );
}
export function childFailureDiagnostic(signal, deadlineFired, diagnostic) {
  if (deadlineFired) return probeFailureMarker('child', 'deadline');
  if (signal) return probeFailureMarker('child', 'failure');
  return extractProbeFailure(diagnostic);
}
export function classifyProbeFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  for (const [prefix, reason] of [
    ['refusing nonlocal', 'origin'],
    ['viewer must receive Settings', 'status'],
    ['requires a Flight response', 'content-type'],
    ['Flight response exceeds', 'size'],
    ['Unsupported length-framed', 'framing'],
    ['Malformed Flight JSON', 'json'],
    ['requires one exact BuildInfo', 'tree'],
    ['BuildInfo requires', 'literal'],
    ['served environment/version', 'literal'],
    ['served commit', 'literal'],
    ['served time', 'literal'],
  ])
    if (message.startsWith(prefix)) return reason;
  return 'failure';
}

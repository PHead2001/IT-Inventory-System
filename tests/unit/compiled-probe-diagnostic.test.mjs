import { expect, it } from 'vitest';
import {
  probeFailureMarker,
  extractProbeFailure,
  classifyProbeFailure,
  childFailureDiagnostic,
} from '../helpers/compiled-probe-diagnostic.mjs';
it('surfaces only known stage/reason tokens, never arbitrary child fields or transcript', () => {
  expect(probeFailureMarker('tree-1', 'framing')).toBe(
    'probe-failure:tree-1.framing',
  );
  expect(
    extractProbeFailure(
      'private prefix\nerror: probe-failure:tree-1.framing\nprivate suffix',
    ),
  ).toBe('probe-failure:tree-1.framing');
  for (const input of [
    'secret',
    'probe-failure:secret.token',
    'probe-failure:tree-1.framing-secret',
    'probe-failure:tree-1.framing.extra',
    'x'.repeat(128 * 1024) + 'probe-failure:tree-1.framing',
  ]) {
    expect(extractProbeFailure(input)).toBe('probe-failure:unknown.unknown');
  }
  expect(probeFailureMarker('secret-stage', 'failure')).toBe(
    'probe-failure:unknown.unknown',
  );
  expect(probeFailureMarker('tree-1', 'secret-reason')).toBe(
    'probe-failure:unknown.unknown',
  );
});
it('classifies known assertion failures while discarding raw errors', () => {
  expect(
    classifyProbeFailure(
      new Error('Unsupported length-framed Flight payload\nprivate remainder'),
    ),
  ).toBe('framing');
  expect(classifyProbeFailure(new Error('requires a Flight response'))).toBe(
    'content-type',
  );
  expect(
    classifyProbeFailure(new Error('arbitrary credential-bearing error')),
  ).toBe('failure');
});
it('calls an exit a deadline only when this probe fired its own deadline', () => {
  for (const signal of ['SIGABRT', 'SIGKILL', 'SIGTERM']) {
    expect(
      childFailureDiagnostic(signal, false, 'probe-failure:tree-1.framing'),
    ).toBe('probe-failure:child.failure');
  }
  expect(
    childFailureDiagnostic('SIGKILL', true, 'probe-failure:tree-1.framing'),
  ).toBe('probe-failure:child.deadline');
  expect(
    childFailureDiagnostic(null, false, 'probe-failure:tree-1.framing'),
  ).toBe('probe-failure:tree-1.framing');
});

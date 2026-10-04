import { describe, expect, it } from 'vitest';
import {
  captureE2eEvidence,
  e2eDiagnostics,
} from '../../scripts/e2e-diagnostics';

describe('browser diagnostic capture policy', () => {
  it('keeps local failure traces and screenshots without recording passing videos', () => {
    expect(e2eDiagnostics({})).toEqual({
      trace: 'retain-on-failure',
      video: 'off',
      screenshot: 'only-on-failure',
    });
  });

  it('captures CI traces and videos on the first retry while retaining failure screenshots', () => {
    expect(e2eDiagnostics({ CI: 'true' })).toEqual({
      trace: 'on-first-retry',
      video: 'on-first-retry',
      screenshot: 'only-on-failure',
    });
  });

  it.each([{}, { CI: 'true' }])(
    'explicit evidence captures every attempt in %j',
    (env) => {
      expect(e2eDiagnostics({ ...env, E2E_CAPTURE_EVIDENCE: '1' })).toEqual({
        trace: 'on',
        video: 'on',
        screenshot: 'only-on-failure',
      });
    },
  );

  it.each([undefined, '', '0', 'true', 'false', ' 1 '])(
    'requires exact evidence opt-in rather than %j',
    (value) => {
      const env = { E2E_CAPTURE_EVIDENCE: value };
      expect(captureE2eEvidence(env)).toBe(false);
      expect(e2eDiagnostics(env)).toEqual(e2eDiagnostics({}));
      expect(e2eDiagnostics({ ...env, CI: '1' })).toEqual(
        e2eDiagnostics({ CI: '1' }),
      );
    },
  );
});

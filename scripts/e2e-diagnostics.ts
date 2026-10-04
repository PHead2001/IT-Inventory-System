import type { PlaywrightWorkerOptions } from '@playwright/test';

type CaptureEnvironment = Readonly<Record<string, string | undefined>>;

export function captureE2eEvidence(env: CaptureEnvironment = process.env) {
  return env.E2E_CAPTURE_EVIDENCE === '1';
}

export function e2eDiagnostics(
  env: CaptureEnvironment = process.env,
): Pick<PlaywrightWorkerOptions, 'trace' | 'video' | 'screenshot'> {
  if (captureE2eEvidence(env))
    return { trace: 'on', video: 'on', screenshot: 'only-on-failure' };
  return {
    trace: env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: env.CI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
  };
}

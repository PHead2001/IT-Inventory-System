import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  FullConfig,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import PerformanceReporter, {
  failureMetadata,
  failureSummary,
  linuxMemory,
} from '../../scripts/e2e-performance-reporter';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  const writes = {
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
  return { ...original, ...writes, default: { ...original, ...writes } };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('bounded browser failure fallback', () => {
  const sentinel = 'PRIVATE_SENTINEL';
  const testCase = {
    location: { file: resolve('tests/e2e/inventory.spec.ts'), line: 41 },
    title: sentinel,
  } as TestCase;
  const result = {
    status: 'timedOut',
    retry: 1,
    workerIndex: 2,
    errors: [{ message: sentinel, stack: sentinel }],
    attachments: [
      { name: 'trace', path: sentinel, body: Buffer.from(sentinel) },
    ],
    stdout: [sentinel],
    stderr: [sentinel],
  } as unknown as TestResult;

  it('retains source coordinates and failure state without assertion or attachment data', () => {
    expect(failureMetadata(testCase, result)).toEqual({
      file: 'tests/e2e/inventory.spec.ts',
      line: 41,
      status: 'timedOut',
      retry: 1,
      workerIndex: 2,
      errorCount: 1,
      traceAttached: true,
    });
    expect(JSON.stringify(failureMetadata(testCase, result))).not.toContain(
      sentinel,
    );
  });

  it('omits untrusted paths and invalid coordinates rather than dumping them', () => {
    for (const file of [
      resolve('../private.txt'),
      resolve(`tests/e2e/${'a'.repeat(200)}.spec.ts`),
      'https://host/path?secret=PRIVATE_SENTINEL',
    ]) {
      const metadata = failureMetadata(
        {
          ...testCase,
          location: { file, line: Infinity, column: 1 },
        } as TestCase,
        { ...result, retry: -1 },
      );
      expect(metadata.file).toBe('unavailable');
      expect(metadata.line).toBeNull();
      expect(metadata.retry).toBeNull();
    }
  });

  it('caps the summary and exposes omitted records and unavailable trace guidance', () => {
    const records = Array.from({ length: 1000 }, () =>
      failureMetadata(testCase, result),
    );
    const summary = failureSummary(records, 1000);
    expect(summary.records).toHaveLength(20);
    expect(summary.omitted).toBe(980);
    expect(summary.guidance).toContain('upload succeeded');
    expect(summary.guidance).toContain('no downloadable trace');
    expect(JSON.stringify(summary).length).toBeLessThan(6000);
    expect(JSON.stringify(summary)).not.toContain(sentinel);
  });

  it('publishes the bounded fallback to stdout and the job summary without writing test data', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('GITHUB_STEP_SUMMARY', 'summary-path');
    const reporter = new PerformanceReporter();
    reporter.onBegin(
      { workers: 1 } as FullConfig,
      { allTests: () => [] } as unknown as Suite,
    );
    for (let index = 0; index < 22; index++) {
      reporter.onTestEnd(
        {
          ...testCase,
          id: String(index),
          outcome: () => 'unexpected',
        } as TestCase,
        result,
      );
    }
    reporter.onEnd({ status: 'failed', startTime: new Date(), duration: 1 });
    const logged = log.mock.calls.find(([value]) =>
      String(value).startsWith('E2E failure metadata: '),
    )?.[0];
    expect(logged).toBeDefined();
    expect(
      JSON.parse(String(logged).slice('E2E failure metadata: '.length)),
    ).toMatchObject({ failedAttempts: 22, omitted: 2 });
    expect(appendFileSync).toHaveBeenCalledWith(
      'summary-path',
      expect.stringContaining('Browser failure metadata'),
    );
    expect(JSON.stringify(vi.mocked(appendFileSync).mock.calls)).not.toContain(
      sentinel,
    );
  });
});

describe('sanitized E2E resource metrics', () => {
  it('uses available memory and actual swap consumption, not free memory alone', () => {
    expect(
      linuxMemory(
        'MemTotal: 6291456 kB\nMemFree: 512 kB\nMemAvailable: 1048576 kB\nSwapTotal: 1048576 kB\nSwapFree: 786432 kB\n',
      ),
    ).toEqual({
      totalMiB: 6144,
      availableMiB: 1024,
      swapUsedMiB: 256,
    });
  });

  it('refuses absent memory availability instead of presenting zero pressure', () => {
    expect(() =>
      linuxMemory('MemTotal: 6291456 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'),
    ).toThrow('unavailable');
  });
});

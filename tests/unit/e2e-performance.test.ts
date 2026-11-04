import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
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
  AttemptTiming,
  CpuMetrics,
  MAX_SPEC_RECORDS,
  MAX_TIMING_INTERVALS,
} from '../../scripts/e2e-performance-reporter';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  const writes = {
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(original.readFileSync),
  };
  return { ...original, ...writes, default: { ...original, ...writes } };
});

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  const metrics = {
    platform: vi.fn(() => 'win32'),
    cpus: vi.fn(original.cpus),
  };
  return { ...original, ...metrics, default: { ...original, ...metrics } };
});

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const command = { spawnSync: vi.fn(() => ({ status: 1, stdout: '' })) };
  return { ...original, ...command, default: { ...original, ...command } };
});

beforeEach(() => {
  vi.mocked(platform).mockReturnValue('win32');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const attempt = (
  start: number,
  duration: number,
  status: TestResult['status'] = 'passed',
) => ({ startTime: new Date(start), duration, status });

function savedSummary() {
  const write = vi
    .mocked(writeFileSync)
    .mock.calls.find(([path]) => path === 'test-results/e2e-performance.json');
  expect(write).toBeDefined();
  return JSON.parse(String(write?.[1]));
}

function reporterTest(file: string, project = 'chromium-parallel') {
  return {
    id: file,
    location: { file: resolve(file), line: 1 },
    parent: { project: () => ({ name: project }) },
    outcome: () => 'expected',
  } as unknown as TestCase;
}

function reportedAttempt(
  start: number,
  duration: number,
  status: TestResult['status'] = 'passed',
) {
  return {
    ...attempt(start, duration, status),
    errors: [],
    attachments: [],
    retry: 0,
    workerIndex: 0,
  } as unknown as TestResult;
}

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
      assertionLocations: [null],
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

  it('retains only known-file assertion coordinates from bounded serialized stacks', () => {
    const stack = [
      'Error: PRIVATE_SENTINEL',
      '    at helper (C:\\private\\PRIVATE_SENTINEL.ts:9:2)',
      '    at run (' + resolve('tests/e2e/inventory.spec.ts') + ':1482:24)',
      '    at forged (' + resolve('tests/e2e/other.spec.ts') + ':77:1)',
    ].join('\n');
    const metadata = failureMetadata(testCase, {
      ...result,
      errors: [{ stack }],
    } as TestResult);
    expect(metadata.assertionLocations).toEqual([{ line: 1482, column: 24 }]);
    expect(JSON.stringify(metadata)).not.toContain(sentinel);
    const oversized = failureMetadata(testCase, {
      ...result,
      errors: Array.from({ length: 20 }, () => ({ stack })),
    } as TestResult);
    expect(oversized.assertionLocations).toHaveLength(3);
    for (const value of [
      'at run (' + resolve('tests/e2e/other.spec.ts') + ':77:1)',
      'at run (' + resolve('tests/e2e/inventory.spec.ts') + ':0:1)',
      'at run (' + resolve('tests/e2e/inventory.spec.ts') + ':77:0)',
      'at run (' +
        resolve('tests/e2e/inventory.spec.ts') +
        ':77:1?PRIVATE_SENTINEL)',
      'x'.repeat(65_536) + '\n' + stack,
    ])
      expect(
        failureMetadata(testCase, {
          ...result,
          errors: [{ stack: value }],
        } as TestResult).assertionLocations,
      ).toEqual([null]);
  });

  it('emits sanitized attempts before finalization and caps immediate output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(appendFileSync).mockClear();
    const reporter = new PerformanceReporter();
    for (let index = 0; index < 22; index++)
      reporter.onTestEnd(
        {
          ...testCase,
          id: String(index),
          outcome: () => 'unexpected',
        } as TestCase,
        result,
      );
    expect(log).toHaveBeenCalledTimes(20);
    expect(
      log.mock.calls.every(([value]) =>
        String(value).startsWith('E2E failed attempt: '),
      ),
    ).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    expect(appendFileSync).not.toHaveBeenCalled();
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

  it('rejects impossible or overflowing memory counters', () => {
    for (const memory of [
      'MemTotal: 0 kB\nMemAvailable: 0 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
      'MemTotal: 10 kB\nMemAvailable: 11 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
      'MemTotal: 10 kB\nMemAvailable: 1 kB\nSwapTotal: 1 kB\nSwapFree: 2 kB\n',
      'MemTotal: 999999999999999999999999 kB\nMemAvailable: 1 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
    ])
      expect(() => linuxMemory(memory)).toThrow('unavailable');
  });

  it('weights average CPU by actual deltas and keeps the peak separately', () => {
    const metrics = new CpuMetrics();
    metrics.observe({ busy: 0, idle: 0 });
    metrics.observe({ busy: 9, idle: 1 });
    metrics.observe({ busy: 19, idle: 81 });
    expect(metrics.summary()).toEqual({
      cpuIntervals: 2,
      unavailableCpuIntervals: 0,
      averageCpuPercent: 19,
      peakCpuPercent: 90,
    });
  });

  it('reports null without a measured CPU interval and recovers after reset or unavailable counters', () => {
    const metrics = new CpuMetrics();
    expect(metrics.summary().averageCpuPercent).toBeNull();
    metrics.observe({ busy: 100, idle: 100 });
    metrics.observe({ busy: 100, idle: 100 });
    metrics.observe({ busy: 2, idle: 3 });
    expect(metrics.summary()).toMatchObject({
      cpuIntervals: 0,
      unavailableCpuIntervals: 2,
      averageCpuPercent: null,
      peakCpuPercent: null,
    });
    metrics.observe({ busy: 3, idle: 6 });
    metrics.observe({ busy: NaN, idle: 10 });
    metrics.observe(null);
    metrics.observe({ busy: 1000, idle: 1000 });
    expect(metrics.summary()).toMatchObject({
      cpuIntervals: 1,
      unavailableCpuIntervals: 4,
      averageCpuPercent: 25,
      peakCpuPercent: 25,
    });
  });

  it('starts CPU sampling at onBegin and preserves CPU data when memory is unavailable', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(platform).mockReturnValue('linux');
    const processors = (user: number, idle: number) => [
      {
        model: 'test',
        speed: 0,
        times: { user, idle, nice: 0, sys: 0, irq: 0 },
      },
    ];
    vi.mocked(cpus).mockReturnValue(processors(10, 10));
    vi.mocked(readFileSync).mockImplementation((file) => {
      if (file === '/proc/vmstat') return 'oom_kill 4\n';
      throw new Error('unavailable');
    });
    const reporter = new PerformanceReporter();
    expect(cpus).not.toHaveBeenCalled();
    reporter.onBegin(
      { workers: 2 } as FullConfig,
      { allTests: () => [] } as unknown as Suite,
    );
    vi.mocked(cpus).mockReturnValue(processors(20, 100));
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 1 });
    expect(savedSummary().resources).toMatchObject({
      samples: 2,
      memorySamples: 0,
      minimumAvailableMemoryMiB: null,
      averageCpuPercent: 10,
      peakCpuPercent: 10,
      cpuIntervals: 1,
      oomKillDelta: 0,
      metricFailures: 2,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounded E2E timing evidence', () => {
  it('distinguishes overlapping attempt sums, active interval union and elapsed gaps', () => {
    const timing = new AttemptTiming();
    timing.record(attempt(1000, 3000));
    timing.record(attempt(2000, 3000, 'failed'));
    timing.record(attempt(7000, 1000));
    timing.record(attempt(0, 999999, 'skipped'));
    expect(timing.summary()).toEqual({
      attempts: 4,
      skippedAttempts: 1,
      attemptDurationSeconds: 7,
      activeIntervalSeconds: 5,
      elapsedSeconds: 7,
      unavailableDurations: 0,
      unavailableIntervals: 0,
      intervalLimitExceeded: false,
    });
  });

  it('merges out-of-order and bridging intervals without double counting retries', () => {
    const timing = new AttemptTiming();
    for (const [start, duration] of [
      [5000, 1000],
      [1000, 1000],
      [2000, 3000],
      [1000, 1000],
    ])
      timing.record(attempt(start, duration));
    expect(timing.summary()).toMatchObject({
      attempts: 4,
      attemptDurationSeconds: 6,
      activeIntervalSeconds: 5,
      elapsedSeconds: 5,
    });
  });

  it('keeps unavailable timings null while skipped-only timing has no execution interval', () => {
    const timing = new AttemptTiming();
    timing.record(attempt(0, 200, 'skipped'));
    expect(timing.summary()).toMatchObject({
      attemptDurationSeconds: 0,
      activeIntervalSeconds: null,
      elapsedSeconds: null,
    });
    timing.record(attempt(NaN, 1000));
    expect(timing.summary()).toMatchObject({
      attemptDurationSeconds: 1,
      activeIntervalSeconds: null,
      elapsedSeconds: null,
      unavailableIntervals: 1,
    });
    timing.record(attempt(0, -1));
    expect(timing.summary()).toMatchObject({
      attemptDurationSeconds: null,
      unavailableDurations: 1,
      unavailableIntervals: 2,
    });
  });

  it('limits retained intervals and reports the active total unavailable after overflow', () => {
    const timing = new AttemptTiming();
    for (let index = 0; index <= MAX_TIMING_INTERVALS; index++)
      timing.record(attempt(index * 2000, 1000));
    expect(timing.summary()).toMatchObject({
      attempts: MAX_TIMING_INTERVALS + 1,
      attemptDurationSeconds: MAX_TIMING_INTERVALS + 1,
      activeIntervalSeconds: null,
      elapsedSeconds: MAX_TIMING_INTERVALS * 2 + 1,
      intervalLimitExceeded: true,
    });
  });

  it('reports per-spec retries and phase overlap without leaking raw project names, IDs or titles', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = new PerformanceReporter();
    const parallel = reporterTest('tests/e2e/00-room.spec.ts');
    reporter.onBegin(
      { workers: 2 } as FullConfig,
      {
        allTests: () => [parallel],
      } as unknown as Suite,
    );
    reporter.onTestEnd(parallel, {
      ...reportedAttempt(1000, 3000, 'failed'),
      errors: [
        {
          stack:
            'PRIVATE_SENTINEL\n    at journey (' +
            resolve('tests/e2e/00-room.spec.ts') +
            ':1482:24)',
        },
      ],
    });
    reporter.onTestEnd(parallel, reportedAttempt(5000, 1000));
    reporter.onTestEnd(
      reporterTest('tests/e2e/inventory.spec.ts'),
      reportedAttempt(2000, 3000),
    );
    reporter.onTestEnd(
      reporterTest('tests/e2e/auth.spec.ts', 'chromium-exclusive'),
      reportedAttempt(0, 1000),
    );
    reporter.onTestEnd(
      reporterTest(
        'https://host/PRIVATE_SENTINEL?secret=1',
        'PRIVATE_SENTINEL',
      ),
      reportedAttempt(0, 0, 'skipped'),
    );
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 1 });
    const summary = savedSummary();
    expect(summary.timing.phases.parallel).toMatchObject({
      attempts: 3,
      attemptDurationSeconds: 7,
      activeIntervalSeconds: 5,
      elapsedSeconds: 5,
    });
    expect(summary.timing.phases.exclusive.activeIntervalSeconds).toBe(1);
    expect(summary.timing.phases.unclassified.skippedAttempts).toBe(1);
    expect(
      summary.timing.specs.find(
        ({ file }: { file: string }) => file === 'tests/e2e/00-room.spec.ts',
      ),
    ).toMatchObject({
      attempts: 2,
      attemptDurationSeconds: 4,
      activeIntervalSeconds: 4,
      elapsedSeconds: 5,
    });
    const failure = log.mock.calls.find(([value]) =>
      String(value).startsWith('E2E failed attempt: '),
    )?.[0];
    expect(
      JSON.parse(String(failure).slice('E2E failed attempt: '.length)),
    ).toMatchObject({
      file: 'tests/e2e/00-room.spec.ts',
      assertionLocations: [{ line: 1482, column: 24 }],
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SENTINEL');
    expect(JSON.stringify(summary)).not.toContain('PRIVATE_SENTINEL');
    const output = log.mock.calls.find(([value]) =>
      String(value).startsWith('E2E performance: '),
    )?.[0];
    expect(String(output)).not.toContain('room.spec.ts');
    expect(summary.resources).toMatchObject({
      samples: 0,
      averageCpuPercent: null,
      peakCpuPercent: null,
      totalMemoryMiB: null,
    });
  });

  it('caps spec records without silently dropping attempts from phase totals', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = new PerformanceReporter();
    reporter.onBegin(
      { workers: 1 } as FullConfig,
      {
        allTests: () => [],
      } as unknown as Suite,
    );
    for (let index = 0; index < MAX_SPEC_RECORDS + 2; index++)
      reporter.onTestEnd(
        reporterTest(`tests/e2e/spec-${index}.spec.ts`),
        reportedAttempt(0, 1000),
      );
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 1 });
    const summary = savedSummary();
    expect(summary.timing.specs).toHaveLength(MAX_SPEC_RECORDS);
    expect(summary.timing.omittedSpecAttempts).toBe(2);
    expect(summary.timing.phases.parallel.attempts).toBe(MAX_SPEC_RECORDS + 2);
    expect(JSON.stringify(summary).length).toBeLessThan(100_000);
  });
});

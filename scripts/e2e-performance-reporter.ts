import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { relative } from 'node:path';
import { cpus, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

export const MAX_FAILURE_RECORDS = 20;
export const MAX_SPEC_RECORDS = 200;
export const MAX_TIMING_INTERVALS = 256;

function sourceFile(file: string) {
  const source = relative(process.cwd(), file).replaceAll('\\', '/');
  return source.length <= 160 &&
    /^tests\/e2e\/[a-zA-Z0-9_/-]+\.spec\.ts$/.test(source)
    ? source
    : 'unavailable';
}

export function failureMetadata(test: TestCase, result: TestResult) {
  // Source coordinates only, never titles, errors, attachments, stdout or bodies.
  const integer = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
      ? value
      : null;
  return {
    file: sourceFile(test.location.file),
    line: integer(test.location.line),
    status: ['failed', 'timedOut', 'interrupted'].includes(result.status)
      ? result.status
      : 'unknown',
    retry: integer(result.retry),
    workerIndex: integer(result.workerIndex),
    errorCount: Math.min(result.errors.length, 100),
    traceAttached: result.attachments.some(
      (attachment) => attachment.name === 'trace',
    ),
  };
}

export function failureSummary(
  records: ReturnType<typeof failureMetadata>[],
  total: number,
) {
  return {
    failedAttempts: total,
    omitted: Math.max(0, total - MAX_FAILURE_RECORDS),
    records: records.slice(0, MAX_FAILURE_RECORDS),
    guidance:
      'Assertion details are in the Validate browser workflows log. Download traces from foundation-failures only if the upload succeeded; artifact quota or service failure leaves no downloadable trace. Metadata is limited to 20 failed attempts and excludes titles, error bodies and attachment contents.',
  };
}

export function linuxMemory(text: string) {
  const value = (name: string) => {
    const match = text.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm'));
    if (!match) throw new Error('Linux memory metric unavailable.');
    const bytes = Number(match[1]);
    if (!Number.isSafeInteger(bytes))
      throw new Error('Linux memory metric unavailable.');
    return bytes / 1024;
  };
  const totalMiB = value('MemTotal');
  const availableMiB = value('MemAvailable');
  const swapTotal = value('SwapTotal');
  const swapFree = value('SwapFree');
  if (totalMiB <= 0 || availableMiB > totalMiB || swapFree > swapTotal)
    throw new Error('Linux memory metric unavailable.');
  return { totalMiB, availableMiB, swapUsedMiB: swapTotal - swapFree };
}

type CpuTime = { busy: number; idle: number };

export class CpuMetrics {
  private previous: CpuTime | null = null;
  private busy = 0;
  private total = 0;
  private peak = 0;
  private intervals = 0;
  private unavailableIntervals = 0;

  observe(current: CpuTime | null) {
    const valid = (value: CpuTime | null): value is CpuTime =>
      value !== null &&
      Number.isFinite(value.busy) &&
      Number.isFinite(value.idle) &&
      value.busy >= 0 &&
      value.idle >= 0;
    if (!valid(current)) {
      this.previous = null;
      this.unavailableIntervals++;
      return false;
    }
    const previous = this.previous;
    this.previous = current;
    if (!previous) return true;
    const busy = current.busy - previous.busy;
    const idle = current.idle - previous.idle;
    const total = busy + idle;
    if (busy < 0 || idle < 0 || !Number.isFinite(total) || total <= 0) {
      this.unavailableIntervals++;
      return false;
    }
    this.busy += busy;
    this.total += total;
    this.peak = Math.max(this.peak, (100 * busy) / total);
    this.intervals++;
    return true;
  }

  summary() {
    return {
      cpuIntervals: this.intervals,
      unavailableCpuIntervals: this.unavailableIntervals,
      // Weight by actual CPU-time deltas, never by rounded sample percentages.
      averageCpuPercent: this.total ? (100 * this.busy) / this.total : null,
      peakCpuPercent: this.intervals ? this.peak : null,
    };
  }
}

export class AttemptTiming {
  private attempts = 0;
  private skippedAttempts = 0;
  private duration = 0;
  private unavailableDurations = 0;
  private unavailableIntervals = 0;
  private intervals: [number, number][] = [];
  private overflow = false;
  private firstStart = Infinity;
  private lastEnd = -Infinity;

  record(result: Pick<TestResult, 'status' | 'duration' | 'startTime'>) {
    this.attempts++;
    if (result.status === 'skipped') {
      this.skippedAttempts++;
      return;
    }
    if (!Number.isFinite(result.duration) || result.duration < 0) {
      this.unavailableDurations++;
      this.unavailableIntervals++;
      return;
    }
    this.duration += result.duration;
    const start = result.startTime?.getTime();
    const end = start + result.duration;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      this.unavailableIntervals++;
      return;
    }
    this.firstStart = Math.min(this.firstStart, start);
    this.lastEnd = Math.max(this.lastEnd, end);
    if (this.overflow) return;
    // Merge overlap and adjacency; retries remain separate when there is a gap.
    const merged: [number, number][] = [];
    let interval: [number, number] = [start, end];
    for (const existing of this.intervals) {
      if (existing[1] < interval[0]) merged.push(existing);
      else if (interval[1] < existing[0]) {
        merged.push(interval);
        interval = existing;
      } else {
        interval = [
          Math.min(interval[0], existing[0]),
          Math.max(interval[1], existing[1]),
        ];
      }
    }
    merged.push(interval);
    if (merged.length > MAX_TIMING_INTERVALS) {
      this.overflow = true;
      this.intervals = [];
    } else this.intervals = merged;
  }

  summary() {
    const hasExecution = this.attempts > this.skippedAttempts;
    return {
      attempts: this.attempts,
      skippedAttempts: this.skippedAttempts,
      attemptDurationSeconds: this.unavailableDurations
        ? null
        : this.duration / 1000,
      elapsedSeconds:
        !hasExecution || this.unavailableIntervals
          ? null
          : (this.lastEnd - this.firstStart) / 1000,
      activeIntervalSeconds:
        !hasExecution || this.overflow || this.unavailableIntervals
          ? null
          : this.intervals.reduce(
              (total, [start, end]) => total + end - start,
              0,
            ) / 1000,
      unavailableDurations: this.unavailableDurations,
      unavailableIntervals: this.unavailableIntervals,
      intervalLimitExceeded: this.overflow,
    };
  }
}

function oomKills() {
  const match = readFileSync('/proc/vmstat', 'utf8').match(/^oom_kill (\d+)$/m);
  if (!match) throw new Error('Linux OOM metric unavailable.');
  return Number(match[1]);
}

function cpuTime() {
  const processors = cpus();
  if (!processors.length) throw new Error('CPU metric unavailable.');
  return processors.reduce(
    (total, cpu) => ({
      busy:
        total.busy +
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.irq,
      idle: total.idle + cpu.times.idle,
    }),
    { busy: 0, idle: 0 },
  );
}

export default class PerformanceReporter {
  private readonly listing = process.argv.includes('--list');
  private started = 0;
  private discovered = 0;
  private workers = 0;
  private attempts = 0;
  private activeTests = new Set<string>();
  private peakConcurrentTests = 0;
  private finalTests = new Map<
    string,
    { result: TestResult['status']; outcome: string }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private cpu = new CpuMetrics();
  private cpuCount: number | null = null;
  private samples = 0;
  private memorySamples = 0;
  private specs = new Map<string, AttemptTiming>();
  private omittedSpecAttempts = 0;
  private phases = {
    exclusive: new AttemptTiming(),
    parallel: new AttemptTiming(),
    ordinary: new AttemptTiming(),
    unclassified: new AttemptTiming(),
  };
  private totalMemoryMiB: number | null = null;
  private minimumAvailableMemoryMiB: number | null = null;
  private peakSwapUsedMiB: number | null = null;
  private initialOomKills: number | null = null;
  private metricFailures = 0;
  private failureCount = 0;
  private failures: ReturnType<typeof failureMetadata>[] = [];

  private sample() {
    if (platform() !== 'linux') return;
    this.samples++;
    try {
      const memory = linuxMemory(readFileSync('/proc/meminfo', 'utf8'));
      this.totalMemoryMiB = memory.totalMiB;
      this.minimumAvailableMemoryMiB = Math.min(
        this.minimumAvailableMemoryMiB ?? Infinity,
        memory.availableMiB,
      );
      this.peakSwapUsedMiB = Math.max(
        this.peakSwapUsedMiB ?? 0,
        memory.swapUsedMiB,
      );
      this.memorySamples++;
    } catch {
      this.metricFailures++;
    }
    try {
      if (!this.cpu.observe(cpuTime())) this.metricFailures++;
    } catch {
      this.cpu.observe(null);
      this.metricFailures++;
    }
  }

  onBegin(config: FullConfig, suite: Suite) {
    if (this.listing) return;
    this.started = performance.now();
    this.discovered = suite.allTests().length;
    this.workers = config.workers;
    try {
      this.cpuCount = cpus().length || null;
    } catch {
      this.metricFailures++;
    }
    if (platform() === 'linux') {
      try {
        this.initialOomKills = oomKills();
      } catch {
        this.metricFailures++;
      }
      this.sample();
      this.timer = setInterval(() => this.sample(), 1000);
      this.timer.unref();
    }
  }

  onTestBegin(test: TestCase) {
    this.activeTests.add(test.id);
    this.peakConcurrentTests = Math.max(
      this.peakConcurrentTests,
      this.activeTests.size,
    );
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.activeTests.delete(test.id);
    this.attempts++;
    const file = sourceFile(test.location.file);
    let timing = this.specs.get(file);
    if (!timing && this.specs.size < MAX_SPEC_RECORDS) {
      timing = new AttemptTiming();
      this.specs.set(file, timing);
    }
    if (timing) timing.record(result);
    else this.omittedSpecAttempts++;
    const project = test.parent?.project()?.name;
    const phase =
      project === 'chromium-exclusive'
        ? 'exclusive'
        : project === 'chromium-parallel'
          ? 'parallel'
          : project === 'chromium'
            ? 'ordinary'
            : 'unclassified';
    this.phases[phase].record(result);
    if (['failed', 'timedOut', 'interrupted'].includes(result.status)) {
      this.failureCount++;
      if (this.failures.length < MAX_FAILURE_RECORDS)
        this.failures.push(failureMetadata(test, result));
    }
    this.finalTests.set(test.id, {
      result: result.status,
      outcome: test.outcome(),
    });
  }

  onEnd(result: FullResult) {
    if (this.listing) return;
    clearInterval(this.timer);
    this.sample();
    if (this.failureCount || result.status !== 'passed') {
      const evidence = JSON.stringify(
        failureSummary(this.failures, this.failureCount),
      );
      console.log('E2E failure metadata: ' + evidence);
      if (process.env.GITHUB_STEP_SUMMARY) {
        try {
          appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `\n### Browser failure metadata\n\n\`\`\`json\n${evidence}\n\`\`\`\n`,
          );
        } catch {
          console.error('E2E failure summary unavailable; use the job log.');
        }
      }
    }
    let oomKillDelta: number | null = null;
    if (this.initialOomKills !== null) {
      try {
        const delta = oomKills() - this.initialOomKills;
        if (!Number.isSafeInteger(delta) || delta < 0)
          throw new Error('Linux OOM metric unavailable.');
        oomKillDelta = delta;
      } catch {
        this.metricFailures++;
      }
    }
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha =
      revision.status === 0 && /^[0-9a-f]{40}$/.test(revision.stdout.trim())
        ? revision.stdout.trim()
        : null;
    const tests = [...this.finalTests.values()];
    const counts = {
      discovered: this.discovered,
      executed: tests.filter((test) => test.result !== 'skipped').length,
      attempts: this.attempts,
      passed: tests.filter((test) => test.result === 'passed').length,
      skipped: tests.filter((test) => test.result === 'skipped').length,
      unexpected: tests.filter((test) => test.outcome === 'unexpected').length,
      flaky: tests.filter((test) => test.outcome === 'flaky').length,
    };
    const summary = {
      sha,
      status: result.status,
      elapsedSeconds: (performance.now() - this.started) / 1000,
      configuredWorkers: this.workers,
      peakConcurrentTests: this.peakConcurrentTests,
      tests: counts,
      timing: {
        semantics:
          'Attempt durations sum all non-skipped Playwright attempts, including retries. Active intervals union their start/end times without overlap. Elapsed is first attempt start to last attempt end, including observed gaps; build and server preparation are excluded. Missing attempt timing makes affected totals unavailable.',
        phases: Object.fromEntries(
          Object.entries(this.phases).map(([phase, timing]) => [
            phase,
            timing.summary(),
          ]),
        ),
        specs: [...this.specs.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([file, timing]) => ({ file, ...timing.summary() })),
        omittedSpecAttempts: this.omittedSpecAttempts,
        maxSpecRecords: MAX_SPEC_RECORDS,
        maxIntervalsPerRecord: MAX_TIMING_INTERVALS,
      },
      resources: {
        platform: platform(),
        cpuCount: this.cpuCount,
        samples: this.samples,
        memorySamples: this.memorySamples,
        cpuScope:
          'All guest vCPUs during the reporter window, including other guest processes; average is weighted by valid CPU-time deltas. Not Chrome-only.',
        totalMemoryMiB: this.totalMemoryMiB,
        minimumAvailableMemoryMiB: this.minimumAvailableMemoryMiB,
        peakSwapUsedMiB: this.peakSwapUsedMiB,
        ...this.cpu.summary(),
        oomKillDelta,
        metricFailures: this.metricFailures,
      },
    };
    try {
      mkdirSync('test-results', { recursive: true });
      writeFileSync(
        'test-results/e2e-performance.json',
        JSON.stringify(summary, null, 2) + '\n',
      );
      console.log(
        'E2E performance: ' +
          JSON.stringify({
            ...summary,
            timing: {
              ...summary.timing,
              specs: {
                recorded: this.specs.size,
                path: 'test-results/e2e-performance.json',
              },
            },
          }),
      );
    } catch {
      console.error('E2E performance evidence could not be written.');
    }
  }
}

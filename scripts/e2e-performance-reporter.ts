import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

export function linuxMemory(text: string) {
  const value = (name: string) => {
    const match = text.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm'));
    if (!match) throw new Error('Linux memory metric unavailable.');
    return Number(match[1]) / 1024;
  };
  return {
    totalMiB: value('MemTotal'),
    availableMiB: value('MemAvailable'),
    swapUsedMiB: value('SwapTotal') - value('SwapFree'),
  };
}

function oomKills() {
  const match = readFileSync('/proc/vmstat', 'utf8').match(/^oom_kill (\d+)$/m);
  if (!match) throw new Error('Linux OOM metric unavailable.');
  return Number(match[1]);
}

function cpuTime() {
  return cpus().reduce(
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
  private cpu = cpuTime();
  private peakCpuPercent = 0;
  private samples = 0;
  private totalMemoryMiB: number | null = null;
  private minimumAvailableMemoryMiB: number | null = null;
  private peakSwapUsedMiB: number | null = null;
  private initialOomKills: number | null = null;
  private metricFailures = 0;

  private sample() {
    if (platform() !== 'linux') return;
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
      const cpu = cpuTime();
      const busy = cpu.busy - this.cpu.busy;
      const idle = cpu.idle - this.cpu.idle;
      if (busy + idle > 0)
        this.peakCpuPercent = Math.max(
          this.peakCpuPercent,
          (100 * busy) / (busy + idle),
        );
      this.cpu = cpu;
      this.samples++;
    } catch {
      this.metricFailures++;
    }
  }

  onBegin(config: FullConfig, suite: Suite) {
    if (this.listing) return;
    this.started = performance.now();
    this.discovered = suite.allTests().length;
    this.workers = config.workers;
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
    this.finalTests.set(test.id, {
      result: result.status,
      outcome: test.outcome(),
    });
  }

  onEnd(result: FullResult) {
    if (this.listing) return;
    clearInterval(this.timer);
    this.sample();
    let oomKillDelta: number | null = null;
    if (this.initialOomKills !== null) {
      try {
        oomKillDelta = oomKills() - this.initialOomKills;
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
      resources: {
        platform: platform(),
        cpuCount: cpus().length,
        samples: this.samples,
        totalMemoryMiB: this.totalMemoryMiB,
        minimumAvailableMemoryMiB: this.minimumAvailableMemoryMiB,
        peakSwapUsedMiB: this.peakSwapUsedMiB,
        peakCpuPercent: this.samples ? this.peakCpuPercent : null,
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
      console.log('E2E performance: ' + JSON.stringify(summary));
    } catch {
      console.error('E2E performance evidence could not be written.');
    }
  }
}

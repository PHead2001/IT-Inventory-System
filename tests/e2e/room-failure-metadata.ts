import type { TestInfo, TestInfoError } from '@playwright/test';

const matchers = new Set([
  'toBe',
  'toBeDefined',
  'toBeTruthy',
  'toBeVisible',
  'toEqual',
  'toHaveAttribute',
  'toHaveCount',
  'toBeGreaterThan',
]);

function errorRecord(error: TestInfoError, timedOut: boolean) {
  // TestInfo normally contains serialized errors without matcherResult. Never
  // infer a matcher or expose a value from an assertion's rendered message.
  const structured = error as TestInfoError & {
    matcherResult?: { name?: unknown };
  };
  const name = structured.matcherResult?.name;
  const matcher = typeof name === 'string' && matchers.has(name) ? name : null;
  const stack = (error.stack ?? '')
    .slice(0, 65_536)
    .replace(/\u001b\[[0-9;]*m/g, '');
  const location = stack
    .split('\n')
    .map((line) =>
      /^\s+at\s+.*[/\\]tests[/\\]e2e[/\\]room\.spec\.ts:(\d{1,6}):(\d{1,6})\)?\s*$/.exec(
        line,
      ),
    )
    .find(Boolean);
  const message = (error.message ?? '')
    .slice(0, 1_024)
    .replace(/\u001b\[[0-9;]*m/g, '');
  return {
    kind: timedOut
      ? 'test-timeout'
      : /^(?:TimeoutError:|(?:locator|page)\.[A-Za-z]+: Timeout \d+ms exceeded)/.test(
            message,
          )
        ? 'action-timeout'
        : matcher !== null
          ? 'assertion'
          : 'other',
    matcher,
    location:
      location && Number(location[1]) > 0 && Number(location[2]) > 0
        ? {
            file: 'tests/e2e/room.spec.ts',
            line: Number(location[1]),
            column: Number(location[2]),
          }
        : null,
  };
}

export function roomFailureMetadata(
  info: Pick<TestInfo, 'status' | 'retry' | 'errors'>,
) {
  return {
    status: ['failed', 'timedOut', 'interrupted'].includes(info.status ?? '')
      ? info.status
      : 'other',
    retry:
      Number.isSafeInteger(info.retry) && info.retry >= 0 ? info.retry : null,
    omitted: Math.max(0, info.errors.length - 4),
    records: info.errors
      .slice(0, 4)
      .map((error) => errorRecord(error, info.status === 'timedOut')),
  };
}

import type { TestInfo, TestInfoError } from '@playwright/test';

export const roomAssertionIds = [
  'reveal-open-code',
  'reveal-phase',
  'reveal-label-layout',
  'selected-offset',
  'unselected-offset',
  'occupancy-snapshot',
  'occupancy-label',
  'label-visible',
  'click-witness',
  'primary-binding',
  'hover-owner',
  'selected-code',
  'pick-request',
  'aggregate-offset',
  'aggregate-count-badge',
  'drawer-outside-rest',
  'presentation-coverage',
  'container-outside-rest',
] as const;
export type RoomAssertionId = (typeof roomAssertionIds)[number];

const fixedLabels: Record<string, string> = {
  'ITC-D01': 'Drawer 1',
  'ITC-D07': 'Drawer 7',
  'ITC-RED': 'Red Container',
  'ITC-BLACK': 'Black Container',
  'ITC-CLEAR': 'Clear Container',
  'ITC-S1A': '1A',
  'ITC-RACK': 'Server Rack',
};
function count(value: unknown) {
  return typeof value === 'string' &&
    /^(?:0|[1-9][0-9]{0,18})$/.test(value) &&
    (value.length < 19 || value <= '9223372036854775807')
    ? value
    : null;
}
export function roomOccupancyFailureProjection(input: {
  code: string;
  expected: unknown;
  labels: {
    aria: string | null;
    badge: string | null;
    suppressed: string | null;
    compact: string | null;
    exposed: string | null;
  }[];
  labelCount: number;
}) {
  const expected = input.expected as Record<string, unknown> | null;
  const counts = (value: Record<string, unknown> | null) => ({
    quantity_product_count: count(value?.quantity_product_count),
    quantity_unit_count: count(value?.quantity_unit_count),
    asset_count: count(value?.asset_count),
  });
  const flag = (value: string | null) =>
    value === 'true' || value === 'false' ? value : 'other';
  const parse = (value: string | null) => {
    // Only the fixed numeric occupancy grammar crosses this boundary. Names,
    // arbitrary DOM text and inventory values outside counts never reach stdout.
    const match =
      /^([0-9,]{1,25}) products? \/ ([0-9,]{1,25}) units? \/ ([0-9,]{1,25}) assets?$/.exec(
        value ?? '',
      );
    return match &&
      match
        .slice(1)
        .every((part) => /^(?:0|[1-9][0-9]{0,2}(?:,[0-9]{3})*)$/.test(part))
      ? counts({
          quantity_product_count: match[1].replaceAll(',', ''),
          quantity_unit_count: match[2].replaceAll(',', ''),
          asset_count: match[3].replaceAll(',', ''),
        })
      : null;
  };
  const fixtureLabel = Object.hasOwn(fixedLabels, input.code)
    ? fixedLabels[input.code]
    : null;
  const prefix = fixtureLabel ? `Select ${fixtureLabel} (${input.code})` : null;
  return {
    expected: counts(expected),
    labelCount: Number.isSafeInteger(input.labelCount)
      ? Math.max(0, Math.min(10000, input.labelCount))
      : null,
    omitted: Math.max(0, input.labels.length - 4),
    labels: input.labels.slice(0, 4).map((label) => {
      const fixed =
        prefix !== null &&
        (label.aria === prefix || label.aria?.startsWith(prefix + '; '));
      const suffix =
        fixed && label.aria?.endsWith(' at this location')
          ? label.aria.slice(prefix!.length + 2, -17)
          : null;
      return {
        fixedFixtureLabel: fixed ? fixtureLabel : null,
        ariaOccupancy: parse(suffix),
        badgeOccupancy: parse(
          label.badge?.replace(/^\s*·\s*/, '').trim() ?? null,
        ),
        suppressed: flag(label.suppressed),
        compact: flag(label.compact),
        exposed: flag(label.exposed),
      };
    }),
  };
}

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
      /^\s+at\s+.*[/\\]tests[/\\]e2e[/\\]00-room\.spec\.ts:(\d{1,6}):(\d{1,6})\)?\s*$/.exec(
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
            file: 'tests/e2e/00-room.spec.ts',
            line: Number(location[1]),
            column: Number(location[2]),
          }
        : null,
  };
}

export function roomFailureMetadata(
  info: Pick<TestInfo, 'status' | 'retry' | 'errors'>,
  activeAssertion?: unknown,
) {
  return {
    ...(activeAssertion === undefined
      ? {}
      : {
          activeAssertion:
            typeof activeAssertion === 'string' &&
            (roomAssertionIds as readonly string[]).includes(activeAssertion)
              ? activeAssertion
              : null,
        }),
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

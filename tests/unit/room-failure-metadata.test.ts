import { describe, expect, it } from 'vitest';
import { roomFailureMetadata } from '../e2e/room-failure-metadata';

describe('room failure metadata', () => {
  it('retains only the first owned stack location and an actual allowlisted matcher', () => {
    const error = {
      message: 'private inventory value, URL, expected and received DOM',
      stack:
        'Error: private\n    at helper (/host/private/tests/e2e/helper.ts:2:3)\n    at test (/host/private/tests/e2e/room.spec.ts:911:28)\n    at later (/host/private/tests/e2e/room.spec.ts:919:9)',
      matcherResult: { name: 'toHaveAttribute', actual: 'private' },
    };
    expect(
      roomFailureMetadata({ status: 'failed', retry: 1, errors: [error] }),
    ).toEqual({
      status: 'failed',
      retry: 1,
      omitted: 0,
      records: [
        {
          kind: 'assertion',
          matcher: 'toHaveAttribute',
          location: {
            file: 'tests/e2e/room.spec.ts',
            line: 911,
            column: 28,
          },
        },
      ],
    });
  });

  it('does not infer matcher names from messages or expose private error fields and causes', () => {
    const error = {
      message: 'Error: expect(private).toHaveAttribute(secret)',
      stack:
        'private tests/e2e/room.spec.ts:911:28\n    at /host/private/app.ts:4:5',
      value: 'secret token',
      errorContext: 'private DOM',
      cause: { message: 'private cause' },
      matcherResult: { name: 'private-custom-matcher' },
    };
    const output = roomFailureMetadata({
      status: 'failed',
      retry: 0,
      errors: [error],
    });
    expect(output.records).toEqual([
      { kind: 'other', matcher: null, location: null },
    ]);
    expect(JSON.stringify(output)).not.toMatch(
      /private|secret|token|host|toHaveAttribute/,
    );
  });

  it('bounds records and classifies real test deadlines without claiming a matcher', () => {
    const output = roomFailureMetadata({
      status: 'timedOut',
      retry: 0,
      errors: Array.from({ length: 7 }, () => ({
        message: '\u001b[31mTest timeout of 120000ms exceeded.\u001b[39m',
        stack:
          'Test timeout\n    at C:\\private\\tests\\e2e\\room.spec.ts:553:1',
      })),
    });
    expect(output.omitted).toBe(3);
    expect(output.records).toHaveLength(4);
    expect(
      output.records.every((record) => record.kind === 'test-timeout'),
    ).toBe(true);
    expect(output.records[0]).toEqual({
      kind: 'test-timeout',
      matcher: null,
      location: { file: 'tests/e2e/room.spec.ts', line: 553, column: 1 },
    });
  });

  it('classifies action deadlines without printing the locator or call log', () => {
    expect(
      roomFailureMetadata({
        status: 'failed',
        retry: 0,
        errors: [
          {
            message:
              'locator.click: Timeout 5000ms exceeded.\nCall log: private',
          },
        ],
      }).records,
    ).toEqual([{ kind: 'action-timeout', matcher: null, location: null }]);
  });
});

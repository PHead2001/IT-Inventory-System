import { describe, expect, it } from 'vitest';
import {
  roomFailureMetadata,
  roomOccupancyFailureProjection,
} from '../e2e/room-failure-metadata';

describe('room failure metadata', () => {
  it('retains an explicit assertion checkpoint for serialized Playwright errors without guessing a matcher', () => {
    const info = {
      status: 'failed' as const,
      retry: 0,
      errors: [{ message: 'private expected/received' }],
    };
    expect(roomFailureMetadata(info, 'occupancy-label')).toMatchObject({
      activeAssertion: 'occupancy-label',
      records: [{ kind: 'other', matcher: null }],
    });
    expect(roomFailureMetadata(info, 'private assertion')).toMatchObject({
      activeAssertion: null,
    });
  });

  it('projects only fixed fixture label identity and bounded numeric occupancy fields', () => {
    const output = roomOccupancyFailureProjection({
      code: 'ITC-RED',
      expected: {
        quantity_product_count: '2',
        quantity_unit_count: '9007199254740993',
        asset_count: '0',
        private: 'secret',
      },
      labelCount: 1,
      labels: [
        {
          aria: 'Select Red Container (ITC-RED); 2 products / 9,007,199,254,740,993 units / 0 assets at this location',
          badge: ' · 2 products / 9,007,199,254,740,993 units / 0 assets',
          suppressed: 'true',
          compact: 'false',
          exposed: 'true',
        },
      ],
    });
    expect(output.expected.quantity_unit_count).toBe('9007199254740993');
    expect(output.labels[0]).toEqual({
      fixedFixtureLabel: 'Red Container',
      ariaOccupancy: output.expected,
      badgeOccupancy: output.expected,
      suppressed: 'true',
      compact: 'false',
      exposed: 'true',
    });
    expect(JSON.stringify(output)).not.toMatch(/private|secret/);
  });

  it('bounds label records and rejects arbitrary DOM text, invalid counts and unknown fixed identities', () => {
    const output = roomOccupancyFailureProjection({
      code: 'private location',
      expected: {
        quantity_product_count: '-1',
        quantity_unit_count: '1'.repeat(20),
        asset_count: 'secret',
      },
      labelCount: 999999,
      labels: Array.from({ length: 8 }, () => ({
        aria: 'Select private name; secret',
        badge: 'secret inventory',
        suppressed: 'secret',
        compact: null,
        exposed: null,
      })),
    });
    expect(output).toMatchObject({
      expected: {
        quantity_product_count: null,
        quantity_unit_count: null,
        asset_count: null,
      },
      labelCount: 10000,
      omitted: 4,
    });
    expect(output.labels).toHaveLength(4);
    expect(JSON.stringify(output)).not.toMatch(/private|secret|inventory/);
  });
  it('retains only the first owned stack location and an actual allowlisted matcher', () => {
    const error = {
      message: 'private inventory value, URL, expected and received DOM',
      stack:
        'Error: private\n    at helper (/host/private/tests/e2e/helper.ts:2:3)\n    at test (/host/private/tests/e2e/00-room.spec.ts:911:28)\n    at later (/host/private/tests/e2e/00-room.spec.ts:919:9)',
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
            file: 'tests/e2e/00-room.spec.ts',
            line: 911,
            column: 28,
          },
        },
      ],
    });
  });

  it('retains bounded coordinates from the extracted spec and explicit support only', () => {
    for (const file of [
      'room-occupancy-exclusive.spec.ts',
      'room-test-support.ts',
    ]) {
      for (const stack of [
        'Error: private\n    at helper (/private/tests/e2e/' +
          file +
          ':123:45)',
        'Error: private\n    at C:\\private\\tests\\e2e\\' + file + ':123:45',
      ]) {
        const output = roomFailureMetadata({
          status: 'failed',
          retry: 0,
          errors: [{ stack }],
        });
        expect(output.records[0].location).toEqual({
          file: 'tests/e2e/' + file,
          line: 123,
          column: 45,
        });
        expect(JSON.stringify(output)).not.toMatch(/private|Error/);
      }
    }
    for (const suffix of [
      'other.spec.ts:123:45',
      'room-test-support.ts.backup:123:45',
      'room-occupancy-exclusive.spec.ts/../private.ts:123:45',
      '../room-test-support.ts:123:45',
      'room-test-support.ts:0:45',
      'room-test-support.ts:123:0',
      'room-test-support.ts:1234567:45',
      'room-test-support.ts:123:45?secret',
    ])
      expect(
        roomFailureMetadata({
          status: 'failed',
          retry: 0,
          errors: [
            {
              stack:
                'Error: private\n    at helper (/private/tests/e2e/' +
                suffix +
                ')',
            },
          ],
        }).records[0].location,
        suffix,
      ).toBeNull();
  });

  it('does not infer matcher names from messages or expose private error fields and causes', () => {
    const error = {
      message: 'Error: expect(private).toHaveAttribute(secret)',
      stack:
        'private tests/e2e/00-room.spec.ts:911:28\n    at /host/private/app.ts:4:5',
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
          'Test timeout\n    at C:\\private\\tests\\e2e\\00-room.spec.ts:553:1',
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
      location: { file: 'tests/e2e/00-room.spec.ts', line: 553, column: 1 },
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

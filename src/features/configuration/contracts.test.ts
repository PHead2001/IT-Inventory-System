import { describe, expect, it } from 'vitest';
import {
  configurationError,
  parseConfigurationCommand,
  parseConfigurationResult,
  removalReviewSchema,
} from './contracts';

const category = 'd8fd402e-e853-4255-a40b-020b927673f3';
const requestId = '554544d2-0598-45c5-a469-161942361e64';
describe('configuration command boundaries', () => {
  it('keeps bigint versions as decimal strings and accepts legacy safe integers', () => {
    const input = {
      operation: 'category_rename',
      requestId,
      payload: {
        category_id: category,
        expected_version: 9007199254740992n.toString(),
        name: '  Field   Gear  ',
      },
    };
    expect(parseConfigurationCommand(input)?.payload).toEqual({
      category_id: category,
      expected_version: '9007199254740992',
      name: 'Field Gear',
    });
    expect(
      parseConfigurationCommand({
        ...input,
        payload: { ...input.payload, expected_version: 2 },
      })?.payload,
    ).toMatchObject({ expected_version: '2' });
    expect(
      parseConfigurationCommand({
        ...input,
        payload: { ...input.payload, expected_version: 9007199254740992 },
      }),
    ).toBeNull();
    expect(
      parseConfigurationResult({
        changed: true,
        version: '9007199254740993',
        event_id: requestId,
      }).success,
    ).toBe(true);
    expect(
      parseConfigurationResult({
        changed: true,
        version: 9007199254740993,
        event_id: requestId,
      }).success,
    ).toBe(false);
  });
  it('rejects unsupported controls and validates the reviewed impact shape', () => {
    expect(
      parseConfigurationCommand({
        operation: 'category_create',
        requestId,
        payload: { code: 'NEW', name: 'New', can_manage_configuration: true },
      }),
    ).toBeNull();
    expect(
      removalReviewSchema.safeParse({
        token: requestId,
        source_id: category,
        source_name: 'Other',
        source_version: '1',
        target_id: null,
        target_name: null,
        target_version: null,
        quantity_count: 0,
        asset_count: 0,
        expires_at: new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(configurationError('P1017')).toMatchObject({
      ok: false,
      code: 'P1017',
    });
  });
});

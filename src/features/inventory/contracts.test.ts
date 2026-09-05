import { describe, expect, it } from 'vitest';
import {
  mutationError,
  mutationResultSchema,
  operations,
  validateCommand,
  type Operation,
} from './contracts';

const requestId = 'a1000000-0000-4000-8000-000000000001';
const itemId = 'a1000000-0000-4000-8000-000000000002';
const locationId = 'a1000000-0000-4000-8000-000000000003';
const categoryId = 'a1000000-0000-4000-8000-000000000004';
const destinationId = 'a1000000-0000-4000-8000-000000000005';
const metadata = { name: 'Cable', category_id: categoryId };
const quantity = { item_id: itemId, expected_version: 1 };
const asset = { asset_id: itemId, expected_version: 1 };
const payloads: Record<Operation, Record<string, unknown>> = {
  quantity_create: metadata,
  quantity_receive: {
    ...quantity,
    location_id: locationId,
    quantity: 2,
    reason: 'Delivery',
  },
  quantity_move: {
    ...quantity,
    source_location_id: locationId,
    destination_location_id: destinationId,
    quantity: 1,
  },
  quantity_adjust: {
    ...quantity,
    location_id: locationId,
    observed_quantity: 0,
    reason: 'Counted',
  },
  quantity_update: { ...quantity, ...metadata },
  quantity_archive: { ...quantity, reason: 'No longer stocked' },
  quantity_restore: { ...quantity, reason: 'Stocking again' },
  asset_create: { ...metadata, location_id: locationId },
  asset_move: { ...asset, location_id: destinationId },
  asset_correct_location: {
    ...asset,
    location_id: destinationId,
    reason: 'Record correction',
  },
  asset_update: { ...asset, ...metadata },
  asset_retire: { ...asset, reason: 'Disposal' },
  asset_restore: {
    ...asset,
    location_id: locationId,
    reason: 'Returned to service',
  },
};
const command = (operation: Operation, payload = payloads[operation]) =>
  validateCommand({ operation, requestId, payload });

describe('inventory mutation input contracts', () => {
  it.each(operations)('accepts the supported %s command', (operation) => {
    expect(command(operation).success).toBe(true);
  });

  it('normalizes optional metadata and defaults without losing serial punctuation or leading zeros', () => {
    const parsed = command('asset_create', {
      ...payloads.asset_create,
      name: '\t Laptop \n',
      description: '  ',
      manufacturer: '\nVendor\t',
      model: undefined,
      asset_tag: '  TAG-001 ',
      serial_number: '  0001-A/B.02  ',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('Expected valid command');
    expect(parsed.data.payload).toMatchObject({
      name: 'Laptop',
      description: null,
      manufacturer: 'Vendor',
      model: null,
      asset_tag: 'TAG-001',
      serial_number: '0001-A/B.02',
    });
    const zero = command('quantity_create');
    expect(zero.success).toBe(true);
    if (!zero.success) throw new Error('Expected valid command');
    expect(zero.data.payload).toMatchObject({
      initial_quantity: 0,
      initial_location_id: null,
    });
  });

  it('permits a zero definition with or without a chosen initial location and requires a location for positive stock', () => {
    expect(
      command('quantity_create', {
        ...metadata,
        initial_quantity: 0,
        initial_location_id: locationId,
      }).success,
    ).toBe(true);
    expect(
      command('quantity_create', { ...metadata, initial_quantity: 1 }).success,
    ).toBe(false);
    expect(
      command('quantity_create', {
        ...metadata,
        initial_quantity: 2147483647,
        initial_location_id: locationId,
      }).success,
    ).toBe(true);
  });

  it.each([
    -1,
    1.5,
    2147483648,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '2',
    null,
  ])('rejects invalid whole-unit count %s', (invalid) => {
    expect(
      command('quantity_receive', {
        ...payloads.quantity_receive,
        quantity: invalid,
      }).success,
    ).toBe(false);
    expect(
      command('quantity_adjust', {
        ...payloads.quantity_adjust,
        observed_quantity: invalid,
      }).success,
    ).toBe(false);
  });

  it('requires positive receipts and moves but allows observed zero counts', () => {
    expect(
      command('quantity_receive', { ...payloads.quantity_receive, quantity: 0 })
        .success,
    ).toBe(false);
    expect(
      command('quantity_move', { ...payloads.quantity_move, quantity: 0 })
        .success,
    ).toBe(false);
    expect(command('quantity_adjust').success).toBe(true);
  });

  it('makes Move All exclusive with an explicit amount', () => {
    expect(
      command('quantity_move', {
        ...payloads.quantity_move,
        quantity: null,
        move_all: true,
      }).success,
    ).toBe(true);
    expect(
      command('quantity_move', {
        ...payloads.quantity_move,
        quantity: undefined,
        move_all: true,
      }).success,
    ).toBe(true);
    expect(
      command('quantity_move', { ...payloads.quantity_move, move_all: true })
        .success,
    ).toBe(false);
    expect(
      command('quantity_move', { ...payloads.quantity_move, quantity: null })
        .success,
    ).toBe(false);
  });

  it.each([
    'quantity_receive',
    'quantity_adjust',
    'quantity_archive',
    'quantity_restore',
    'asset_correct_location',
    'asset_retire',
    'asset_restore',
  ] as const)('%s requires an explanation', (operation) => {
    expect(
      command(operation, { ...payloads[operation], reason: ' \n ' }).success,
    ).toBe(false);
    expect(
      command(operation, { ...payloads[operation], reason: undefined }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, 2147483648, '1', null])(
    'rejects malformed expected version %s',
    (version) => {
      expect(
        command('asset_move', {
          ...payloads.asset_move,
          expected_version: version,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ['name', ' '.repeat(2)],
    ['name', 'n'.repeat(201)],
    ['description', 'd'.repeat(4001)],
    ['manufacturer', 'm'.repeat(201)],
    ['model', 'm'.repeat(201)],
    ['asset_tag', 't'.repeat(101)],
    ['serial_number', 's'.repeat(201)],
  ])('enforces %s bounds', (field, value) => {
    expect(
      command('asset_create', { ...payloads.asset_create, [field]: value })
        .success,
    ).toBe(false);
  });

  it('rejects forged actor fields, tracking conversion, unknown operations and malformed identities', () => {
    expect(
      command('quantity_create', { ...metadata, actor_id: itemId }).success,
    ).toBe(false);
    expect(
      command('asset_update', {
        ...payloads.asset_update,
        tracking_type: 'quantity',
      }).success,
    ).toBe(false);
    expect(
      validateCommand({ operation: 'asset_delete', requestId, payload: {} })
        .success,
    ).toBe(false);
    expect(
      validateCommand({
        operation: 'quantity_create',
        requestId: 'invalid',
        payload: metadata,
      }).success,
    ).toBe(false);
    expect(
      command('asset_move', { ...payloads.asset_move, asset_id: 'invalid' })
        .success,
    ).toBe(false);
    expect(
      validateCommand({
        operation: 'quantity_create',
        requestId,
        payload: metadata,
        actor_id: itemId,
      }).success,
    ).toBe(false);
  });
});

describe('safe mutation responses', () => {
  it.each([
    ['P1001', 'forbidden'],
    ['P1002', 'stale_version'],
    ['P1003', 'insufficient_stock'],
    ['P1004', 'invalid_location'],
    ['P1005', 'same_location'],
    ['P1006', 'invalid_quantity'],
    ['P1007', 'identifier_conflict'],
    ['P1008', 'invalid_transition'],
    ['P1009', 'idempotency_conflict'],
    ['P1010', 'not_found'],
    ['P1011', 'invalid_category'],
  ])(
    'maps %s to stable %s without parsing database prose',
    (sqlstate, code) => {
      expect(mutationError(sqlstate)).toMatchObject({
        ok: false,
        kind: 'domain',
        code,
      });
    },
  );
  it('distinguishes input validation from unexpected transport/database errors', () => {
    expect(mutationError('P1012')).toMatchObject({
      ok: false,
      kind: 'validation',
      code: 'invalid_input',
    });
    expect(mutationError('XX000')).toMatchObject({
      ok: false,
      kind: 'unexpected',
      code: 'unexpected',
    });
    expect(mutationError(undefined)).toEqual(mutationError('XX000'));
  });
  it('accepts a no-change result and rejects malformed database result types', () => {
    const result = {
      entity_id: itemId,
      version: 1,
      event_id: null,
      changed: false,
    };
    expect(mutationResultSchema.safeParse(result).success).toBe(true);
    for (const invalid of [
      { ...result, entity_id: 'invalid' },
      { ...result, version: 0 },
      { ...result, version: '1' },
      { ...result, changed: 'false' },
      { ...result, event_id: 2 },
    ])
      expect(mutationResultSchema.safeParse(invalid).success).toBe(false);
  });
});

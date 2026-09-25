import { describe, expect, it } from 'vitest';
import { custodyError, parseCustodyCommand } from './contracts';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const command = (operation: string, payload: Record<string, unknown>) => ({
  operation,
  requestId: id(1),
  payload,
});
describe('custody command boundary', () => {
  it('accepts positive whole-unit issue and rejects fractional, missing, and extra custody fields', () => {
    const valid = {
      action: 'issue',
      item_id: id(2),
      expected_version: '3',
      source_location_id: id(3),
      destination_site_id: id(4),
      quantity: 3,
    };
    expect(
      parseCustodyCommand(command('quantity_site_change', valid)).success,
    ).toBe(true);
    for (const payload of [
      { ...valid, quantity: 3.5 },
      { ...valid, quantity: -1 },
      { ...valid, destination_location_id: id(5) },
      { ...valid, expected_version: '03' },
    ])
      expect(
        parseCustodyCommand(command('quantity_site_change', payload)).success,
      ).toBe(false);
  });
  it('requires reason for corrections, write-offs, and site-held asset retirement', () => {
    const quantity = {
      action: 'correct',
      item_id: id(2),
      expected_version: '1',
      source_site_id: id(3),
      observed_quantity: 0,
    };
    expect(
      parseCustodyCommand(command('quantity_site_change', quantity)).success,
    ).toBe(false);
    expect(
      parseCustodyCommand(
        command('quantity_site_change', {
          ...quantity,
          reason: 'Counted on site',
        }),
      ).success,
    ).toBe(true);
    const asset = {
      action: 'retire',
      asset_id: id(2),
      expected_version: '1',
      source_site_id: id(3),
    };
    expect(
      parseCustodyCommand(command('asset_site_change', asset)).success,
    ).toBe(false);
    expect(
      parseCustodyCommand(
        command('asset_site_change', { ...asset, reason: 'Lost' }),
      ).success,
    ).toBe(true);
  });
  it('keeps opening records separate from ordinary issue and requires a published form baseline', () => {
    const opening = {
      name: 'Switch',
      description: null,
      category_id: id(2),
      manufacturer: null,
      model: null,
      site_id: id(3),
      expected_published_revision_id: id(4),
      custom_patch: { set: {}, unset: [] },
      asset_tag: null,
      serial_number: null,
    };
    expect(
      parseCustodyCommand(command('asset_site_open', opening)).success,
    ).toBe(true);
    expect(
      parseCustodyCommand(
        command('asset_site_open', { ...opening, source_location_id: id(5) }),
      ).success,
    ).toBe(false);
    expect(
      parseCustodyCommand(
        command('asset_site_open', {
          ...opening,
          expected_published_revision_id: null,
        }),
      ).success,
    ).toBe(false);
  });
  it('reports stale, blocked archive, and unknown results without implying a confirmed write', () => {
    const stale = custodyError('P1002');
    const blocked = custodyError('P1008');
    const unknown = custodyError();
    if (stale.ok || blocked.ok || unknown.ok)
      throw new Error('Custody errors must never imply a confirmed write.');
    expect(stale.message).toMatch(/changed/i);
    expect(blocked.message).toMatch(/holdings/i);
    expect(unknown.code).toBe('unexpected');
  });
});

import { describe, expect, it } from 'vitest';
import { creationSummary, normalizeCreationIntent } from './creation-summary';
import type { MetadataDefinition } from './contracts';
const category = '00000000-0000-4000-8000-000000000001';
const location = '00000000-0000-4000-8000-000000000002';
const revision = '00000000-0000-4000-8000-000000000003';
const ids = Array.from(
  { length: 6 },
  (_, i) => `00000000-0000-4000-8000-00000000001${i}`,
);
const definition: MetadataDefinition = {
  fields: [
    {
      id: ids[0],
      label: 'Boolean',
      type: 'boolean',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
    {
      id: ids[1],
      label: 'Count',
      type: 'integer',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
      default: 0,
    },
    {
      id: ids[2],
      label: 'Clear text',
      type: 'short_text',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
    {
      id: ids[3],
      label: 'Absent',
      type: 'short_text',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
    {
      id: ids[4],
      label: 'Selection',
      type: 'hierarchical_select',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [
        { id: category, label: 'Parent', active: true },
        { id: location, label: 'Child', parent_id: category, active: true },
      ],
    },
    {
      id: ids[5],
      label: 'Price',
      type: 'currency',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
  ],
  layout: [
    {
      id: revision,
      label: 'Details',
      controls: ids.map((id) => ({
        id,
        kind: 'field',
        field_id: id,
        width: 'Auto',
      })),
    },
  ],
};
const payload = {
  name: ' Cable ',
  category_id: category,
  description: '  ',
  manufacturer: ' Maker ',
  model: ' Model ',
  expected_published_revision_id: revision,
  item_code: ' CODE ',
  reorder_threshold: 0,
  initial_quantity: 3,
  initial_location_id: location,
  custom_patch: {
    set: {
      [ids[0]]: false,
      [ids[1]]: 0,
      [ids[2]]: '',
      [ids[4]]: location,
      [ids[5]]: { amount: '0.00', currency: 'USD' },
    },
    unset: [],
  },
};
const refs = {
  categories: [{ id: category, name: 'Parts', active: true }],
  locations: [
    {
      id: location,
      name: 'Drawer',
      breadcrumb: 'IT Closet / Drawer',
      code: 'DRAWER',
      active: true,
      can_hold_inventory: true,
      parentId: null,
    },
  ],
};
describe('exact creation summary', () => {
  it('normalizes existing parser/RPC core semantics while retaining custom values', () => {
    const intent = normalizeCreationIntent('quantity', false, payload)!;
    expect(intent).toMatchObject({
      name: 'Cable',
      description: null,
      manufacturer: 'Maker',
      item_code: 'CODE',
      reorder_threshold: 0,
      custom_patch: payload.custom_patch,
    });
  });
  it('shows positive starting stock at its authorized breadcrumb and custom distinct values', () => {
    const result = creationSummary({
      ...refs,
      kind: 'quantity',
      intent: normalizeCreationIntent('quantity', false, payload)!,
      definition,
      touched: [ids[0], ids[2], ids[4], ids[5]],
    });
    expect(result.rows).toContainEqual({
      label: 'Initial storage',
      value: 'IT Closet / Drawer',
    });
    expect(result.details).toEqual(
      expect.arrayContaining([
        { label: 'Boolean', value: 'No', source: undefined },
        { label: 'Count', value: '0', source: 'Default applied' },
        { label: 'Clear text', value: 'Empty value', source: undefined },
        { label: 'Absent', value: 'Not recorded', source: undefined },
        { label: 'Selection', value: 'Parent / Child', source: undefined },
        { label: 'Price', value: '0.00 USD', source: undefined },
        { label: 'Reorder threshold', value: '0' },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(location);
  });
  it('does not invent a location for zero stock', () => {
    const intent = normalizeCreationIntent('quantity', false, {
      ...payload,
      initial_quantity: 0,
      initial_location_id: null,
    })!;
    const result = creationSummary({
      ...refs,
      kind: 'quantity',
      intent,
      definition,
      touched: [],
    });
    expect(result.rows).toContainEqual({ label: 'Starting count', value: '0' });
    expect(result.rows).toContainEqual({
      label: 'Initial storage',
      value: 'No initial stock · no storage destination',
    });
  });
  it.each(['asset', 'quantity'] as const)(
    'names the already-there %s site opening without fabricated storage',
    (kind) => {
      const core: Record<string, unknown> = { ...payload };
      for (const key of [
        'initial_quantity',
        'initial_location_id',
        'item_code',
        'reorder_threshold',
      ])
        delete core[key];
      const raw = {
        ...core,
        site_id: location,
        reason: '',
        reference: '',
        ...(kind === 'quantity'
          ? { quantity: 2, item_code: ' CODE ', reorder_threshold: null }
          : { asset_tag: ' TAG-UPPER ', serial_number: ' SerialCase ' }),
      };
      const intent = normalizeCreationIntent(kind, true, raw)!;
      expect(intent).not.toBeNull();
      expect(intent.reason).toBeNull();
      if (kind === 'asset')
        expect(intent).toMatchObject({
          asset_tag: 'tag-upper',
          serial_number: 'SerialCase',
        });
      const result = creationSummary({
        ...refs,
        kind,
        intent,
        definition,
        touched: [],
        openingSite: { id: location, name: 'Example site' },
      });
      expect(result.rows).toContainEqual({
        label: 'Site',
        value: 'Example site',
      });
      expect(result.opening).toContain('already at this site');
      expect(result.rows.map((row) => row.label)).not.toContain(
        'Initial storage',
      );
    },
  );
  it('rejects a payload the existing creation contract cannot commit', () => {
    expect(
      normalizeCreationIntent('quantity', false, {
        ...payload,
        initial_quantity: -1,
      }),
    ).toBeNull();
  });
  it('retains all long supplied text', () => {
    const description = 'Long text '.repeat(350);
    const intent = normalizeCreationIntent('quantity', false, {
      ...payload,
      description,
    })!;
    const result = creationSummary({
      ...refs,
      kind: 'quantity',
      intent,
      definition,
      touched: [],
    });
    expect(
      result.details.find((row) => row.label === 'Description')?.value,
    ).toBe(description.trim());
  });
});

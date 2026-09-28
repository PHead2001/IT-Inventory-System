import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MetadataDefinition } from './contracts';
import {
  canReparent,
  designerIssues,
  moveControl,
  optionPath,
  supportedCurrencyCodes,
} from './designer-model';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const definition = (): MetadataDefinition => ({
  fields: [
    {
      id: id(1),
      type: 'hierarchical_select',
      label: 'Location type',
      applies_to: ['asset'],
      required: true,
      rules: {},
      options: [
        { id: id(11), label: 'Root', active: true },
        { id: id(12), label: 'Child', active: true, parent_id: id(11) },
        { id: id(13), label: 'Grandchild', active: true, parent_id: id(12) },
      ],
    },
  ],
  layout: [
    {
      id: id(2),
      label: 'Details',
      controls: [
        { id: id(3), kind: 'builtin', builtin: 'name', width: 12 },
        { id: id(4), kind: 'builtin', builtin: 'category_id', width: 12 },
        { id: id(5), kind: 'field', field_id: id(1), width: 6 },
      ],
    },
    { id: id(6), label: 'More', controls: [] },
  ],
});

describe('form designer model', () => {
  it('rejects protected and required controls hidden through their section', () => {
    const draft=definition();
    draft.layout[0].controls.push({id:id(20),kind:'builtin',builtin:'asset_tag',width:'Auto',applies_to:['asset']});
    expect(designerIssues(draft)).not.toContain('Asset tag must stay visible on asset forms.');
    draft.layout[0].controls.find((control)=>control.builtin==='asset_tag')!.visible=false;
    expect(designerIssues(draft)).toContain('Asset tag must stay visible on asset forms.');
    draft.layout[0].controls.find((control)=>control.builtin==='asset_tag')!.visible=true;
    draft.layout[0].visible=false;
    expect(designerIssues(draft)).toContain('Location type must be visible on asset forms.');
    expect(designerIssues(draft)).toContain('Name must stay visible on quantity forms.');
  });
  it('moves controls across sections in document order without losing identities', () => {
    const before = definition();
    const after = moveControl(before, id(5), id(6), 0);
    expect(after.layout[0].controls.map((control) => control.id)).toEqual([
      id(3),
      id(4),
    ]);
    expect(after.layout[1].controls.map((control) => control.id)).toEqual([
      id(5),
    ]);
    expect(before.layout[0].controls).toHaveLength(3);
  });
  it('rejects a hierarchy cycle, a missing parent and a path beyond 64 levels', () => {
    const options = definition().fields[0].options;
    expect(optionPath(options, id(13))).toBe('Root / Child / Grandchild');
    expect(canReparent(options, id(11), id(13))).toBe(false);
    expect(canReparent(options, id(12), id(99))).toBe(false);
    expect(canReparent(options, id(13), null)).toBe(true);
    const broken = options.map((option) =>
      option.id === id(12) ? { ...option, parent_id: id(99) } : option,
    );
    expect(optionPath(broken, id(12))).toBeNull();
    const deep = Array.from({ length: 65 }, (_, index) => ({
      id: id(index + 100),
      label: String(index),
      active: true,
      ...(index ? { parent_id: id(index + 99) } : {}),
    }));
    expect(optionPath(deep, id(164))).toBeNull();
  });
  it('includes the moved subtree height when enforcing the 64-level parent limit', () => {
    const chain = Array.from({ length: 63 }, (_, index) => ({
      id: id(index + 200),
      label: `Ancestor ${index}`,
      active: true,
      ...(index ? { parent_id: id(index + 199) } : {}),
    }));
    const moved = { id: id(300), label: 'Moved', active: true };
    const child = {
      id: id(301),
      label: 'Child',
      active: true,
      parent_id: moved.id,
    };
    expect(canReparent([...chain, moved, child], moved.id, chain[62].id)).toBe(
      false,
    );
    expect(canReparent([...chain, moved, child], moved.id, chain[61].id)).toBe(
      true,
    );
    expect(canReparent([...chain, moved, child], moved.id, null)).toBe(true);
  });
  it('allows saving a malformed semantic draft but reports publish blockers', () => {
    const draft = definition();
    draft.fields[0].label = '';
    draft.fields[0].options[1].parent_id = id(99);
    draft.layout[0].controls = draft.layout[0].controls.filter(
      (control) => control.kind !== 'field',
    );
    expect(designerIssues(draft)).toEqual(
      expect.arrayContaining([
        'A field needs a label.',
        'A field has an invalid option parent, cycle, or depth over 64.',
        'A required field must appear in the layout.',
      ]),
    );
  });
  it('compares datetime bounds by instant across offsets while keeping calendar dates ordered', () => {
    const draft = definition();
    draft.fields[0].type = 'datetime';
    draft.fields[0].options = [];
    draft.fields[0].rules = {
      min: '2026-09-25T10:00:00+02:00',
      max: '2026-09-25T09:30:00Z',
    };
    expect(designerIssues(draft)).not.toContain(
      'Location type has inverted date bounds.',
    );
    draft.fields[0].rules = {
      min: '2026-09-25T10:00:00Z',
      max: '2026-09-25T11:00:00+02:00',
    };
    expect(designerIssues(draft)).toContain(
      'Location type has inverted date bounds.',
    );
    draft.fields[0].type = 'date';
    draft.fields[0].rules = { min: '2026-09-26', max: '2026-09-25' };
    expect(designerIssues(draft)).toContain(
      'Location type has inverted date bounds.',
    );
  });
  it('compares datetime rules at exact UTC microsecond precision', () => {
    const draft = definition();
    const field = draft.fields[0];
    field.type = 'datetime';
    field.options = [];
    field.rules = {
      min: '2026-09-25T10:00:00.000002+02:00',
      max: '2026-09-25T08:00:00.000003Z',
    };
    expect(designerIssues(draft)).not.toContain(
      'Location type has inverted date bounds.',
    );
    field.rules.max = '2026-09-25T08:00:00.000001Z';
    expect(designerIssues(draft)).toContain(
      'Location type has inverted date bounds.',
    );
    field.rules.max = '2026-09-25T08:00:00.000002Z';
    expect(designerIssues(draft)).not.toContain(
      'Location type has inverted date bounds.',
    );
    field.rules.min = '2026-09-25T08:00:00.0000001Z';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid date bounds.',
    );
    field.rules.min = '0000-01-01T00:00:00Z';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid date bounds.',
    );
  });
  it('enforces configured fractional precision and the database 24-digit bound cap', () => {
    const draft = definition();
    const field = draft.fields[0];
    field.type = 'decimal';
    field.options = [];
    field.rules = { precision: 2, min: '1.234' };
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules = {
      precision: 2,
      min: '1.23',
      max: '9999999999999999999999.99',
    };
    expect(designerIssues(draft)).not.toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules.max = '99999999999999999999999.99';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules = { min: '0.123456' };
    expect(designerIssues(draft)).not.toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules.min = '0.1234567';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
    field.type = 'currency';
    field.rules = { currencyCode: 'USD', precision: 0, min: '1.1' };
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
  });
  it('orders large numeric bounds exactly instead of rounding them through Number', () => {
    const draft = definition();
    const field = draft.fields[0];
    field.type = 'decimal';
    field.options = [];
    field.rules = {
      precision: 0,
      min: '999999999999999999999999',
      max: '999999999999999999999998',
    };
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
  });
  it('blocks defaults that violate text, numeric, calendar, URL, and choice rules before review', () => {
    const draft = definition();
    const field = draft.fields[0];
    const invalid =
      'Location type has a default that violates its field rules.';
    field.type = 'short_text';
    field.options = [];
    field.rules = { minLength: 2 };
    field.default = 'x';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = 'xy';
    expect(designerIssues(draft)).not.toContain(invalid);
    field.rules = { maxLength: 0 };
    field.default = '';
    expect(designerIssues(draft)).not.toContain(invalid);

    field.type = 'decimal';
    field.rules = { precision: 2, min: '0', max: '9.99' };
    field.default = '1.234';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '0';
    expect(designerIssues(draft)).not.toContain(invalid);
    field.default = '10';
    expect(designerIssues(draft)).toContain(invalid);

    field.type = 'integer';
    field.rules = { min: '0', max: '2' };
    field.default = 0;
    expect(designerIssues(draft)).not.toContain(invalid);
    field.default = 3;
    expect(designerIssues(draft)).toContain(invalid);

    field.type = 'date';
    field.rules = { min: '2026-09-25' };
    field.default = '2026-09-24';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '2026-09-25';
    expect(designerIssues(draft)).not.toContain(invalid);
    field.default = '0000-01-01';
    expect(designerIssues(draft)).toContain(invalid);
    field.rules.min = '0000-01-01';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid date bounds.',
    );

    field.type = 'datetime';
    field.rules = { min: '2026-09-25T10:00:00+02:00' };
    field.default = '2026-99-99T00:00:00Z';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '2026-09-25T07:59:59Z';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '2026-09-25T08:00:00Z';
    expect(designerIssues(draft)).not.toContain(invalid);
    field.rules = {
      min: '2026-09-25T10:00:00.000002+02:00',
      max: '2026-09-25T08:00:00.000003Z',
    };
    field.default = '2026-09-25T08:00:00.000001Z';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '2026-09-25T08:00:00.000002Z';
    expect(designerIssues(draft)).not.toContain(invalid);
    field.default = '2026-09-25T08:00:00.000004Z';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '2026-09-25T08:00:00.0000001Z';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = '0000-01-01T00:00:00Z';
    expect(designerIssues(draft)).toContain(invalid);

    field.type = 'url';
    field.rules = {};
    field.default = 'https://user:pass@example.com';
    expect(designerIssues(draft)).toContain(invalid);
    field.default = 'https://example.com/path';
    expect(designerIssues(draft)).not.toContain(invalid);

    field.type = 'multi_select';
    field.options = [
      { id: id(11), label: 'First', active: true },
      { id: id(12), label: 'Second', active: true },
    ];
    field.rules = { maxSelections: 1 };
    field.default = [id(11), id(12)];
    expect(designerIssues(draft)).toContain(invalid);
    field.default = [id(11), id(11)];
    expect(designerIssues(draft)).toContain(invalid);
    field.default = [];
    expect(designerIssues(draft)).not.toContain(invalid);

    field.type = 'boolean';
    field.options = [];
    field.rules = {};
    field.default = false;
    expect(designerIssues(draft)).not.toContain(invalid);
    field.default = undefined;
    expect(designerIssues(draft)).not.toContain(invalid);
  });
  it('requires a supported currency code and validates the complete currency default', () => {
    const draft = definition();
    const field = draft.fields[0];
    const invalid =
      'Location type has a default that violates its field rules.';
    const invalidCode =
      'Location type needs an ISO currency code and precision from 0 to 4.';
    field.type = 'currency';
    field.options = [];
    field.rules = { currencyCode: 'ZZZ', precision: 2 };
    expect(designerIssues(draft)).toContain(invalidCode);
    field.rules = { currencyCode: 'USD', precision: 2, min: '1.00' };
    expect(designerIssues(draft)).not.toContain(invalidCode);
    field.default = { amount: '0.99', currency: 'USD' };
    expect(designerIssues(draft)).toContain(invalid);
    field.default = { amount: '1.234', currency: 'USD' };
    expect(designerIssues(draft)).toContain(invalid);
    field.default = { amount: '1.00', currency: 'USD', extra: true };
    expect(designerIssues(draft)).toContain(invalid);
    field.default = { amount: '1.00', currency: 'USD' };
    expect(designerIssues(draft)).not.toContain(invalid);
  });
  it('keeps the designer ISO 4217 allowlist identical to the authoritative SQL list', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260925000100_published_metadata.sql',
      ),
      'utf8',
    );
    const codes = sql.match(
      /create function private\.metadata_currency_code_valid\(code text\)[\s\S]*?array\[([^\]]+)\]::text\[\]/,
    )?.[1];
    expect(codes).toBeDefined();
    expect([...supportedCurrencyCodes].sort()).toEqual(
      [...(codes?.matchAll(/'([A-Z]{3})'/g) ?? [])]
        .map((match) => match[1])
        .sort(),
    );
    expect(supportedCurrencyCodes.has('ZZZ')).toBe(false);
  });
});

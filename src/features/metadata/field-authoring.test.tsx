import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AddFieldDialog } from './add-field-dialog';
import { FieldSettings, makeField } from './field-settings';
import type { DateTimeDraft } from './field-value-input';
import * as datetimeAdapter from './datetime-adapter';
import {
  fieldTypes,
  type FieldType,
  type MetadataDefinition,
} from './contracts';
import {
  additionRestriction,
  fieldName,
  fieldSettingErrors,
  fieldTypeInfo,
  placementName,
  scopeRestriction,
  settingRuleLabel,
} from './field-authoring-model';
import {
  addFieldToSection,
  hidePlacement,
  sectionEditBlockReason,
  type Field,
} from './designer-model';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const definition = (): MetadataDefinition => ({
  fields: [],
  layout: [
    {
      id: id(1),
      label: 'Details',
      controls: [
        { id: id(2), kind: 'builtin', builtin: 'name', width: 12 },
        { id: id(3), kind: 'builtin', builtin: 'category_id', width: 12 },
        { id: id(4), kind: 'builtin', builtin: 'asset_tag', width: 12 },
      ],
    },
  ],
});
function openPicker(
  initialField?: Field,
  document = definition(),
  initialDateTimeDraft?: DateTimeDraft,
) {
  const add = vi.fn(),
    change = vi.fn(),
    go = vi.fn(),
    stage = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open picker
        </button>
        {open && (
          <AddFieldDialog
            definition={document}
            sectionId={id(1)}
            initialField={initialField}
            initialDateTimeDraft={initialDateTimeDraft}
            onDraftChange={stage}
            onCancel={() => setOpen(false)}
            onAdd={add}
            onChange={change}
            onGo={go}
          />
        )}
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Open picker' });
  trigger.focus();
  fireEvent.click(trigger);
  return {
    add,
    change,
    go,
    stage,
    trigger,
    dialog: screen.getByRole('dialog', { name: 'Add field' }),
  };
}
describe('staged field authoring', () => {
  it.each([
    {
      name: 'invalid DST gap',
      wall: '2026-03-08T02:30:00',
      value: '2026-03-08T02:30:00',
      invalid: true,
    },
    {
      name: 'valid instant',
      wall: '2026-03-08T03:30:00',
      value: '2026-03-08T07:30:00Z',
      invalid: false,
    },
  ])(
    'recovers $name datetime default but clears it after a deliberate type cycle',
    ({ wall, value, invalid }) => {
      const timezone = vi
        .spyOn(datetimeAdapter, 'browserTimeZone')
        .mockReturnValue('UTC');
      try {
        const recovered = {
          ...makeField('datetime', 'Recovered pending time'),
          default: value,
        };
        const { add, stage, dialog } = openPicker(recovered, definition(), {
          wall,
          zone: 'America/New_York',
        });
        const defaults = () =>
          within(dialog).getByRole('group', {
            name: 'Starts with (optional)',
          });
        const openRules = () =>
          fireEvent.click(
            within(dialog).getByText('Optional rules', {
              selector: 'summary',
            }),
          );
        openRules();
        expect(within(defaults()).getByLabelText('Date')).toHaveValue(
          '2026-03-08',
        );
        expect(within(defaults()).getByLabelText('Time')).toHaveValue(
          wall.split('T')[1],
        );
        expect(
          within(defaults()).getByLabelText('Display timezone'),
        ).toHaveValue('America/New_York');
        // Re-selecting the current type preserves ordinary pending recovery.
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Date & time' }),
        );
        expect(stage.mock.lastCall?.[0]).toMatchObject({
          field: { id: recovered.id, default: value },
          datetimeDraft: { wall, zone: 'America/New_York' },
        });
        if (invalid) {
          fireEvent.click(
            within(dialog).getByRole('button', { name: 'Add to form' }),
          );
          expect(add).not.toHaveBeenCalled();
          expect(within(defaults()).getByRole('alert')).toHaveTextContent(
            'does not exist in this timezone',
          );
        }
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Short text' }),
        );
        expect(stage.mock.lastCall?.[0].datetimeDraft).toBeUndefined();
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Date & time' }),
        );
        openRules();
        expect(within(defaults()).getByLabelText('Date')).toHaveValue('');
        expect(within(defaults()).getByLabelText('Time')).toHaveValue('');
        expect(
          within(defaults()).getByLabelText('Display timezone'),
        ).toHaveValue('UTC');
        expect(
          within(dialog).queryByText(/does not exist in this timezone/),
        ).not.toBeInTheDocument();
        expect(stage.mock.lastCall?.[0]).toMatchObject({
          field: { id: recovered.id, type: 'datetime' },
          datetimeDraft: { wall: '', zone: 'UTC' },
        });
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Add to form' }),
        );
        expect(add).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            id: recovered.id,
            type: 'datetime',
            label: 'Recovered pending time',
          }),
          id(1),
        );
        expect(add.mock.lastCall?.[0].default).toBeUndefined();
      } finally {
        timezone.mockRestore();
      }
    },
  );
  it('retains a corrected recovered datetime draft when the field-source tab remounts its settings', () => {
    const recovered = {
      ...makeField('datetime', 'Corrected pending time'),
      default: '2026-03-08T02:30:00',
    };
    const { add, stage, dialog } = openPicker(recovered, definition(), {
      wall: '2026-03-08T02:30:00',
      zone: 'America/New_York',
    });
    const defaults = () =>
      within(dialog).getByRole('group', { name: 'Starts with (optional)' });
    const openRules = () =>
      fireEvent.click(
        within(dialog).getByText('Optional rules', { selector: 'summary' }),
      );
    openRules();
    fireEvent.change(within(defaults()).getByLabelText('Time'), {
      target: { value: '03:30:00' },
    });
    fireEvent.change(within(defaults()).getByLabelText('Display timezone'), {
      target: { value: 'UTC' },
    });
    const correctedValue = stage.mock.lastCall?.[0].field.default;
    expect(correctedValue).toBe('2026-03-08T07:30:00Z');
    fireEvent.click(
      within(dialog).getByRole('tab', { name: 'Use existing field' }),
    );
    fireEvent.click(within(dialog).getByRole('tab', { name: 'New field' }));
    openRules();
    expect(within(defaults()).getByLabelText('Date')).toHaveValue('2026-03-08');
    expect(within(defaults()).getByLabelText('Time')).toHaveValue('07:30:00');
    expect(within(defaults()).getByLabelText('Display timezone')).toHaveValue(
      'UTC',
    );
    expect(within(defaults()).queryByRole('alert')).not.toBeInTheDocument();
    expect(stage.mock.lastCall?.[0]).toMatchObject({
      field: { id: recovered.id, default: correctedValue },
      datetimeDraft: { wall: '2026-03-08T07:30:00', zone: 'UTC' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    expect(add).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: recovered.id, default: correctedValue }),
      id(1),
    );
  });
  it.each(fieldTypes)(
    'configures and adds %s with a readable type, purpose and example',
    (type) => {
      const { add, dialog } = openPicker();
      const info = fieldTypeInfo[type];
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: info.name,
        }),
      );
      fireEvent.change(within(dialog).getByLabelText('Field name'), {
        target: { value: `Example ${info.name}` },
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Add to form' }),
      );
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          label: `Example ${info.name}`,
          required: false,
        }),
        id(1),
      );
      expect(
        within(dialog).getByText('Optional rules', { selector: 'summary' }),
      ).not.toHaveAttribute('open');
    },
  );
  it.each(['Cancel', 'Escape'])(
    'cancels via %s without creating anything and restores focus',
    (action) => {
      const { add, change, trigger, dialog } = openPicker();
      fireEvent.change(within(dialog).getByLabelText('Field name'), {
        target: { value: 'Unsaved draft' },
      });
      if (action === 'Cancel')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      else fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(add).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
      expect(trigger).toHaveFocus();
    },
  );
  it('requires a name inline, leaves the recoverable draft and preserves local type identity', () => {
    const { add, dialog } = openPicker();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent('field name');
    expect(add).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Field name'), {
      target: { value: 'Port count' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Whole number' }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    const first = add.mock.calls[0][0] as Field;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Short text' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    expect(add.mock.calls[1][0].id).toBe(first.id);
  });
  it('offers placed standard fields with Go to field and avoids duplicate insertion', () => {
    const { change, go, dialog } = openPicker();
    fireEvent.click(
      within(dialog).getByRole('tab', { name: 'Standard fields' }),
    );
    const row = within(dialog)
      .getByText('Name', { exact: true })
      .closest('div')!;
    expect(
      within(row).getByText('Already shown in Details'),
    ).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Go to field' }));
    expect(go).toHaveBeenCalledWith(id(2));
    expect(change).not.toHaveBeenCalled();
  });
  it('explains incompatible existing fields and disables addition without mutation', () => {
    const document = definition();
    document.layout[0].applies_to = ['quantity'];
    document.fields = [
      { ...makeField('short_text', 'Asset note'), applies_to: ['asset'] },
    ];
    const before = structuredClone(document);
    const { add, change, go, dialog } = openPicker(undefined, document);
    fireEvent.click(
      within(dialog).getByRole('tab', { name: 'Use existing field' }),
    );
    const row = within(dialog)
      .getByText('Asset note', { exact: true })
      .closest('div')!;
    expect(
      within(row).getByText(
        /This section does not show on every selected form type/,
      ),
    ).toBeVisible();
    const action = within(row).getByRole('button', {
      name: 'Add to this section',
    });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(add).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(document).toEqual(before);
    expect(dialog).toBeInTheDocument();
  });
  it('goes to an already placed custom field without duplicating its definition or placement', () => {
    const field = makeField('short_text', 'Existing note');
    const document = addFieldToSection(definition(), field, id(1));
    const placement = document.layout[0].controls.at(-1)!;
    const before = structuredClone(document);
    const { add, change, go, dialog } = openPicker(undefined, document);
    fireEvent.click(
      within(dialog).getByRole('tab', { name: 'Use existing field' }),
    );
    const row = within(dialog)
      .getByText('Existing note', { exact: true })
      .closest('div')!;
    expect(within(row).getByText('Already shown in Details')).toBeVisible();
    fireEvent.click(within(row).getByRole('button', { name: 'Go to field' }));
    expect(go).toHaveBeenCalledExactlyOnceWith(placement.id);
    expect(add).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(document).toEqual(before);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows a hidden existing field while retaining its placement ID and field settings', () => {
    const field = { ...makeField('boolean', 'Has USB-C?'), default: false };
    const placed = addFieldToSection(definition(), field, id(1));
    const placement = placed.layout[0].controls.at(-1)!;
    const document = hidePlacement(placed, placement.id);
    const before = structuredClone(document);
    const { add, change, go, dialog } = openPicker(undefined, document);
    fireEvent.click(
      within(dialog).getByRole('tab', { name: 'Use existing field' }),
    );
    const row = within(dialog)
      .getByText('Has USB-C?', { exact: true })
      .closest('div')!;
    expect(within(row).getByText('Hidden in Details')).toBeVisible();
    fireEvent.click(within(row).getByRole('button', { name: 'Show' }));
    expect(change).toHaveBeenCalledTimes(1);
    const shown = change.mock.calls[0][0] as MetadataDefinition;
    expect(shown.fields).toEqual(document.fields);
    expect(shown.layout[0].controls).toHaveLength(
      document.layout[0].controls.length,
    );
    expect(shown.layout[0].controls.at(-1)).toEqual({
      ...placement,
      visible: true,
    });
    expect(go).toHaveBeenCalledExactlyOnceWith(placement.id, shown);
    expect(add).not.toHaveBeenCalled();
    expect(document).toEqual(before);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows inline numeric default errors and retains incomplete typing until corrected', () => {
    const { add, dialog } = openPicker(makeField('integer', 'Port count'));
    fireEvent.click(
      within(dialog).getByText('Optional rules', { selector: 'summary' }),
    );
    const initial = within(dialog).getByLabelText('Starts with (optional)');
    fireEvent.change(initial, { target: { value: '-' } });
    expect(initial).toHaveValue('-');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    expect(add).not.toHaveBeenCalled();
    fireEvent.change(initial, { target: { value: '-2' } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ default: -2 }),
      id(1),
    );
  });
  it('keeps incomplete whole-number bounds and reports the error beside the setting', () => {
    function Harness() {
      const [field, setField] = useState(makeField('integer', 'Ports'));
      return <FieldSettings field={field} change={setField} />;
    }
    render(<Harness />);
    fireEvent.click(
      screen.getByText('Optional rules', { selector: 'summary' }),
    );
    fireEvent.click(screen.getByLabelText('Use minimum value'));
    const minimum = screen.getByLabelText('Minimum value', { exact: true });
    fireEvent.change(minimum, { target: { value: '-' } });
    expect(minimum).toHaveValue('-');
    expect(minimum).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Minimum value: Enter a whole number',
    );
    fireEvent.change(minimum, { target: { value: '-2' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(minimum).toHaveValue('-2');
  });
  it.each(
    (
      [
        ['short_text', ['minLength', 'maxLength'], '0'],
        ['long_text', ['minLength', 'maxLength'], '0'],
        ['integer', ['min', 'max'], '0'],
        ['decimal', ['min', 'max'], '0'],
        ['currency', ['min', 'max'], '0'],
        ['date', ['min', 'max'], '2026-10-02'],
        ['datetime', ['min', 'max'], '2026-10-02'],
        ['multi_select', ['maxSelections'], '1'],
      ] as [FieldType, string[], string][]
    ).flatMap(([type, keys, value]) =>
      keys.map((key) => ({ type, key, value })),
    ),
  )(
    'requires enabled $type $key until filled or unchecked',
    ({ type, key, value }) => {
      const field = makeField(type, 'Bounded field');
      const label = settingRuleLabel(field, key);
      const { add, dialog } = openPicker(field);
      fireEvent.click(
        within(dialog).getByText('Optional rules', { selector: 'summary' }),
      );
      const toggle = within(dialog).getByLabelText(
        `Use ${label.toLowerCase()}`,
      );
      fireEvent.click(toggle);
      expect(toggle).toBeChecked();
      expect(
        within(dialog)
          .getAllByRole('alert')
          .some((alert) =>
            alert.textContent?.toLowerCase().includes(label.toLowerCase()),
          ),
      ).toBe(true);
      const submit = () =>
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Add to form' }),
        );
      submit();
      expect(add).not.toHaveBeenCalled();
      if (type === 'datetime') {
        const group = within(dialog).getByRole('group', { name: label });
        fireEvent.change(within(group).getByLabelText('Display timezone'), {
          target: { value: 'UTC' },
        });
        fireEvent.change(within(group).getByLabelText('Date'), {
          target: { value },
        });
        submit();
        expect(add).not.toHaveBeenCalled();
        expect(within(group).getByLabelText('Date')).toHaveValue(value);
        fireEvent.change(within(group).getByLabelText('Time'), {
          target: { value: '09:00' },
        });
      } else {
        fireEvent.change(
          within(dialog).getByLabelText(label, { exact: true }),
          { target: { value } },
        );
      }
      submit();
      expect(add).toHaveBeenCalledTimes(1);
      const saved = add.mock.calls[0][0] as Field;
      expect(saved.rules[key]).toEqual(
        type === 'datetime'
          ? '2026-10-02T09:00:00Z'
          : ['minLength', 'maxLength', 'maxSelections'].includes(key)
            ? Number(value)
            : value,
      );
      add.mockClear();
      if (type === 'datetime') {
        const group = within(dialog).getByRole('group', { name: label });
        fireEvent.click(
          within(group.parentElement!).getByRole('button', {
            name: 'Clear answer',
          }),
        );
      } else {
        fireEvent.change(
          within(dialog).getByLabelText(label, { exact: true }),
          { target: { value: '' } },
        );
      }
      expect(toggle).toBeChecked();
      submit();
      expect(add).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();
      submit();
      expect(add).toHaveBeenCalledTimes(1);
      expect((add.mock.calls[0][0] as Field).rules).not.toHaveProperty(key);
    },
  );
  it('keeps an unchecked checkbox default distinct from no default', () => {
    const { add, dialog } = openPicker(makeField('boolean', 'Has USB-C?'));
    fireEvent.click(
      within(dialog).getByText('Optional rules', { selector: 'summary' }),
    );
    fireEvent.change(within(dialog).getByLabelText('Starts with (optional)'), {
      target: { value: 'false' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ default: false }),
      id(1),
    );
  });
  it('keeps multiline starts-with and optional date restrictions type-specific', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FieldSettings
        field={makeField('long_text', 'Notes')}
        change={onChange}
      />,
    );
    fireEvent.click(
      screen.getByText('Optional rules', { selector: 'summary' }),
    );
    expect(screen.getByLabelText('Starts with (optional)').tagName).toBe(
      'TEXTAREA',
    );
    expect(screen.getByLabelText('Use minimum characters')).not.toBeChecked();
    rerender(
      <FieldSettings
        key="date"
        field={makeField('date', 'Checked on')}
        change={onChange}
      />,
    );
    fireEvent.click(
      screen.getByText('Optional rules', { selector: 'summary' }),
    );
    expect(screen.getByLabelText('Starts with (optional)')).toHaveAttribute(
      'type',
      'date',
    );
    expect(
      screen.getByLabelText('Use earliest allowed date'),
    ).not.toBeChecked();
    expect(
      screen.queryByLabelText('Earliest allowed date', { exact: true }),
    ).not.toBeInTheDocument();
  });
});
describe('authoring and visibility invariants', () => {
  it.each([
    ['integer', { min: '2', max: '1' }],
    [
      'decimal',
      {
        min: '999999999999999999.000002',
        max: '999999999999999999.000001',
        precision: 6,
      },
    ],
    [
      'currency',
      { min: '2.01', max: '2.00', currencyCode: 'USD', precision: 2 },
    ],
    ['date', { min: '2026-10-02', max: '2026-10-01' }],
    [
      'datetime',
      {
        min: '2026-10-01T00:00:00.999999Z',
        max: '2026-10-01T00:00:00.999998Z',
      },
    ],
  ] as const)(
    'names both inverted %s restrictions without losing exact precision',
    (type, rules) => {
      const field = { ...makeField(type, 'Bounded field'), rules };
      const errors = fieldSettingErrors(field);
      expect(errors.min).toMatch(/must be at/);
      expect(errors.max).toMatch(/must be at/);
      expect(errors.min).toMatch(/Maximum|Latest allowed/);
      expect(errors.max).toMatch(/Minimum|Earliest allowed/);
    },
  );
  it('commits new field and placement in one edit and does not mutate unrelated edits', () => {
    const before = definition();
    before.layout[0].label = 'Unsaved heading';
    const field = makeField('boolean', 'Has USB-C?');
    const next = addFieldToSection(before, field, id(1));
    expect(next.fields).toEqual([field]);
    expect(next.layout[0].controls.at(-1)).toMatchObject({
      kind: 'field',
      field_id: field.id,
    });
    expect(before.fields).toEqual([]);
    expect(next.layout[0].label).toBe('Unsaved heading');
    expect(addFieldToSection(next, field, id(1))).toBe(next);
  });
  it('rejects hidden/incompatible additions instead of producing invisible or orphan fields', () => {
    const before = definition();
    const field = makeField('short_text', 'Both forms');
    before.layout[0].applies_to = ['quantity'];
    expect(additionRestriction(before.layout[0], field.applies_to)).toContain(
      'selected form type',
    );
    expect(addFieldToSection(before, field, id(1))).toBe(before);
    before.layout[0].visible = false;
    expect(
      addFieldToSection(before, { ...field, applies_to: ['quantity'] }, id(1)),
    ).toBe(before);
  });
  it('requires explicit optional transition before hiding required fields and retains defaults/identity', () => {
    const field = {
      ...makeField('boolean', 'Has USB-C?'),
      required: true,
      default: false,
    };
    const before = addFieldToSection(definition(), field, id(1));
    const control = before.layout[0].controls.at(-1)!;
    expect(hidePlacement(before, control.id)).toBe(before);
    expect(sectionEditBlockReason(before, id(1), { visible: false })).toContain(
      'optional',
    );
    expect(
      sectionEditBlockReason(before, id(1), { applies_to: ['quantity'] }),
    ).toContain('optional');
    const hidden = hidePlacement(before, control.id, true);
    expect(hidden.fields[0]).toMatchObject({
      id: field.id,
      required: false,
      default: false,
    });
    expect(hidden.layout[0].controls.at(-1)?.visible).toBe(false);
    expect(hidePlacement(before, id(2), true)).toBe(before);
  });
  it('distinguishes untitled definitions from missing references and explains ancestor scope', () => {
    const field = makeField('short_text');
    expect(fieldName(field)).toBe('Untitled field');
    expect(fieldName()).toBe('Missing field');
    const before = addFieldToSection(definition(), field, id(1));
    before.layout[0].applies_to = ['quantity'];
    expect(scopeRestriction(before, field, ['quantity', 'asset'])).toContain(
      'Details restricts',
    );
    expect(scopeRestriction(before, field, ['quantity'])).toBeNull();
    expect(
      placementName(
        { id: id(10), kind: 'field', field_id: id(99), width: 12 },
        before.fields,
      ),
    ).toBe('Missing field');
  });
});

it('keeps selected type beside the dialog header while the field name is focused', () => {
  const { dialog } = openPicker();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Money' }));
  const name = within(dialog).getByLabelText('Field name');
  name.focus();
  expect(within(dialog).getByText('Selected type: Money')).toBeVisible();
  expect(name).toHaveFocus();
});
it('offers compatible optional Yes/No presentation without changing the field identity or answer', () => {
  const initial = { ...makeField('boolean'), default: false };
  function Settings() {
    const [field, setField] = useState(initial);
    return (
      <>
        <FieldSettings
          field={field}
          change={(next) => setField(next as typeof initial)}
        />
        <output data-testid="authored-field">{JSON.stringify(field)}</output>
      </>
    );
  }
  render(<Settings />);
  const presentation = screen.getByLabelText('Answer presentation');
  expect(presentation).toHaveValue('checkbox');
  fireEvent.change(presentation, { target: { value: 'yes_no' } });
  expect(
    JSON.parse(screen.getByTestId('authored-field').textContent!),
  ).toMatchObject({
    id: initial.id,
    type: 'boolean',
    default: false,
    rules: { booleanPresentation: 'yes_no' },
  });
  fireEvent.change(presentation, { target: { value: 'checkbox' } });
  expect(
    JSON.parse(screen.getByTestId('authored-field').textContent!).rules,
  ).toEqual({});
});
it.each(fieldTypes)('shows relevant required help for %s', (type) => {
  const field = { ...makeField(type), required: true };
  render(<FieldSettings field={field} change={() => {}} />);
  if (type !== 'boolean')
    expect(screen.queryByText(/unchecked checkbox/)).not.toBeInTheDocument();
  if (type === 'multi_select')
    expect(
      screen.getByText(
        'Select any that apply. Record a selection or explicitly choose none.',
      ),
    ).toBeVisible();
  expect(screen.getByLabelText('Required')).toBeChecked();
});

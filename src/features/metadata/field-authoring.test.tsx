import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AddFieldDialog } from './add-field-dialog';
import { FieldSettings, makeField } from './field-settings';
import { fieldTypes, type MetadataDefinition } from './contracts';
import {
  additionRestriction,
  fieldName,
  fieldSettingErrors,
  fieldTypeInfo,
  placementName,
  scopeRestriction,
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
function openPicker(initialField?: Field, document = definition()) {
  const add = vi.fn(),
    change = vi.fn(),
    go = vi.fn();
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
    trigger,
    dialog: screen.getByRole('dialog', { name: 'Add field' }),
  };
}
describe('staged field authoring', () => {
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

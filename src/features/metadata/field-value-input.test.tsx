'use client';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MetadataFieldInput } from './field-value-input';
import type { MetadataField } from './field-value-validation';
const field = (type: MetadataField['type']): MetadataField => ({
  id: 'f',
  type,
  label: 'Example',
  help: 'Helpful description',
  required: false,
  applies_to: ['quantity'],
  rules: type === 'currency' ? { currencyCode: 'USD', precision: 2 } : {},
  options: [
    { id: 'parent', label: 'USB', parent_id: null, active: true },
    { id: 'child', label: 'USB-C', parent_id: 'parent', active: true },
  ],
});
it('restores an unresolved date/time wall and display timezone without choosing an instant', () => {
  const changed = vi.fn(),
    draft = vi.fn();
  render(
    <MetadataFieldInput
      field={field('datetime')}
      value="2026-03-08T02:30:00"
      onChange={changed}
      initialDateTimeDraft={{
        wall: '2026-03-08T02:30:00',
        zone: 'America/Chicago',
      }}
      onDateTimeDraftChange={draft}
    />,
  );
  expect(screen.getByLabelText('Date')).toHaveValue('2026-03-08');
  expect(screen.getByLabelText('Time')).toHaveValue('02:30:00');
  expect(screen.getByLabelText('Display timezone')).toHaveValue(
    'America/Chicago',
  );
  expect(screen.getByText(/does not exist in this timezone/)).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
  expect(draft).toHaveBeenCalledWith({
    wall: '2026-03-08T02:30:00',
    zone: 'America/Chicago',
  });
});
function Harness({
  config,
  initial,
  changed = () => {},
}: {
  config: MetadataField;
  initial?: unknown;
  changed?(next: unknown): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MetadataFieldInput
      field={config}
      value={value}
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}
it('chooses No directly in Yes/No presentation, accepts required false, and clears back to unanswered with focus', () => {
  const config = {
    ...field('boolean'),
    required: true,
    rules: { booleanPresentation: 'yes_no' },
  };
  const changed = vi.fn();
  render(<Harness config={config} changed={changed} />);
  fireEvent.click(screen.getByRole('radio', { name: 'No' }));
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
  expect(changed).toHaveBeenLastCalledWith(undefined);
  expect(screen.getByRole('radio', { name: 'Yes' })).toHaveFocus();
  expect(screen.getByText('Not recorded')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
  expect(changed).toHaveBeenLastCalledWith(true);
});
it('keeps existing and unknown boolean presentation on the compatible checkbox path', () => {
  render(
    <MetadataFieldInput
      field={{ ...field('boolean'), rules: { booleanPresentation: 'unknown' } }}
      value={false}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
it('uses a neutral amount prompt inside arbitrary configured currency bounds', () => {
  render(
    <MetadataFieldInput
      field={{
        ...field('currency'),
        rules: { currencyCode: 'USD', precision: 0, min: '0', max: '100' },
      }}
      value={undefined}
      onChange={() => {}}
    />,
  );
  expect(screen.getByPlaceholderText('Enter amount in USD')).toHaveValue('');
  expect(screen.queryByPlaceholderText('125.00')).not.toBeInTheDocument();
});
describe('shared metadata field input', () => {
  it.each([
    'short_text',
    'long_text',
    'integer',
    'decimal',
    'date',
    'url',
    'currency',
  ] as const)(
    'renders and retains the %s answer with associated help',
    (type) => {
      const changed = vi.fn();
      render(<Harness config={field(type)} changed={changed} />);
      const input = screen.getByLabelText('Example');
      const helpId = input.getAttribute('aria-describedby')!;
      expect(document.getElementById(helpId)).toHaveTextContent(
        'Helpful description',
      );
      const value = {
        short_text: '',
        long_text: 'Line one\nLine two',
        integer: '0',
        decimal: '9007199254740992.000001',
        date: '2026-10-01',
        url: 'https://example.com/manual',
        currency: '125.00',
      }[type];
      if (type === 'short_text') {
        fireEvent.change(input, { target: { value: 'temporary' } });
      }
      fireEvent.change(input, { target: { value } });
      expect(changed).toHaveBeenLastCalledWith(
        type === 'integer'
          ? 0
          : type === 'currency'
            ? { amount: '125.00', currency: 'USD' }
            : value,
      );
      expect(input).toHaveValue(type === 'integer' ? '0' : value);
    },
  );
  it('keeps fractional/incomplete integer drafts recoverable and validates inline', () => {
    const changed = vi.fn();
    render(<Harness config={field('integer')} changed={changed} />);
    const input = screen.getByLabelText('Example');
    for (const value of ['-', '1.5', '']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue(value);
      expect(changed).toHaveBeenLastCalledWith(value);
      expect(screen.getByRole('alert')).toHaveTextContent('whole number');
    }
    fireEvent.change(input, { target: { value: '-24' } });
    expect(changed).toHaveBeenLastCalledWith(-24);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows a question once and records unchecked as a required answer', () => {
    const config = { ...field('boolean'), label: 'Has USB-C?', required: true };
    const changed = vi.fn();
    render(<Harness config={config} changed={changed} />);
    const checkbox = screen.getByRole('checkbox', {
      name: 'Has USB-C? (required)',
    });
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(checkbox).not.toHaveAttribute('required');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(changed).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Yes / No')).toBeNull();
    expect(screen.queryByText('No')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    expect(changed).toHaveBeenLastCalledWith(undefined);
  });
  it.each(['single_select', 'multi_select', 'hierarchical_select'] as const)(
    'selects canonical IDs through %s',
    (type) => {
      const changed = vi.fn();
      render(<Harness config={field(type)} changed={changed} />);
      if (type === 'single_select')
        fireEvent.change(screen.getByRole('combobox', { name: 'Example' }), {
          target: { value: 'parent' },
        });
      else if (type === 'multi_select')
        fireEvent.click(screen.getByRole('checkbox', { name: 'USB-C' }));
      else fireEvent.click(screen.getByRole('button', { name: /USB-C/ }));
      expect(changed).toHaveBeenLastCalledWith(
        type === 'multi_select'
          ? ['child']
          : type === 'single_select'
            ? 'parent'
            : 'child',
      );
    },
  );
  it('changes display timezone without touching an existing microsecond instant', () => {
    const changed = vi.fn();
    const value = '2026-10-01T18:12:34.123456Z';
    render(
      <Harness config={field('datetime')} initial={value} changed={changed} />,
    );
    fireEvent.change(screen.getByLabelText('Display timezone'), {
      target: { value: 'America/Chicago' },
    });
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Time')).toHaveValue('13:12:34.123');
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText(/Retained fractional seconds/)).toHaveTextContent(
      '123456',
    );
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-10-02' },
    });
    expect(changed).toHaveBeenLastCalledWith('2026-10-02T18:12:34.123456Z');
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '01:30:00' },
    });
    expect(
      screen
        .getAllByRole('alert')
        .some((node) => node.textContent?.includes('occurs twice')),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'UTC-06:00' }));
    expect(changed).toHaveBeenLastCalledWith('2026-11-01T07:30:00Z');
  });
  it.each([
    ['0001-01-01T00:00:00Z', 'America/Chicago'],
    ['9999-12-31T23:59:59Z', 'Asia/Tokyo'],
  ])(
    'keeps boundary instant %s unchanged in an unrepresentable display timezone',
    (value, zone) => {
      const changed = vi.fn();
      render(
        <Harness
          config={field('datetime')}
          initial={value}
          changed={changed}
        />,
      );
      fireEvent.change(screen.getByLabelText('Display timezone'), {
        target: { value: 'UTC' },
      });
      fireEvent.change(screen.getByLabelText('Display timezone'), {
        target: { value: zone },
      });
      expect(changed).not.toHaveBeenCalled();
      expect(
        screen.getByText(/outside the supported calendar years/),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Display timezone'), {
        target: { value: 'UTC' },
      });
      expect(screen.getByLabelText('Date')).toHaveValue(value.slice(0, 10));
      expect(changed).not.toHaveBeenCalled();
    },
  );
  it('retains partial date/time entry without inventing either part or erasing its counterpart', () => {
    const changed = vi.fn();
    render(<Harness config={field('datetime')} changed={changed} />);
    fireEvent.change(screen.getByLabelText('Display timezone'), {
      target: { value: 'America/Chicago' },
    });
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '01:30:00' },
    });
    expect(screen.getByLabelText('Date')).toHaveValue('');
    expect(screen.getByLabelText('Time')).toHaveValue('01:30:00');
    expect(changed).toHaveBeenLastCalledWith('T01:30:00');
    expect(
      screen
        .getAllByRole('alert')
        .some((node) => node.textContent?.includes('Choose a date and time')),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-11-01' },
    });
    expect(
      screen.getByRole('button', { name: 'UTC-06:00' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'UTC-06:00' }));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '' } });
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-01');
    expect(changed).toHaveBeenLastCalledWith('2026-11-01T');
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '03:30:00' },
    });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } });
    expect(screen.getByLabelText('Time')).toHaveValue('03:30:00');
    expect(changed).toHaveBeenLastCalledWith('T03:30:00');
  });
  it('allocates distinct label/help IDs for simultaneous previews and disables readOnly interaction', () => {
    const changed = vi.fn();
    render(
      <>
        <MetadataFieldInput
          field={field('short_text')}
          value=""
          onChange={changed}
        />
        <MetadataFieldInput
          field={field('short_text')}
          value=""
          onChange={changed}
          readOnly
        />
      </>,
    );
    const inputs = screen.getAllByLabelText('Example');
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[0].getAttribute('aria-describedby')).not.toBe(
      inputs[1].getAttribute('aria-describedby'),
    );
    expect(inputs[1]).toBeDisabled();
  });
  it('retains invalid wall times, blocks them, and lets the user correct or clear them', () => {
    const changed = vi.fn();
    render(
      <Harness
        config={field('datetime')}
        initial="2026-03-07T18:30:00Z"
        changed={changed}
      />,
    );
    fireEvent.change(screen.getByLabelText('Display timezone'), {
      target: { value: 'America/Chicago' },
    });
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-03-08' },
    });
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '02:30:00' },
    });
    expect(screen.getByLabelText('Time')).toHaveValue('02:30:00');
    expect(
      screen
        .getAllByRole('alert')
        .some((node) => node.textContent?.includes('does not exist')),
    ).toBe(true);
    expect(changed).toHaveBeenLastCalledWith('2026-03-08T02:30:00');
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '03:30:00' },
    });
    expect(changed).toHaveBeenLastCalledWith('2026-03-08T08:30:00Z');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    expect(changed).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText('Date')).toHaveValue('');
  });
});

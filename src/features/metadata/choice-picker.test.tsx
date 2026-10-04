import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChoicePicker } from './choice-picker';
const options = [
  { id: 'usb', label: 'USB', active: true },
  { id: 'c', label: 'USB-C', parent_id: 'usb', active: true },
  { id: 'a', label: 'USB-A', parent_id: 'usb', active: true },
  { id: 'net', label: 'Network', active: true },
  { id: 'eth', label: 'Ethernet', parent_id: 'net', active: true },
];
describe('shared choice picker', () => {
  it('associates submitted validation with the actual choice control without changing its value', () => {
    render(
      <>
        <p id="answer-error">Choose a configured answer.</p>
        <ChoicePicker
          options={options.filter((option) => !option.parent_id)}
          type="single_select"
          label="Connector"
          value="usb"
          onChange={() => {}}
          invalid
          describedBy="answer-error"
        />
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Connector' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Choose a configured answer.');
    expect(input).toHaveValue('usb');
  });
  it('shows a visible associated label for a flat dropdown', () => {
    render(
      <ChoicePicker
        options={options.filter((option) => !option.parent_id)}
        type="single_select"
        label="Connector"
        value={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Connector')).toBeVisible();
    expect(screen.getByText('Connector')).toHaveAttribute(
      'for',
      screen.getByRole('combobox', { name: 'Connector' }).id,
    );
  });
  it('selects parents explicitly and replaces a previous branch with one canonical ID', () => {
    function Picker() {
      const [value, setValue] = useState<unknown>('c');
      return (
        <>
          <ChoicePicker
            options={options}
            type="hierarchical_select"
            label="Connection"
            value={value}
            onChange={setValue}
          />
          <output>{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<Picker />);
    expect(screen.getByText('Selected: USB / USB-C')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Network — Choose this option' }),
    );
    expect(screen.getByText('Selected: Network')).toBeInTheDocument();
    expect(screen.getByText('"net"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ethernet' }));
    expect(
      screen.getByText('Selected: Network / Ethernet'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Selected: USB / USB-C')).not.toBeInTheDocument();
  });
  it('retains unavailable answers and forbids new retired selections', () => {
    const change = vi.fn();
    render(
      <ChoicePicker
        options={options.map((o) =>
          o.id === 'c' ? { ...o, active: false } : o,
        )}
        type="hierarchical_select"
        label="Connection"
        value="c"
        onChange={change}
      />,
    );
    expect(screen.getByText('Selected: USB / USB-C')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'USB-C' }),
    ).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    expect(change).toHaveBeenCalledWith(undefined);
  });
  it('searches full paths across pages without truncating options', () => {
    render(
      <ChoicePicker
        options={Array.from({ length: 1000 }, (_, n) => ({
          id: `id${n}`,
          label: `Option ${n}`,
          active: true,
        }))}
        type="hierarchical_select"
        label="Options"
        value="id999"
        onChange={() => {}}
      />,
    );
    expect(
      within(
        screen.getByRole('list', { name: 'Available options' }),
      ).getAllByRole('listitem'),
    ).toHaveLength(50);
    expect(screen.getByText('Selected: Option 999')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search options'), {
      target: { value: 'Option 999' },
    });
    expect(screen.getByRole('button', { name: 'Option 999' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.queryByRole('button', { name: 'Next options' }),
    ).not.toBeInTheDocument();
  });
  it('preserves falsey unset and explicit empty multi choices', () => {
    const change = vi.fn();
    render(
      <ChoicePicker
        options={options}
        type="multi_select"
        label="Options"
        value={undefined}
        onChange={change}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose none' }));
    expect(change).toHaveBeenCalledWith([]);
  });
});

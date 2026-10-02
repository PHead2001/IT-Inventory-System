import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChoiceDefaultEditor, OptionTreeEditor } from './option-tree-editor';
import type { Field } from './designer-model';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base: Field = {
  id: id(1),
  type: 'hierarchical_select',
  label: 'Connection',
  applies_to: ['asset'],
  required: false,
  rules: {},
  options: [
    { id: id(2), label: 'USB', active: true },
    { id: id(3), label: 'USB-C', parent_id: id(2), active: true },
    { id: id(4), label: 'Ethernet', active: true },
  ],
};
function Editor({ initial = base }: { initial?: Field }) {
  const [field, setField] = useState(initial);
  return (
    <>
      <OptionTreeEditor field={field} change={setField} />
      <output data-testid="field">{JSON.stringify(field)}</output>
    </>
  );
}
const current = () =>
  JSON.parse(screen.getByTestId('field').textContent!) as Field;
describe('choice editor', () => {
  it('discards an accidentally added blank leaf without altering other answers', () => {
    render(<Editor initial={{ ...base, default: id(3) }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(current().options).toHaveLength(4);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove option New option' }),
    );
    expect(current().options).toEqual(base.options);
    expect(current().default).toBe(id(3));
    expect(screen.getByRole('button', { name: 'Add option' })).toHaveFocus();
  });
  it('disallows deleting parents and explains how to preserve their children', () => {
    render(<Editor />);
    expect(
      screen.getByRole('button', { name: 'Remove option USB' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Move child options elsewhere before removing/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove option USB' }));
    expect(current().options).toEqual(base.options);
  });
  it('requires confirmation before removing an initial selection and supports cancellation', () => {
    render(<Editor initial={{ ...base, default: id(3) }} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove option USB-C' }),
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'clears that initial selection for new records',
    );
    expect(screen.getByRole('button', { name: 'Keep option' })).toHaveFocus();
    expect(current().default).toBe(id(3));
    fireEvent.click(screen.getByRole('button', { name: 'Keep option' }));
    expect(current().options).toEqual(base.options);
    expect(current().default).toBe(id(3));
    expect(screen.getByLabelText('Option name: USB-C')).toHaveFocus();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove option USB-C' }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove and clear initial selection',
      }),
    );
    expect(current().options.map((option) => option.id)).toEqual([
      id(2),
      id(4),
    ]);
    expect(current().default).toBeUndefined();
  });
  it('preserves other multi-select initial choices on confirmed removal', () => {
    render(
      <Editor
        initial={{
          ...base,
          type: 'multi_select',
          options: base.options.filter((option) => !option.parent_id),
          default: [id(2), id(4)],
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove option USB' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove and clear initial selection',
      }),
    );
    expect(current().default).toEqual([id(4)]);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove option Ethernet',
      }),
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep option' }), {
      key: 'Escape',
    });
    expect(current().default).toEqual([id(4)]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps option name Enter presses from submitting the outer form', () => {
    render(<Editor />);
    expect(
      fireEvent.keyDown(screen.getByLabelText('Option name: USB'), {
        key: 'Enter',
      }),
    ).toBe(false);
  });
  it('shows nested rows directly, adds a child with focus and preserves IDs on rename/reorder', () => {
    render(<Editor />);
    expect(screen.getByLabelText('Option name: USB-C')).toBeVisible();
    expect(screen.queryByText('Root')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Option name: USB-C'), {
      target: { value: 'Type C' },
    });
    expect(current().options[1]).toMatchObject({
      id: id(3),
      label: 'Type C',
      parent_id: id(2),
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add child option to USB' }),
    );
    expect(screen.getByLabelText('Option name: New option')).toHaveFocus();
    expect(current().options.at(-1)).toMatchObject({ parent_id: id(2) });
    fireEvent.click(screen.getByRole('button', { name: 'Move down USB' }));
    expect(current().options[0].id).toBe(id(4));
  });
  it('moves subtrees only to safe destinations and retires without deleting descendants', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to… USB' }));
    const destinations = screen.getByLabelText('Move under');
    expect(
      within(destinations).queryByRole('option', { name: 'USB / USB-C' }),
    ).not.toBeInTheDocument();
    fireEvent.change(destinations, { target: { value: id(4) } });
    expect(current().options[0]).toMatchObject({ id: id(2), parent_id: id(4) });
    expect(current().options[1]).toMatchObject({ id: id(3), parent_id: id(2) });
    fireEvent.click(screen.getByRole('button', { name: 'Retire option USB' }));
    expect(current().options[0].active).toBe(false);
    expect(current().options[1].active).toBe(true);
    expect(current().options).toHaveLength(3);
  });
  it('renders flat editable names without hierarchy or pagination chrome for small lists', () => {
    render(
      <Editor
        initial={{
          ...base,
          type: 'single_select',
          options: base.options.filter((o) => !o.parent_id),
        }}
      />,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: /Add child/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search options')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Next choices' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move down USB' }));
    expect(current().options.map((o) => o.id)).toEqual([id(4), id(2)]);
  });
  it('bounds 1,000 rows, supports search and reveals added children on their page', () => {
    const options = Array.from({ length: 999 }, (_, n) => ({
      id: id(n + 100),
      label: `Node ${n}`,
      active: true,
    }));
    render(<Editor initial={{ ...base, options }} />);
    expect(
      within(screen.getByRole('list', { name: 'Choices' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(50);
    fireEvent.change(screen.getByLabelText('Search options'), {
      target: { value: 'Node 998' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add child option to Node 998' }),
    );
    expect(screen.getByLabelText('Option name: New option')).toHaveFocus();
    expect(current().options.at(-1)?.parent_id).toBe(id(1098));
    expect(screen.getByRole('button', { name: 'Add option' })).toBeDisabled();
  });
  it('preserves 64-level choices and disallows adding a 65th level', () => {
    const options = Array.from({ length: 64 }, (_, n) => ({
      id: id(n + 100),
      label: `Depth ${n + 1}`,
      active: true,
      ...(n ? { parent_id: id(n + 99) } : {}),
    }));
    render(<Editor initial={{ ...base, options }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next choices' }));
    expect(
      screen.getByRole('button', { name: 'Add child option to Depth 64' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Add child option to Depth 63' }),
    ).not.toBeDisabled();
  });
});
it('default multiple choices distinguish explicitly empty from unset', () => {
  function Defaults() {
    const [field, setField] = useState({
      ...base,
      type: 'multi_select' as const,
      options: base.options.filter((o) => !o.parent_id),
      default: [id(2)],
    });
    return (
      <>
        <ChoiceDefaultEditor
          field={field}
          change={(next) => setField(next as typeof field)}
        />
        <output data-testid="field">{JSON.stringify(field)}</output>
      </>
    );
  }
  render(<Defaults />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'USB' }));
  expect(current().default).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
  expect(current().default).toBeUndefined();
});

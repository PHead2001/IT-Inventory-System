import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChoiceDefaultEditor, OptionTreeEditor } from './option-tree-editor';
import type { Field } from './designer-model';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('large option hierarchy editor', () => {
  it('pages 1,000 choices and edits one selected node with bounded parent candidates', () => {
    const field: Field = {
      id: id(1),
      type: 'hierarchical_select',
      label: 'Type',
      applies_to: ['asset'],
      required: false,
      rules: {},
      options: Array.from({ length: 1000 }, (_, index) => ({
        id: id(index + 100),
        label: `Node ${index}`,
        active: true,
      })),
    };
    const change = vi.fn();
    render(<OptionTreeEditor field={field} change={change} />);
    const list = screen.getByRole('list', { name: 'Choices' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText('1–50 of 1000')).toBeInTheDocument();
    expect(screen.queryByLabelText('Parent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next choices' }));
    expect(screen.getByText('51–100 of 1000')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search choice paths'), {
      target: { value: 'Node 999' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button', { name: /Node 999/ }));
    expect(
      screen.getByLabelText('Parent').querySelectorAll('option').length,
    ).toBeLessThanOrEqual(51);
    fireEvent.change(screen.getByLabelText('Search parent paths'), {
      target: { value: 'Node 998' },
    });
    fireEvent.change(screen.getByLabelText('Parent'), {
      target: { value: id(1098) },
    });
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ id: id(1099), parent_id: id(1098) }),
        ]),
      }),
    );
  });
  it('keeps a selected default visible while paging 1,000 active choices', () => {
    const options = Array.from({ length: 1000 }, (_, index) => ({
      id: id(index + 100),
      label: `Node ${index}`,
      active: true,
    }));
    const change = vi.fn();
    const field: Field = {
      id: id(1),
      type: 'multi_select',
      label: 'Types',
      applies_to: ['asset'],
      required: false,
      rules: {},
      options,
      default: [id(1099)],
    };
    render(<ChoiceDefaultEditor field={field} change={change} />);
    const list = screen.getByRole('list', { name: 'Default choices' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText(/1 selected: Node 999/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search default choices'), {
      target: { value: 'Node 999' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(list).getByRole('button', { name: /Node 999/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(list).getByRole('button', { name: /Node 999/ }));
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({ default: undefined }),
    );
  });
});

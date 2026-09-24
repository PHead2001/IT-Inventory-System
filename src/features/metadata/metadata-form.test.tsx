import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { submitInventory } from '@/features/inventory/actions';
import {
  MetadataForm,
  MetadataFormPreview,
  buildCustomPatch,
} from './metadata-form';
import type { MetadataForm as Form } from './contracts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/features/inventory/actions', () => ({
  submitInventory: vi.fn(),
  findDuplicateSerials: vi.fn(),
}));
vi.mock('@/features/locations/location-picker', () => ({
  LocationPicker: () => <div>Location picker</div>,
}));

const categoryId = '00000000-0000-4000-8000-000000000001';
const firstRevision = '00000000-0000-4000-8000-000000000002';
const secondRevision = '00000000-0000-4000-8000-000000000003';
const sectionId = '00000000-0000-4000-8000-000000000004';
const fieldId = '00000000-0000-4000-8000-000000000005';
const otherCategory = '00000000-0000-4000-8000-000000000010';
const form = (revision = firstRevision): Form => ({
  category_id: categoryId,
  published_revision_id: revision,
  published_number: revision === firstRevision ? '1' : '2',
  draft_id: null,
  draft_version: null,
  draft_definition: null,
  published_definition: {
    fields: [
      {
        id: fieldId,
        type: 'boolean',
        label: 'Inspected',
        applies_to: ['quantity'],
        required: true,
        rules: {},
        options: [],
      },
    ],
    layout: [
      {
        id: sectionId,
        label: 'Details',
        controls: [
          {
            id: '00000000-0000-4000-8000-000000000006',
            kind: 'builtin',
            builtin: 'name',
            width: 12,
          },
          {
            id: '00000000-0000-4000-8000-000000000007',
            kind: 'builtin',
            builtin: 'category_id',
            width: 12,
          },
          {
            id: '00000000-0000-4000-8000-000000000008',
            kind: 'field',
            field_id: fieldId,
            width: 'Auto',
          },
        ],
      },
    ],
  },
});
const item = {
  id: '00000000-0000-4000-8000-000000000009',
  name: 'Cable',
  description: null,
  categoryId,
  categoryName: 'Parts',
  manufacturer: null,
  model: null,
  version: 1,
  archived: false,
  reorderThreshold: null,
  customValues: {},
  validatedFormRevisionId: firstRevision,
  needsMetadata: false,
};
const props = {
  kind: 'quantity' as const,
  categories: [{ id: categoryId, name: 'Parts', active: true }],
  locations: [],
  item,
};
describe('published metadata form', () => {
  it('previews live controls in order without submitting inventory', () => {
    const { container } = render(
      <MetadataFormPreview
        kind="quantity"
        definition={form().published_definition}
        categoryId={categoryId}
        categoryName="Parts"
      />,
    );
    expect(
      screen.getByRole('form', { name: 'Preview quantity metadata' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Inspected/)).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('label')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['Name', 'Category', 'Inspected (required)']);
    expect(
      screen.queryByRole('button', { name: 'Review metadata' }),
    ).toBeNull();
    expect(screen.queryByLabelText('Initial quantity')).toBeNull();
    fireEvent.submit(
      screen.getByRole('form', { name: 'Preview quantity metadata' }),
    );
    expect(screen.queryByRole('button', { name: 'Confirm save' })).toBeNull();
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('preserves false, zero and empty strings as values distinct from missing', () => {
    const definition = {
      fields: [
        form().published_definition.fields[0],
        {
          ...form().published_definition.fields[0],
          id: sectionId,
          type: 'integer' as const,
        },
        {
          ...form().published_definition.fields[0],
          id: firstRevision,
          type: 'short_text' as const,
        },
      ],
      layout: [],
    };
    const patch = buildCustomPatch(
      definition,
      'quantity',
      {
        [fieldId]: false,
        [sectionId]: 0,
        [firstRevision]: '',
      },
      [],
      true,
    );
    expect(patch.set).toEqual({
      [fieldId]: false,
      [sectionId]: 0,
      [firstRevision]: '',
    });
    expect(patch.unset).toEqual([]);
    expect(buildCustomPatch(definition, 'quantity', {}, [], true).set).toEqual(
      {},
    );
  });
  it('keeps entered values and original item baseline until explicit schema and item review', () => {
    const { rerender } = render(
      <MetadataForm {...props} forms={{ [categoryId]: form() }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Edited cable' },
    });
    fireEvent.change(screen.getByLabelText(/Inspected/), {
      target: { value: 'false' },
    });
    rerender(
      <MetadataForm
        {...props}
        item={{ ...item, version: 2, name: 'Updated elsewhere' }}
        forms={{ [categoryId]: form(secondRevision) }}
      />,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Edited cable',
    );
    expect(
      screen.getByText(/record changed from version 1 to 2/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/published form changed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/previous "Cable"; latest "Updated elsewhere"/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use reviewed form revision' }),
    );
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use reviewed record version' }),
    );
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeEnabled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Edited cable',
    );
    expect(
      (screen.getByLabelText(/Inspected/) as HTMLSelectElement).value,
    ).toBe('false');
  });
  it('keeps the original option and entered value until schema review, then shows a retired choice', () => {
    const choiceId = '00000000-0000-4000-8000-000000000020';
    const original = form();
    original.published_definition.fields[0] = {
      ...original.published_definition.fields[0],
      type: 'single_select',
      label: 'Inspection choice',
      options: [
        {
          id: choiceId,
          label: 'Original choice',
          active: true,
          parent_id: null,
        },
      ],
    };
    const revised = form(secondRevision);
    revised.published_definition.fields[0] = {
      ...revised.published_definition.fields[0],
      type: 'single_select',
      label: 'Revised choice',
      required: false,
      options: [],
    };
    const { rerender } = render(
      <MetadataForm {...props} forms={{ [categoryId]: original }} />,
    );
    fireEvent.change(screen.getByLabelText(/Inspection choice/), {
      target: { value: choiceId },
    });
    rerender(<MetadataForm {...props} forms={{ [categoryId]: revised }} />);
    const oldInput = screen.getByLabelText(
      /Inspection choice/,
    ) as HTMLSelectElement;
    expect(oldInput.value).toBe(choiceId);
    expect(screen.queryByLabelText(/Revised choice/)).toBeNull();
    expect(
      screen.getByText(/label changed to Revised choice/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/available choices or choice labels changed/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use reviewed form revision' }),
    );
    const newInput = screen.getByLabelText(
      'Revised choice',
    ) as HTMLSelectElement;
    expect(newInput.value).toBe(choiceId);
    expect(
      screen.getByText(/Retained historical choice: Original choice/),
    ).toBeInTheDocument();
  });
  it('requires an explicit legacy-value acknowledgement when changing an item category', () => {
    const target = form(secondRevision);
    target.category_id = otherCategory;
    target.published_definition.fields = [];
    target.published_definition.layout[0].controls =
      target.published_definition.layout[0].controls.slice(0, 2);
    render(
      <MetadataForm
        {...props}
        item={{
          ...item,
          customValues: {
            [fieldId]: { value: false, validated_revision_id: firstRevision },
          },
        }}
        categories={[
          ...props.categories,
          { id: otherCategory, name: 'Other', active: true },
        ]}
        forms={{ [categoryId]: form(), [otherCategory]: target }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: otherCategory },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    expect(screen.getByRole('button', { name: 'Confirm save' })).toBeDisabled();
    const acknowledgement = screen.getByLabelText(
      /existing custom values.*legacy values/i,
    );
    fireEvent.click(acknowledgement);
    expect(screen.getByRole('button', { name: 'Confirm save' })).toBeEnabled();
  });
});

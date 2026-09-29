import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { submitInventory } from '@/features/inventory/actions';
import { submitCustody } from '@/features/custody/actions';
import { fetchCategoryForm } from './form-fetch.actions';
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
vi.mock('@/features/custody/actions', () => ({ submitCustody: vi.fn() }));
vi.mock('./form-fetch.actions', () => ({ fetchCategoryForm: vi.fn() }));
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
  itemCode: null,
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
  it('omits a section whose only control does not apply to an asset while keeping quantity item code', () => {
    const current = form();
    current.published_definition.layout.push({
      id: '00000000-0000-4000-8000-000000000025',
      label: 'Identification',
      controls: [
        {
          id: '00000000-0000-4000-8000-000000000026',
          kind: 'builtin',
          builtin: 'item_code',
          width: 12,
        },
      ],
    });
    const { unmount } = render(
      <MetadataFormPreview
        kind="asset"
        definition={current.published_definition}
        categoryId={categoryId}
        categoryName="Parts"
      />,
    );
    expect(
      screen.queryByRole('heading', { name: 'Identification' }),
    ).toBeNull();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    unmount();
    render(
      <MetadataFormPreview
        kind="quantity"
        definition={current.published_definition}
        categoryId={categoryId}
        categoryName="Parts"
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Identification' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Item code (SKU)')).toBeInTheDocument();
  });
  it('shows optional asset identifiers only on serialized forms and quantity identifiers only on quantity forms', () => {
    const current = form();
    current.published_definition.layout[0].controls.push(
      {
        id: '00000000-0000-4000-8000-000000000031',
        kind: 'builtin',
        builtin: 'asset_tag',
        width: 12,
      },
      {
        id: '00000000-0000-4000-8000-000000000032',
        kind: 'builtin',
        builtin: 'serial_number',
        width: 12,
      },
      {
        id: '00000000-0000-4000-8000-000000000033',
        kind: 'builtin',
        builtin: 'item_code',
        width: 12,
      },
      {
        id: '00000000-0000-4000-8000-000000000034',
        kind: 'builtin',
        builtin: 'reorder_threshold',
        width: 12,
      },
    );
    const { unmount } = render(
      <MetadataFormPreview
        kind="asset"
        definition={current.published_definition}
        categoryId={categoryId}
        categoryName="Parts"
      />,
    );
    expect(screen.getByLabelText('Asset tag')).toHaveValue('');
    expect(screen.getByLabelText('Serial number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Item code (SKU)')).toBeNull();
    expect(screen.queryByLabelText('Reorder threshold (optional)')).toBeNull();
    unmount();
    render(
      <MetadataFormPreview
        kind="quantity"
        definition={current.published_definition}
        categoryId={categoryId}
        categoryName="Parts"
      />,
    );
    expect(screen.getByLabelText('Item code (SKU)')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Reorder threshold (optional)'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Asset tag')).toBeNull();
    expect(screen.queryByLabelText('Serial number')).toBeNull();
  });
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
    expect(screen.getByRole('checkbox', { name: /Inspected/ })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
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
  it('keeps missing, false, and true boolean values distinct with an explicit Unset', () => {
    render(
      <MetadataFormPreview
        kind="quantity"
        definition={form().published_definition}
        categoryId={categoryId}
        categoryName="Parts"
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: /Inspected/ });
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByText('Not set')).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('No')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unset' }));
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });
  it('validates quantity Item code by Unicode characters and keeps its display text', () => {
    const current = form();
    current.published_definition.layout[0].controls.push({
      id: '00000000-0000-4000-8000-000000000024',
      kind: 'builtin',
      builtin: 'item_code',
      width: 'Auto',
    });
    render(<MetadataForm {...props} forms={{ [categoryId]: current }} />);
    const input = screen.getByLabelText('Item code (SKU)');
    expect(input).not.toHaveAttribute('maxLength');
    fireEvent.change(input, { target: { value: '😀'.repeat(101) } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { value: '😀'.repeat(100) } });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeEnabled();
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
      layout: [
        {
          id: sectionId,
          label: 'Values',
          controls: [
            {
              id: '00000000-0000-4000-8000-000000000021',
              kind: 'field' as const,
              field_id: fieldId,
              width: 'Auto' as const,
            },
            {
              id: '00000000-0000-4000-8000-000000000022',
              kind: 'field' as const,
              field_id: sectionId,
              width: 'Auto' as const,
            },
            {
              id: '00000000-0000-4000-8000-000000000023',
              kind: 'field' as const,
              field_id: firstRevision,
              width: 'Auto' as const,
            },
          ],
        },
      ],
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
    const hidden = {
      ...definition,
      layout: definition.layout.map((section) => ({
        ...section,
        controls: section.controls.map((control, index) =>
          index === 0 ? { ...control, visible: false } : control,
        ),
      })),
    };
    expect(
      buildCustomPatch(
        hidden,
        'quantity',
        { [fieldId]: false, [sectionId]: 0 },
        [fieldId, sectionId],
        false,
      ),
    ).toEqual({ set: { [sectionId]: 0 }, unset: [] });
    const hiddenSection = {
      ...definition,
      layout: definition.layout.map((section) => ({
        ...section,
        visible: false,
      })),
    };
    expect(
      buildCustomPatch(
        hiddenSection,
        'quantity',
        { [fieldId]: false },
        [fieldId],
        false,
      ),
    ).toEqual({ set: {}, unset: [] });
  });
  it('records an opening site assignment with the same published custom form and no fictional storage source', async () => {
    vi.mocked(submitCustody).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '1',
      changed: true,
    });
    render(
      <MetadataForm
        kind="quantity"
        categories={props.categories}
        locations={[]}
        forms={{ [categoryId]: form() }}
        openingSite={{
          id: item.id,
          code: 'PROPERTY-A',
          name: 'Example Property',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Existing adapters' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Inspected/ }));
    fireEvent.change(screen.getByLabelText('Units already at this site'), {
      target: { value: '3' },
    });
    expect(screen.queryByLabelText('Initial location')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(submitCustody).toHaveBeenCalled());
    expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
      operation: 'quantity_site_open',
      payload: {
        name: 'Existing adapters',
        site_id: item.id,
        quantity: 3,
        expected_published_revision_id: firstRevision,
        custom_patch: { set: { [fieldId]: true }, unset: [] },
      },
    });
    const payload = vi.mocked(submitCustody).mock.calls[0][0] as {
      payload: Record<string, unknown>;
    };
    expect(payload.payload).not.toHaveProperty('initial_location_id');
    expect(payload.payload).not.toHaveProperty('item_id');
    expect(payload.payload).not.toHaveProperty('expected_version');
  });
  it('opens a serialized asset at a site without an edit baseline or storage location', async () => {
    vi.mocked(submitCustody).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '1',
      changed: true,
    });
    render(
      <MetadataForm
        kind="asset"
        categories={props.categories}
        locations={[]}
        forms={{ [categoryId]: form() }}
        openingSite={{
          id: item.id,
          code: 'PROPERTY-A',
          name: 'Example Property',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Existing tablet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(submitCustody).toHaveBeenCalled());
    const command = vi.mocked(submitCustody).mock.calls[0][0] as {
      operation: string;
      payload: Record<string, unknown>;
    };
    expect(command.operation).toBe('asset_site_open');
    expect(command.payload).toMatchObject({
      name: 'Existing tablet',
      site_id: item.id,
      expected_published_revision_id: firstRevision,
    });
    expect(command.payload).not.toHaveProperty('asset_id');
    expect(command.payload).not.toHaveProperty('expected_version');
    expect(command.payload).not.toHaveProperty('location_id');
  });
  it('keeps entered values and original item baseline until explicit schema and item review', () => {
    const { rerender } = render(
      <MetadataForm {...props} forms={{ [categoryId]: form() }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Edited cable' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Inspected/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Inspected/ }));
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
    expect(screen.getByRole('checkbox', { name: /Inspected/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
  it('refetches a secondary category after a schema conflict without losing entered values', async () => {
    const secondary = { ...form(), category_id: otherCategory };
    const revised = { ...form(secondRevision), category_id: otherCategory };
    vi.mocked(fetchCategoryForm)
      .mockResolvedValueOnce({ ok: true, form: secondary })
      .mockResolvedValueOnce({ ok: true, form: revised });
    vi.mocked(submitInventory).mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'stale_schema',
      message: 'The form changed.',
    });
    render(
      <MetadataForm
        {...props}
        categories={[
          ...props.categories,
          { id: otherCategory, name: 'Adapters', active: true },
        ]}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: otherCategory },
    });
    await waitFor(() =>
      expect(fetchCategoryForm).toHaveBeenCalledWith(otherCategory),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review metadata' }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Edited cable' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalled());
    expect(
      (vi.mocked(submitInventory).mock.calls[0][0] as { payload: unknown })
        .payload,
    ).toMatchObject({
      expected_published_revision_id: firstRevision,
    });
    await waitFor(() => expect(fetchCategoryForm).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/published form changed/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Edited cable');
    expect(screen.getByRole('button', { name: 'Confirm save' })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use reviewed form revision' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Edited cable');
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeEnabled();
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

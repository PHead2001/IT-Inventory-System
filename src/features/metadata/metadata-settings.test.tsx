import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MetadataSettings } from './metadata-settings';
import {
  reviewMetadataPublish,
  saveMetadataForm,
  verifyMetadataDesignerIdentity,
} from './actions';
import type { MetadataDefinition, MetadataForm } from './contracts';
import { moveControl } from './designer-model';
import {
  clearAllDesignerRecovery,
  designerInstanceKey,
  readDesignerRecovery,
  writeDesignerRecovery,
} from './designer-recovery';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  submitMetadataDraft: vi.fn(),
  reviewMetadataPublish: vi.fn(),
  saveMetadataForm: vi.fn(),
  verifyMetadataDesignerIdentity: vi.fn(),
}));
vi.mock('./metadata-form', () => ({
  MetadataFormPreview: ({ definition }: { definition: MetadataDefinition }) => {
    // The live form snapshots its form at mount. The designer must explicitly
    // remount that same component after edits without changing inventory behavior.
    const [snapshot] = useState(() => ({
      labels: definition.fields.map((field) => field.label).join(','),
      order: definition.layout
        .flatMap((section) =>
          section.controls.map(
            (control) => control.builtin ?? control.field_id ?? control.kind,
          ),
        )
        .join(','),
    }));
    return (
      <div>
        <span>Shared live preview</span>
        <span data-testid="preview-fields">{snapshot.labels}</span>
        <span data-testid="preview-order">{snapshot.order}</span>
      </div>
    );
  },
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const form: MetadataForm = {
  category_id: id(1),
  published_revision_id: id(2),
  published_number: '1',
  draft_id: null,
  draft_version: null,
  draft_definition: null,
  published_definition: {
    fields: [],
    layout: [
      {
        id: id(3),
        label: 'Details',
        controls: [
          { id: id(4), kind: 'builtin', builtin: 'name', width: 12 },
          { id: id(5), kind: 'builtin', builtin: 'category_id', width: 12 },
          {
            id: id(6),
            kind: 'builtin',
            builtin: 'asset_tag',
            width: 12,
            applies_to: ['asset'],
          },
        ],
      },
    ],
  },
};
function mount() {
  render(
    <MetadataSettings
      memberId={id(50)}
      categories={[{ id: id(1), name: 'Cables', active: true }]}
      forms={{ [id(1)]: form }}
    />,
  );
}

describe('category form designer', () => {
  beforeEach(() => {
    clearAllDesignerRecovery();
    vi.mocked(saveMetadataForm).mockReset();
    vi.mocked(reviewMetadataPublish).mockReset();
    vi.mocked(saveMetadataForm).mockReset();
    vi.mocked(verifyMetadataDesignerIdentity).mockReset();
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({ ok: true });
  });
  it('keeps library, canvas, and inspector as three panes with hidden controls inside the library', () => {
    const hiddenForm = structuredClone(form);
    hiddenForm.published_definition.layout[0].controls[0].visible = false;
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: hiddenForm }}
      />,
    );
    const panes = screen.getByTestId('designer-panes');
    const library = screen.getByTestId('designer-library');
    const canvas = screen.getByTestId('designer-canvas');
    const inspector = screen.getByTestId('designer-inspector');
    expect(Array.from(panes.children)).toEqual([library, canvas, inspector]);
    expect(panes.className).toContain('minmax(28rem,2.5fr)');
    const nameRow = screen
      .getAllByTestId('designer-control-name')
      .find((node) => node.textContent?.startsWith('Name'));
    expect(nameRow).toHaveClass('block');
    expect(nameRow?.closest('[data-control-id]')).toContainElement(
      screen.getByRole('button', { name: 'Drag Name' }),
    );
    expect(nameRow?.closest('[data-control-id]')).toContainElement(
      screen.getByRole('button', { name: 'Resize Name' }),
    );
    fireEvent.click(within(library).getByText(/Hidden & unplaced/));
    expect(
      within(library).getByText('Hidden controls (1)'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(library).getByRole('button', { name: 'Restore Name' }),
    );
    expect(
      within(library).queryByRole('button', { name: 'Restore Name' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Designer panels' }),
    ).toContainElement(screen.getByRole('button', { name: 'Library' }));
  });
  it('keeps canvas previews inert and selects stable controls into the Inspector by focus or keyboard', () => {
    mount();
    const canvas = screen.getByTestId('designer-canvas');
    const inspector = screen.getByTestId('designer-inspector');
    const name = canvas.querySelector<HTMLElement>(
      `[data-control-id="${id(4)}"]`,
    )!;
    const category = canvas.querySelector<HTMLElement>(
      `[data-control-id="${id(5)}"]`,
    )!;
    expect(
      within(canvas).queryByText('Layout options'),
    ).not.toBeInTheDocument();
    expect(
      within(name).getByTestId('designer-control-preview'),
    ).toHaveAttribute('aria-hidden', 'true');
    expect(name.querySelector('input, select, textarea')).toBeNull();
    expect(within(inspector).queryByLabelText('Width')).not.toBeInTheDocument();
    fireEvent.focus(name);
    expect(name).toHaveAttribute('data-selected', 'true');
    expect(
      within(inspector).getByRole('region', { name: 'Name layout properties' }),
    ).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Show control')).toBeDisabled();
    fireEvent.change(within(inspector).getByLabelText('Width'), {
      target: { value: '6' },
    });
    expect(canvas.querySelector(`[data-control-id="${id(4)}"]`)).toBe(name);
    fireEvent.keyDown(category, { key: 'Enter' });
    expect(category).toHaveAttribute('data-selected', 'true');
    expect(
      within(inspector).queryByRole('region', {
        name: 'Name layout properties',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).getByRole('region', {
        name: 'Category layout properties',
      }),
    ).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Show control')).toBeDisabled();
  });
  it('clears the previous field Inspector when inspecting or creating a section', () => {
    mount();
    const inspector = screen.getByTestId('designer-inspector');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    expect(within(inspector).getByLabelText('Label')).toHaveValue('Connector');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect section' }));
    expect(within(inspector).queryByLabelText('Label')).not.toBeInTheDocument();
    expect(within(inspector).queryByLabelText('Width')).not.toBeInTheDocument();
    expect(within(inspector).getByText(/Section Details/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getByRole('button', { name: 'Drag Connector' })
        .closest('[data-control-id]')!,
    );
    expect(within(inspector).getByLabelText('Label')).toHaveValue('Connector');
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(within(inspector).queryByLabelText('Label')).not.toBeInTheDocument();
    expect(within(inspector).queryByLabelText('Width')).not.toBeInTheDocument();
    expect(
      within(inspector).getByText(/Section New section/),
    ).toBeInTheDocument();
  });
  it('counts a hidden section once, then exposes its separately hidden child for restore', () => {
    const hiddenForm = structuredClone(form);
    hiddenForm.published_definition.layout.push({
      id: id(30),
      label: 'Archive details',
      visible: false,
      controls: [
        {
          id: id(31),
          kind: 'builtin',
          builtin: 'description',
          width: 12,
          visible: false,
        },
      ],
    });
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: hiddenForm }}
      />,
    );
    const library = screen.getByTestId('designer-library');
    fireEvent.click(within(library).getByText(/Hidden & unplaced/));
    expect(
      within(library).getByText('Hidden sections (1)'),
    ).toBeInTheDocument();
    expect(
      within(library).getByText('Hidden controls (0)'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(library).getByRole('button', {
        name: 'Restore section Archive details',
      }),
    );
    expect(
      within(library).getByText('Hidden controls (1)'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(library).getByRole('button', { name: 'Restore Description' }),
    );
    expect(within(library).getByText('No hidden fields')).toBeInTheDocument();
  });
  it('reports intrinsic kinds and places an unplaced standard control in a selected section', () => {
    mount();
    const library = screen.getByTestId('designer-library');
    fireEvent.click(within(library).getByText(/Hidden & unplaced/));
    const itemCode = within(library)
      .getByText(/Item Code · Standard control/)
      .closest('div')!;
    fireEvent.click(
      within(itemCode).getByRole('button', { name: 'Place Item Code' }),
    );
    const control = screen
      .getByRole('button', { name: 'Drag Item Code' })
      .closest('[data-control-id]')!;
    expect(
      within(control as HTMLElement).getByTitle(
        'Form types using this control',
      ),
    ).toHaveTextContent('Quantity');
    fireEvent.click(
      screen.getByText(/Live preview · open quantity or asset form/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Asset' }));
    expect(
      within(library).getByText('Excluded from Serialized preview (1)'),
    ).toBeInTheDocument();
  });
  it('gives selected field headings a full-width row above inspector actions', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const heading = screen.getByRole('heading', {
      name: 'Untitled field · Short Text',
    });
    expect(heading).toHaveClass('break-words');
    expect(heading.nextElementSibling).toContainElement(
      screen.getByRole('button', { name: 'Field up' }),
    );
    expect(heading.nextElementSibling).toContainElement(
      screen.getByRole('button', { name: 'Field down' }),
    );
    expect(heading.nextElementSibling).toContainElement(
      screen.getByRole('button', { name: 'Remove field' }),
    );
  });
  it('keeps stable IDs and prevents an invalid form from becoming active', async () => {
    mount();
    expect(screen.getByText('Shared live preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const stableId = screen.getByText(/Stable ID:/).textContent?.split(': ')[1];
    expect(stableId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A field needs a label',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(saveMetadataForm).not.toHaveBeenCalled();
  });
  it('refreshes the shared preview snapshot after field and layout edits', () => {
    mount();
    expect(screen.getByTestId('preview-order')).toHaveTextContent(
      'name,category_id,asset_tag',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector family' },
    });
    expect(screen.getByTestId('preview-fields')).toHaveTextContent(
      'Connector family',
    );
    fireEvent.click(
      screen
        .getByRole('button', { name: 'Drag Name' })
        .closest('[data-control-id]')!,
    );
    fireEvent.click(
      within(screen.getByTestId('designer-inspector')).getByRole('button', {
        name: 'Move down',
      }),
    );
    expect(screen.getByTestId('preview-order')).toHaveTextContent(
      'category_id,name,asset_tag',
    );
  });
  it('keeps JSON in an explicit recovery panel and applies only supported documents', async () => {
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: true,
      data: { version: '1', draft_id: id(11) },
    });
    mount();
    fireEvent.click(screen.getByText('Advanced JSON recovery'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Load current document JSON' }),
    );
    const input = screen.getByLabelText('Form definition JSON');
    const document = JSON.parse((input as HTMLTextAreaElement).value);
    fireEvent.change(input, { target: { value: '{broken' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply JSON to visual editor' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No form changes were applied',
    );
    expect(screen.getByTestId('preview-order')).toHaveTextContent(
      'name,category_id,asset_tag',
    );
    document.layout[0].label = 'Recovered section';
    fireEvent.change(input, { target: { value: JSON.stringify(document) } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply JSON to visual editor' }),
    );
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalled());
    const saved = vi.mocked(saveMetadataForm).mock.calls[0][0];
    expect(
      (saved.payload.definition as MetadataDefinition).layout[0].label,
    ).toBe('Recovered section');
  });
  it('gives pointer handles and adjacent move controls touch-sized targets', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Drag Name' })).toHaveClass(
      'min-h-11',
      'min-w-11',
    );
    expect(screen.getByRole('button', { name: 'Resize Name' })).toHaveClass(
      'min-h-11',
    );
    fireEvent.focus(
      screen
        .getByRole('button', { name: 'Drag Name' })
        .closest('[data-control-id]')!,
    );
    expect(
      within(screen.getByTestId('designer-inspector')).getByRole('button', {
        name: 'Move down',
      }),
    ).toHaveClass('min-h-11');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByRole('button', { name: 'Field down' })).toHaveClass(
      'min-h-11',
    );
  });
  it('offers an empty section target and preserves control identity when moved there', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const empty = [
      ...document.querySelectorAll<HTMLElement>('[data-section-id]'),
    ].at(-1)!;
    expect(empty.querySelector('input')).toHaveValue('New section');
    expect(empty.querySelector('[data-control-id]')).toBeNull();
    const targetId = empty.dataset.sectionId!;
    const next = moveControl(
      {
        ...form.published_definition,
        layout: [
          ...form.published_definition.layout,
          { id: targetId, label: 'New section', controls: [] },
        ],
      },
      id(6),
      targetId,
      0,
    );
    expect(next.layout[1].controls[0].id).toBe(id(6));
    expect(
      next.layout[0].controls.some((control) => control.id === id(6)),
    ).toBe(false);
    const assetControl = screen
      .getByRole('button', { name: 'Drag Asset Tag' })
      .closest('[data-control-id]')!;
    fireEvent.click(assetControl);
    fireEvent.change(
      within(screen.getByTestId('designer-inspector')).getByLabelText(
        'Section',
      ),
      { target: { value: targetId } },
    );
    expect(empty.querySelector('[data-control-id]')).toHaveTextContent(
      'Asset Tag',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(empty.querySelector('[data-control-id]')).toBeNull();
  });
  it('offers a compatible section to recover an excluded serialized control without changing its scope', () => {
    const variant = structuredClone(form);
    variant.published_definition.layout.push(
      {
        id: id(41),
        label: 'Quantity only',
        applies_to: ['quantity'],
        controls: [
          { id: id(40), kind: 'builtin', builtin: 'serial_number', width: 6 },
        ],
      },
      {
        id: id(42),
        label: 'Serialized only',
        applies_to: ['asset'],
        controls: [],
      },
      {
        id: id(43),
        label: 'Another quantity section',
        applies_to: ['quantity'],
        controls: [],
      },
    );
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: variant }}
      />,
    );
    const control = screen
      .getByRole('button', { name: 'Drag Serial Number' })
      .closest('[data-control-id]') as HTMLElement;
    fireEvent.click(control);
    const destinations = within(
      screen.getByTestId('designer-inspector'),
    ).getByLabelText('Section');
    expect(
      within(destinations).getByRole('option', { name: /Serialized only/ }),
    ).not.toBeDisabled();
    expect(
      within(destinations).getByRole('option', {
        name: /Another quantity section/,
      }),
    ).toBeDisabled();
    fireEvent.change(destinations, { target: { value: id(42) } });
    const moved = screen
      .getByRole('button', { name: 'Drag Serial Number' })
      .closest('[data-control-id]') as HTMLElement;
    expect(moved.closest('[data-section-id]')).toHaveAttribute(
      'data-section-id',
      id(42),
    );
    expect(
      within(moved).getByTitle('Form types using this control'),
    ).toHaveTextContent('Serialized');
    fireEvent.click(screen.getByText('Advanced JSON recovery'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Load current document JSON' }),
    );
    const recovered = JSON.parse(
      (screen.getByLabelText('Form definition JSON') as HTMLTextAreaElement)
        .value,
    ) as MetadataDefinition;
    expect(recovered.layout[2].controls[0].applies_to).toEqual(['asset']);
    expect(recovered.layout[1].controls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(
      screen
        .getByRole('button', { name: 'Drag Serial Number' })
        .closest('[data-section-id]'),
    ).toHaveAttribute('data-section-id', id(41));
  });
  it('disables quantity, serialized and hidden destinations that would reject a control move', () => {
    const variant = structuredClone(form);
    variant.published_definition.layout[0].controls.push({
      id: id(40),
      kind: 'builtin',
      builtin: 'item_code',
      width: 6,
    });
    variant.published_definition.layout.push(
      {
        id: id(41),
        label: 'Quantity only',
        applies_to: ['quantity'],
        controls: [],
      },
      {
        id: id(42),
        label: 'Serialized only',
        applies_to: ['asset'],
        controls: [],
      },
      { id: id(43), label: 'Hidden', visible: false, controls: [] },
    );
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: variant }}
      />,
    );
    const itemCode = screen
      .getByRole('button', { name: 'Drag Item Code' })
      .closest('[data-control-id]') as HTMLElement;
    fireEvent.click(itemCode);
    const itemDestinations = within(
      screen.getByTestId('designer-inspector'),
    ).getByLabelText('Section') as HTMLSelectElement;
    expect(
      within(itemDestinations).getByRole('option', { name: /Quantity only/ }),
    ).not.toBeDisabled();
    expect(
      within(itemDestinations).getByRole('option', { name: /Serialized only/ }),
    ).toBeDisabled();
    expect(
      within(itemDestinations).getByRole('option', { name: /Hidden/ }),
    ).toBeDisabled();
    const assetTag = screen
      .getByRole('button', { name: 'Drag Asset Tag' })
      .closest('[data-control-id]') as HTMLElement;
    fireEvent.click(assetTag);
    const assetDestinations = within(
      screen.getByTestId('designer-inspector'),
    ).getByLabelText('Section') as HTMLSelectElement;
    expect(
      within(assetDestinations).getByRole('option', {
        name: /Serialized only/,
      }),
    ).not.toBeDisabled();
    expect(
      within(assetDestinations).getByRole('option', { name: /Quantity only/ }),
    ).toBeDisabled();
    expect(
      within(assetDestinations).getByRole('option', { name: /Hidden/ }),
    ).toBeDisabled();
  });
  it('moves placements from a nonempty custom section without deleting field definitions', () => {
    mount();
    expect(
      screen.getAllByRole('button', { name: 'Remove section' })[0],
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const custom = [
      ...document.querySelectorAll<HTMLElement>('[data-section-id]'),
    ].at(-1)!;
    fireEvent.click(
      within(custom).getByRole('button', { name: 'Add help text' }),
    );
    expect(custom.querySelectorAll('[data-control-id]')).toHaveLength(1);
    fireEvent.click(
      within(custom).getByRole('button', { name: 'Remove section' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove New section?' });
    expect(within(dialog).getByLabelText('Destination')).toHaveValue(id(3));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove section' }),
    );
    expect(document.querySelectorAll('[data-section-id]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-control-id]')).toHaveLength(4);
  });
  it('uses UUID destinations for duplicate section names and supports cancel and undo', () => {
    const duplicate = structuredClone(form);
    duplicate.published_definition.layout.push({
      id: id(32),
      label: 'Details',
      controls: [],
    });
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: duplicate }}
      />,
    );
    const first = document.querySelector<HTMLElement>(
      `[data-section-id="${id(3)}"]`,
    )!;
    fireEvent.click(within(first).getByText('Section options'));
    fireEvent.click(
      within(first).getByRole('button', { name: 'Remove section' }),
    );
    let dialog = screen.getByRole('dialog', { name: 'Remove Details?' });
    expect(within(dialog).getByLabelText('Destination')).toHaveValue(id(32));
    expect(within(dialog).getByText(/00000032/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelectorAll('[data-section-id]')).toHaveLength(2);
    fireEvent.click(
      within(first).getByRole('button', { name: 'Remove section' }),
    );
    dialog = screen.getByRole('dialog', { name: 'Remove Details?' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove section' }),
    );
    expect(document.querySelectorAll('[data-section-id]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-control-id]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(document.querySelectorAll('[data-section-id]')).toHaveLength(2);
  });
  it('snaps width before release and rolls a canceled resize back', () => {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: MouseEvent,
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    const resize = screen.getByRole('button', {
      name: 'Resize Missing field',
    });
    const width = screen
      .getAllByLabelText('Width', { selector: 'select' })
      .at(-1)!;
    expect(width).toHaveValue('Auto');
    fireEvent.pointerDown(resize, { pointerId: 2, clientX: 10, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 100, clientY: 100 });
    expect(width).toHaveValue('12');
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(width).toHaveValue('Auto');
  });
  it('preserves entered data and original draft baseline after a stale save response', async () => {
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Stale draft.'),
    );
    expect(screen.getByLabelText('Label')).toHaveValue('Connector');
    expect(screen.getByText(/Published revision 1/)).toBeInTheDocument();
  });
  it('asks before dropping unsaved edits on category switch', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form, [id(20)]: { ...form, category_id: id(20) } }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: id(20) },
    });
    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved edits and switch category?',
    );
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    confirm.mockRestore();
  });
  it('locks the category during an in-flight draft save and binds its response to the original category', async () => {
    let finish!: (result: Awaited<ReturnType<typeof saveMetadataForm>>) => void;
    vi.mocked(saveMetadataForm).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form, [id(20)]: { ...form, category_id: id(20) } }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const category = screen.getByLabelText('Category');
    expect(category).toBeDisabled();
    fireEvent.change(category, { target: { value: id(20) } });
    expect(category).toHaveValue(id(1));
    finish({ ok: true, data: { version: '1', draft_id: id(11) } });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Saved active form revision 1',
      ),
    );
    expect(category).toHaveValue(id(1));
    expect(screen.getByLabelText('Label')).toHaveValue('Connector');
    expect(
      vi.mocked(saveMetadataForm).mock.calls[0][0].payload.category_id,
    ).toBe(id(1));
  });
  it('offers explicit recovery after re-entry while retaining the original draft baseline', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Recovered connector' },
    });
    await waitFor(() =>
      expect(
        readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
      ).toBe('Recovered connector'),
    );
    cleanup();
    mount();
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Recover unsaved form edits' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByDisplayValue('Recovered connector'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover edits' }));
    expect(screen.getByLabelText('Label')).toHaveValue('Recovered connector');
    expect(screen.getByText(/Published revision 1/)).toBeInTheDocument();
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalled());
    expect(
      vi.mocked(saveMetadataForm).mock.calls[0][0].payload
        .expected_draft_version,
    ).toBe('0');
  });
  it('keeps recovery on cancelled refresh but clears it on confirmed discard and return', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
      fireEvent.change(screen.getByLabelText('Label'), {
        target: { value: 'Discard me' },
      });
      await waitFor(() =>
        expect(
          readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
        ).toBe('Discard me'),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh from server' }),
      );
      expect(confirm).toHaveBeenCalledWith(
        'Discard unsaved edits and load the latest form from the server?',
      );
      expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull();
      confirm.mockReturnValue(true);
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh from server' }),
      );
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull();
      cleanup();
      mount();
      await waitFor(() =>
        expect(
          screen.queryByRole('region', { name: 'Recover unsaved form edits' }),
        ).not.toBeInTheDocument(),
      );
    } finally {
      confirm.mockRestore();
    }
  });
  it('clears obsolete recovery when undo returns to the saved baseline, including after a category switch', async () => {
    const other = { ...form, category_id: id(20) };
    const mountTwo = () =>
      render(
        <MetadataSettings
          memberId={id(50)}
          categories={[
            { id: id(1), name: 'Cables', active: true },
            { id: id(20), name: 'Adapters', active: true },
          ]}
          forms={{ [id(1)]: form, [id(20)]: other }}
        />,
      );
    mountTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull(),
    );
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: id(20) },
    });
    cleanup();
    mountTwo();
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Recover unsaved form edits' }),
      ).not.toBeInTheDocument(),
    );
    expect(readDesignerRecovery(id(50), id(1)).item).toBeNull();
  });
  it('clears recovery after a manual reversal to the saved field value', async () => {
    const savedForm: MetadataForm = {
      ...form,
      published_definition: {
        ...form.published_definition,
        fields: [
          {
            id: id(31),
            type: 'short_text',
            label: 'Saved label',
            applies_to: ['quantity', 'asset'],
            required: false,
            rules: {},
            options: [],
          },
        ],
      },
    };
    const mountSaved = () =>
      render(
        <MetadataSettings
          memberId={id(50)}
          categories={[{ id: id(1), name: 'Cables', active: true }]}
          forms={{ [id(1)]: savedForm }}
        />,
      );
    mountSaved();
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Temporary' },
    });
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Saved label' },
    });
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull(),
    );
    cleanup();
    mountSaved();
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Recover unsaved form edits' }),
      ).not.toBeInTheDocument(),
    );
  });
  it('remounts on authenticated member change without carrying or copying dirty state', async () => {
    const view = (memberId: string) => (
      <MetadataSettings
        key={designerInstanceKey(memberId, 'local-api')}
        memberId={memberId}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: form }}
      />
    );
    const { rerender } = render(view(id(50)));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Member A private draft' },
    });
    await waitFor(() =>
      expect(
        readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
      ).toBe('Member A private draft'),
    );
    rerender(view(id(51)));
    expect(
      screen.queryByDisplayValue('Member A private draft'),
    ).not.toBeInTheDocument();
    expect(readDesignerRecovery(id(51), id(1)).item).toBeNull();
    expect(
      readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
    ).toBe('Member A private draft');
  });
  it('creates a new identity for a field type replacement', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const first = screen.getByText(/Stable ID:/).textContent;
    fireEvent.change(screen.getByLabelText(/Replacement type for/), {
      target: { value: 'integer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add replacement' }));
    const replacement = screen.getByText(/Stable ID:/).textContent;
    expect(replacement).not.toBe(first);
    expect(
      screen.getByRole('button', { name: /Untitled field · Short Text/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Untitled field replacement · Integer/).length,
    ).toBeGreaterThan(0);
  });
  it('saves an ordinary edit directly against the exact baseline', async () => {
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: true,
      data: {
        status: 'saved',
        changed: true,
        entity_id: id(1),
        version: '2',
        event_id: id(20),
        category_id: id(1),
        published_revision_id: id(9),
      },
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveMetadataForm).mock.calls[0][0]).toMatchObject({
      expectedActorId: id(50),
      payload: {
        category_id: id(1),
        expected_draft_id: null,
        expected_draft_version: '0',
        expected_published_revision_id: id(2),
      },
    });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((item) =>
            item.textContent?.includes('Saved active form revision 2'),
          ),
      ).toBe(true),
    );
    expect(
      screen.queryByRole('region', { name: 'Form save impact' }),
    ).not.toBeInTheDocument();
  });
  it('requires targeted confirmation with an identical proposal and fresh request ID', async () => {
    vi.mocked(saveMetadataForm)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'confirmation_required',
          changed: false,
          token: id(10),
          expires_at: '2030-09-24T20:00:00Z',
          category_id: id(1),
          expected_published_revision_id: id(2),
          expected_draft_id: null,
          expected_draft_version: '0',
          reasons: [
            {
              kind: 'section_removed',
              id: id(30),
              affected_kinds: ['quantity'],
            },
          ],
          affected_quantity: '3',
          affected_assets: '2',
          newly_needs_quantity: '1',
          newly_needs_assets: '0',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'saved',
          changed: true,
          entity_id: id(1),
          version: '2',
          event_id: id(20),
          category_id: id(1),
          published_revision_id: id(9),
        },
      });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Form save impact' }),
      ).toHaveTextContent('1 quantity records'),
    );
    const first = vi.mocked(saveMetadataForm).mock.calls[0][0];
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirm and save changes' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm and save changes' }),
    );
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(2));
    const second = vi.mocked(saveMetadataForm).mock.calls[1][0];
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.payload).toEqual({ ...first.payload, review_token: id(10) });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((item) =>
            item.textContent?.includes('Saved active form revision 2'),
          ),
      ).toBe(true),
    );
  });
  it('keeps a legacy draft as the exact save baseline', async () => {
    const draftForm = {
      ...form,
      draft_id: id(11),
      draft_version: '1',
      draft_definition: form.published_definition,
    };
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: draftForm }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalled());
    expect(vi.mocked(saveMetadataForm).mock.calls[0][0].payload).toMatchObject({
      expected_draft_id: id(11),
      expected_draft_version: '1',
      expected_published_revision_id: id(2),
    });
    expect(screen.getByText(/Legacy draft available/)).toBeInTheDocument();
  });
  it('recovers the original draft ID across an ABA replacement at the same version', async () => {
    const oldDraft = {
      ...form,
      draft_id: id(11),
      draft_version: '1',
      draft_definition: form.published_definition,
    };
    writeDesignerRecovery({
      memberId: id(50),
      categoryId: id(1),
      definition: form.published_definition,
      savedDefinition: JSON.stringify(form.published_definition),
      expectedDraftId: id(11),
      expectedDraftVersion: '1',
      expectedPublishedRevisionId: id(2),
    });
    const replacement = { ...oldDraft, draft_id: id(13) };
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: replacement }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Recover unsaved form edits' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/server form has changed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover edits' }));
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalled());
    expect(vi.mocked(saveMetadataForm).mock.calls[0][0].payload).toMatchObject({
      expected_draft_id: id(11),
      expected_draft_version: '1',
    });
  });
  it('keeps the same-user editor mounted during verification and hides it on identity loss', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof verifyMetadataDesignerIdentity>>,
    ) => void;
    vi.mocked(verifyMetadataDesignerIdentity).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    fireEvent.focus(window);
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument();
    expect(vi.mocked(verifyMetadataDesignerIdentity)).toHaveBeenCalledWith(
      id(50),
    );
    finish({ ok: false, code: 'P1001', message: 'Actor changed.' });
    await waitFor(() =>
      expect(
        screen.getByText(/Configuration access changed/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
  });
  it('masks the editor after a fresh action rejects the original actor', async () => {
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Actor changed.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByText(/Configuration access changed/),
      ).toBeInTheDocument(),
    );
    expect(vi.mocked(saveMetadataForm).mock.calls[0][0].expectedActorId).toBe(
      id(50),
    );
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
  });
  it('keeps unsaved input and selection during a retryable check, then restores Save for the same actor', async () => {
    vi.mocked(verifyMetadataDesignerIdentity)
      .mockResolvedValueOnce({
        ok: false,
        code: 'identity_unverified',
        message: 'Temporary auth service failure.',
      })
      .mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Retained connector' },
    });
    fireEvent.focus(window);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry access check' }),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText('Label')).toHaveValue('Retained connector');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeEnabled(),
    );
    expect(screen.getByLabelText('Label')).toHaveValue('Retained connector');
    expect(vi.mocked(verifyMetadataDesignerIdentity)).toHaveBeenCalledTimes(2);
  });
  it('latches a terminal mismatch across later focus events and delayed verification success', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof verifyMetadataDesignerIdentity>>,
    ) => void;
    vi.mocked(verifyMetadataDesignerIdentity).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Actor changed.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Private connector' },
    });
    fireEvent.focus(window);
    expect(vi.mocked(verifyMetadataDesignerIdentity)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.getByText(/Configuration access changed/)).toBeVisible(),
    );
    finish({ ok: true });
    fireEvent.focus(window);
    await waitFor(() =>
      expect(screen.queryByText('Private connector')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
    expect(vi.mocked(verifyMetadataDesignerIdentity)).toHaveBeenCalledTimes(1);
    expect(readDesignerRecovery(id(50), id(1)).item).toBeNull();
  });
  it('does not process an in-progress resize after terminal denial', async () => {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: MouseEvent,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Actor changed.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Resize Missing field' }),
      {
        pointerId: 4,
        clientX: 10,
      },
    );
    fireEvent.focus(window);
    await waitFor(() =>
      expect(screen.getByText(/Configuration access changed/)).toBeVisible(),
    );
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 500 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 500 });
    expect(readDesignerRecovery(id(50), id(1)).item).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Undo edit' }),
    ).not.toBeInTheDocument();
  });
});

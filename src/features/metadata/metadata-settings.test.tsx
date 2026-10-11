import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import {
  cleanup,
  act,
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
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { revokePrivatePresentation } from '@/features/scan/assign-batch';
import { fetchCategoryForm } from './form-fetch.actions';
import {
  clearAllDesignerRecovery,
  designerInstanceKey,
  readDesignerRecovery,
  writeDesignerRecovery,
} from './designer-recovery';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const privacyActions = vi.hoisted(() => ({
  readLogoutPrivacyGeneration: vi.fn(),
  acknowledgeLogoutPrivacyGeneration: vi.fn(),
  readProtectedPrivacyIdentity: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => privacyActions);
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/settings/metadata',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./form-fetch.actions', () => ({ fetchCategoryForm: vi.fn() }));
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

function addField(name = 'New field') {
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  const dialog = screen.getByRole('dialog', { name: 'Add field' });
  fireEvent.change(within(dialog).getByLabelText('Field name'), {
    target: { value: name },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to form' }));
}

function openRecoveryTools() {
  if (!screen.queryByRole('dialog', { name: 'Recovery & advanced' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Recovery & advanced' }),
    );
}

describe('category form designer', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    privacyActions.readLogoutPrivacyGeneration
      .mockReset()
      .mockResolvedValue({ status: 'absent' });
    privacyActions.acknowledgeLogoutPrivacyGeneration
      .mockReset()
      .mockResolvedValue({ status: 'match' });
    privacyActions.readProtectedPrivacyIdentity
      .mockReset()
      .mockResolvedValue({ status: 'match', generation: { status: 'absent' } });
    router.push.mockReset();
    vi.mocked(fetchCategoryForm).mockReset();
    vi.mocked(fetchCategoryForm).mockResolvedValue({ ok: true, form: null });
    clearAllDesignerRecovery();
    vi.mocked(saveMetadataForm).mockReset();
    vi.mocked(reviewMetadataPublish).mockReset();
    vi.mocked(saveMetadataForm).mockReset();
    vi.mocked(verifyMetadataDesignerIdentity).mockReset();
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({ ok: true });
  });
  it('keeps publication controls together and opens recovery tools without losing edits, restoring focus on close and Escape', () => {
    mount();
    const toolbar = screen.getByRole('toolbar', { name: 'Form designer' });
    expect(within(toolbar).getByLabelText('Designer category')).toHaveValue(
      id(1),
    );
    expect(
      within(toolbar).getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Active form saved');
    expect(
      within(toolbar).getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled();
    expect(
      within(toolbar).getByRole('button', { name: 'Undo edit' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Refresh from server' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard unsaved edits' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Section heading'), {
      target: { value: 'Cable details' },
    });
    expect(
      within(toolbar).getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Unsaved changes');
    const trigger = within(toolbar).getByRole('button', {
      name: 'Recovery & advanced',
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Recovery & advanced' });
    expect(
      within(dialog).getByRole('button', { name: 'Refresh from server' }),
    ).toBeEnabled();
    expect(within(dialog).getByText('Advanced JSON recovery')).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close recovery tools' }),
    );
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText('Section heading')).toHaveValue(
      'Cable details',
    );
    fireEvent.click(trigger);
    fireEvent(dialog, new Event('cancel', { bubbles: true }));
    expect(trigger).toHaveFocus();
    expect(
      screen.queryByRole('dialog', { name: 'Recovery & advanced' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Undo edit' }));
    expect(screen.getByLabelText('Section heading')).toHaveValue('Details');
    expect(
      within(toolbar).getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Active form saved');
    expect(saveMetadataForm).not.toHaveBeenCalled();
  });
  it('treats a staged field as unsaved without implying that it has been published', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Unsaved changes');
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add field' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Active form saved');
    expect(saveMetadataForm).not.toHaveBeenCalled();
  });
  it.each([
    'Undo edit',
    'Discard unsaved edits',
    'Refresh from server',
    'Apply JSON to visual editor',
  ])(
    'reconciles invalid rule drafts and Save errors after %s restores the same field ID',
    async (action) => {
      const savedForm = structuredClone(form);
      savedForm.published_definition.fields.push({
        id: id(8),
        type: 'short_text',
        label: 'Bounded note',
        required: false,
        applies_to: ['quantity', 'asset'],
        rules: { minLength: 5 },
        options: [],
      });
      savedForm.published_definition.layout[0].controls.push({
        id: id(9),
        kind: 'field',
        field_id: id(8),
        width: 12,
      });
      const props = {
        memberId: id(50),
        categories: [{ id: id(1), name: 'Cables', active: true }],
        forms: { [id(1)]: savedForm },
      };
      const { rerender } = render(<MetadataSettings {...props} />);
      fireEvent.click(document.querySelector(`[data-control-id="${id(9)}"]`)!);
      const openRules = () => {
        const summary = screen.getByText('Optional rules', {
          selector: 'summary',
        });
        if (!(summary.closest('details') as HTMLDetailsElement).open)
          fireEvent.click(summary);
      };
      openRules();
      fireEvent.change(
        screen.getByLabelText('Minimum characters', { exact: true }),
        { target: { value: '-' } },
      );
      expect(
        screen.getByLabelText('Minimum characters', { exact: true }),
      ).toHaveValue('-');
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      try {
        if (action === 'Apply JSON to visual editor') {
          openRecoveryTools();
          fireEvent.click(screen.getByText('Advanced JSON recovery'));
          fireEvent.change(screen.getByLabelText('Form definition JSON'), {
            target: { value: JSON.stringify(savedForm.published_definition) },
          });
        }
        if (['Discard unsaved edits', 'Refresh from server'].includes(action))
          openRecoveryTools();
        fireEvent.click(screen.getByRole('button', { name: action }));
        if (action === 'Refresh from server')
          rerender(
            <MetadataSettings
              {...props}
              forms={{ [id(1)]: { ...savedForm, published_number: '2' } }}
            />,
          );
        openRules();
        expect(
          screen.getByLabelText('Minimum characters', { exact: true }),
        ).toHaveValue('5');
        expect(
          screen.queryByText(/Minimum characters needs a whole number/),
        ).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Field name'), {
          target: { value: 'Restored bounded note' },
        });
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'Save changes' }),
          ).toBeEnabled(),
        );
      } finally {
        confirm.mockRestore();
      }
    },
  );
  it.each([
    ['short_text', 'minimum characters'],
    ['long_text', 'maximum characters'],
    ['integer', 'minimum value'],
    ['decimal', 'maximum value'],
    ['currency', 'minimum amount'],
    ['date', 'earliest allowed date'],
    ['datetime', 'latest allowed date and time'],
    ['multi_select', 'maximum selections'],
  ])(
    'blocks Save for an enabled empty %s restriction and resets it on Undo',
    async (type, label) => {
      mount();
      addField('Bounded field');
      if (type !== 'short_text')
        fireEvent.change(screen.getByLabelText('Field type'), {
          target: { value: type },
        });
      const openRules = () => {
        const summary = screen.getByText('Optional rules', {
          selector: 'summary',
        });
        if (!(summary.closest('details') as HTMLDetailsElement).open)
          fireEvent.click(summary);
      };
      openRules();
      fireEvent.click(screen.getByLabelText(`Use ${label}`));
      expect(screen.getByLabelText(`Use ${label}`)).toBeChecked();
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Field name'), {
        target: { value: 'Recoverable draft' },
      });
      expect(screen.getByLabelText(`Use ${label}`)).toBeChecked();
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
      openRules();
      expect(screen.getByLabelText(`Use ${label}`)).not.toBeChecked();
      expect(
        screen.queryByText(`Enter ${label} or turn off this restriction.`),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save changes' }),
        ).toBeEnabled(),
      );
      expect(saveMetadataForm).not.toHaveBeenCalled();
    },
  );
  it('restores a valid numeric rule display on Undo while retaining incomplete ordinary typing', () => {
    mount();
    addField('Ports');
    fireEvent.change(screen.getByLabelText('Field type'), {
      target: { value: 'integer' },
    });
    fireEvent.click(
      screen.getByText('Optional rules', { selector: 'summary' }),
    );
    fireEvent.click(screen.getByLabelText('Use minimum value'));
    fireEvent.change(screen.getByLabelText('Minimum value', { exact: true }), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByLabelText('Minimum value', { exact: true }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    const summary = screen.getByText('Optional rules', { selector: 'summary' });
    if (!(summary.closest('details') as HTMLDetailsElement).open)
      fireEvent.click(summary);
    expect(screen.getByLabelText('Minimum value', { exact: true })).toHaveValue(
      '5',
    );
    fireEvent.change(screen.getByLabelText('Minimum value', { exact: true }), {
      target: { value: '-' },
    });
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Port count' },
    });
    expect(screen.getByLabelText('Minimum value', { exact: true })).toHaveValue(
      '-',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
  it('removes only a broken placement so a legacy document can be saved without inventing a field', async () => {
    const legacy = structuredClone(form);
    legacy.published_definition.fields.push({
      id: id(8),
      type: 'boolean',
      label: 'Known answer',
      required: false,
      applies_to: ['quantity', 'asset'],
      rules: {},
      options: [],
      default: false,
    });
    legacy.published_definition.layout[0].controls.push(
      { id: id(9), kind: 'field', field_id: id(8), width: 12 },
      {
        id: id(10),
        kind: 'field',
        field_id: id(99),
        width: 12,
        visible: false,
      },
    );
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: legacy }}
      />,
    );
    fireEvent.click(document.querySelector(`[data-control-id="${id(9)}"]`)!);
    expect(
      screen.queryByRole('button', { name: 'Remove broken placement' }),
    ).not.toBeInTheDocument();
    fireEvent.click(document.querySelector(`[data-control-id="${id(10)}"]`)!);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove broken placement' }),
    );
    expect(document.querySelector(`[data-control-id="${id(10)}"]`)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Remove broken placement' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(
      document.querySelector(`[data-control-id="${id(10)}"]`),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove broken placement' }),
    );
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'unexpected',
      message: 'Test response.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveMetadataForm).mock.calls[0][0].payload
      .definition as MetadataDefinition;
    expect(saved.fields).toEqual(legacy.published_definition.fields);
    expect(saved.layout[0].controls).toEqual(
      legacy.published_definition.layout[0].controls.slice(0, -1),
    );
  });
  it('cancels staged addition while preserving unrelated unsaved section edits and adds in one undo step', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Section heading'), {
      target: { value: 'Unsaved heading' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog', { name: 'Add field' });
    fireEvent.change(within(dialog).getByLabelText('Field name'), {
      target: { value: 'Canceled field' },
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByLabelText('Section heading')).toHaveValue(
      'Unsaved heading',
    );
    expect(document.querySelectorAll('[data-control-id]')).toHaveLength(3);
    expect(
      screen.queryByRole('button', { name: 'Drag Canceled field' }),
    ).not.toBeInTheDocument();
    addField('Has USB-C?');
    expect(document.querySelectorAll('[data-control-id]')).toHaveLength(4);
    expect(
      screen.getByRole('heading', { name: /Has USB-C/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(document.querySelectorAll('[data-control-id]')).toHaveLength(3);
    expect(screen.queryByLabelText('Field name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Section heading')).toHaveValue(
      'Unsaved heading',
    );
  });
  it('uses a real checkbox canvas with one configured question, description and unique IDs', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog', { name: 'Add field' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Checkbox' }));
    fireEvent.change(within(dialog).getByLabelText('Field name'), {
      target: { value: 'Has USB-C?' },
    });
    fireEvent.change(
      within(dialog).getByLabelText('Description shown below this field'),
      { target: { value: 'Check the port before answering.' } },
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to form' }),
    );
    const canvas = screen.getByTestId('designer-canvas');
    const preview = canvas.querySelector(
      '[data-control-id]:has(button[aria-label="Drag Has USB-C?"])',
    )!;
    const checkbox = preview.querySelector('input[type="checkbox"]')!;
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(
      within(preview as HTMLElement).getAllByText('Has USB-C?', {
        exact: true,
      }),
    ).toHaveLength(1);
    expect(
      preview.querySelector(`#${checkbox.getAttribute('aria-describedby')}`),
    ).toHaveTextContent('Check the port before answering.');
    expect(within(canvas).queryByText('Yes / No')).not.toBeInTheDocument();
    const ids = [...document.querySelectorAll('[id]')].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(within(canvas).getByText('Form canvas')).toBeInTheDocument();
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
    fireEvent.click(
      within(library).getByText(/Hidden fields/, { selector: 'summary' }),
    );
    expect(within(library).getByText('Hidden fields (1)')).toBeInTheDocument();
    fireEvent.click(within(library).getByRole('button', { name: 'Show Name' }));
    expect(
      within(library).queryByRole('button', { name: 'Show Name' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Designer panels' }),
    ).toContainElement(screen.getByRole('button', { name: 'Library' }));
  });
  it.each(['desktop', 'phone'] as const)(
    'hands focused Add field dialog focus to the visible %s destination',
    async (viewport) => {
      mount();
      const user = userEvent.setup();
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      const canvas = screen.getByTestId('designer-canvas');
      if (viewport === 'phone') canvas.style.display = 'none';
      const trigger = screen.getByRole('button', {
        name: 'Add field',
      });
      await user.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'Add field' });
      await user.type(
        within(dialog).getByLabelText('Field name'),
        'Focus transfer',
      );
      await user.click(
        within(dialog).getByRole('button', {
          name: 'Add to form',
        }),
      );
      act(() => frames.splice(0).forEach((callback) => callback(0)));
      const control = [
        ...canvas.querySelectorAll<HTMLElement>('[data-control-id]'),
      ].at(-1)!;
      expect(control).toHaveAttribute('data-selected', 'true');
      if (viewport === 'desktop') expect(control).toHaveFocus();
      else {
        const inspector = screen.getByTestId('designer-inspector');
        expect(inspector).toBeVisible();
        expect(
          within(inspector).getByRole('heading', {
            name: 'Inspector',
          }),
        ).toHaveFocus();
      }
    },
  );
  it('hands focused dialog Go to field focus to its existing placement', async () => {
    mount();
    const user = userEvent.setup();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const dialog = screen.getByRole('dialog', { name: 'Add field' });
    await user.click(
      within(dialog).getByRole('tab', { name: 'Standard fields' }),
    );
    await user.click(
      within(
        within(dialog).getByText('Name', { exact: true }).parentElement!,
      ).getByRole('button', { name: 'Go to field' }),
    );
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    const name = screen
      .getByTestId('designer-canvas')
      .querySelector<HTMLElement>(`[data-control-id="${id(4)}"]`)!;
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('data-selected', 'true');
  });
  it.each(['pointer', 'keyboard'] as const)(
    'keeps ordinary %s custom control selection focus while mounting Inspector settings',
    async (input) => {
      mount();
      const user = userEvent.setup();
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      addField('Click focus');
      act(() => frames.splice(0).forEach((callback) => callback(0)));
      const canvas = screen.getByTestId('designer-canvas');
      const name = canvas.querySelector<HTMLElement>(
        `[data-control-id="${id(4)}"]`,
      )!;
      await user.click(name);
      const custom = [
        ...canvas.querySelectorAll<HTMLElement>('[data-control-id]'),
      ].at(-1)!;
      if (input === 'pointer') await user.click(custom);
      else
        for (
          let attempt = 0;
          attempt < 30 && document.activeElement !== custom;
          attempt++
        )
          await user.tab();
      expect(custom).toHaveFocus();
      expect(custom).toHaveAttribute('data-selected', 'true');
      expect(
        within(screen.getByTestId('designer-inspector')).getByRole('region', {
          name: 'Click focus field settings',
        }),
      ).toBeInTheDocument();
    },
  );
  it('returns canceled dialog focus to its focused Add field trigger', async () => {
    mount();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', {
      name: 'Add field',
    });
    await user.click(trigger);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add field' })).getByRole(
        'button',
        { name: 'Cancel field addition' },
      ),
    );
    expect(trigger).toHaveFocus();
  });
  it('keeps newer toolbar focus when queued section focus runs later', () => {
    mount();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const save = within(
      screen.getByRole('toolbar', { name: 'Form designer' }),
    ).getByRole('button', { name: 'Save changes' });
    act(() => save.focus());
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    expect(save).toHaveFocus();
  });
  it('focuses the new section when no later user intent supersedes it', () => {
    mount();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    expect(screen.getAllByLabelText('Section heading').at(-1)).toHaveFocus();
  });
  it('keeps newer control focus when a queued Add section focus runs later', () => {
    mount();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const name = screen
      .getByTestId('designer-canvas')
      .querySelector<HTMLElement>(`[data-control-id="${id(4)}"]`)!;
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    act(() => name.focus());
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(name).toHaveAttribute('data-selected', 'true');
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('data-selected', 'true');
    expect(
      within(screen.getByTestId('designer-inspector')).getByRole('region', {
        name: 'Name layout properties',
      }),
    ).toBeInTheDocument();
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
    expect(within(name).getByLabelText('Name preview')).toBeDisabled();
    expect(
      within(inspector).queryByLabelText('Preferred width'),
    ).not.toBeInTheDocument();
    fireEvent.focus(name);
    expect(name).toHaveAttribute('data-selected', 'true');
    expect(
      within(inspector).getByRole('region', { name: 'Name layout properties' }),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByRole('button', { name: 'Hide from form' }),
    ).toBeDisabled();
    fireEvent.change(within(inspector).getByLabelText('Preferred width'), {
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
    expect(
      within(inspector).getByRole('button', { name: 'Hide from form' }),
    ).toBeDisabled();
  });
  it('clears the previous field Inspector when inspecting or creating a section', () => {
    mount();
    const inspector = screen.getByTestId('designer-inspector');
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Connector' },
    });
    expect(within(inspector).getByLabelText('Field name')).toHaveValue(
      'Connector',
    );
    fireEvent.focus(screen.getByLabelText('Section heading'));
    expect(
      within(inspector).queryByLabelText('Field name'),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByLabelText('Preferred width'),
    ).not.toBeInTheDocument();
    expect(within(inspector).getByText(/Section Details/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getByRole('button', { name: 'Drag Connector' })
        .closest('[data-control-id]')!,
    );
    expect(within(inspector).getByLabelText('Field name')).toHaveValue(
      'Connector',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(
      within(inspector).queryByLabelText('Field name'),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByLabelText('Preferred width'),
    ).not.toBeInTheDocument();
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
    fireEvent.click(
      within(library).getByText(/Hidden fields/, { selector: 'summary' }),
    );
    expect(
      within(library).getByText('Hidden sections (1)'),
    ).toBeInTheDocument();
    expect(within(library).getByText('Hidden fields (0)')).toBeInTheDocument();
    fireEvent.click(
      within(library).getByRole('button', {
        name: 'Restore section Archive details',
      }),
    );
    expect(within(library).getByText('Hidden fields (1)')).toBeInTheDocument();
    fireEvent.click(
      within(library).getByRole('button', { name: 'Show Description' }),
    );
    expect(within(library).getByText('No hidden fields')).toBeInTheDocument();
  });
  it('reports intrinsic kinds and places an unplaced standard control in a selected section', () => {
    mount();
    const library = screen.getByTestId('designer-library');
    fireEvent.click(
      within(library).getByText(/Hidden fields/, { selector: 'summary' }),
    );
    const itemCode = within(library)
      .getByText(/Item Code · Standard field/)
      .closest('div')!;
    fireEvent.click(
      within(itemCode).getByRole('button', { name: 'Add Item Code to form' }),
    );
    const control = screen
      .getByRole('button', { name: 'Drag Item Code' })
      .closest('[data-control-id]')!;
    expect(
      within(control as HTMLElement).getByTitle('Form types using this field'),
    ).toHaveTextContent('Quantity');
    fireEvent.click(
      screen.getByText(/Try form · quantity items or individual assets/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Individual asset' }));
    expect(
      within(library).getByText('Excluded from Individual asset preview (1)'),
    ).toBeInTheDocument();
  });
  it('keeps identity and retirement in Advanced and moves visible placements', () => {
    mount();
    addField('Connector');
    const inspector = screen.getByTestId('designer-inspector');
    expect(
      within(inspector).queryByRole('button', { name: 'Field up' }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByRole('button', { name: 'Remove field' }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).getByRole('button', { name: 'Move up' }),
    ).toBeEnabled();
    fireEvent.click(within(inspector).getByText('Advanced'));
    expect(within(inspector).getByText(/Stable ID:/)).toBeInTheDocument();
    expect(
      within(inspector).getByRole('button', {
        name: 'Discard unpublished field',
      }),
    ).toBeInTheDocument();
  });
  it('keeps stable IDs and prevents an invalid form from becoming active', () => {
    mount();
    addField();
    fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }));
    const stableId = screen.getByText(/Stable ID:/).textContent?.split(': ')[1];
    expect(stableId).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: '' },
    });
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
    openRecoveryTools();
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
    addField();
    expect(screen.getByRole('button', { name: 'Move down' })).toHaveClass(
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
      within(moved).getByTitle('Form types using this field'),
    ).toHaveTextContent('Individual asset');
    openRecoveryTools();
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
      within(custom).getByRole('button', { name: 'Add instructions' }),
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
    addField();
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    const resize = screen.getByRole('button', {
      name: 'Resize New field',
    });
    const width = screen
      .getAllByLabelText('Preferred width', { selector: 'select' })
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByText('Stale draft.', { selector: '[role="status"]' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Field name')).toHaveValue('Connector');
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Save failed');
    expect(
      screen.getByRole('button', { name: 'Review recovery options' }),
    ).toBeVisible();
    expect(screen.getByText(/Published revision 1/)).toBeInTheDocument();
  });
  it('replaces a failed save state with confirmed active publication after retry', async () => {
    vi.mocked(saveMetadataForm)
      .mockResolvedValueOnce({
        ok: false,
        code: 'P1012',
        message: 'Save was rejected.',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 'saved', version: '2', published_revision_id: id(22) },
      });
    mount();
    addField('Connector');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Save was rejected.');
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Save failed');
    const original = vi.mocked(saveMetadataForm).mock.calls[0][0];
    expect(original.payload).toMatchObject({
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: id(2),
    });
    expect(screen.getByLabelText('Field name')).toHaveValue('Connector');
    // Error feedback precedes release of the React transition. Exercise the
    // user's retry only when its actual control becomes enabled.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved active form revision 2.');
    expect(saveMetadataForm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveMetadataForm).mock.calls[1][0]).toEqual(original);
    expect(screen.getByLabelText('Field name')).toHaveValue('Connector');
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Active form saved');
    expect(
      screen.queryByRole('button', { name: 'Review recovery options' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
  it('clears a failed save treatment when editing, adopting an explicit refresh or entering another category', async () => {
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale form.',
    });
    const properties = {
      memberId: id(50),
      categories: [
        { id: id(1), name: 'Cables', active: true },
        { id: id(20), name: 'Adapters', active: true },
      ],
      forms: { [id(1)]: form, [id(20)]: { ...form, category_id: id(20) } },
    };
    const { rerender } = render(
      <MetadataSettings
        key="cables"
        {...properties}
        selectedCategoryId={id(1)}
      />,
    );
    addField('Connector');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Stale form.');
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Updated connector' },
    });
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Stale form.');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    openRecoveryTools();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh from server' }),
    );
    rerender(
      <MetadataSettings
        key="cables"
        {...properties}
        forms={{
          ...properties.forms,
          [id(1)]: { ...form, published_number: '2' },
        }}
        selectedCategoryId={id(1)}
      />,
    );
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Active form saved');
    addField('Another connector');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Stale form.');
    rerender(
      <MetadataSettings
        key="adapters"
        {...properties}
        selectedCategoryId={id(20)}
      />,
    );
    expect(screen.getByLabelText('Designer category')).toHaveValue(id(20));
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Active form saved');
    expect(screen.queryByText('Stale form.')).not.toBeInTheDocument();
    confirm.mockRestore();
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
    addField();
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved edits and switch category?',
    );
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    confirm.mockRestore();
  });
  it('routes the designer selector without adopting an absent category payload', async () => {
    render(
      <MetadataSettings
        memberId={id(50)}
        selectedCategoryId={id(1)}
        categories={[
          { id: id(20), name: 'Adapters', active: true },
          { id: id(1), name: 'Cables', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    expect(
      screen.getByLabelText('Designer category', { exact: true }),
    ).toHaveValue(id(1));
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/settings/forms/${id(20)}`),
    );
    expect(fetchCategoryForm).toHaveBeenCalledWith(id(20));
    expect(
      screen.getByLabelText('Designer category', { exact: true }),
    ).toHaveValue(id(1));
    expect(saveMetadataForm).not.toHaveBeenCalled();
  });
  it('preserves entered edits when a selected form fails to load, then permits retry', async () => {
    vi.mocked(fetchCategoryForm).mockResolvedValueOnce({
      ok: false,
      message: 'Form could not be loaded. Retry.',
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    addField('Keep this input');
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    await waitFor(() =>
      expect(
        screen.getByText('Form could not be loaded. Retry.'),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText('Field name')).toHaveValue('Keep this input');
    expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
    confirm.mockRestore();
  });
  it('ignores an old category load after a rapid switch back to the current route', async () => {
    let finishFetch!: (
      value: Awaited<ReturnType<typeof fetchCategoryForm>>,
    ) => void;
    const fetched = new Promise<Awaited<ReturnType<typeof fetchCategoryForm>>>(
      (resolve) => {
        finishFetch = resolve;
      },
    );
    let finishIdentity!: (
      value: Awaited<ReturnType<typeof verifyMetadataDesignerIdentity>>,
    ) => void;
    const verified = new Promise<
      Awaited<ReturnType<typeof verifyMetadataDesignerIdentity>>
    >((resolve) => {
      finishIdentity = resolve;
    });
    vi.mocked(fetchCategoryForm).mockReturnValue(fetched);
    vi.mocked(verifyMetadataDesignerIdentity).mockReturnValue(verified);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const heading = screen.getAllByLabelText('Section heading').at(-1)!;
    fireEvent.change(heading, {
      target: { value: 'Original category local section' },
    });
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(1) },
      },
    );
    expect(fetchCategoryForm).toHaveBeenCalledExactlyOnceWith(id(20));
    // Await both application promises, including the identity continuation.
    // Selector A alone is already observable before either promise settles.
    await act(async () => {
      finishFetch({ ok: true, form: null });
      await fetched;
    });
    expect(verifyMetadataDesignerIdentity).toHaveBeenCalledExactlyOnceWith(
      id(50),
    );
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => {
      finishIdentity({ ok: true });
      await verified;
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText('Designer category', { exact: true }),
    ).toHaveValue(id(1));
    expect(heading).toHaveValue('Original category local section');
    expect(
      screen.getByRole('button', { name: /^Save changes$/ }),
    ).toBeEnabled();
    expect(saveMetadataForm).not.toHaveBeenCalled();
    fireEvent.change(heading, {
      target: { value: 'Still editable after the old load completed' },
    });
    expect(heading).toHaveValue('Still editable after the old load completed');
  });
  it('keeps an earlier category load valid when a newer dirty switch is cancelled', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchCategoryForm>>) => void;
    vi.mocked(fetchCategoryForm).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
          { id: id(21), name: 'Computers', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    addField('Keep after cancellation');
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(21) },
      },
    );
    expect(fetchCategoryForm).toHaveBeenCalledTimes(1);
    finish({ ok: false, message: 'Adapters failed to open.' });
    await waitFor(() =>
      expect(
        screen.getByText('Adapters failed to open.', {
          selector: '[role="status"]',
        }),
      ).toBeInTheDocument(),
    );
    const link = document.createElement('a');
    link.href = '/settings';
    document.body.append(link);
    // No invalidated target remains to silently block ordinary navigation.
    expect(fireEvent.click(link)).toBe(true);
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('Leave this page?'),
    );
    link.remove();
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(21) },
      },
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/settings/forms/${id(21)}`),
    );
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Keep after cancellation',
    );
    confirm.mockRestore();
  });
  it('freezes the reviewed outgoing editor until the target route actually mounts', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const categories = [
      { id: id(1), name: 'Cables', active: true },
      { id: id(20), name: 'Adapters', active: true },
    ];
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={categories}
        forms={{ [id(1)]: form }}
      />,
    );
    addField('Reviewed input');
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
    expect(
      screen.getByLabelText('Designer category', { exact: true }),
    ).toBeDisabled();
    expect(screen.getByLabelText('Field name')).toBeDisabled();
    openRecoveryTools();
    for (const name of [
      'Save changes',
      'Discard unsaved edits',
      'Undo edit',
      'Refresh from server',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Too late' },
    });
    expect(screen.getByLabelText('Field name')).toHaveValue('Reviewed input');
    const reviewed = readDesignerRecovery(id(50), id(1)).item?.definition;
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Resize Reviewed input' }),
      { pointerId: 2, clientX: 10 },
    );
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 500 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 500 });
    expect(readDesignerRecovery(id(50), id(1)).item?.definition).toEqual(
      reviewed,
    );
    expect(
      readDesignerRecovery(id(50), id(1)).item?.discardAfterCategoryId,
    ).toBe(id(20));
    cleanup();
    render(
      <MetadataSettings
        memberId={id(50)}
        selectedCategoryId={id(20)}
        categories={categories}
        forms={{ [id(20)]: { ...form, category_id: id(20) } }}
      />,
    );
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull(),
    );
    expect(
      screen.getByLabelText('Designer category', { exact: true }),
    ).toBeEnabled();
    expect(saveMetadataForm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it('removes a discard marker before unlocking a route that never committed, preserving later edits on a late target mount', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const categories = [
      { id: id(1), name: 'Cables', active: true },
      { id: id(20), name: 'Adapters', active: true },
    ];
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={categories}
        forms={{ [id(1)]: form }}
      />,
    );
    addField('Original input');
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
    const expire = timers.mock.calls
      .filter(([, delay]) => delay === 15000)
      .at(-1)![0];
    expect(typeof expire).toBe('function');
    act(() => {
      if (typeof expire === 'function') expire();
    });
    expect(screen.getByLabelText('Field name')).toBeEnabled();
    expect(
      readDesignerRecovery(id(50), id(1)).item?.discardAfterCategoryId,
    ).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Fresh retained input' },
    });
    cleanup();
    render(
      <MetadataSettings
        memberId={id(50)}
        selectedCategoryId={id(20)}
        categories={categories}
        forms={{ [id(20)]: { ...form, category_id: id(20) } }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText('Designer category', { exact: true }),
      ).toHaveValue(id(20)),
    );
    expect(
      readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
    ).toBe('Fresh retained input');
    cleanup();
    mount();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Recover edits' }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recover edits' }));
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Fresh retained input',
    );
    timers.mockRestore();
    confirm.mockRestore();
  });
  it('keeps the outgoing editor frozen when storage cannot remove a timed-out discard marker', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    addField('Protected reviewed input');
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
    const expire = timers.mock.calls
      .filter(([, delay]) => delay === 15000)
      .at(-1)![0];
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage blocked');
      });
    const remove = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('storage blocked');
      });
    act(() => {
      if (typeof expire === 'function') expire();
    });
    expect(
      screen.getByText(/editing is paused to protect the reviewed draft/, {
        selector: '[role="status"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Field name')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Unsafe edit' },
    });
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Protected reviewed input',
    );
    expect(
      readDesignerRecovery(id(50), id(1)).item?.discardAfterCategoryId,
    ).toBe(id(20));
    write.mockRestore();
    remove.mockRestore();
    timers.mockRestore();
    confirm.mockRestore();
  });
  it('treats a pending field addition as unsaved and recovers it only in its original context', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(
      within(screen.getByRole('dialog')).getByLabelText('Field name'),
      { target: { value: 'Unadded field' } },
    );
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved edits and switch category?',
    );
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        readDesignerRecovery(id(50), id(1)).item?.addition?.field?.label,
      ).toBe('Unadded field'),
    );
    cleanup();
    render(
      <MetadataSettings
        memberId={id(50)}
        selectedCategoryId={id(20)}
        categories={[{ id: id(20), name: 'Adapters', active: true }]}
        forms={{ [id(20)]: { ...form, category_id: id(20) } }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Recover unsaved form edits' }),
      ).not.toBeInTheDocument(),
    );
    cleanup();
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Recover edits' }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recover edits' }));
    expect(
      within(screen.getByRole('dialog')).getByLabelText('Field name'),
    ).toHaveValue('Unadded field');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /^Cancel$/,
      }),
    );
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull(),
    );
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const category = screen.getByLabelText('Designer category', {
      exact: true,
    });
    expect(category).toBeDisabled();
    fireEvent.change(category, { target: { value: id(20) } });
    expect(category).toHaveValue(id(1));
    finish({ ok: true, data: { version: '1', draft_id: id(11) } });
    await waitFor(() =>
      expect(screen.getByText('Saved active form revision 1.')).toBeVisible(),
    );
    expect(category).toHaveValue(id(1));
    expect(screen.getByLabelText('Field name')).toHaveValue('Connector');
    expect(
      vi.mocked(saveMetadataForm).mock.calls[0][0].payload.category_id,
    ).toBe(id(1));
  });
  it('retains exact reviewed replay after a lost response and pre-RPC authorization denial', async () => {
    const definition = structuredClone(form.published_definition);
    const payload = {
      expected_actor_id: id(50),
      category_id: id(1),
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: id(2),
      definition,
      review_token: 'original-review-token',
    };
    const receipt = {
      key: JSON.stringify(['metadata_form_save', payload]),
      id: id(60),
    };
    writeDesignerRecovery({
      memberId: id(50),
      categoryId: id(1),
      definition,
      savedDefinition: JSON.stringify(definition),
      expectedDraftId: null,
      expectedDraftVersion: '0',
      expectedPublishedRevisionId: id(2),
      receipt,
      uncertainSave: true,
    });
    vi.mocked(saveMetadataForm).mockRejectedValueOnce(
      new Error('lost response'),
    );
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Recover edits' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    await screen.findByText(/save outcome could not be confirmed/);
    const original = vi.mocked(saveMetadataForm).mock.calls[0][0];
    expect(original).toEqual({
      requestId: id(60),
      expectedActorId: id(50),
      payload,
    });
    vi.mocked(saveMetadataForm).mockResolvedValueOnce({
      ok: false,
      code: 'P1001',
      message: 'Actor no longer authorized.',
    });
    // The outcome message can render before the React transition releases its
    // pending lock. A user can retry only after the actual button is enabled.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry original save' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    expect(saveMetadataForm).toHaveBeenCalledTimes(2);
    await screen.findByText(/Configuration access changed/);
    expect(
      screen.queryByRole('button', { name: 'Retry original save' }),
    ).not.toBeInTheDocument();
    expect(readDesignerRecovery(id(50), id(1)).item?.receipt).toEqual(receipt);
    cleanup();
    render(
      <MetadataSettings
        memberId={id(51)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: form }}
      />,
    );
    await act(async () => {});
    expect(
      screen.queryByRole('button', { name: 'Recover edits' }),
    ).not.toBeInTheDocument();
    expect(readDesignerRecovery(id(50), id(1)).item?.receipt).toEqual(receipt);
    cleanup();
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Recover edits' }),
    );
    vi.mocked(saveMetadataForm).mockResolvedValueOnce({
      ok: true,
      data: { status: 'saved', version: '2', published_revision_id: id(22) },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    await screen.findByText('Saved active form revision 2.');
    expect(vi.mocked(saveMetadataForm).mock.calls[2][0]).toEqual(original);
    expect(readDesignerRecovery(id(50), id(1)).item?.uncertainSave).not.toBe(
      true,
    );
  });
  it('captures an in-flight command before passive effects and ignores late success after focus denial', async () => {
    let finish!: (value: Awaited<ReturnType<typeof saveMetadataForm>>) => void;
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Access removed.',
    });
    vi.mocked(saveMetadataForm).mockImplementation((input) => {
      expect(readDesignerRecovery(id(50), id(1)).item?.receipt).toEqual({
        id: input.requestId,
        key: JSON.stringify(['metadata_form_save', input.payload]),
      });
      fireEvent.focus(window);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    mount();
    addField('Private in-flight field');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Configuration access changed/);
    const original = readDesignerRecovery(id(50), id(1)).item;
    expect(original?.uncertainSave).toBe(true);
    expect(
      screen.queryByText('Private in-flight field'),
    ).not.toBeInTheDocument();
    await act(async () => {
      finish({
        ok: true,
        data: { status: 'saved', version: '2', published_revision_id: id(22) },
      });
    });
    expect(readDesignerRecovery(id(50), id(1)).item).toEqual(original);
    expect(
      screen.queryByText('Saved active form revision 2.'),
    ).not.toBeInTheDocument();
    cleanup();
    mount();
    expect(
      await screen.findByRole('button', { name: 'Recover edits' }),
    ).toBeVisible();
  });
  it('preserves an unresolved snapshot when focus denial happens before Recover edits', async () => {
    const definition = structuredClone(form.published_definition);
    const snapshot = {
      memberId: id(50),
      categoryId: id(1),
      definition,
      savedDefinition: JSON.stringify(definition),
      expectedDraftId: null,
      expectedDraftVersion: '0',
      expectedPublishedRevisionId: id(2),
      receipt: { key: 'untouched original command', id: id(60) },
      uncertainSave: true,
    };
    writeDesignerRecovery(snapshot);
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Access removed.',
    });
    mount();
    fireEvent.focus(window);
    await screen.findByText(/Configuration access changed/);
    expect(readDesignerRecovery(id(50), id(1)).item).toEqual(snapshot);
    cleanup();
    mount();
    expect(
      await screen.findByRole('button', { name: 'Recover edits' }),
    ).toBeVisible();
  });
  it('keeps a non-durable original command in memory and does not advertise safe reload on denial', async () => {
    vi.mocked(saveMetadataForm).mockRejectedValueOnce(
      new Error('lost response'),
    );
    mount();
    addField('Memory-only command');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/save outcome could not be confirmed/);
    const original = readDesignerRecovery(id(50), id(1)).item;
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Access removed.',
    });
    fireEvent.focus(window);
    await screen.findByText(/Do not reload or close it/);
    expect(
      screen.queryByRole('button', { name: 'Refresh access' }),
    ).not.toBeInTheDocument();
    expect(readDesignerRecovery(id(50), id(1))).toEqual({
      available: false,
      item: original,
    });
    // A different actor or unavailable identity cannot release the mask.
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    await screen.findByText(/configuration access could not be verified/);
    expect(
      screen.queryByRole('button', { name: 'Recover edits' }),
    ).not.toBeInTheDocument();
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValueOnce({
      ok: false,
      code: 'identity_unverified',
      message: 'Unavailable.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    await waitFor(() =>
      expect(verifyMetadataDesignerIdentity).toHaveBeenCalledTimes(3),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry access' }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole('button', { name: 'Recover edits' }),
    ).not.toBeInTheDocument();
    // A fresh successful original-actor check enables same-page recovery, even
    // when a reload would destroy the only exact receipt.
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValueOnce({
      ok: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Recover edits' }),
    );
    vi.mocked(saveMetadataForm).mockResolvedValueOnce({
      ok: true,
      data: { status: 'saved', version: '3', published_revision_id: id(23) },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    await screen.findByText('Saved active form revision 3.');
    expect(vi.mocked(saveMetadataForm).mock.calls[1][0]).toEqual(
      vi.mocked(saveMetadataForm).mock.calls[0][0],
    );
    expect(readDesignerRecovery(id(50), id(1)).item).toBeNull();
    cleanup();
  });
  it('retains a memory-only command through protected revocation and requires explicit original-owner recovery after readmission', async () => {
    const binding = {
      actorId: id(50),
      backend: 'https://isolated.supabase.co',
      role: 'staff',
      canManageConfiguration: true,
    };
    vi.mocked(saveMetadataForm).mockRejectedValueOnce(
      new Error('lost response'),
    );
    render(
      <ProtectedPrivacyBoundary binding={binding}>
        <ProtectedPrivacyContent>
          <MetadataSettings
            memberId={id(50)}
            categories={[{ id: id(1), name: 'Cables', active: true }]}
            forms={{ [id(1)]: form }}
          />
        </ProtectedPrivacyContent>
      </ProtectedPrivacyBoundary>,
    );
    await screen.findByRole('button', { name: 'Add field' });
    addField('Private memory-only form field');
    const storageBlocked = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/save outcome could not be confirmed/);
    const originalRequest = vi.mocked(saveMetadataForm).mock.calls[0][0];
    const originalRecovery = readDesignerRecovery(id(50), id(1)).item;
    expect(originalRecovery?.receipt?.id).toBe(originalRequest.requestId);
    privacyActions.readProtectedPrivacyIdentity.mockResolvedValueOnce({
      status: 'denied',
    });
    act(() => {
      revokePrivatePresentation();
    });
    expect(
      Array.from(document.querySelectorAll('input'))
        .map((input) => input.value)
        .join(' '),
    ).not.toContain('Private memory-only form field');
    expect(
      screen.queryByRole('button', { name: 'Retry original save' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'original account access',
    );
    expect(readDesignerRecovery(id(50), id(1))).toEqual({
      available: false,
      item: originalRecovery,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry privacy cleanup' }),
    );
    expect(
      await screen.findByText(/Configuration access changed/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Recover edits' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
    expect(
      privacyActions.readProtectedPrivacyIdentity,
    ).toHaveBeenLastCalledWith(binding);
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Recover edits' }),
    );
    vi.mocked(saveMetadataForm).mockResolvedValueOnce({
      ok: true,
      data: { status: 'saved', version: '3', published_revision_id: id(23) },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    await screen.findByText('Saved active form revision 3.');
    expect(vi.mocked(saveMetadataForm).mock.calls[1][0]).toEqual(
      originalRequest,
    );
    expect(readDesignerRecovery(id(50), id(1)).item).toBeNull();
    storageBlocked.mockRestore();
  });
  it('retains the same request after an uncertain save and recovery re-entry', async () => {
    vi.mocked(saveMetadataForm).mockRejectedValueOnce(
      new Error('lost response'),
    );
    mount();
    addField('Uncertain field');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByText(/save outcome could not be confirmed/),
      ).toBeVisible(),
    );
    expect(
      screen.getByRole('status', { name: 'Form save state' }),
    ).toHaveTextContent('Save outcome unconfirmed');
    const original = vi.mocked(saveMetadataForm).mock.calls[0][0];
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item?.receipt?.id).toBe(
        original.requestId,
      ),
    );
    cleanup();
    // Observe the first committed recovery UI, before passive effects have to
    // run. A user must never see a locked uncertain command with navigation open.
    const entryLink = document.createElement('a');
    entryLink.href = '/settings';
    document.body.append(entryLink);
    let entryNavigationAllowed: boolean | undefined;
    const observer = new MutationObserver(() => {
      if (
        entryNavigationAllowed === undefined &&
        screen.queryByRole('button', { name: 'Recover edits' })
      ) {
        entryNavigationAllowed = entryLink.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[
          { id: id(1), name: 'Cables', active: true },
          { id: id(20), name: 'Adapters', active: true },
        ]}
        forms={{ [id(1)]: form }}
      />,
    );
    try {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Recover edits' }),
        ).toBeVisible(),
      );
      await waitFor(() => expect(entryNavigationAllowed).toBeDefined());
    } finally {
      observer.disconnect();
      entryLink.remove();
    }
    expect(entryNavigationAllowed).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Discard recovered edits' }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('Designer category', { exact: true }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Discard recovered edits' }),
    );
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
    expect(readDesignerRecovery(id(50), id(1)).item?.receipt?.id).toBe(
      original.requestId,
    );
    expect(fetchCategoryForm).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    const link = document.createElement('a');
    link.href = '/settings';
    document.body.append(link);
    expect(fireEvent.click(link)).toBe(false);
    link.remove();
    fireEvent.click(screen.getByRole('button', { name: 'Recover edits' }));
    vi.mocked(saveMetadataForm).mockResolvedValueOnce({
      ok: false,
      code: 'unexpected',
      message: 'Still uncertain.',
    });
    expect(screen.getByLabelText('Field name')).toBeDisabled();
    openRecoveryTools();
    expect(
      screen.getByRole('button', { name: 'Discard unsaved edits' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveMetadataForm).mock.calls[1][0]).toEqual(original);
  });
  it('ignores a successful old save after leaving its category and preserves its retry receipt', async () => {
    let finish!: (value: Awaited<ReturnType<typeof saveMetadataForm>>) => void;
    vi.mocked(saveMetadataForm).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    addField('Old context');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item?.receipt).toBeDefined(),
    );
    cleanup();
    finish({ ok: true, data: { version: '2', published_revision_id: id(22) } });
    await Promise.resolve();
    expect(readDesignerRecovery(id(50), id(1)).item?.receipt).toBeDefined();
    expect(
      readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
    ).toBe('Old context');
  });
  it('replays an uncertain confirmed save including its review token after category re-entry', async () => {
    const definition = structuredClone(form.published_definition);
    definition.layout[0].label = 'Reviewed layout';
    const payload = {
      expected_actor_id: id(50),
      category_id: id(1),
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: id(2),
      definition,
      review_token: id(80),
    };
    writeDesignerRecovery({
      memberId: id(50),
      categoryId: id(1),
      definition,
      savedDefinition: JSON.stringify(form.published_definition),
      expectedDraftId: null,
      expectedDraftVersion: '0',
      expectedPublishedRevisionId: id(2),
      uncertainSave: true,
      receipt: {
        key: JSON.stringify(['metadata_form_save', payload]),
        id: id(81),
      },
    });
    mount();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Recover edits' }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recover edits' }));
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: false,
      code: 'P1017',
      message: 'Review expired.',
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry original save' }),
    );
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledOnce());
    expect(saveMetadataForm).toHaveBeenCalledWith({
      requestId: id(81),
      expectedActorId: id(50),
      payload,
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Section heading')).not.toBeDisabled(),
    );
  });
  it('offers explicit recovery after re-entry while retaining the original draft baseline', async () => {
    mount();
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Recovered connector',
    );
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
      addField();
      fireEvent.change(screen.getByLabelText('Field name'), {
        target: { value: 'Discard me' },
      });
      await waitFor(() =>
        expect(
          readDesignerRecovery(id(50), id(1)).item?.definition.fields[0].label,
        ).toBe('Discard me'),
      );
      openRecoveryTools();
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh from server' }),
      );
      expect(confirm).toHaveBeenCalledWith(
        'Discard unsaved edits and load the latest form from the server?',
      );
      expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull();
      confirm.mockReturnValue(true);
      openRecoveryTools();
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
    addField();
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull(),
    );
    fireEvent.change(
      screen.getByLabelText('Designer category', { exact: true }),
      {
        target: { value: id(20) },
      },
    );
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
    fireEvent.click(screen.getByRole('button', { name: /^Saved label/ }));
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Temporary' },
    });
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText('Field name'), {
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
  it('changes an unpublished type without creating a replacement identity', () => {
    mount();
    addField('Ports');
    fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }));
    const first = screen.getByText(/Stable ID:/).textContent;
    fireEvent.change(screen.getByLabelText('Field type'), {
      target: { value: 'integer' },
    });
    expect(screen.getByText(/Stable ID:/).textContent).toBe(first);
    expect(
      screen.getByRole('heading', { name: 'Ports · Whole number' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create replacement field' }),
    ).not.toBeInTheDocument();
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
  it('uses the committed choice baseline while refresh still has obsolete props', async () => {
    const legacy = structuredClone(form);
    legacy.published_definition.fields.push({
      id: id(30),
      type: 'single_select',
      label: 'Connector',
      applies_to: ['quantity', 'asset'],
      required: false,
      rules: {},
      options: [
        { id: id(31), label: 'USB', active: true },
        { id: id(32), label: 'usb', active: true },
      ],
    });
    legacy.published_definition.layout[0].controls.push({
      id: id(33),
      kind: 'field',
      field_id: id(30),
      width: 12,
    });
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: true,
      data: { status: 'saved', version: '2', published_revision_id: id(9) },
    });
    const props = {
      memberId: id(50),
      categories: [{ id: id(1), name: 'Cables', active: true }],
      forms: { [id(1)]: legacy },
    };
    const view = render(<MetadataSettings {...props} />);
    fireEvent.click(document.querySelector(`[data-control-id="${id(33)}"]`)!);
    fireEvent.change(screen.getByLabelText('Option name: usb'), {
      target: { value: 'Ethernet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved active form revision 2.');
    fireEvent.change(screen.getByLabelText('Option name: Ethernet'), {
      target: { value: 'usb' },
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(
      screen.getAllByText(/indistinguishable active choice/).length,
    ).toBeGreaterThan(0);
    // A delayed refresh with the old revision must not replace the committed baseline.
    view.rerender(<MetadataSettings {...props} forms={{ ...props.forms }} />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMetadataForm).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Option name: usb'), {
      target: { value: 'Ethernet cable' },
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveMetadataForm).mock.calls[1][0].payload).toMatchObject({
      expected_published_revision_id: id(9),
    });
  });
  it('protects a newly published field identity before refreshed props arrive', async () => {
    vi.mocked(saveMetadataForm).mockResolvedValue({
      ok: true,
      data: { status: 'saved', version: '2', published_revision_id: id(9) },
    });
    mount();
    addField('Ports');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved active form revision 2.');
    fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }));
    expect(screen.queryByLabelText('Field type')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create replacement field' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Discard unpublished field' }),
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
  it('invalidates an undispatched impact confirmation on Undo and reviews the restored proposal before confirming', async () => {
    const review = (token: string) => ({
      ok: true as const,
      data: {
        status: 'confirmation_required' as const,
        changed: false,
        token,
        expires_at: '2030-09-24T20:00:00Z',
        category_id: id(1),
        expected_published_revision_id: id(2),
        expected_draft_id: null,
        expected_draft_version: '0',
        reasons: [],
        affected_quantity: '3',
        affected_assets: '2',
        newly_needs_quantity: '1',
        newly_needs_assets: '0',
      },
    });
    vi.mocked(saveMetadataForm)
      .mockResolvedValueOnce(review(id(10)))
      .mockResolvedValueOnce(review(id(11)))
      .mockResolvedValueOnce({
        ok: false,
        code: 'unexpected',
        message: 'Test response.',
      });
    mount();
    addField('Restored proposal');
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Old reviewed proposal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirm and save changes' }),
      ).toBeEnabled(),
    );
    const oldReview = vi.mocked(saveMetadataForm).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Restored proposal',
    );
    expect(
      screen.queryByRole('region', { name: 'Form save impact' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm and save changes' }),
    ).not.toBeInTheDocument();
    expect(saveMetadataForm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirm and save changes' }),
      ).toBeEnabled(),
    );
    const restoredReview = vi.mocked(saveMetadataForm).mock.calls[1][0];
    expect(restoredReview.requestId).not.toBe(oldReview.requestId);
    expect(restoredReview.payload).not.toHaveProperty('review_token');
    expect(
      (restoredReview.payload.definition as MetadataDefinition).fields[0].label,
    ).toBe('Restored proposal');
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm and save changes' }),
    );
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(3));
    expect(vi.mocked(saveMetadataForm).mock.calls[2][0].payload).toEqual({
      ...restoredReview.payload,
      review_token: id(11),
    });
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Retained connector' },
    });
    fireEvent.focus(window);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry access check' }),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Retained connector',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeEnabled(),
    );
    expect(screen.getByLabelText('Field name')).toHaveValue(
      'Retained connector',
    );
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
    addField();
    fireEvent.change(screen.getByLabelText('Field name'), {
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
    addField();
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Resize New field' }),
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

  it('opens the same draft tester from the toolbar and returns to the selected field focus', async () => {
    mount();
    addField('Inspection notes');
    const name = screen.getByLabelText('Field name');
    name.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Preview form' }));
    expect(screen.getByTestId('preview-fields')).toHaveTextContent(
      'Inspection notes',
    );
    expect(screen.getAllByText('Shared live preview')).toHaveLength(1);
    expect(screen.getByText(/Temporary preview answers/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveValue('Inspection notes');
  });
  it.each(['desktop', 'phone', 'short'] as const)(
    'resets the selected inspector scroll while preserving unsaved input and intentional %s focus',
    (viewport) => {
      mount();
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      addField('Late field');
      act(() => frames.splice(0).forEach((callback) => callback(0)));
      const inspector = screen.getByTestId('designer-inspector');
      const canvas = screen.getByTestId('designer-canvas');
      const control = canvas.querySelector<HTMLElement>(
        '[data-control-id][data-selected="true"]',
      )!;
      const identity = control.dataset.controlId;
      inspector.scrollTop = 900;
      fireEvent.change(screen.getByLabelText('Field name'), {
        target: { value: 'Unsaved literal <draft>' },
      });
      expect(inspector.scrollTop).toBe(900);
      const scroll = vi.fn();
      inspector.scrollTo = scroll;
      fireEvent.click(
        within(inspector).getByRole('button', { name: 'Layout' }),
      );
      expect(
        within(inspector).getByRole('region', { name: 'Appearance' }),
      ).toHaveFocus();
      expect(scroll).toHaveBeenCalledOnce();
      expect(screen.getByLabelText('Field name')).toHaveValue(
        'Unsaved literal <draft>',
      );
      const select = within(canvas).getByRole('button', {
        name: 'Inspect Unsaved literal <draft> settings',
      });
      fireEvent.click(select);
      // Model responsive CSS after the panel state commits, before queued focus.
      if (viewport === 'phone') canvas.style.display = 'none';
      if (viewport === 'short')
        screen.getByTestId('designer-panes').dataset.designerFlow = 'true';
      act(() => frames.splice(0).forEach((callback) => callback(0)));
      expect(inspector.scrollTop).toBe(0);
      expect(control).toHaveAttribute('role', 'group');
      expect(control.dataset.controlId).toBe(identity);
      expect(control.querySelector('button button, button input')).toBeNull();
      if (viewport === 'desktop') expect(control).toHaveFocus();
      else
        expect(
          within(inspector).getByRole('heading', {
            name: 'Inspector',
          }),
        ).toHaveFocus();
      expect(screen.getByLabelText('Field name')).toHaveValue(
        'Unsaved literal <draft>',
      );
      if (viewport === 'short') {
        const appearance = within(inspector).getByRole('region', {
          name: 'Appearance',
        });
        const documentJump = vi.fn();
        appearance.scrollIntoView = documentJump;
        fireEvent.click(
          within(inspector).getByRole('button', { name: 'Layout' }),
        );
        expect(documentJump).toHaveBeenCalledOnce();
        expect(scroll).toHaveBeenCalledOnce();
        expect(appearance).toHaveFocus();
      }
      expect(saveMetadataForm).not.toHaveBeenCalled();
    },
  );
  it('applies pasted paths in one undoable designer edit', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nested dropdown' }));
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Connection' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste option paths' }));
    fireEvent.change(screen.getByLabelText('Option paths'), {
      target: { value: 'USB > USB-C > Dock' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review paths' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply paths' }));
    expect(screen.getByLabelText('Option name: Dock')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(
      screen.queryByLabelText('Option name: Dock'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Field name')).toHaveValue('Connection');
  });

  it('names a new required field and keeps review wording tied to the submitted proposal', async () => {
    let finish!: (result: Awaited<ReturnType<typeof saveMetadataForm>>) => void;
    vi.mocked(saveMetadataForm).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    addField('Safety inspection');
    fireEvent.click(screen.getByLabelText('Required'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMetadataForm).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveMetadataForm).mock.calls[0][0].payload;
    const field = (payload.definition as MetadataDefinition).fields[0];
    await act(async () =>
      finish({
        ok: true,
        data: {
          status: 'confirmation_required',
          token: id(10),
          expires_at: '2030-09-24T20:00:00Z',
          reasons: [
            {
              kind: 'required_tightened',
              id: field.id,
              affected_kinds: ['quantity', 'asset'],
            },
          ],
          affected_quantity: '3',
          affected_assets: '2',
          newly_needs_quantity: '1',
          newly_needs_assets: '0',
        },
      }),
    );
    const review = screen.getByRole('region', { name: 'Form save impact' });
    expect(review).toHaveTextContent(
      'Add required field “Safety inspection”: absent → required',
    );
    expect(review).toHaveTextContent(
      '3 quantity records and 2 individual assets',
    );
    expect(review).not.toHaveTextContent('Required tightened');
    fireEvent.change(screen.getByLabelText('Field name'), {
      target: { value: 'Edited after review' },
    });
    expect(
      screen.queryByRole('region', { name: 'Form save impact' }),
    ).not.toBeInTheDocument();
  });
  it('announces a keyboard drag using field and section names in the actual live region', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    mount();
    addField('Inspection notes');
    const handle = screen.getByRole('button', {
      name: 'Drag Inspection notes',
    });
    handle.focus();
    await waitFor(() => expect(handle).toHaveAttribute('aria-describedby'));
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await waitFor(() =>
      expect(
        [
          ...document.querySelectorAll(
            '[aria-live="polite"][id^="dnd-kit-announcement"]',
          ),
        ]
          .map((node) => node.textContent)
          .join(' '),
      ).toContain('Picked up “Inspection notes” in “Details”'),
    );
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() =>
      expect(
        [
          ...document.querySelectorAll(
            '[aria-live="polite"][id^="dnd-kit-announcement"]',
          ),
        ]
          .map((node) => node.textContent)
          .join(' '),
      ).toContain('Canceled move of “Inspection notes”'),
    );
  });
});

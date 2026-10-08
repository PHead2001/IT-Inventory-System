import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Link from 'next/link';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { submitInventory } from '@/features/inventory/actions';
import { submitCustody } from '@/features/custody/actions';
import { fetchCategoryForm } from './form-fetch.actions';
import { refreshMetadataRecord } from './record-refresh.actions';
import {
  MetadataForm,
  MetadataFormPreview,
  buildCustomPatch,
} from './metadata-form';
import type { MetadataForm as Form } from './contracts';
import { TaskWorkspace } from '@/features/inventory/components/task-workspace';
import { readCreation, writeCreation } from './creation-recovery';

const { push, refresh, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace }),
}));
vi.mock('@/features/inventory/actions', () => ({
  submitInventory: vi.fn(),
  findDuplicateSerials: vi.fn(),
}));
vi.mock('@/features/custody/actions', () => ({ submitCustody: vi.fn() }));
vi.mock('./form-fetch.actions', () => ({ fetchCategoryForm: vi.fn() }));
vi.mock('./record-refresh.actions', () => ({ refreshMetadataRecord: vi.fn() }));
vi.mock('@/features/locations/location-picker', () => ({
  LocationPicker: ({
    label,
    id,
    value,
    locations,
    onValueChange,
  }: {
    label: string;
    id: string;
    value: string;
    locations: Array<{ id: string; name: string }>;
    onValueChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="">Choose location</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </label>
  ),
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
  creationDraftId: firstRevision,
  actorId: '00000000-0000-4000-8000-000000000009',
  recoveryBackend: 'http://127.0.0.1:54321',
  kind: 'quantity' as const,
  categories: [{ id: categoryId, name: 'Parts', active: true }],
  locations: [],
  item,
};
describe('published metadata form', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: item,
      form: form(),
      draftForm: form(),
    });
  });
  it('focuses an empty creation Name with a persistent associated error while preserving false answers', async () => {
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    const name = await screen.findByLabelText('Name');
    await waitFor(() => expect(name).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/Enter/);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(submitInventory).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Metadata review' }),
    ).toBeNull();
  });
  it('identifies an untouched required custom answer on submit and accepts corrected false', async () => {
    const user = userEvent.setup();
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    await user.type(screen.getByLabelText('Name'), 'Cable');
    await user.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    const answer = screen.getByRole('checkbox', {
      name: 'Inspected (required)',
    });
    expect(answer).toHaveFocus();
    expect(answer).toHaveAttribute('aria-invalid', 'true');
    expect(answer).toHaveAccessibleDescription('Answer this required field.');
    expect(
      screen.queryByRole('region', { name: 'Metadata review' }),
    ).toBeNull();
    await user.click(answer);
    await user.click(answer);
    await user.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    expect(answer).not.toBeChecked();
    expect(answer).not.toHaveAttribute('required');
    expect(answer).not.toHaveAttribute('aria-invalid');
    expect(
      screen.getByRole('region', { name: 'Metadata review' }),
    ).toBeVisible();
    expect(submitInventory).not.toHaveBeenCalled();
  });

  it.each(['quantity', 'asset'] as const)(
    'retains invalid %s site-opening values and focuses its required Name',
    async (kind) => {
      const user = userEvent.setup();
      render(
        <MetadataForm
          {...props}
          kind={kind}
          item={undefined}
          forms={{ [categoryId]: form() }}
          openingSite={{
            id: otherCategory,
            code: 'EXAMPLE',
            name: 'Example site',
          }}
        />,
      );
      await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
      await user.click(
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      );
      expect(screen.getByLabelText('Name')).toHaveFocus();
      expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
        /Enter/,
      );
      expect(submitCustody).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Reason (optional)')).not.toBeRequired();
      if (kind === 'quantity')
        expect(screen.getByLabelText('Units already at this site')).toHaveValue(
          1,
        );
    },
  );
  it('recovers exact creation inputs after navigation remount and never restores an explicitly discarded instance', async () => {
    const creation = {
      ...props,
      item: undefined,
      actorId: item.id,
      recoveryBackend: 'http://127.0.0.1:54321',
      creationDraftId: secondRevision,
      forms: { [categoryId]: form() },
    };
    const first = render(<MetadataForm {...creation} />);
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Recovered cable' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('checkbox'));
    first.unmount();
    const second = render(<MetadataForm {...creation} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toHaveValue('Recovered cable'),
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    second.unmount();
    render(<MetadataForm {...creation} />);
    await waitFor(() =>
      expect(
        screen.getByText(/This creation draft was discarded/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue('Recovered cable')).toBeNull();
  });
  it('recovers a submitted creation and retries its exact identity instead of creating another operation', async () => {
    const creation = {
      ...props,
      item: undefined,
      actorId: item.id,
      recoveryBackend: 'http://127.0.0.1:54321',
      creationDraftId: secondRevision,
      forms: { [categoryId]: form() },
    };
    vi.mocked(submitInventory).mockRejectedValueOnce(
      new Error('lost response'),
    );
    const first = render(<MetadataForm {...creation} />);
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'One creation' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeInTheDocument(),
    );
    const command = vi.mocked(submitInventory).mock.calls[0][0];
    first.unmount();
    render(<MetadataForm {...creation} />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Name')).toBeDisabled();
    vi.mocked(submitInventory).mockResolvedValueOnce({
      ok: true,
      entityId: item.id,
      version: '1',
      changed: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(command);
  });
  it('blocks first dispatch when storage fails and retains input with a truthful navigation limitation', () => {
    const failure = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={secondRevision}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Keep in memory' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    expect(submitInventory).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Keep in memory');
    expect(
      screen.getByText(/browser and internal navigation may lose/),
    ).toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    failure.mockRestore();
  });
  it('keeps canonical creation controls behind the barrier until URL normalization remounts the durable instance', () => {
    const first = render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByText('Checking creation recovery…')).toBeInTheDocument();
    expect(replace).toHaveBeenCalledTimes(1);
    const id = new URL(
      replace.mock.calls[0][0],
      'http://localhost',
    ).searchParams.get('draft')!;
    first.unmount();
    render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={id}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.getByLabelText('Name')).toBeEnabled();
  });
  it('offers an explicit retry when canonical URL normalization does not remount and retains the same durable instance', () => {
    render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    const initialURL = replace.mock.calls[0][0];
    const retry = screen.getByRole('button', {
      name: 'Retry creation recovery',
    });
    replace.mockImplementationOnce(() => {
      throw new Error('Interrupted navigation');
    });
    fireEvent.click(retry);
    expect(screen.getByRole('alert')).toHaveTextContent('creation URL');
    expect(screen.getByLabelText('Name')).toBeDisabled();
    fireEvent.click(retry);
    expect(replace.mock.calls.map(([url]) => url)).toEqual([
      initialURL,
      initialURL,
      initialURL,
    ]);
    expect(
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith('inventory-creation-v1:'),
      ),
    ).toHaveLength(1);
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });
  it('never remounts an unstored canonical creation after a material edit when storage is unavailable', () => {
    const failure = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Retain this in memory' },
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Retain this in memory');
    failure.mockRestore();
  });
  it('offers another pending draft explicitly while canonical entry starts empty and another actor sees none', () => {
    const first = render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={secondRevision}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Separate pending draft' },
    });
    first.unmount();
    const second = render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Recover Separate pending draft' }),
    ).toBeInTheDocument();
    second.unmount();
    render(
      <MetadataForm
        {...props}
        actorId={firstRevision}
        item={undefined}
        creationDraftId={secondRevision}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.queryByText('Separate pending draft')).toBeNull();
  });
  it('retains incomplete datetime wall/zone input and requires explicit review of a changed recovered schema', () => {
    const current = form();
    current.published_definition.fields[0] = {
      ...current.published_definition.fields[0],
      type: 'datetime',
      required: false,
      label: 'Observed at',
    };
    const first = render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={secondRevision}
        forms={{ [categoryId]: current }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Incomplete time' },
    });
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-10-03' },
    });
    fireEvent.change(screen.getByLabelText('Display timezone'), {
      target: { value: 'America/Chicago' },
    });
    first.unmount();
    const changed = {
      ...current,
      published_revision_id: secondRevision,
      published_number: '2',
    };
    render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={secondRevision}
        forms={{ [categoryId]: changed }}
      />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-03');
    expect(screen.getByLabelText('Time')).toHaveValue('');
    expect(screen.getByLabelText('Display timezone')).toHaveValue(
      'America/Chicago',
    );
    expect(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Review updated fields' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Incomplete time');
    expect(screen.getByText('Choose a date and time.')).toBeInTheDocument();
  });
  it('locks an older editing page on pageshow when its exact draft now has a submitted command', async () => {
    render(
      <MetadataForm
        {...props}
        item={undefined}
        creationDraftId={secondRevision}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Submitted elsewhere' },
    });
    const scope = {
      origin: window.location.origin,
      backend: props.recoveryBackend,
      actor: props.actorId,
      kind: 'quantity' as const,
      site: null,
    };
    const envelope = readCreation(scope, secondRevision).envelope!;
    const command = {
      operation: 'quantity_create_v2' as const,
      requestId: otherCategory,
      expectedActorId: props.actorId,
      payload: {
        name: 'Submitted elsewhere',
        description: null,
        category_id: categoryId,
        manufacturer: null,
        model: null,
        initial_quantity: 0,
        initial_location_id: null,
        expected_published_revision_id: firstRevision,
        custom_patch: { set: { [fieldId]: false }, unset: [] },
      },
    };
    expect(writeCreation({ ...envelope, status: 'submitted', command })).toBe(
      true,
    );
    fireEvent(window, new Event('pageshow'));
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    vi.mocked(submitInventory).mockRejectedValueOnce(
      new Error('still unknown'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledWith(command));
  });
  it('keeps the durable submitted request when success-marker storage fails and safely resolves that same request', async () => {
    let acknowledge!: (
      result: Awaited<ReturnType<typeof submitInventory>>,
    ) => void;
    vi.mocked(submitInventory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const creation = {
      ...props,
      item: undefined,
      creationDraftId: secondRevision,
      forms: { [categoryId]: form() },
    };
    const first = render(<MetadataForm {...creation} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Acknowledged once' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    const original = vi.mocked(submitInventory).mock.calls[0][0];
    const raw = sessionStorage.getItem(sessionStorage.key(0)!);
    const pendingUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pendingUnload);
    expect(pendingUnload.defaultPrevented).toBe(true);
    const failure = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    await act(async () =>
      acknowledge({ ok: true, entityId: item.id, version: '1', changed: true }),
    );
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(raw);
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Retry same save' }),
    ).toBeInTheDocument();
    const unresolvedUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unresolvedUnload);
    expect(unresolvedUnload.defaultPrevented).toBe(true);
    failure.mockRestore();
    const navigationUnload = new Event('beforeunload', { cancelable: true });
    push.mockImplementationOnce(() => window.dispatchEvent(navigationUnload));
    vi.mocked(submitInventory).mockResolvedValueOnce({
      ok: true,
      entityId: item.id,
      version: '1',
      changed: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/inventory/quantity/${item.id}`),
    );
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(original);
    expect(navigationUnload.defaultPrevented).toBe(false);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    first.unmount();
    render(<MetadataForm {...creation} />);
    expect(
      screen.getByText('This creation draft was already saved.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    ).toBeNull();
  });
  it.each(['quantity', 'asset'] as const)(
    'recovers %s site-opening context, raw notes and amount without selecting a storage holding',
    (kind) => {
      const creation = {
        ...props,
        kind,
        item: undefined,
        creationDraftId: secondRevision,
        openingSite: { id: item.id, code: 'SITE-A', name: 'Site A' },
        forms: { [categoryId]: form() },
      };
      const first = render(<MetadataForm {...creation} />);
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Opening equipment' },
      });
      fireEvent.change(screen.getByLabelText('Reason (optional)'), {
        target: { value: '  Original note  ' },
      });
      fireEvent.change(screen.getByLabelText('Reference (optional)'), {
        target: { value: '  Opening reference  ' },
      });
      if (kind === 'quantity')
        fireEvent.change(screen.getByLabelText('Units already at this site'), {
          target: { value: '3' },
        });
      first.unmount();
      render(<MetadataForm {...creation} />);
      expect(screen.getByLabelText('Name')).toHaveValue('Opening equipment');
      expect(screen.getByLabelText('Reason (optional)')).toHaveValue(
        '  Original note  ',
      );
      expect(screen.getByLabelText('Reference (optional)')).toHaveValue(
        '  Opening reference  ',
      );
      if (kind === 'quantity')
        expect(screen.getByLabelText('Units already at this site')).toHaveValue(
          3,
        );
      expect(screen.queryByLabelText('Initial location')).toBeNull();
    },
  );
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
    ).toEqual(['Name *', 'Category *', 'Inspected (required)']);
    expect(
      screen.queryByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeNull();
    expect(screen.queryByLabelText('Initial quantity')).toBeNull();
    fireEvent.submit(
      screen.getByRole('form', { name: 'Preview quantity metadata' }),
    );
    expect(
      screen.queryByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    ).toBeNull();
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('keeps missing, false, and true boolean values distinct with an explicit Clear answer', () => {
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
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('No')).toBeNull();
    expect(checkbox).not.toHaveAttribute('required');
    fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });
  it('validates quantity Item code by Unicode characters and keeps its display text', async () => {
    const user = userEvent.setup();
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
    await user.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription(/at most 100 characters/);
    expect(
      screen.queryByRole('region', { name: 'Metadata review' }),
    ).toBeNull();
    expect(submitInventory).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '😀'.repeat(100) } });
    await user.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole('region', { name: 'Metadata review' }),
    ).toBeVisible();
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
    ).toEqual({ set: { [fieldId]: false, [sectionId]: 0 }, unset: [] });
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
    ).toEqual({ set: { [fieldId]: false }, unset: [] });
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
        actorId={props.actorId}
        recoveryBackend={props.recoveryBackend}
        creationDraftId={firstRevision}
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
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
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
        actorId={props.actorId}
        recoveryBackend={props.recoveryBackend}
        creationDraftId={firstRevision}
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
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
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
  it('keeps overlapping edits until a field-specific decision, automatically adopting compatible forms', async () => {
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
    expect(screen.getByText(/Name was changed elsewhere/)).toHaveTextContent(
      'Latest: Updated elsewhere. My edit: Edited cable.',
    );
    expect(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my Name edit' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      ).toBeEnabled(),
    );
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
    revised.published_definition.fields[0].required = false;
    let finishSchema!: (
      result: Awaited<ReturnType<typeof fetchCategoryForm>>,
    ) => void;
    const refreshedSchema = new Promise<
      Awaited<ReturnType<typeof fetchCategoryForm>>
    >((resolve) => {
      finishSchema = resolve;
    });
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: item,
      form: form(),
      draftForm: revised,
    });
    vi.mocked(fetchCategoryForm)
      .mockResolvedValueOnce({ ok: true, form: secondary })
      .mockReturnValueOnce(refreshedSchema);
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
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Edited cable' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() => expect(submitInventory).toHaveBeenCalled());
    expect(
      (vi.mocked(submitInventory).mock.calls[0][0] as { payload: unknown })
        .payload,
    ).toMatchObject({
      expected_published_revision_id: firstRevision,
      expected_version: item.version,
      category_id: otherCategory,
      name: 'Edited cable',
    });
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      operation: 'quantity_update_v2',
      expectedActorId: props.actorId,
    });
    await waitFor(() => expect(fetchCategoryForm).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText(/Loading the newly published category form/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Edited cable');
    expect(
      screen.getByRole('button', { name: 'Review metadata' }),
    ).toBeDisabled();
    expect(submitInventory).toHaveBeenCalledOnce();
    await act(async () => finishSchema({ ok: true, form: revised }));
    await waitFor(() =>
      expect(screen.getByText(/category form changed/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Edited cable');
    expect(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review updated fields' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Review updated fields' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Edited cable');
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      ).toBeEnabled(),
    );
    expect(submitInventory).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    expect(submitInventory).toHaveBeenCalledOnce();
    vi.mocked(submitInventory).mockResolvedValueOnce({
      ok: true,
      entityId: item.id,
      version: '2',
      changed: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toMatchObject({
      operation: 'quantity_update_v2',
      expectedActorId: props.actorId,
      payload: {
        expected_published_revision_id: secondRevision,
        expected_version: item.version,
        category_id: otherCategory,
        name: 'Edited cable',
      },
    });
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
      screen.getByRole('button', { name: 'Review updated fields' }),
    );
    const newInput = screen.getByLabelText(
      'Revised choice',
    ) as HTMLSelectElement;
    expect(newInput.value).toBe(choiceId);
    expect(
      screen.getByText(/Original choice.*unavailable/),
    ).toBeInTheDocument();
  });
  it('adopts independent latest values before saving without resending stale metadata', async () => {
    const current = form();
    current.published_definition.layout[0].controls.push({
      id: secondRevision,
      kind: 'builtin',
      builtin: 'manufacturer',
      width: 12,
    });
    const { rerender } = render(
      <MetadataForm {...props} forms={{ [categoryId]: current }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My name' },
    });
    rerender(
      <MetadataForm
        {...props}
        item={{ ...item, version: 2, manufacturer: 'Latest maker' }}
        forms={{ [categoryId]: current }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Manufacturer')).toHaveValue('Latest maker'),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('My name');
    vi.mocked(submitInventory).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '3',
      changed: true,
    });
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: {
        ...item,
        version: 3,
        name: 'My name',
        manufacturer: 'Latest maker',
      },
      form: current,
      draftForm: current,
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() => expect(submitInventory).toHaveBeenCalledOnce());
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      payload: {
        expected_version: 2,
        name: 'My name',
        manufacturer: 'Latest maker',
        custom_patch: { set: {}, unset: [] },
      },
    });
  });
  it('establishes a complete canonical baseline after its own category change and permits another edit', async () => {
    const target = { ...form(secondRevision), category_id: otherCategory };
    target.published_definition.fields = [];
    target.published_definition.layout[0].controls =
      target.published_definition.layout[0].controls.slice(0, 2);
    const catalog = [
      ...props.categories,
      { id: otherCategory, name: 'Adapters', active: true },
    ];
    const forms = { [categoryId]: form(), [otherCategory]: target };
    const saved = {
      ...item,
      categoryId: otherCategory,
      categoryName: 'Adapters',
      version: 2,
      validatedFormRevisionId: secondRevision,
    };
    vi.mocked(submitInventory).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '2',
      changed: true,
    });
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: saved,
      form: target,
      draftForm: target,
    });
    const { rerender } = render(
      <MetadataForm {...props} categories={catalog} forms={forms} />,
    );
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: otherCategory },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit details' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    rerender(
      <MetadataForm
        {...props}
        item={saved}
        categories={catalog}
        forms={forms}
      />,
    );
    expect(screen.queryByText(/was changed elsewhere/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Second edit' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toMatchObject({
      payload: {
        expected_version: 2,
        category_id: otherCategory,
        name: 'Second edit',
      },
    });
  });
  it('rebases once after a definitive stale rejection with latest untouched fields and a new request ID', async () => {
    vi.mocked(submitInventory)
      .mockResolvedValueOnce({
        ok: false,
        kind: 'domain',
        code: 'stale_version',
        message: 'Stale',
      })
      .mockResolvedValueOnce({
        ok: true,
        entityId: item.id,
        version: '3',
        changed: true,
      });
    const latest = { ...item, version: 2, manufacturer: 'Latest maker' };
    vi.mocked(refreshMetadataRecord)
      .mockResolvedValueOnce({
        ok: true,
        record: latest,
        form: form(),
        draftForm: form(),
      })
      .mockResolvedValueOnce({
        ok: true,
        record: { ...latest, version: 3, name: 'Mine' },
        form: form(),
        draftForm: form(),
      });
    render(<MetadataForm {...props} forms={{ [categoryId]: form() }} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Mine' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
    const [first, second] = vi
      .mocked(submitInventory)
      .mock.calls.map(
        ([command]) =>
          command as { requestId: string; payload: Record<string, unknown> },
      );
    expect(first.requestId).not.toBe(second.requestId);
    expect(second.payload).toMatchObject({
      name: 'Mine',
      manufacturer: 'Latest maker',
      expected_version: 2,
    });
    await screen.findByText('Details saved.');
  });
  it('stops after another intervening stale rejection instead of looping', async () => {
    vi.mocked(submitInventory).mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'stale_version',
      message: 'Changed again; review your save.',
    });
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: { ...item, version: 2, model: 'Other' },
      form: form(),
      draftForm: form(),
    });
    render(<MetadataForm {...props} forms={{ [categoryId]: form() }} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Mine' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Changed again'),
    );
    expect(submitInventory).toHaveBeenCalledTimes(2);
    expect(refreshMetadataRecord).toHaveBeenCalledOnce();
  });
  it('replays an uncertain revised payload exactly before any further reconciliation', async () => {
    vi.mocked(submitInventory)
      .mockResolvedValueOnce({
        ok: false,
        kind: 'domain',
        code: 'stale_version',
        message: 'Stale',
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: 'unexpected',
        code: 'unexpected',
        message: 'Unknown outcome',
      })
      .mockResolvedValueOnce({
        ok: true,
        entityId: item.id,
        version: '3',
        changed: true,
      });
    const latest = { ...item, version: 2, model: 'Updated model' };
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: latest,
      form: form(),
      draftForm: form(),
    });
    const { rerender } = render(
      <MetadataForm {...props} forms={{ [categoryId]: form() }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Mine' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeEnabled(),
    );
    rerender(
      <MetadataForm
        {...props}
        item={{ ...item, version: 4, name: 'Another user' }}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(refreshMetadataRecord).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(3));
    expect(vi.mocked(submitInventory).mock.calls[2][0]).toEqual(
      vi.mocked(submitInventory).mock.calls[1][0],
    );
  });
  it('shows saved-refresh retry without replaying a confirmed commit', async () => {
    vi.mocked(submitInventory).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '2',
      changed: true,
    });
    vi.mocked(refreshMetadataRecord)
      .mockResolvedValueOnce({ ok: false, message: 'Record read failed' })
      .mockResolvedValueOnce({
        ok: true,
        record: { ...item, name: 'Saved name', version: 2 },
        form: form(),
        draftForm: form(),
      });
    render(<MetadataForm {...props} forms={{ [categoryId]: form() }} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Saved name' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry saved record refresh' }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole('button', { name: 'Retry same save' }),
    ).toBeNull();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry saved record refresh' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit details' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(submitInventory).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Name')).toHaveValue('Saved name');
  });
  it('does not reuse conflict choices after a newer concurrent edit', async () => {
    const current = form();
    current.published_definition.layout[0].controls.push({
      id: secondRevision,
      kind: 'builtin',
      builtin: 'model',
      width: 12,
    });
    const { rerender } = render(
      <MetadataForm {...props} forms={{ [categoryId]: current }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Mine' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'My model' },
    });
    rerender(
      <MetadataForm
        {...props}
        item={{ ...item, version: 2, name: 'Name 2', model: 'Model 2' }}
        forms={{ [categoryId]: current }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use my Name edit' }));
    rerender(
      <MetadataForm
        {...props}
        item={{ ...item, version: 3, name: 'Name 3', model: 'Model 3' }}
        forms={{ [categoryId]: current }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Use my Name edit' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Name was changed elsewhere/)).toHaveTextContent(
      'Name 3',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use my Model edit' }));
    expect(
      screen.getByRole('button', { name: 'Use my Name edit' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeDisabled();
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
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    expect(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    ).toBeDisabled();
    const acknowledgement = screen.getByLabelText(
      /existing custom values.*legacy values/i,
    );
    fireEvent.click(acknowledgement);
    expect(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    ).toBeEnabled();
  });
  it.each(['quantity', 'asset'] as const)(
    'cancels untouched %s creation immediately without a write',
    (kind) => {
      const current = form();
      current.published_definition.fields[0].default = false;
      render(
        <MetadataForm
          {...props}
          kind={kind}
          item={undefined}
          forms={{ [categoryId]: current }}
          returnTo="/inventory?q=USB&type=quantity&page=2"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(push).toHaveBeenCalledWith(
        '/inventory?q=USB&type=quantity&page=2',
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(submitInventory).not.toHaveBeenCalled();
      expect(submitCustody).not.toHaveBeenCalled();
    },
  );
  it('returns site opening cancellation to its known site, and rejects external return paths', () => {
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
        openingSite={{ id: item.id, code: 'PROPERTY-A', name: 'Property' }}
        returnTo="https://evil.test"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(push).toHaveBeenCalledWith('/sites/PROPERTY-A');
    expect(submitCustody).not.toHaveBeenCalled();
  });
  it.each(['quantity', 'asset'] as const)(
    'discards a mounted %s edit, closes it, and reopens saved values without touched patches',
    async (kind) => {
      const current = form();
      current.published_definition.fields[0] = {
        ...current.published_definition.fields[0],
        type: 'integer',
        label: 'Count',
        required: false,
        applies_to: [kind],
      };
      const saved = {
        ...item,
        customValues: {
          [fieldId]: {
            type: 'integer' as const,
            value: 0,
            label: 'Count',
            validated_revision_id: firstRevision,
            owner_category_id: categoryId,
          },
        },
      };
      const savedAsset = {
        ...saved,
        assetTag: null,
        serialNumber: null,
        locationId: null,
        locationCode: null,
        locationName: null,
        status: 'active' as const,
      };
      render(
        <details open>
          <summary>Edit metadata</summary>
          <MetadataForm
            {...props}
            kind={kind}
            item={kind === 'quantity' ? saved : undefined}
            asset={kind === 'asset' ? savedAsset : undefined}
            forms={{ [categoryId]: current }}
          />
        </details>,
      );
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Discard this core edit' },
      });
      fireEvent.change(screen.getByLabelText('Count'), {
        target: { value: '-' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      const summary = screen.getByText('Edit metadata');
      expect(summary.parentElement).not.toHaveAttribute('open');
      expect(summary).toHaveFocus();
      expect(push).not.toHaveBeenCalled();
      summary.parentElement!.setAttribute('open', '');
      expect(screen.getByLabelText('Name')).toHaveValue('Cable');
      expect(screen.getByLabelText('Count')).toHaveValue('0');
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      );
      expect(
        screen.getByRole('button', {
          name: /^(Confirm save|Add quantity item|Add individual asset)$/,
        }),
      ).toBeEnabled();
      // Pristine Cancel also closes and clears review state without a prompt.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(summary.parentElement).not.toHaveAttribute('open');
      expect(screen.queryByRole('dialog')).toBeNull();
      summary.parentElement!.setAttribute('open', '');
      expect(
        screen.queryByRole('button', {
          name: /^(Confirm save|Add quantity item|Add individual asset)$/,
        }),
      ).toBeNull();
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Actual edit' },
      });
      vi.mocked(submitInventory).mockResolvedValue({
        ok: true,
        entityId: item.id,
        version: '2',
        changed: true,
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: /^(Confirm save|Add quantity item|Add individual asset)$/,
        }),
      );
      await waitFor(() => expect(submitInventory).toHaveBeenCalledOnce());
      expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
        payload: {
          name: 'Actual edit',
          custom_patch: { set: {}, unset: [] },
        },
      });
    },
  );
  it('prompts for dirty Cancel, traps focus and restores it on Keep editing and Escape', () => {
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New cable' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(
      screen.getByRole('button', { name: 'Discard changes' }),
    ).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveValue('New cable');
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(push).toHaveBeenCalledWith('/inventory');
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('treats genuinely reverted entries as untouched and does not resurrect a cleared create default', () => {
    const current = form();
    current.published_definition.fields[0].default = false;
    current.published_definition.fields[0].required = false;
    const first = render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: current }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Temporary' },
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: current }}
        creationDraftId={secondRevision}
      />,
    );
    push.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    expect(
      buildCustomPatch(
        current.published_definition,
        'quantity',
        {},
        [fieldId],
        true,
      ),
    ).toEqual({ set: {}, unset: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('accepts required unchecked false during create and preserves zero and missing values', async () => {
    vi.mocked(submitInventory).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '1',
      changed: true,
    });
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cable' },
    });
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() => expect(submitInventory).toHaveBeenCalled());
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      payload: {
        initial_quantity: 0,
        custom_patch: { set: { [fieldId]: false }, unset: [] },
      },
    });
  });
  it('blocks double submit and Cancel during a dispatched mutation, then freezes unknown outcomes and retries the same identity', async () => {
    let finish!: (result: Awaited<ReturnType<typeof submitInventory>>) => void;
    vi.mocked(submitInventory)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        entityId: item.id,
        version: '1',
        changed: true,
      });
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cable' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    ).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Add quantity item' }));
    expect(submitInventory).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish({
        ok: false,
        kind: 'unexpected',
        code: 'unexpected',
        message: 'Unknown outcome',
      }),
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /^(Edit values|Back to edit)$/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(
      vi.mocked(submitInventory).mock.calls[0][0],
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/inventory/quantity/' + item.id),
    );
  });
  it('keeps receipt after a thrown response instead of allowing cancellation or a new write identity', async () => {
    vi.mocked(submitInventory).mockRejectedValueOnce(
      new Error('Connection dropped'),
    );
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cable' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be confirmed',
    );
  });
  it('allows a touched then reverted grandfathered answer on the same category without weakening changed answers', async () => {
    const user = userEvent.setup();
    const current = form();
    current.published_definition.fields[0] = {
      ...current.published_definition.fields[0],
      type: 'short_text',
      label: 'Old note',
      rules: { maxLength: 2 },
    };
    render(
      <MetadataForm
        {...props}
        item={{
          ...item,
          customValues: {
            [fieldId]: {
              value: 'Legacy long note',
              validated_revision_id: firstRevision,
            },
          },
        }}
        forms={{ [categoryId]: current }}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Old note (required)'), {
      target: { value: 'Different long note' },
    });
    await user.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    const invalid = screen.getByLabelText('Old note (required)');
    expect(invalid).toHaveFocus();
    expect(invalid).toHaveAttribute('aria-invalid', 'true');
    expect(invalid).toHaveAccessibleDescription(/at most 2/);
    expect(
      screen.queryByRole('region', { name: 'Metadata review' }),
    ).toBeNull();
    expect(submitInventory).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Old note (required)'), {
      target: { value: 'Legacy long note' },
    });
    expect(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    ).toBeEnabled();
  });
  it.each(['forbidden', 'idempotency_conflict', 'actor_changed'])(
    'keeps an unknown prior save unresolved when retry returns %s before receipt confirmation',
    async (code) => {
      vi.mocked(submitInventory)
        .mockResolvedValueOnce({
          ok: false,
          kind: 'unexpected',
          code: 'unexpected',
          message: 'Unknown outcome',
        })
        .mockResolvedValueOnce({
          ok: false,
          kind: 'domain',
          code,
          message: 'Replay access denied',
        });
      render(
        <MetadataForm
          {...props}
          item={undefined}
          forms={{ [categoryId]: form() }}
        />,
      );
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Cable' },
      });
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(
        screen.getByRole('button', {
          name: /^Review (metadata|quantity item|individual asset)$/,
        }),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: /^(Confirm save|Add quantity item|Add individual asset)$/,
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Retry same save' }),
        ).toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Retry same save' }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Replay access denied',
        ),
      );
      expect(refresh).toHaveBeenCalledTimes(code === 'actor_changed' ? 1 : 0);
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByLabelText('Name')).toBeDisabled();
      expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(
        vi.mocked(submitInventory).mock.calls[0][0],
      );
    },
  );
  it('retains inputs and the bound receipt across a different active staff actor, resuming only as the original actor', async () => {
    vi.mocked(submitInventory)
      .mockResolvedValueOnce({
        ok: false,
        kind: 'unexpected',
        code: 'unexpected',
        message: 'Unknown outcome',
      })
      .mockResolvedValueOnce({
        ok: true,
        entityId: item.id,
        version: '1',
        changed: true,
      });
    const { rerender } = render(
      <MetadataForm
        {...props}
        actorId={firstRevision}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Actor-bound cable' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Review (metadata|quantity item|individual asset)$/,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /^(Confirm save|Add quantity item|Add individual asset)$/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeEnabled(),
    );
    rerender(
      <MetadataForm
        {...props}
        actorId={secondRevision}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'signed-in account or environment changed',
    );
    expect(submitInventory).toHaveBeenCalledTimes(1);
    rerender(
      <MetadataForm
        {...props}
        actorId={firstRevision}
        item={undefined}
        forms={{ [categoryId]: form() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(
      vi.mocked(submitInventory).mock.calls[0][0],
    );
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      expectedActorId: firstRevision,
    });
  });
});

describe('creation intent review', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
  });
  const destination = {
    id: secondRevision,
    code: 'DRAWER',
    name: 'Drawer',
    breadcrumb: 'IT Closet / Drawer',
    active: true,
    can_hold_inventory: true,
    parentId: null,
  };
  function completeForm(kind: 'quantity' | 'asset' = 'quantity') {
    const current = form();
    current.published_definition.fields[0].applies_to = [kind];
    current.published_definition.fields[0].default = false;
    for (const [index, builtin] of [
      'description',
      'manufacturer',
      'model',
      ...(kind === 'quantity'
        ? ['item_code', 'reorder_threshold']
        : ['asset_tag', 'serial_number']),
    ].entries())
      current.published_definition.layout[0].controls.push({
        id: `00000000-0000-4000-8000-00000000002${index}`,
        kind: 'builtin',
        builtin,
        width: 12,
      });
    return current;
  }
  it('reviews normalized positive stock, returns to edit, then submits exactly the new reviewed values', async () => {
    vi.mocked(submitInventory).mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'fixture',
      message: 'Fixture captured',
    });
    render(
      <MetadataForm
        {...props}
        item={undefined}
        locations={[destination]}
        forms={{ [categoryId]: completeForm() }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Cable first  ' },
    });
    fireEvent.change(screen.getByLabelText('Initial quantity'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Initial location'), {
      target: { value: destination.id },
    });
    fireEvent.change(screen.getByLabelText('Manufacturer'), {
      target: { value: '  Maker  ' },
    });
    fireEvent.change(screen.getByLabelText('Item code (SKU)'), {
      target: { value: '  CODE  ' },
    });
    fireEvent.change(screen.getByLabelText('Reorder threshold (optional)'), {
      target: { value: '0' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Review quantity item' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Review quantity item' }),
    ).toHaveFocus();
    let summary = screen.getByRole('region', { name: 'Metadata review' });
    expect(summary).toHaveTextContent('Cable first');
    expect(summary).toHaveTextContent('IT Closet / Drawer');
    expect(summary).toHaveTextContent('Starting count3');
    fireEvent.click(screen.getByText('Record details & custom answers'));
    expect(summary).toHaveTextContent('ManufacturerMaker');
    expect(summary).toHaveTextContent('Reorder threshold0');
    expect(summary).toHaveTextContent('Inspected · Default appliedNo');
    expect(submitInventory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveValue('  Cable first  ');
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Cable final  ' },
    });
    fireEvent.change(screen.getByLabelText('Initial quantity'), {
      target: { value: '4' },
    });
    expect(
      screen.queryByRole('region', { name: 'Metadata review' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Review quantity item' }),
    );
    summary = screen.getByRole('region', { name: 'Metadata review' });
    expect(summary).toHaveTextContent('Cable final');
    expect(summary).not.toHaveTextContent('Cable first');
    expect(summary).toHaveTextContent('Starting count4');
    fireEvent.click(screen.getByRole('button', { name: 'Add quantity item' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledOnce());
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      operation: 'quantity_create_v2',
      payload: {
        name: 'Cable final',
        manufacturer: 'Maker',
        initial_quantity: 4,
        initial_location_id: destination.id,
        item_code: 'CODE',
        reorder_threshold: 0,
        custom_patch: { set: { [fieldId]: false }, unset: [] },
      },
    });
  });
  it('reviews an explicitly cleared default separately and submits its omitted answer', async () => {
    vi.mocked(submitInventory).mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'fixture',
      message: 'Captured',
    });
    const definition = completeForm();
    definition.published_definition.fields[0].required = false;
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: definition }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cleared answer item' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear answer' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Review quantity item' }),
    );
    fireEvent.click(screen.getByText('Record details & custom answers'));
    expect(
      screen.getByRole('region', { name: 'Metadata review' }),
    ).toHaveTextContent('Cleared');
    fireEvent.click(screen.getByRole('button', { name: 'Add quantity item' }));
    await waitFor(() => expect(submitInventory).toHaveBeenCalledOnce());
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      payload: { custom_patch: { set: {}, unset: [] } },
    });
  });
  it('reviews zero initial stock without a fabricated destination', async () => {
    render(
      <MetadataForm
        {...props}
        item={undefined}
        locations={[destination]}
        forms={{ [categoryId]: completeForm() }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Empty item' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Review quantity item' }),
    );
    const summary = screen.getByRole('region', { name: 'Metadata review' });
    expect(summary).toHaveTextContent('Starting count0');
    expect(summary).toHaveTextContent(
      'No initial stock · no storage destination',
    );
    expect(summary).not.toHaveTextContent('IT Closet / Drawer');
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('shows asset tag normalization, preserved serial case and the same submitted intent', async () => {
    vi.mocked(submitInventory).mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'fixture',
      message: 'Fixture captured',
    });
    render(
      <MetadataForm
        {...props}
        kind="asset"
        item={undefined}
        locations={[destination]}
        forms={{ [categoryId]: completeForm('asset') }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Device  ' },
    });
    fireEvent.change(screen.getByLabelText('Current location'), {
      target: { value: destination.id },
    });
    fireEvent.change(screen.getByLabelText('Asset tag'), {
      target: { value: ' TAG-UPPER ' },
    });
    fireEvent.change(screen.getByLabelText('Serial number'), {
      target: { value: ' SerialCase ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Review individual asset' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Add individual asset' }),
      ).toBeEnabled(),
    );
    const summary = screen.getByRole('region', { name: 'Metadata review' });
    expect(summary).toHaveTextContent('tag-upper');
    expect(summary).toHaveTextContent('SerialCase');
    expect(summary).toHaveTextContent('1 individually tracked asset');
    fireEvent.click(
      screen.getByRole('button', { name: 'Add individual asset' }),
    );
    await waitFor(() => expect(submitInventory).toHaveBeenCalledOnce());
    expect(vi.mocked(submitInventory).mock.calls[0][0]).toMatchObject({
      operation: 'asset_create_v2',
      payload: {
        name: 'Device',
        asset_tag: 'tag-upper',
        serial_number: 'SerialCase',
        location_id: destination.id,
      },
    });
  });
  it('reviews site-opening equipment already there and dispatches the matching custody command', async () => {
    vi.mocked(submitCustody).mockResolvedValue({
      ok: false,
      code: 'fixture',
      message: 'Fixture captured',
    });
    render(
      <MetadataForm
        {...props}
        item={undefined}
        forms={{ [categoryId]: completeForm() }}
        openingSite={{
          id: secondRevision,
          name: 'Example site',
          code: 'EXAMPLE',
        }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Site cable  ' },
    });
    fireEvent.change(screen.getByLabelText('Units already at this site'), {
      target: { value: '2' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Review quantity item' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Review quantity item' }),
    ).toHaveFocus();
    const summary = screen.getByRole('region', { name: 'Metadata review' });
    expect(summary).toHaveTextContent('Example site');
    expect(summary).toHaveTextContent('Count already at site2');
    expect(summary).toHaveTextContent('Records equipment already at this site');
    fireEvent.click(screen.getByRole('button', { name: 'Add quantity item' }));
    await waitFor(() => expect(submitCustody).toHaveBeenCalledOnce());
    expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
      operation: 'quantity_site_open',
      payload: { name: 'Site cable', quantity: 2, site_id: secondRevision },
    });
    expect(submitInventory).not.toHaveBeenCalled();
  });
});

it('retains completed workspace metadata until explicit Done', async () => {
  vi.mocked(submitInventory).mockResolvedValue({
    ok: true,
    entityId: props.item.id,
    version: '2',
    changed: true,
  });
  render(
    <TaskWorkspace
      choices={[
        { id: 'metadata', label: 'Edit details' },
        { id: 'receive', label: 'Receive stock' },
      ]}
      context="Cable"
    >
      {() => <MetadataForm {...props} forms={{ [categoryId]: form() }} />}
    </TaskWorkspace>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Saved name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
  await screen.findByText('Details saved.');
  expect(screen.getByLabelText('Name')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Unsafe new intent' },
  });
  expect(screen.getByLabelText('Name')).toHaveValue('Saved name');
  expect(screen.getByRole('button', { name: 'Receive stock' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Review metadata' })).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Close task' })).toBeEnabled(),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.getByRole('button', { name: 'Receive stock' })).toBeEnabled();
  expect(submitInventory).toHaveBeenCalledOnce();
});

describe('existing edit recovery and review', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    vi.mocked(refreshMetadataRecord).mockResolvedValue({
      ok: true,
      record: item,
      form: form(),
      draftForm: form(),
    });
  });
  it.each(['quantity', 'asset'] as const)(
    'recovers dirty %s metadata through task unmount without adopting a stale baseline',
    async (kind) => {
      const current = form();
      current.published_definition.fields[0].applies_to = [kind];
      current.published_definition.fields[0].required = false;
      const asset = {
        ...item,
        assetTag: null,
        serialNumber: null,
        status: 'active' as const,
      };
      const entityProps =
        kind === 'quantity' ? { item } : { item: undefined, asset };
      const mount = (name?: string) => (
        <MetadataForm
          {...props}
          {...entityProps}
          kind={kind}
          forms={{ [categoryId]: current }}
          {...(name
            ? kind === 'quantity'
              ? { item: { ...item, name, version: 2 } }
              : { asset: { ...asset, name, version: 2 } }
            : {})}
        />
      );
      const first = render(mount());
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'My unsaved entry' },
      });
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('checkbox'));
      first.unmount();
      const second = render(mount('Changed elsewhere'));
      expect(screen.getByLabelText('Name')).toHaveValue('My unsaved entry');
      expect(screen.getByRole('checkbox')).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.getByText(/Name was changed elsewhere/)).toHaveTextContent(
        'Changed elsewhere',
      );
      expect(
        screen.getByRole('button', { name: 'Review metadata' }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Use my Name edit' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Review current details' }),
        ).toBeEnabled(),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Review current details' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
      expect(
        screen.getByRole('region', { name: 'Changed details' }),
      ).toHaveTextContent('Changed elsewhere → My unsaved entry');
      second.unmount();
      render(mount('Changed elsewhere'));
      expect(screen.queryByRole('button', { name: 'Confirm save' })).toBeNull();
      expect(screen.getByLabelText('Name')).toHaveValue('My unsaved entry');
      expect(submitInventory).not.toHaveBeenCalled();
    },
  );
  it('replays the identical unknown existing save after navigation and clears recovery only after acknowledgement', async () => {
    vi.mocked(submitInventory)
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({
        ok: true,
        entityId: item.id,
        version: '2',
        changed: true,
      });
    const first = render(
      <MetadataForm {...props} forms={{ [categoryId]: form() }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Unsure saved entry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeEnabled(),
    );
    const submitted = vi.mocked(submitInventory).mock.calls[0][0] as {
      requestId: string;
    };
    first.unmount();
    render(
      <MetadataForm
        {...props}
        item={{ ...item, version: 2, name: 'Unsure saved entry' }}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Unsure saved entry');
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const uncertainUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(uncertainUnload);
    expect(uncertainUnload.defaultPrevented).toBe(true);
    const acknowledgedUnload = new Event('beforeunload', { cancelable: true });
    vi.mocked(refreshMetadataRecord).mockImplementationOnce(async () => {
      window.dispatchEvent(acknowledgedUnload);
      return { ok: true, record: item, form: form(), draftForm: form() };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await screen.findByText('Details saved.');
    expect(acknowledgedUnload.defaultPrevented).toBe(false);
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(submitted);
    const raw = sessionStorage.getItem(sessionStorage.key(0)!)!;
    expect(JSON.parse(raw)).toMatchObject({
      status: 'saved',
      inputs: null,
      command: null,
      completedRequestId: submitted.requestId,
    });
    expect(screen.queryByRole('button', { name: 'Confirm save' })).toBeNull();
  });
  it.each(['Edit details', 'Review updated fields'])(
    'starts a new protected edit after recovered save through %s',
    async (reopen) => {
      const saved = {
        ...item,
        name: 'Saved recovered edit',
        version: 2,
        customValues: {
          [fieldId]: { value: false, validated_revision_id: firstRevision },
        },
      };
      const originalForms = { [categoryId]: form() };
      const first = render(<MetadataForm {...props} forms={originalForms} />);
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: saved.name },
      });
      fireEvent.click(screen.getByRole('checkbox'));
      first.unmount();
      const view = render(<MetadataForm {...props} forms={originalForms} />);
      vi.mocked(submitInventory).mockResolvedValue({
        ok: true,
        entityId: item.id,
        version: '2',
        changed: true,
      });
      vi.mocked(refreshMetadataRecord).mockResolvedValue({
        ok: true,
        record: saved,
        form: form(),
        draftForm: form(),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
      await screen.findByText('Details saved.');
      const key = Object.keys(sessionStorage).find((key) =>
        key.startsWith('inventory-metadata-edit-v1:'),
      )!;
      const completed = JSON.parse(sessionStorage.getItem(key)!);
      expect(completed.status).toBe('saved');
      const updated = { ...form(secondRevision), published_number: '2' };
      view.rerender(
        <MetadataForm
          {...props}
          item={saved}
          forms={{ [categoryId]: updated }}
        />,
      );
      await screen.findByRole('button', { name: 'Review updated fields' });
      fireEvent.click(screen.getByRole('button', { name: reopen }));
      await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled());
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'New unsaved edit' },
      });
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      const editing = JSON.parse(sessionStorage.getItem(key)!);
      expect(editing).toMatchObject({
        status: 'editing',
        completedRequestId: null,
        baseline: { id: item.id, version: 2 },
        inputs: { core: { name: 'New unsaved edit' } },
      });
      expect(editing.instance).not.toBe(completed.instance);
      fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
      await waitFor(() => expect(submitInventory).toHaveBeenCalledTimes(2));
      expect(vi.mocked(submitInventory).mock.calls[1][0]).toMatchObject({
        payload: {
          expected_version: 2,
          expected_published_revision_id: secondRevision,
          name: 'New unsaved edit',
        },
      });
    },
  );
  it('keeps Stay entries and explicit workspace discard clears only the owning edit draft', async () => {
    const workspace = () => (
      <TaskWorkspace
        choices={[
          { id: 'metadata', label: 'Edit details' },
          { id: 'other', label: 'Other task' },
        ]}
        context="Cable"
      >
        {() => <MetadataForm {...props} forms={{ [categoryId]: form() }} />}
      </TaskWorkspace>
    );
    const first = render(workspace());
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Recovered task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Stay with this task' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Recovered task');
    first.unmount();
    render(workspace());
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Recovered task');
    sessionStorage.setItem('unrelated-task', 'keep');
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Cable');
    expect(sessionStorage.getItem('unrelated-task')).toBe('keep');
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('hides drafts after actor/environment changes and keeps isolated new mounts clean', () => {
    const first = render(
      <MetadataForm {...props} forms={{ [categoryId]: form() }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Private original draft' },
    });
    first.rerender(
      <MetadataForm
        {...props}
        actorId={secondRevision}
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.queryByDisplayValue('Private original draft')).toBeNull();
    first.unmount();
    const other = render(
      <MetadataForm
        {...props}
        recoveryBackend="https://other-backend.test"
        forms={{ [categoryId]: form() }}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Cable');
    other.unmount();
    render(<MetadataForm {...props} forms={{ [categoryId]: form() }} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Private original draft');
  });
  it('keeps in-memory work when recovery storage fails and resumes safe dispatch when it recovers', async () => {
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota');
      });
    vi.mocked(submitInventory).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '2',
      changed: true,
    });
    render(<MetadataForm {...props} forms={{ [categoryId]: form() }} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Held in memory' },
    });
    expect(screen.getByLabelText('Name')).toHaveValue('Held in memory');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Recovery storage is unavailable or full',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    expect(submitInventory).not.toHaveBeenCalled();
    storage.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await screen.findByText('Details saved.');
    expect(submitInventory).toHaveBeenCalledOnce();
  });
  it('opens more than 32 pristine edit tasks without allocating durable entries', () => {
    for (let n = 100; n < 140; n++) {
      const mounted = render(
        <MetadataForm
          {...props}
          item={{
            ...item,
            id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
          }}
          forms={{ [categoryId]: form() }}
        />,
      );
      expect(screen.getByLabelText('Name')).toHaveValue('Cable');
      mounted.unmount();
    }
    expect(sessionStorage.length).toBe(0);
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('guards client links after storage failure, preserves modifiers/new tabs, and allows explicit Stay or discard', () => {
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota');
      });
    const navigation = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault(),
    );
    render(
      <>
        <Link href="/inventory?category=parts" onClick={navigation}>
          Back to results
        </Link>
        <Link href="/sites" target="_blank" onClick={navigation}>
          Sites new tab
        </Link>
        <MetadataForm {...props} forms={{ [categoryId]: form() }} />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Only in memory' },
    });
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      fireEvent.click(screen.getByRole('link', { name: 'Back to results' }), {
        [modifier]: true,
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    fireEvent.click(screen.getByRole('link', { name: 'Sites new tab' }));
    expect(navigation).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    expect(navigation).toHaveBeenCalledTimes(5);
    expect(
      screen.getByRole('dialog', { name: 'Leave this edit?' }),
    ).toHaveTextContent('Leaving will discard');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Only in memory');
    expect(screen.getByRole('link', { name: 'Back to results' })).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(push).toHaveBeenCalledWith('/inventory?category=parts');
    expect(sessionStorage.length).toBe(0);
    expect(submitInventory).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('allows healthy-storage internal navigation and restores the exact draft after returning', () => {
    const navigation = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault(),
    );
    const first = render(
      <>
        <Link href="/sites" onClick={navigation}>
          Sites
        </Link>
        <MetadataForm {...props} forms={{ [categoryId]: form() }} />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Durable navigation entry' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Sites' }));
    expect(navigation).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    const raw = sessionStorage.getItem(sessionStorage.key(0)!);
    first.unmount();
    render(<MetadataForm {...props} forms={{ [categoryId]: form() }} />);
    fireEvent(window, new Event('pageshow'));
    expect(screen.getByLabelText('Name')).toHaveValue(
      'Durable navigation entry',
    );
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(raw);
    expect(submitInventory).not.toHaveBeenCalled();
  });
  it('guards incomplete raw datetime entries when storage fails before an answer can be parsed', () => {
    const current = form();
    current.published_definition.fields[0] = {
      ...current.published_definition.fields[0],
      type: 'datetime',
      required: false,
      label: 'Observed at',
    };
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota');
      });
    render(
      <>
        <Link href="/sites" onClick={(event) => event.preventDefault()}>
          Sites
        </Link>
        <MetadataForm {...props} forms={{ [categoryId]: current }} />
      </>,
    );
    expect(sessionStorage.length).toBe(0);
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-10-03' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Sites' }));
    expect(
      screen.getByRole('dialog', { name: 'Leave this edit?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-03');
    expect(screen.getByLabelText('Time')).toHaveValue('');
    expect(push).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('can explicitly discard only its older durable editing snapshot when the latest entries cannot be stored', () => {
    render(
      <>
        <Link href="/sites" onClick={(event) => event.preventDefault()}>
          Sites
        </Link>
        <MetadataForm {...props} forms={{ [categoryId]: form() }} />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Older durable name' },
    });
    expect(sessionStorage.length).toBe(1);
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota');
      });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Latest memory name' },
    });
    expect(screen.getByLabelText('Name')).toHaveValue('Latest memory name');
    fireEvent.click(screen.getByRole('link', { name: 'Sites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(push).toHaveBeenCalledWith('/sites');
    expect(sessionStorage.length).toBe(0);
    expect(submitInventory).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('does not discard an uncertain exact command when the terminal receipt cannot be stored', async () => {
    const original = Storage.prototype.setItem;
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, raw) {
        if (JSON.parse(raw).status === 'saved') throw new DOMException('quota');
        original.call(this, key, raw);
      });
    vi.mocked(submitInventory).mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '2',
      changed: true,
    });
    render(
      <>
        <Link href="/sites" onClick={(event) => event.preventDefault()}>
          Sites
        </Link>
        <MetadataForm {...props} forms={{ [categoryId]: form() }} />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Possibly saved' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry same save' }),
      ).toBeEnabled(),
    );
    const command = vi.mocked(submitInventory).mock.calls[0][0];
    fireEvent.click(screen.getByRole('link', { name: 'Sites' }));
    expect(
      screen.getByRole('dialog', { name: 'Leave this edit?' }),
    ).toHaveTextContent('retry the same save');
    expect(
      screen.queryByRole('button', { name: 'Discard changes' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(push).not.toHaveBeenCalled();
    expect(
      JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).status,
    ).toBe('submitted');
    storage.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
    await screen.findByText('Details saved.');
    expect(vi.mocked(submitInventory).mock.calls[1][0]).toEqual(command);
  });
  it('shows normalized changes, retains hidden untouched values, and invalidates review after editing', () => {
    const current = form();
    current.published_definition.layout[0].controls.push({
      id: secondRevision,
      kind: 'builtin',
      builtin: 'manufacturer',
      width: 'Auto',
    });
    render(
      <MetadataForm
        {...props}
        item={{
          ...item,
          manufacturer: 'Old maker',
          customValues: {
            [fieldId]: { value: false, validated_revision_id: firstRevision },
          },
        }}
        forms={{ [categoryId]: current }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Manufacturer'), {
      target: { value: ' New maker ' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Review metadata' }));
    expect(
      screen.getByRole('region', { name: 'Changed details' }),
    ).toHaveTextContent('Old maker → New maker');
    expect(
      screen.getByRole('region', { name: 'Changed details' }),
    ).toHaveTextContent('No → Yes');
    fireEvent.change(screen.getByLabelText('Manufacturer'), {
      target: { value: 'Further edit' },
    });
    expect(
      screen.queryByRole('region', { name: 'Changed details' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm save' })).toBeNull();
  });
});

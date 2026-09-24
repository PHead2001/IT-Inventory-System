import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MetadataSettings } from './metadata-settings';
import {
  submitMetadataDraft,
  reviewMetadataPublish,
  verifyMetadataDesignerIdentity,
} from './actions';
import type { MetadataForm } from './contracts';
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
  verifyMetadataDesignerIdentity: vi.fn(),
}));
vi.mock('./metadata-form', () => ({
  MetadataFormPreview: () => <div>Shared live preview</div>,
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
    vi.mocked(submitMetadataDraft).mockReset();
    vi.mocked(reviewMetadataPublish).mockReset();
    vi.mocked(verifyMetadataDesignerIdentity).mockReset();
    vi.mocked(verifyMetadataDesignerIdentity).mockResolvedValue({ ok: true });
  });
  it('keeps stable IDs through local edits and saves a semantic-invalid draft without publishing it', async () => {
    vi.mocked(submitMetadataDraft).mockResolvedValue({
      ok: true,
      data: { version: '1', draft_id: id(11) },
    });
    mount();
    expect(screen.getByText('Shared live preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const stableId = screen.getByText(/Stable ID:/).textContent?.split(': ')[1];
    expect(stableId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A field needs a label',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(submitMetadataDraft).toHaveBeenCalled());
    const call = vi.mocked(submitMetadataDraft).mock.calls[0][0];
    expect(call.payload.expected_draft_version).toBe('0');
    expect(call.payload.expected_draft_id).toBeNull();
    expect(call.payload.expected_actor_id).toBe(id(50));
    expect(call.expectedActorId).toBe(id(50));
    expect(
      (call.payload.definition as MetadataForm['published_definition'])
        .fields[0].id,
    ).toBe(stableId);
    expect(
      screen.getByRole('button', { name: 'Review publish impact' }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(readDesignerRecovery(id(50), id(1)).item).toBeNull(),
    );
  });
  it('preserves entered data and original draft baseline after a stale save response', async () => {
    vi.mocked(submitMetadataDraft).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Stale draft.'),
    );
    expect(screen.getByLabelText('Label')).toHaveValue('Connector');
    expect(screen.getByText(/Draft version none/)).toBeInTheDocument();
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
    expect(screen.getByText(/Unsaved edits/)).toBeInTheDocument();
    confirm.mockRestore();
  });
  it('locks the category during an in-flight draft save and binds its response to the original category', async () => {
    let finish!: (
      result: Awaited<ReturnType<typeof submitMetadataDraft>>,
    ) => void;
    vi.mocked(submitMetadataDraft).mockImplementation(
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
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    const category = screen.getByLabelText('Category');
    expect(category).toBeDisabled();
    fireEvent.change(category, { target: { value: id(20) } });
    expect(category).toHaveValue(id(1));
    finish({ ok: true, data: { version: '1', draft_id: id(11) } });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Draft saved'),
    );
    expect(category).toHaveValue(id(1));
    expect(screen.getByLabelText('Label')).toHaveValue('Connector');
    expect(
      vi.mocked(submitMetadataDraft).mock.calls[0][0].payload.category_id,
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
    expect(screen.getByText(/Draft version none/)).toBeInTheDocument();
    vi.mocked(submitMetadataDraft).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(submitMetadataDraft).toHaveBeenCalled());
    expect(
      vi.mocked(submitMetadataDraft).mock.calls[0][0].payload
        .expected_draft_version,
    ).toBe('0');
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
    const identities = screen
      .getAllByText(/Stable ID:/)
      .map((element) => element.textContent);
    expect(identities).toHaveLength(2);
    expect(identities[0]).toBe(first);
    expect(identities[1]).not.toBe(first);
    expect(
      screen.getByText(/Untitled field replacement · Integer/),
    ).toBeInTheDocument();
  });
  it('publishes only after saving and reviewing the returned version and published pointer', async () => {
    vi.mocked(submitMetadataDraft)
      .mockResolvedValueOnce({
        ok: true,
        data: { version: '1', draft_id: id(11) },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { version: '2', published_revision_id: id(9) },
      });
    vi.mocked(reviewMetadataPublish).mockResolvedValue({
      ok: true,
      review: {
        token: id(10),
        category_id: id(1),
        draft_id: id(11),
        draft_version: '1',
        published_revision_id: id(2),
        affected_quantity: '3',
        affected_assets: '2',
        expires_at: '2026-09-24T20:00:00Z',
      },
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Connector' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review publish impact' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Review publish impact' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Form publication impact' }),
      ).toHaveTextContent('3 quantity definitions'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish reviewed revision' }),
    );
    await waitFor(() => expect(submitMetadataDraft).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(submitMetadataDraft).mock.calls[1][0].payload,
    ).toMatchObject({
      expected_draft_version: '1',
      expected_draft_id: id(11),
      expected_published_revision_id: id(2),
      expected_actor_id: id(50),
      review_token: id(10),
    });
  });
  it('rejects a deferred review for a newer draft while retaining the original baseline', async () => {
    const draftForm = {
      ...form,
      draft_id: id(11),
      draft_version: '1',
      draft_definition: form.published_definition,
    };
    let finish!: (
      value: Awaited<ReturnType<typeof reviewMetadataPublish>>,
    ) => void;
    vi.mocked(reviewMetadataPublish).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MetadataSettings
        memberId={id(50)}
        categories={[{ id: id(1), name: 'Cables', active: true }]}
        forms={{ [id(1)]: draftForm }}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Review publish impact' }),
    );
    expect(vi.mocked(reviewMetadataPublish).mock.calls[0][0]).toMatchObject({
      expectedActorId: id(50),
      expectedDraftId: id(11),
      expectedDraftVersion: '1',
      expectedPublishedRevisionId: id(2),
    });
    finish({
      ok: true,
      review: {
        token: id(12),
        category_id: id(1),
        draft_id: id(13),
        draft_version: '2',
        published_revision_id: id(2),
        affected_quantity: '1',
        affected_assets: '0',
        expires_at: '2026-09-24T20:00:00Z',
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'server draft changed during review',
      ),
    );
    expect(
      screen.queryByRole('region', { name: 'Form publication impact' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Draft version 1/)).toBeInTheDocument();
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
    vi.mocked(submitMetadataDraft).mockResolvedValue({
      ok: false,
      code: 'P1002',
      message: 'Stale draft.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(submitMetadataDraft).toHaveBeenCalled());
    expect(
      vi.mocked(submitMetadataDraft).mock.calls[0][0].payload,
    ).toMatchObject({ expected_draft_id: id(11), expected_draft_version: '1' });
  });
  it('masks the old editor on focus until fresh actor verification succeeds', async () => {
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
      screen.getByText('Checking configuration access…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
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
      screen.queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
  });
  it('masks the editor after a fresh action rejects the original actor', async () => {
    vi.mocked(submitMetadataDraft).mockResolvedValue({
      ok: false,
      code: 'P1001',
      message: 'Actor changed.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(
        screen.getByText(/Configuration access changed/),
      ).toBeInTheDocument(),
    );
    expect(
      vi.mocked(submitMetadataDraft).mock.calls[0][0].expectedActorId,
    ).toBe(id(50));
    expect(
      screen.queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
  });
});

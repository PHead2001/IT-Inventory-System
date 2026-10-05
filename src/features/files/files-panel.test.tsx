import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetch: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: mocks.rpc,
    storage: {
      from: () => ({ upload: mocks.upload, download: mocks.download }),
    },
  }),
}));

import { FilesPanel } from './files-panel';

const id = '00000000-0000-4000-8000-000000000001';
const pending = {
  id,
  name: 'Fictional damaged image',
  filename: 'damaged.png',
  uploader: 'IT staff',
  ready_at: null,
  type: 'image/png',
  bytes: 20,
  purpose: 'asset_photo',
  state: 'uploaded',
  created_at: '2026-09-25T00:00:00Z',
  version: '1',
  replaces_file_id: null,
  reviewed_replaced_file_version: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({ data: { path: 's/fixture' }, error: null });
  let cancelled = false;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'inventory_file_cancel') {
      cancelled = true;
      return { data: { changed: true }, error: null };
    }
    if (name === 'inventory_file_cards')
      return {
        data: { revision: '1', files: cancelled ? [] : [pending] },
        error: null,
      };
    if (name === 'inventory_file_history')
      return { data: { rows: [], has_more: false }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ deleted: 1, pending: false }),
  });
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('fresh native picker intent', () => {
  const first = {
    ...pending,
    state: 'ready',
    purpose: 'asset_photo',
    version: '3',
  };
  const second = {
    ...first,
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Second photo',
    version: '5',
  };
  const image = (name: string) =>
    new File(['fresh fictional bytes'], name, { type: 'image/png' });
  function configure(files: (typeof first)[]) {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return { data: { revision: '9', files }, error: null };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_read')
        return {
          data: null,
          error: { message: 'No thumbnail in this picker test' },
        };
      if (name === 'inventory_file_reserve')
        return {
          data: { id: '00000000-0000-4000-8000-000000000003', path: 's/fresh' },
          error: null,
        };
      if (name === 'inventory_file_uploaded') return { data: {}, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Fictional validation rejection' }),
    });
  }
  it.each([
    {
      kind: 'asset' as const,
      cards: [first, second],
      action: 'Add attachment',
      index: 0,
      target: '',
    },
    {
      kind: 'quantity' as const,
      cards: [],
      action: 'Add photo',
      index: 0,
      target: '',
    },
    {
      kind: 'quantity' as const,
      cards: [{ ...first, purpose: 'quantity_photo' }],
      action: 'Replace photo',
      index: 0,
      target: first.id,
    },
    {
      kind: 'asset' as const,
      cards: [first, second],
      action: 'Replace',
      index: 0,
      target: first.id,
    },
    {
      kind: 'asset' as const,
      cards: [first, second],
      action: 'Replace',
      index: 1,
      target: second.id,
    },
  ])(
    'clears old bytes before $kind $action picker, including cancel without a change event',
    async ({ kind, cards, action, index, target }) => {
      const user = userEvent.setup();
      configure(cards);
      render(
        <FilesPanel
          actorId="actor-a"
          parentType={kind}
          parentId={id}
          active
          staff
        />,
      );
      await screen.findByRole('button', {
        name:
          kind === 'quantity'
            ? cards.length
              ? 'Replace photo'
              : 'Add photo'
            : 'Add attachment',
      });
      const input = screen.getByLabelText(
        kind === 'quantity' ? 'Add recognition photo' : 'Add photo or PDF',
      ) as HTMLInputElement;
      if (cards.length)
        fireEvent.change(screen.getByLabelText('Replace a ready file'), {
          target: { value: first.id },
        });
      await user.upload(input, image('old-staged.png'));
      expect(input.value).not.toBe('');
      expect(
        screen.getByRole('button', { name: 'Upload and review' }),
      ).toBeEnabled();
      await user.click(screen.getAllByRole('button', { name: action })[index]);
      // Cancel/no-change: a new picker intent must not reuse the prior native selection.
      expect(input.value).toBe('');
      expect(input.files).toHaveLength(0);
      if (cards.length)
        expect(screen.getByLabelText('Replace a ready file')).toHaveValue(
          target,
        );
      expect(
        screen.getByRole('button', { name: 'Upload and review' }),
      ).toBeDisabled();
      expect(
        mocks.rpc.mock.calls.filter(
          ([name]) => name === 'inventory_file_reserve',
        ),
      ).toHaveLength(0);
      expect(mocks.upload).not.toHaveBeenCalled();
      const fresh = image('fresh-selection.png');
      await user.upload(input, fresh);
      await user.click(
        screen.getByRole('button', { name: 'Upload and review' }),
      );
      await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
      expect(mocks.upload.mock.calls[0][1]).toBe(fresh);
      expect(mocks.rpc).toHaveBeenCalledWith(
        'inventory_file_reserve',
        expect.objectContaining({
          p_name: fresh.name,
          p_bytes: fresh.size,
          p_replaces: target || null,
          p_expected_file_version:
            target === first.id ? '3' : target === second.id ? '5' : null,
          p_expected_revision: '9',
        }),
      );
      await screen.findByText('Fictional validation rejection');
    },
  );

  it('keeps staged bytes when the visible replacement dropdown deliberately reviews another target', async () => {
    const user = userEvent.setup();
    configure([first, second]);
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    await screen.findByRole('button', { name: 'Add attachment' });
    const fresh = image('reviewed-selection.png');
    await user.upload(screen.getByLabelText('Add photo or PDF'), fresh);
    await user.selectOptions(
      screen.getByLabelText('Replace a ready file'),
      second.id,
    );
    expect(
      screen.getByRole('button', { name: 'Upload and review' }),
    ).toBeEnabled();
    expect(mocks.upload).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Upload and review' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload.mock.calls[0][1]).toBe(fresh);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'inventory_file_reserve',
      expect.objectContaining({
        p_replaces: second.id,
        p_expected_file_version: '5',
      }),
    );
    await screen.findByText('Fictional validation rejection');
  });
});

describe('terminal file cancellation cleanup', () => {
  it('describes only supported photo formats for quantity records', () => {
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="quantity"
        parentId={id}
        active
        staff
      />,
    );
    const files = screen.getByRole('region', { name: 'Inventory files' });
    expect(files).toHaveTextContent('JPEG, PNG or still WebP');
    expect(files).not.toHaveTextContent('PDF');
    expect(screen.getByLabelText('Add recognition photo')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
  });
  it('keeps a full-width metadata row and a separate wrapping action row for a ready file', async () => {
    const longName =
      'Fictional recognition photo with a readable descriptive filename';
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return {
          data: {
            revision: '2',
            files: [
              {
                ...pending,
                name: longName,
                filename: 'first.png',
                state: 'ready',
              },
            ],
          },
          error: null,
        };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_read')
        return { data: null, error: { code: 'P1010', message: 'not found' } };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    const title = (await screen.findAllByText(longName)).find(
      (element) => element.tagName === 'P',
    );
    expect(title).toBeDefined();
    const row = title?.closest('li');
    expect(row).not.toBeNull();
    expect(row).toHaveClass('flex-col');
    expect(row?.firstElementChild).toHaveClass('min-w-0');
    expect(row?.firstElementChild?.firstElementChild).toHaveClass('w-16');
    expect(row?.lastElementChild).toHaveClass('w-full', 'flex-wrap');
    expect(row?.lastElementChild).toHaveTextContent('View photo');
    expect(row?.lastElementChild).toHaveTextContent('Remove');
  });

  it('shows a cleanup retry after terminal validation rejection', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        message: 'Invalid file content.',
        terminalRejected: true,
        cleanupPending: true,
        cleanupDeleted: 0,
      }),
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(
      await screen.findByRole('button', {
        name: 'Retry file cleanup',
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid file content. Deleted 0 stored objects. Remaining cleanup is unverified',
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith('inventory_file_cancel', {
      p_file_id: id,
    });
  });

  it('requests bounded cleanup after cancellation', async () => {
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('inventory_file_cancel', {
        p_file_id: id,
      });
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/inventory-files/cleanup',
        expect.objectContaining({
          method: 'POST',
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  it('keeps the successful publish visible when cleanup fails instead of reloading away the retry', async () => {
    let ready = false;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return {
          data: {
            revision: ready ? '2' : '1',
            files: [
              ready
                ? {
                    ...pending,
                    state: 'ready',
                    type: 'application/pdf',
                    filename: 'manual.pdf',
                  }
                : pending,
            ],
          },
          error: null,
        };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/validate')) {
        ready = true;
        return { ok: true, json: async () => ({ result: {} }) };
      }
      throw new Error('Provider unavailable');
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(
      await screen.findByRole('button', {
        name: 'Retry file cleanup',
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'File published. Byte cleanup could not be confirmed',
    );
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('shows the published file and confirmation while best-effort cleanup is still pending', async () => {
    let ready = false;
    const published = {
      ...pending,
      name: 'Published manual',
      filename: 'manual.pdf',
      type: 'application/pdf',
      purpose: 'asset_document',
      state: 'ready',
    };
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return {
          data: {
            revision: ready ? '2' : '1',
            files: [ready ? published : pending],
          },
          error: null,
        };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    let completeCleanup!: (result: unknown) => void;
    const cleanup = new Promise((resolve) => {
      completeCleanup = resolve;
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/validate')) {
        ready = true;
        return { ok: true, json: async () => ({ result: { changed: true } }) };
      }
      return cleanup;
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Download PDF' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'File published. Checking byte cleanup',
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/inventory-files/cleanup',
      expect.objectContaining({ method: 'POST' }),
    );
    completeCleanup({
      ok: true,
      json: async () => ({ deleted: 1, pending: true }),
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'File published. Deleted 1 stored object. Remaining cleanup is unverified',
      ),
    );
  });

  it('removes a file from the visible cards before waiting for byte cleanup', async () => {
    let removed = false;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return {
          data: {
            revision: removed ? '2' : '1',
            files: removed
              ? []
              : [
                  {
                    ...pending,
                    state: 'ready',
                    type: 'application/pdf',
                    filename: 'manual.pdf',
                  },
                ],
          },
          error: null,
        };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_remove') {
        removed = true;
        return { data: { changed: true }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    let completeCleanup!: (result: unknown) => void;
    const cleanup = new Promise((resolve) => {
      completeCleanup = resolve;
    });
    mocks.fetch.mockReturnValue(cleanup);
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Download PDF' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'File removed. Checking byte cleanup',
    );
    completeCleanup({
      ok: true,
      json: async () => ({ deleted: 0, pending: true }),
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'File removed. Deleted 0 stored objects. Remaining cleanup is unverified',
      ),
    );
  });

  it('keeps a retry visible when cancellation precedes validation grace', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: 0, pending: false }),
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('button', {
        name: 'Retry file cleanup',
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Deleted 0 stored objects. Remaining cleanup is unverified',
    );
  });

  it('offers an explicit retry after cleanup failure without claiming completion', async () => {
    mocks.fetch
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: 1, pending: false }),
      });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const retry = await screen.findByRole('button', {
      name: 'Retry file cleanup',
      hidden: true,
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /cleanup could not be confirmed/i,
    );
    fireEvent.click(screen.getByText(/File activity/));
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'Retry file cleanup',
          hidden: true,
        }),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Deleted 1 stored object. Remaining cleanup is unverified',
      ),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('replacement selection and reviewed upload intent', () => {
  const original = {
    ...pending,
    id: '00000000-0000-4000-8000-000000000011',
    name: 'Original manual',
    filename: 'original.pdf',
    type: 'application/pdf',
    purpose: 'asset_document',
    state: 'ready',
    version: '3',
  };
  const replacement = {
    ...original,
    id: '00000000-0000-4000-8000-000000000012',
    name: 'Replacement manual',
    filename: 'replacement.pdf',
    version: '1',
  };
  const file = (name: string) =>
    new File(['%PDF-fictitious'], name, { type: 'application/pdf' });

  it('clears only the confirmed replacement selection so a later add does not reuse the removed ID', async () => {
    let visible = [original];
    let revision = '1';
    let validations = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return { data: { revision, files: visible }, error: null };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_reserve')
        return {
          data: { id: pending.id, path: 's/fictional-reservation' },
          error: null,
        };
      if (name === 'inventory_file_uploaded')
        return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/validate')) {
        validations++;
        revision = String(validations + 1);
        visible =
          validations === 1
            ? [replacement]
            : [
                replacement,
                {
                  ...replacement,
                  id: pending.id,
                  filename: 'extra.pdf',
                  name: 'Extra',
                },
              ];
        return { ok: true, json: async () => ({ result: { changed: true } }) };
      }
      return { ok: true, json: async () => ({ deleted: 0, pending: true }) };
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    const choice = await screen.findByLabelText('Replace a ready file');
    fireEvent.change(choice, { target: { value: original.id } });
    fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
      target: { files: [file('replacement.pdf')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and review' }));
    await waitFor(() => expect(choice).toHaveValue(''));
    expect(screen.getAllByText('Replacement manual')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
      target: { files: [file('extra.pdf')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and review' }));
    await waitFor(() => expect(screen.getAllByText('Extra')).toHaveLength(2));
    const reservations = mocks.rpc.mock.calls.filter(
      (call) => call[0] === 'inventory_file_reserve',
    );
    expect(reservations[0][1]).toMatchObject({
      p_replaces: original.id,
      p_expected_file_version: '3',
    });
    expect(reservations[1][1]).toMatchObject({
      p_replaces: null,
      p_expected_file_version: null,
    });
  });

  it('retains failed publish intent and blocks a missing reviewed target until explicitly reselected', async () => {
    let visible = [original];
    let refreshed = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards') {
        refreshed++;
        return {
          data: { revision: String(refreshed), files: visible },
          error: null,
        };
      }
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_reserve')
        return {
          data: { id: pending.id, path: 's/fictional-reservation' },
          error: null,
        };
      if (name === 'inventory_file_uploaded')
        return { data: null, error: null };
      if (name === 'inventory_file_cancel') {
        visible = [];
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/validate')) {
        visible = [original, { ...pending, filename: 'replacement.pdf' }];
        return {
          ok: false,
          json: async () => ({ message: 'Files changed. Review again.' }),
        };
      }
      return { ok: true, json: async () => ({ deleted: 0, pending: true }) };
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    const choice = await screen.findByLabelText('Replace a ready file');
    fireEvent.change(choice, { target: { value: original.id } });
    fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
      target: { files: [file('replacement.pdf')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and review' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Files changed'),
    );
    expect(choice).toHaveValue(original.id);
    // Cancel the staged upload after the reviewed file disappears elsewhere.
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByText(/selected replacement is unavailable/i),
    ).toBeVisible();
    expect(choice).toHaveValue(original.id);
    fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
      target: { files: [file('new.pdf')] },
    });
    expect(
      screen.getByRole('button', { name: 'Upload and review' }),
    ).toBeDisabled();
    fireEvent.change(choice, { target: { value: '' } });
    expect(
      screen.getByRole('button', { name: 'Upload and review' }),
    ).toBeEnabled();
  });

  it('retries uploaded confirmation on the original reservation without reuploading or silently publishing', async () => {
    const reserved = {
      ...pending,
      filename: 'replacement.pdf',
      state: 'reserved',
      replaces_file_id: original.id,
      reviewed_replaced_file_version: '3',
    };
    let visible: Array<typeof original | typeof reserved> = [original];
    let confirmations = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return { data: { revision: '7', files: visible }, error: null };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_reserve') {
        visible = [original, reserved];
        return {
          data: { id: reserved.id, path: 's/original-immutable-reservation' },
          error: null,
        };
      }
      if (name === 'inventory_file_uploaded') {
        confirmations++;
        if (confirmations === 1)
          return {
            data: null,
            error: { code: 'PGRST000', message: 'Temporary connection loss' },
          };
        visible = [original, { ...reserved, state: 'uploaded' }];
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/validate'))
        return { ok: true, json: async () => ({ result: {} }) };
      return { ok: true, json: async () => ({ deleted: 0 }) };
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    const choice = await screen.findByLabelText('Replace a ready file');
    fireEvent.change(choice, { target: { value: original.id } });
    fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
      target: { files: [file('replacement.pdf')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and review' }));
    const confirm = await screen.findByRole('button', {
      name: 'Confirm uploaded bytes',
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(
      screen.getByRole('button', { name: 'Upload and review' }),
    ).toBeDisabled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    expect(
      await screen.findByRole('button', { name: 'Review and publish' }),
    ).toBeVisible();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'inventory_file_uploaded',
      ),
    ).toEqual([
      ['inventory_file_uploaded', { p_file_id: reserved.id }],
      ['inventory_file_uploaded', { p_file_id: reserved.id }],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Review and publish' }));
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/inventory-files/validate',
        expect.objectContaining({
          body: expect.stringContaining('"expectedFileVersion":"3"'),
        }),
      ),
    );
    const validation = mocks.fetch.mock.calls.find(([url]) =>
      String(url).includes('/validate'),
    );
    expect(JSON.parse(validation?.[1].body)).toMatchObject({
      fileId: reserved.id,
      expectedRevision: '7',
      expectedFileVersion: '3',
    });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('accepts an ambiguous confirmation only after a fresh uploaded card proves it committed', async () => {
    let visible = [{ ...pending, state: 'reserved' }];
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return { data: { revision: '1', files: visible }, error: null };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_uploaded') {
        visible = [{ ...pending, state: 'uploaded' }];
        throw new Error('Response lost after commit');
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm uploaded bytes' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Review and publish' }),
    ).toBeVisible();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('blocks a changed replacement version instead of using the latest version', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return {
          data: {
            revision: '8',
            files: [
              { ...original, version: '4' },
              {
                ...pending,
                state: 'uploaded',
                replaces_file_id: original.id,
                reviewed_replaced_file_version: '3',
              },
            ],
          },
          error: null,
        };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'reviewed replacement target changed',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('task-first file presentation', () => {
  it.each(['quantity', 'asset'] as const)(
    'keeps an empty %s collection out of the active upload and refresh states',
    async (parentType) => {
      let releaseValidation!: () => void;
      const validation = new Promise<void>((resolve) => {
        releaseValidation = resolve;
      });
      let releaseRefresh!: () => void;
      const refresh = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      let cardReads = 0;
      const published = {
        ...pending,
        name: 'first.png',
        filename: 'first.png',
        state: 'ready',
      };
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === 'inventory_file_cards') {
          if (++cardReads === 1)
            return { data: { revision: '1', files: [] }, error: null };
          await refresh;
          return {
            data: { revision: '2', files: [published] },
            error: null,
          };
        }
        if (name === 'inventory_file_history')
          return { data: { rows: [], has_more: false }, error: null };
        if (name === 'inventory_file_reserve')
          return {
            data: { id, path: 's/fictional-reservation' },
            error: null,
          };
        if (name === 'inventory_file_uploaded')
          return { data: null, error: null };
        if (name === 'inventory_file_read')
          return { data: null, error: { message: 'Unavailable' } };
        throw new Error(`Unexpected RPC: ${name}`);
      });
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.includes('/validate')) {
          await validation;
          return { ok: true, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({ deleted: 0, pending: false }),
        };
      });
      render(
        <FilesPanel
          actorId="actor-a"
          parentType={parentType}
          parentId={id}
          active
          staff
        />,
      );
      const empty =
        parentType === 'quantity' ? 'No photo yet.' : 'No attachments yet.';
      expect(await screen.findByText(empty)).toBeVisible();
      fireEvent.change(
        screen.getByLabelText(
          parentType === 'quantity'
            ? 'Add recognition photo'
            : 'Add photo or PDF',
        ),
        {
          target: {
            files: [
              new File(['fictional photo'], 'first.png', { type: 'image/png' }),
            ],
          },
        },
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Upload and review' }),
      );
      try {
        await waitFor(() =>
          expect(mocks.fetch).toHaveBeenCalledWith(
            '/api/inventory-files/validate',
            expect.any(Object),
          ),
        );
        expect(screen.getByText('File request in progress…')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
        expect(screen.queryByText(empty)).not.toBeInTheDocument();
        await act(async () => releaseValidation());
        await waitFor(() => expect(cardReads).toBe(2));
        expect(screen.getByText('File request in progress…')).toBeVisible();
        expect(screen.queryByText(empty)).not.toBeInTheDocument();
      } finally {
        await act(async () => {
          releaseValidation();
          releaseRefresh();
        });
      }
      expect(await screen.findByText('Ready')).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent('File published.');
      expect(screen.queryByText(empty)).not.toBeInTheDocument();
      expect(
        screen.queryByText('File request in progress…'),
      ).not.toBeInTheDocument();
    },
  );
  it('shows pending review as a next step rather than an empty ready collection', async () => {
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="quantity"
        parentId={id}
        active
        staff
      />,
    );
    expect(await screen.findByText('Uploaded · review required')).toBeVisible();
    expect(screen.queryByText('No ready files yet.')).not.toBeInTheDocument();
    expect(screen.getByText(/20 B/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Review and publish' }),
    ).toBeEnabled();
  });
});

describe('file state and role fixtures', () => {
  function show(files: Array<Record<string, unknown>>, historyError = false) {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return { data: { revision: '2', files }, error: null };
      if (name === 'inventory_file_history')
        return {
          data: { rows: [], has_more: false },
          error: historyError ? { message: 'Unavailable' } : null,
        };
      if (name === 'inventory_file_read')
        return { data: null, error: { message: 'Unavailable' } };
      throw new Error(`Unexpected RPC: ${name}`);
    });
  }
  it.each(['quantity', 'asset'] as const)(
    'offers a clear empty %s task to staff and no mutations to viewers',
    async (parentType) => {
      show([]);
      const result = render(
        <FilesPanel
          actorId="actor-a"
          parentType={parentType}
          parentId={id}
          active
          staff
        />,
      );
      expect(
        await screen.findByText(
          parentType === 'quantity' ? 'No photo yet.' : 'No attachments yet.',
        ),
      ).toBeVisible();
      const picker = screen.getByLabelText(
        parentType === 'quantity'
          ? 'Add recognition photo'
          : 'Add photo or PDF',
      );
      const choose = vi.spyOn(picker, 'click');
      fireEvent.click(
        screen.getByRole('button', {
          name: parentType === 'quantity' ? 'Add photo' : 'Add attachment',
        }),
      );
      expect(choose).toHaveBeenCalledOnce();
      result.rerender(
        <FilesPanel
          actorId="actor-a"
          parentType={parentType}
          parentId={id}
          active
          staff={false}
        />,
      );
      expect(
        screen.queryByRole('button', {
          name: /Add photo|Add attachment|Upload and review/,
        }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Check file cleanup')).not.toBeInTheDocument();
    },
  );
  it.each([
    ['reserved', 'Waiting for upload confirmation', 'Confirm uploaded bytes'],
    ['uploaded', 'Uploaded · review required', 'Review and publish'],
    ['validating', 'Validation in progress', 'Review and publish'],
    ['validated', 'Awaiting publication', 'Review and publish'],
  ])(
    'describes %s without claiming readiness or invented progress',
    async (state, label, action) => {
      show([{ ...pending, state }]);
      render(
        <FilesPanel
          actorId="actor-a"
          parentType="asset"
          parentId={id}
          active
          staff
        />,
      );
      expect(await screen.findByText(label)).toBeVisible();
      expect(screen.getByRole('button', { name: action })).toBeEnabled();
      expect(screen.queryByText('No attachments yet.')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'View photo' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    },
  );
  it.each(['rejected', 'removed', 'cancelled', 'expired'])(
    'never offers reads or publication for terminal %s fixture',
    async (state) => {
      show([{ ...pending, state }]);
      render(
        <FilesPanel
          actorId="actor-a"
          parentType="asset"
          parentId={id}
          active
          staff
        />,
      );
      expect(
        await screen.findByText(
          /Byte cleanup remains unconfirmed|byte cleanup remains unconfirmed/,
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', {
          name: /View photo|Review and publish|Cancel/,
        }),
      ).not.toBeInTheDocument();
    },
  );
  it('preserves authorized pending information for a viewer without mutation controls', async () => {
    show([pending]);
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff={false}
      />,
    );
    expect(await screen.findByText('Uploaded · review required')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps cleanup secondary and reports inaccessible activity truthfully', async () => {
    show([], true);
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    await screen.findByText('No attachments yet.');
    expect(
      screen
        .getByRole('button', { name: 'Check file cleanup', hidden: true })
        .closest('details'),
    ).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('File activity'));
    expect(
      screen.getByRole('button', { name: 'Check file cleanup' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'File activity could not be loaded',
    );
    expect(screen.queryByText('No file changes yet.')).not.toBeInTheDocument();
  });
  it('does not disguise a failed collection read as an empty record', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Unavailable' },
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="quantity"
        parentId={id}
        active
        staff
      />,
    );
    expect(await screen.findByText('Files could not be loaded.')).toBeVisible();
    expect(screen.queryByText('No photo yet.')).not.toBeInTheDocument();
  });
  it('places ready files first and preserves a usable original next to a pending replacement', async () => {
    show([
      pending,
      { ...pending, id: `${id}-ready`, name: 'Original photo', state: 'ready' },
    ]);
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="quantity"
        parentId={id}
        active
        staff
      />,
    );
    await screen.findByText('Ready');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      'Original photo',
    );
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('Replace a ready file')).toHaveValue(
      `${id}-ready`,
    );
    expect(screen.getByRole('button', { name: 'View photo' })).toBeEnabled();
  });
});

describe('file collection identity isolation', () => {
  it.each(['parent', 'actor', 'role'] as const)(
    'clears prior private state on a %s switch and ignores late reads',
    async (switchKind) => {
      let finishRead!: (value: unknown) => void;
      const delayedRead = new Promise((resolve) => {
        finishRead = resolve;
      });
      let first = true;
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === 'inventory_file_cards')
          return {
            data: {
              revision: '2',
              files: first
                ? [
                    {
                      ...pending,
                      state: 'ready',
                      type: 'application/pdf',
                      name: 'Prior private document',
                    },
                  ]
                : [],
            },
            error: null,
          };
        if (name === 'inventory_file_history')
          return { data: { rows: [], has_more: false }, error: null };
        if (name === 'inventory_file_read') return delayedRead;
        throw new Error(`Unexpected RPC: ${name}`);
      });
      const view = render(
        <FilesPanel
          actorId="actor-a"
          parentType="asset"
          parentId={id}
          active
          staff
        />,
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Download PDF' }),
      );
      first = false;
      view.rerender(
        <FilesPanel
          actorId={switchKind === 'actor' ? 'actor-b' : 'actor-a'}
          parentType="asset"
          parentId={switchKind === 'parent' ? `${id}-other` : id}
          active
          staff={switchKind !== 'role'}
        />,
      );
      expect(
        screen.queryByText('Prior private document'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Download PDF' }),
      ).not.toBeInTheDocument();
      finishRead({ data: null, error: { message: 'Late prior error' } });
      await screen.findByText('No attachments yet.');
      expect(
        screen.queryByText('This file is unavailable.'),
      ).not.toBeInTheDocument();
      if (switchKind === 'role')
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );
  it('does not retain download controls when a confirmed removal cannot refresh cards', async () => {
    let removed = false;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return removed
          ? { data: null, error: { message: 'Refresh unavailable' } }
          : {
              data: {
                revision: '2',
                files: [
                  { ...pending, state: 'ready', type: 'application/pdf' },
                ],
              },
              error: null,
            };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_remove') {
        removed = true;
        return { data: {}, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Download PDF' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('File removed');
  });
});

describe('ready private file reads', () => {
  it.each(['image/png', 'application/pdf'])(
    'uses only the authorized variant for %s and retains viewer access',
    async (type) => {
      mocks.rpc.mockImplementation(
        async (name: string, args: Record<string, unknown>) => {
          if (name === 'inventory_file_cards')
            return {
              data: {
                revision: '2',
                files: [{ ...pending, state: 'ready', type }],
              },
              error: null,
            };
          if (name === 'inventory_file_history')
            return { data: { rows: [], has_more: false }, error: null };
          if (name === 'inventory_file_read')
            return { data: `private-fixture/${args.p_variant}`, error: null };
          throw new Error(`Unexpected RPC: ${name}`);
        },
      );
      const create = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:fixture-private-preview');
      const revoke = vi
        .spyOn(URL, 'revokeObjectURL')
        .mockImplementation(() => {});
      const anchor = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      mocks.download.mockResolvedValue({
        data: new Blob(['fixture']),
        error: null,
      });
      const panel = render(
        <FilesPanel
          actorId="actor-a"
          parentType="asset"
          parentId={id}
          active
          staff={false}
        />,
      );
      fireEvent.click(
        await screen.findByRole('button', {
          name: type === 'application/pdf' ? 'Download PDF' : 'View photo',
        }),
      );
      await waitFor(() =>
        expect(mocks.rpc).toHaveBeenCalledWith('inventory_file_read', {
          p_file_id: id,
          p_variant: type === 'application/pdf' ? 'source' : 'display',
        }),
      );
      await waitFor(() => expect(create).toHaveBeenCalled());
      if (type === 'application/pdf') {
        await waitFor(() => expect(anchor).toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      } else {
        expect(await screen.findByRole('dialog')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Close photo' }));
        await waitFor(() =>
          expect(revoke).toHaveBeenCalledWith('blob:fixture-private-preview'),
        );
      }
      panel.unmount();
      create.mockRestore();
      revoke.mockRestore();
      anchor.mockRestore();
    },
  );
});

describe('explicit add intent and terminal invalidation', () => {
  it('clears an abandoned replacement choice when staff explicitly adds an attachment', async () => {
    const original = { ...pending, state: 'ready', type: 'application/pdf' };
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'inventory_file_cards')
        return { data: { revision: '3', files: [original] }, error: null };
      if (name === 'inventory_file_history')
        return { data: { rows: [], has_more: false }, error: null };
      if (name === 'inventory_file_reserve')
        return { data: { id: `${id}-new`, path: 'fixture' }, error: null };
      if (name === 'inventory_file_uploaded') return { data: {}, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Validation unavailable' }),
    });
    render(
      <FilesPanel
        actorId="actor-a"
        parentType="asset"
        parentId={id}
        active
        staff
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('Replace a ready file')).toHaveValue(id);
    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
      target: {
        files: [new File(['fiction'], 'new.pdf', { type: 'application/pdf' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and review' }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'inventory_file_reserve',
        expect.objectContaining({
          p_replaces: null,
          p_expected_file_version: null,
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  });
  it.each(['cancel', 'reject'] as const)(
    'invalidates a confirmed terminal %s even if refresh fails',
    async (action) => {
      let terminal = false;
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === 'inventory_file_cards')
          return terminal
            ? { data: null, error: { message: 'Read failed' } }
            : { data: { revision: '1', files: [pending] }, error: null };
        if (name === 'inventory_file_history')
          return { data: { rows: [], has_more: false }, error: null };
        if (name === 'inventory_file_cancel') {
          terminal = true;
          return { data: {}, error: null };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      });
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.includes('validate')) {
          terminal = true;
          return {
            ok: false,
            json: async () => ({
              message: 'Invalid content',
              terminalRejected: true,
            }),
          };
        }
        return { ok: true, json: async () => ({ deleted: 0 }) };
      });
      render(
        <FilesPanel
          actorId="actor-a"
          parentType="asset"
          parentId={id}
          active
          staff
        />,
      );
      fireEvent.click(
        await screen.findByRole('button', {
          name: action === 'cancel' ? 'Cancel' : 'Review and publish',
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Review and publish' }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        action === 'cancel' ? 'File cancelled' : 'Invalid content',
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        /unverified|unconfirmed|could not be confirmed/,
      );
    },
  );
});

describe('late successful private blob isolation', () => {
  it.each(['parent', 'actor'] as const)(
    'ignores successful delayed Storage bytes after %s changes',
    async (change) => {
      let finish!: (value: unknown) => void;
      const delayed = new Promise((resolve) => {
        finish = resolve;
      });
      mocks.download.mockReturnValue(delayed);
      let prior = true;
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === 'inventory_file_cards')
          return {
            data: {
              revision: '1',
              files: prior
                ? [{ ...pending, state: 'ready', type: 'application/pdf' }]
                : [],
            },
            error: null,
          };
        if (name === 'inventory_file_history')
          return { data: { rows: [], has_more: false }, error: null };
        if (name === 'inventory_file_read')
          return { data: 'private-fixture/source', error: null };
        throw new Error(`Unexpected RPC: ${name}`);
      });
      const create = vi.spyOn(URL, 'createObjectURL');
      const view = render(
        <FilesPanel
          actorId="actor-a"
          parentType="asset"
          parentId={id}
          active
          staff
        />,
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Download PDF' }),
      );
      await waitFor(() => expect(mocks.download).toHaveBeenCalled());
      prior = false;
      view.rerender(
        <FilesPanel
          actorId={change === 'actor' ? 'actor-b' : 'actor-a'}
          parentType="asset"
          parentId={change === 'parent' ? `${id}-next` : id}
          active
          staff
        />,
      );
      await act(async () => {
        finish({ data: new Blob(['private fixture']), error: null });
      });
      expect(create).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      create.mockRestore();
    },
  );
});

it('revokes an open private preview when the authenticated actor changes', async () => {
  let prior = true;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'inventory_file_cards')
      return {
        data: {
          revision: '1',
          files: prior ? [{ ...pending, state: 'ready' }] : [],
        },
        error: null,
      };
    if (name === 'inventory_file_history')
      return { data: { rows: [], has_more: false }, error: null };
    if (name === 'inventory_file_read')
      return { data: 'private-fixture/display', error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  mocks.download.mockResolvedValue({
    data: new Blob(['fixture']),
    error: null,
  });
  const create = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:private-open-preview');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const view = render(
    <FilesPanel
      actorId="actor-a"
      parentType="asset"
      parentId={id}
      active
      staff
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'View photo' }));
  await screen.findByRole('dialog');
  prior = false;
  view.rerender(
    <FilesPanel
      actorId="actor-b"
      parentType="asset"
      parentId={id}
      active
      staff
    />,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith('blob:private-open-preview');
  create.mockRestore();
  revoke.mockRestore();
});

it('preserves the real upload validation failure when cards cannot refresh', async () => {
  let rejected = false;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'inventory_file_cards')
      return rejected
        ? { data: null, error: { message: 'Refresh unavailable' } }
        : { data: { revision: '1', files: [] }, error: null };
    if (name === 'inventory_file_history')
      return { data: { rows: [], has_more: false }, error: null };
    if (name === 'inventory_file_reserve')
      return { data: { id, path: 'fixture' }, error: null };
    if (name === 'inventory_file_uploaded') return { data: {}, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  mocks.fetch.mockImplementation(async () => {
    rejected = true;
    return {
      ok: false,
      json: async () => ({
        message: 'Invalid file content.',
        terminalRejected: true,
        cleanupDeleted: 0,
      }),
    };
  });
  render(
    <FilesPanel
      actorId="actor-a"
      parentType="asset"
      parentId={id}
      active
      staff
    />,
  );
  await screen.findByText('No attachments yet.');
  fireEvent.change(screen.getByLabelText('Add photo or PDF'), {
    target: {
      files: [
        new File(['fixture'], 'invalid.pdf', { type: 'application/pdf' }),
      ],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and review' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid file content.',
    ),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Files could not be refreshed',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Remaining cleanup is unverified',
  );
});

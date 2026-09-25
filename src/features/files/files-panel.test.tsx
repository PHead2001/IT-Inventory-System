import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetch: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
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

describe('terminal file cancellation cleanup', () => {
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Retry file cleanup' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid file content. Deleted 0 stored objects. Remaining cleanup is unverified',
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith('inventory_file_cancel', {
      p_file_id: id,
    });
  });

  it('requests bounded cleanup after cancellation', async () => {
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Retry file cleanup' }),
    ).toBeVisible();
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No ready files yet.')).toBeVisible();
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('button', { name: 'Retry file cleanup' }),
    ).toBeVisible();
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const retry = await screen.findByRole('button', {
      name: 'Retry file cleanup',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /cleanup could not be confirmed/i,
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry file cleanup' }),
      ).toBeVisible(),
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
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
    render(<FilesPanel parentType="asset" parentId={id} active staff />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and publish' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'reviewed replacement target changed',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

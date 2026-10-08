import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { previewSearchBatch } from './queries.server';
const id = 'a1000000-0000-4000-8000-000000000001';
const key = `asset:${id}`;
type MemberClient = Parameters<typeof previewSearchBatch>[0];
it('preserves user literal IDs in typed human answers without stripping text', async () => {
  const preview = {
    answers: [
      {
        label: 'Reference',
        type: 'short_text',
        displayValue: id,
        truncated: false,
      },
    ],
    truncated: false,
  };
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { [key]: preview }, error: null });
  expect(
    await previewSearchBatch({ rpc } as unknown as MemberClient, [
      { kind: 'asset', id },
    ]),
  ).toEqual({ [key]: preview });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('metadata_preview_batch', {
    p_keys: [{ kind: 'asset', id }],
  });
});
it('rejects provenance decoration, byte overflow and response identity mismatch', async () => {
  const rpc = vi.fn();
  const client = { rpc } as unknown as MemberClient;
  const request = [{ kind: 'asset' as const, id }];
  rpc.mockResolvedValueOnce({
    data: {
      [key]: {
        answers: [
          {
            label: 'Note',
            type: 'short_text',
            displayValue: 'Text',
            truncated: false,
            validated_revision_id: id,
          },
        ],
        truncated: false,
      },
    },
    error: null,
  });
  await expect(previewSearchBatch(client, request)).rejects.toThrow();
  rpc.mockResolvedValueOnce({
    data: {
      [key]: {
        answers: [
          {
            label: 'Note',
            type: 'long_text',
            displayValue: '界'.repeat(100),
            truncated: false,
          },
        ],
        truncated: false,
      },
    },
    error: null,
  });
  await expect(previewSearchBatch(client, request)).rejects.toThrow();
  rpc.mockResolvedValueOnce({ data: {}, error: null });
  await expect(previewSearchBatch(client, request)).rejects.toThrow(
    'did not match',
  );
});
it('does not call the database for empty or duplicate keys', async () => {
  const rpc = vi.fn();
  const client = { rpc } as unknown as MemberClient;
  expect(await previewSearchBatch(client, [])).toEqual({});
  await expect(
    previewSearchBatch(client, [
      { kind: 'asset', id },
      { kind: 'asset', id },
    ]),
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});

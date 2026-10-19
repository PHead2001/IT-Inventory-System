import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ member: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { getInventoryFileCards } from './cards.server';
import { inventoryFileCardsSchema } from './contract';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});
it.each(['asset', 'quantity'] as const)(
  'uses caller membership and the full %s cards projection',
  async (kind) => {
    const result = { revision: '17', files: [] };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    await expect(getInventoryFileCards(kind, 'parent')).resolves.toEqual({
      status: 'ready',
      envelope: result,
    });
    expect(mocks.member).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('inventory_file_cards', {
      p_parent_type: kind,
      p_parent_id: 'parent',
    });
  },
);
it('propagates membership failure without reading file metadata', async () => {
  mocks.member.mockRejectedValue(new Error('forbidden'));
  await expect(getInventoryFileCards('asset', 'parent')).rejects.toThrow(
    'forbidden',
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  null,
  { revision: '1' },
  { revision: '0', files: [] },
  { revision: '1', files: [{ id: 'incomplete' }] },
  { revision: '1', files: [], path: 'private/path' },
])(
  'marks malformed or private metadata unavailable without inventing an empty collection: %j',
  async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getInventoryFileCards('asset', 'parent')).resolves.toEqual({
      status: 'unavailable',
    });
    expect(inventoryFileCardsSchema.safeParse(data).success).toBe(false);
  },
);
it('isolates RPC failure without returning a successful empty collection', async () => {
  mocks.rpc.mockResolvedValue({
    data: { revision: '1', files: [] },
    error: { message: 'denied' },
  });
  await expect(getInventoryFileCards('asset', 'parent')).resolves.toEqual({
    status: 'unavailable',
  });
});

it('validates every complete ready and own-pending card without allowing private card fields', async () => {
  const card = {
    id: 'file',
    name: 'Name',
    filename: 'file.png',
    uploader: 'Staff',
    ready_at: null,
    type: 'image/png',
    bytes: 32,
    purpose: 'asset_photo',
    state: 'uploaded',
    created_at: '2026-10-15T00:00:00Z',
    version: '3',
    replaces_file_id: null,
    reviewed_replaced_file_version: null,
  };
  const result = {
    revision: '7',
    files: [
      card,
      {
        ...card,
        id: 'ready',
        state: 'ready',
        ready_at: '2026-10-15T00:00:00Z',
      },
    ],
  };
  mocks.rpc.mockResolvedValue({ data: result, error: null });
  await expect(getInventoryFileCards('asset', 'parent')).resolves.toEqual({
    status: 'ready',
    envelope: result,
  });
  for (const key of Object.keys(card)) {
    const incomplete: Record<string, unknown> = { ...card };
    delete incomplete[key];
    expect(
      inventoryFileCardsSchema.safeParse({ revision: '7', files: [incomplete] })
        .success,
    ).toBe(false);
  }
  expect(
    inventoryFileCardsSchema.safeParse({
      revision: '7',
      files: [{ ...card, source_path: 'private/source' }],
    }).success,
  ).toBe(false);
});

it.each([
  { status: 401 },
  { status: 403 },
  { code: 'P1001' },
  { code: '42501' },
  { code: 'PGRST301' },
  { name: 'AuthSessionMissingError' },
  { code: 'invalid_jwt' },
])('propagates definite file RPC authorization denial %j', async (error) => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error });
  await expect(getInventoryFileCards('asset', 'parent')).rejects.toEqual(error);
  mocks.rpc.mockRejectedValueOnce(error);
  await expect(getInventoryFileCards('quantity', 'parent')).rejects.toEqual(
    error,
  );
});
it.each([401, 403])(
  'retains RPC HTTP status %s when the error body lacks a denial code',
  async (status) => {
    const error = { message: 'Access denied' };
    mocks.rpc.mockResolvedValue({ data: null, error, status });
    await expect(getInventoryFileCards('asset', 'parent')).rejects.toBe(error);
  },
);
it.each([
  new TypeError('Network unavailable'),
  { status: 503 },
  { status: 429 },
])('isolates a transport/provider exception %j', async (error) => {
  mocks.rpc.mockRejectedValue(error);
  await expect(getInventoryFileCards('quantity', 'parent')).resolves.toEqual({
    status: 'unavailable',
  });
});
it('does not mask Next redirect control flow from a read adapter', async () => {
  const error = Object.assign(new Error('Next redirect'), {
    digest: 'NEXT_REDIRECT;replace;/login;307;',
  });
  mocks.rpc.mockRejectedValue(error);
  await expect(getInventoryFileCards('asset', 'parent')).rejects.toBe(error);
  mocks.rpc.mockResolvedValue({ data: null, error });
  await expect(getInventoryFileCards('quantity', 'parent')).rejects.toBe(error);
});

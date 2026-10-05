import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  keys: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('./rpc.server', () => ({ fileRpc: mocks.rpc }));
vi.mock('./keys.server', () => ({
  fileKeys: mocks.keys,
  proof: () => ({ p_mac: 'signed' }),
}));
import {
  cleanupTerminalFiles,
  FileCleanupNotConfiguredError,
} from './cleanup.server';
const parent = {
  parentType: 'asset' as const,
  parentId: '00000000-0000-4000-8000-000000000001',
};
const actor = {
  userId: 'staff',
  client: { storage: { from: () => ({ remove: mocks.remove }) } },
} as unknown as Parameters<typeof cleanupTerminalFiles>[0];
const claim = {
  object_id: '00000000-0000-4000-8000-000000000002',
  path: 's/owned',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.keys.mockReturnValue({ testkey: 'x'.repeat(32) });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (_client, name) => {
    if (name === 'inventory_file_active_key') return 'testkey';
    if (name === 'inventory_file_cleanup_status')
      return { outstanding: 1, blocked: 0 };
    if (name === 'inventory_file_cleanup_claim_parent') return [claim];
    return null;
  });
});
describe('authoritative parent cleanup', () => {
  it('returns authorized no-work before key lookup or Storage operations', async () => {
    mocks.keys.mockReturnValue({});
    mocks.rpc.mockResolvedValue({ outstanding: 0, blocked: 0 });
    expect(await cleanupTerminalFiles(actor, parent)).toEqual({
      deleted: 0,
      failed: 0,
      outstanding: 0,
      blocked: 0,
      pending: false,
      status: 'no_work',
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      actor.client,
      'inventory_file_cleanup_status',
      { p_parent_type: 'asset', p_parent_id: parent.parentId },
    );
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([new Error('forbidden'), new Error('lookup failed')])(
    'never converts discovery failure into no-work',
    async (error) => {
      mocks.rpc.mockRejectedValue(error);
      await expect(cleanupTerminalFiles(actor, parent)).rejects.toThrow(error);
      expect(mocks.keys).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
  it('reports configuration unavailable for actual work with no active DB key', async () => {
    mocks.rpc.mockImplementation(async (_client, name) =>
      name === 'inventory_file_cleanup_status'
        ? { outstanding: 1, blocked: 1 }
        : null,
    );
    await expect(cleanupTerminalFiles(actor, parent)).rejects.toBeInstanceOf(
      FileCleanupNotConfiguredError,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('keeps grace work pending despite an empty claim batch', async () => {
    mocks.rpc.mockImplementation(async (_client, name) =>
      name === 'inventory_file_active_key'
        ? 'testkey'
        : name === 'inventory_file_cleanup_claim_parent'
          ? []
          : { outstanding: 1, blocked: 1 },
    );
    expect(await cleanupTerminalFiles(actor, parent)).toMatchObject({
      status: 'pending',
      outstanding: 1,
      blocked: 1,
      pending: true,
      failed: 0,
    });
  });
  it('accepts a lost delete acknowledgement only after authoritative confirmation and fresh zero work', async () => {
    mocks.remove.mockRejectedValue(new Error('lost response'));
    let reads = 0;
    mocks.rpc.mockImplementation(async (_client, name) => {
      if (name === 'inventory_file_cleanup_status')
        return { outstanding: ++reads === 1 ? 1 : 0, blocked: 0 };
      if (name === 'inventory_file_active_key') return 'testkey';
      if (name === 'inventory_file_cleanup_claim_parent') return [claim];
      return null;
    });
    expect(await cleanupTerminalFiles(actor, parent)).toMatchObject({
      status: 'complete',
      deleted: 1,
      failed: 0,
      outstanding: 0,
      pending: false,
    });
  });
  it.each([1, 2])(
    'reports actual confirmation failures distinctly (%i objects)',
    async (total) => {
      let confirms = 0;
      mocks.rpc.mockImplementation(async (_client, name) => {
        if (name === 'inventory_file_cleanup_status')
          return { outstanding: total, blocked: 0 };
        if (name === 'inventory_file_active_key') return 'testkey';
        if (name === 'inventory_file_cleanup_claim_parent')
          return Array.from({ length: total }, () => claim);
        if (name === 'inventory_file_cleanup_confirm' && ++confirms === 1)
          throw new Error('bytes remain');
        return null;
      });
      expect(await cleanupTerminalFiles(actor, parent)).toMatchObject({
        status: total === 1 ? 'failed' : 'partial',
        failed: 1,
        deleted: total - 1,
        pending: true,
      });
      expect(
        mocks.rpc.mock.calls.find(
          (call) => call[1] === 'inventory_file_cleanup_claim_parent',
        )?.[2],
      ).toMatchObject({
        p_parent_type: parent.parentType,
        p_parent_id: parent.parentId,
      });
    },
  );
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidFileContentError } from '@/features/files/inspection-error';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  staffClient: vi.fn(),
  fileRpc: vi.fn(),
  inspectFile: vi.fn(),
  info: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/features/files/rpc.server', () => ({
  staffClient: mocks.staffClient,
  fileRpc: mocks.fileRpc,
  fileError: (error: { code?: string }) =>
    error.code === 'INVALID_FILE_CONTENT' ? 'Invalid file content.' : 'Retry.',
}));
vi.mock('@/features/files/inspect.server', () => ({
  inspectFile: mocks.inspectFile,
}));
vi.mock('@/features/files/keys.server', () => ({
  fileKeys: () => ({ testkey: 'x'.repeat(32) }),
  mac: () => 'signed',
  proof: () => ({ p_nonce: 'nonce', p_expires: 9999999999, p_mac: 'signed' }),
}));

import { POST as validate } from './route';
import { POST as cleanup } from '../cleanup/route';

const fileId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const objectId = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';
const sourcePath = `s/${fileId}`;
const sourceBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const storage = {
  info: mocks.info,
  download: mocks.download,
  remove: mocks.remove,
};
const actor = {
  userId: actorId,
  client: { storage: { from: () => storage } },
};
const request = () =>
  new Request('https://inventory.example/api/inventory-files/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId,
      requestId,
      expectedRevision: '1',
      expectedFileVersion: null,
    }),
  });
const called = (name: string) =>
  mocks.fileRpc.mock.calls.some((call) => call[1] === name);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.staffClient.mockResolvedValue(actor);
  mocks.info.mockResolvedValue({
    data: { id: sourceId, version: 'v1' },
    error: null,
  });
  mocks.download.mockResolvedValue({
    data: {
      size: sourceBytes.length,
      arrayBuffer: async () => sourceBytes.slice().buffer,
    },
    error: null,
  });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.fileRpc.mockImplementation(async (_client, name: string) => {
    if (name === 'inventory_file_finalize')
      throw Object.assign(new Error('Not ready'), { code: 'P1008' });
    if (name === 'inventory_file_active_key') return 'testkey';
    if (name === 'inventory_file_begin')
      return {
        generation: 1,
        key_id: 'testkey',
        lease_until: 9999999999,
        source_path: sourcePath,
        source_id: sourceId,
        source_version: 'v1',
      };
    if (name === 'inventory_file_source_details')
      return {
        type: 'image/png',
        bytes: sourceBytes.length,
        parent_type: 'asset',
        parent_id: actorId,
        reviewed_revision: '1',
        purpose: 'asset_photo',
        replaces: null,
        replaced_file_version: null,
      };
    if (name === 'inventory_file_cleanup_claim')
      return [{ object_id: objectId, path: sourcePath }];
    return null;
  });
});

describe('invalid file validation and bounded cleanup', () => {
  it('denies cleanup before claiming bytes when staff authorization is absent', async () => {
    mocks.staffClient.mockResolvedValue(null);
    const response = await cleanup();
    expect(response.status).toBe(403);
    expect(called('inventory_file_cleanup_claim')).toBe(false);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(['image/png', 'application/pdf'])(
    'rejects a trusted invalid-content %s result and cleans its claimed bytes',
    async (type) => {
      mocks.fileRpc.mockImplementation(async (client, name: string) => {
        if (name === 'inventory_file_source_details')
          return {
            type,
            bytes: sourceBytes.length,
            parent_type: 'asset',
            parent_id: actorId,
            reviewed_revision: '1',
            purpose:
              type === 'application/pdf' ? 'asset_document' : 'asset_photo',
            replaces: null,
            replaced_file_version: null,
          };
        return baselineRpc(client, name);
      });
      mocks.inspectFile.mockRejectedValue(new InvalidFileContentError());
      const response = await validate(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        message: 'Invalid file content.',
        terminalRejected: true,
        cleanupPending: true,
        cleanupDeleted: 1,
      });
      expect(called('inventory_file_reject')).toBe(true);
      expect(called('inventory_file_cleanup_claim')).toBe(true);
      expect(called('inventory_file_cleanup_confirm')).toBe(true);
      expect(mocks.remove).toHaveBeenCalledWith([sourcePath]);
      expect(
        mocks.fileRpc.mock.calls.findIndex(
          (call) => call[1] === 'inventory_file_reject',
        ),
      ).toBeLessThan(
        mocks.fileRpc.mock.calls.findIndex(
          (call) => call[1] === 'inventory_file_cleanup_claim',
        ),
      );
    },
  );

  it('keeps cleanup pending while terminal bytes remain behind validation grace', async () => {
    mocks.inspectFile.mockRejectedValue(new InvalidFileContentError());
    mocks.fileRpc.mockImplementation(async (client, name: string) => {
      if (name === 'inventory_file_cleanup_claim') return [];
      return baselineRpc(client, name);
    });
    const response = await validate(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      terminalRejected: true,
      cleanupPending: true,
    });
    expect(called('inventory_file_reject')).toBe(true);
    expect(mocks.remove).not.toHaveBeenCalled();
    const retriedBeforeGrace = await cleanup();
    expect(await retriedBeforeGrace.json()).toEqual({
      deleted: 0,
      pending: true,
    });
  });

  it('reports unknown completion after cleaning an unrelated old claim while the new rejection is in grace', async () => {
    mocks.inspectFile.mockRejectedValue(new InvalidFileContentError());
    mocks.fileRpc.mockImplementation(async (client, name: string) => {
      if (name === 'inventory_file_cleanup_claim')
        return [{ object_id: objectId, path: 's/old-terminal-object' }];
      return baselineRpc(client, name);
    });
    const response = await validate(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      terminalRejected: true,
      cleanupPending: true,
      cleanupDeleted: 1,
    });
    expect(mocks.remove).toHaveBeenCalledWith(['s/old-terminal-object']);
    expect(mocks.remove).not.toHaveBeenCalledWith([sourcePath]);
  });

  it('does not infer completion when the claim RPC returns twenty existing claims', async () => {
    mocks.fileRpc.mockImplementation(async (client, name: string) => {
      if (name === 'inventory_file_cleanup_claim')
        return Array.from({ length: 20 }, (_, index) => ({
          object_id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
          path: `s/fictional-${index}`,
        }));
      return baselineRpc(client, name);
    });
    const response = await cleanup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 20, pending: true });
    expect(mocks.remove).toHaveBeenCalledTimes(20);
  });

  it('leaves a transient download failure available for retry without rejecting it', async () => {
    mocks.download.mockResolvedValue({
      data: null,
      error: new Error('network'),
    });
    const response = await validate(request());
    expect(response.status).toBe(409);
    expect(called('inventory_file_reject')).toBe(false);
    expect(called('inventory_file_cleanup_claim')).toBe(false);
  });

  it('does not classify a stale database review as invalid content', async () => {
    mocks.fileRpc.mockImplementation(async (client, name: string) => {
      if (name === 'inventory_file_review')
        throw Object.assign(new Error('Stale revision'), { code: 'P1002' });
      return baselineRpc(client, name);
    });
    const response = await validate(request());
    expect(response.status).toBe(409);
    expect(called('inventory_file_begin')).toBe(false);
    expect(called('inventory_file_reject')).toBe(false);
    expect(called('inventory_file_cleanup_claim')).toBe(false);
  });

  it('retains a terminal rejection when cleanup fails, then accepts a bounded retry', async () => {
    mocks.inspectFile.mockRejectedValue(new InvalidFileContentError());
    mocks.fileRpc.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Not ready'), { code: 'P1008' });
    });
    mocks.fileRpc.mockImplementation(async (client, name: string) => {
      if (name === 'inventory_file_cleanup_confirm')
        throw new Error('Provider bytes remain');
      return baselineRpc(client, name);
    });
    const response = await validate(request());
    expect(response.status).toBe(409);
    expect((await response.json()).cleanupPending).toBe(true);
    expect(called('inventory_file_reject')).toBe(true);
    mocks.fileRpc.mockImplementation(baselineRpc);
    const retried = await cleanup();
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ deleted: 1, pending: true });
  });
});

async function baselineRpc(_client: unknown, name: string) {
  if (name === 'inventory_file_finalize')
    throw Object.assign(new Error('Not ready'), { code: 'P1008' });
  if (name === 'inventory_file_active_key') return 'testkey';
  if (name === 'inventory_file_begin')
    return {
      generation: 1,
      key_id: 'testkey',
      lease_until: 9999999999,
      source_path: sourcePath,
      source_id: sourceId,
      source_version: 'v1',
    };
  if (name === 'inventory_file_source_details')
    return {
      type: 'image/png',
      bytes: sourceBytes.length,
      parent_type: 'asset',
      parent_id: actorId,
      reviewed_revision: '1',
      purpose: 'asset_photo',
      replaces: null,
      replaced_file_version: null,
    };
  if (name === 'inventory_file_cleanup_claim')
    return [{ object_id: objectId, path: sourcePath }];
  return null;
}

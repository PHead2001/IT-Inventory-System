import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  rpc: vi.fn(),
  keys: vi.fn(),
  proof: vi.fn(),
}));
vi.mock('@/features/files/rpc.server', () => ({
  staffClient: mocks.staff,
  fileRpc: mocks.rpc,
  fileError: () => 'Refresh and review.',
}));
vi.mock('@/features/files/keys.server', () => ({
  fileKeys: mocks.keys,
  proof: mocks.proof,
}));
import { POST } from './route';
const parentId = '00000000-0000-4000-8000-000000000001';
const body = {
  parentType: 'asset',
  parentId,
  expectedRevision: '9007199254740993',
  name: 'Colon:name π.png',
  type: 'image/png',
  bytes: 16,
  replaces: null,
  expectedFileVersion: null,
};
const actor = { userId: 'staff', client: {} };
const request = (value: unknown = body) =>
  new Request('https://inventory.example/api/inventory-files/reserve', {
    method: 'POST',
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(actor);
  mocks.keys.mockReturnValue({ testkey: 'x'.repeat(32) });
  mocks.proof.mockReturnValue({ p_mac: 'signed' });
  mocks.rpc.mockImplementation(async (_client, name) =>
    name === 'inventory_file_active_key'
      ? 'testkey'
      : name === 'inventory_file_reserve_ready'
        ? { id: parentId, path: 's/owned' }
        : { outstanding: 0, blocked: 0 },
  );
});
describe('reservation readiness before bytes', () => {
  it('requires staff before inspecting input/configuration', async () => {
    mocks.staff.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.keys).not.toHaveBeenCalled();
  });
  it('requires parent authority before configuration lookup', async () => {
    mocks.rpc.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'P1010' }),
    );
    expect((await POST(request())).status).toBe(409);
    expect(mocks.keys).not.toHaveBeenCalled();
  });
  it.each([null, 'missingkey'])(
    'does not reserve when active key %s lacks a usable server secret',
    async (key) => {
      mocks.rpc.mockImplementation(async (_client, name) =>
        name === 'inventory_file_active_key'
          ? key
          : { outstanding: 0, blocked: 0 },
      );
      expect((await POST(request())).status).toBe(503);
      expect(
        mocks.rpc.mock.calls.some(
          (call) => call[1] === 'inventory_file_reserve_ready',
        ),
      ).toBe(false);
    },
  );
  it('binds exact revisions, parent and delimiter-safe UTF8 business input to server proof', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.proof).toHaveBeenCalledWith(
      'x'.repeat(32),
      'staff',
      'reserve',
      [
        'asset',
        parentId,
        body.expectedRevision,
        Buffer.from(body.name).toString('hex'),
        'image/png',
        '16',
        '-',
        '-',
        'testkey',
      ],
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      actor.client,
      'inventory_file_reserve_ready',
      expect.objectContaining({
        p_expected_revision: body.expectedRevision,
        p_name: body.name,
        p_key_id: 'testkey',
        p_mac: 'signed',
      }),
    );
  });
  it('reports DB key/proof mismatch as unavailable without claiming a reservation', async () => {
    mocks.rpc.mockImplementation(async (_client, name) => {
      if (name === 'inventory_file_reserve_ready')
        throw Object.assign(new Error('unavailable'), { code: 'P1013' });
      return name === 'inventory_file_active_key'
        ? 'testkey'
        : { outstanding: 0, blocked: 0 };
    });
    expect((await POST(request())).status).toBe(503);
  });
  it.each([
    { ...body, expectedRevision: 1 },
    { ...body, expectedRevision: '9223372036854775808' },
    { ...body, replaces: parentId },
    { ...body, parentType: 'quantity', type: 'application/pdf' },
    { ...body, extra: true },
  ])('rejects invalid business input before readiness', async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

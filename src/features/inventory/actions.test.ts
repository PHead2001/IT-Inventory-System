import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  duplicateSerials: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('./queries.server', () => ({
  duplicateSerials: mocks.duplicateSerials,
}));
import { findDuplicateSerials, submitInventory } from './actions';

const userId = 'b1000000-0000-4000-8000-000000000001';
const itemId = 'b1000000-0000-4000-8000-000000000002';
const locationId = 'b1000000-0000-4000-8000-000000000003';
const requestId = 'b1000000-0000-4000-8000-000000000004';
const eventId = 'b1000000-0000-4000-8000-000000000005';
const member = {
  user_id: userId,
  display_name: 'Staff',
  role: 'staff',
  active: true,
};
const command = {
  operation: 'quantity_receive',
  requestId,
  payload: {
    item_id: itemId,
    expected_version: 1,
    location_id: locationId,
    quantity: 2,
    reason: '  Delivery  ',
  },
};
const success = {
  entity_id: itemId,
  version: 2,
  event_id: eventId,
  changed: true,
};
const query = {
  select: mocks.select,
  eq: mocks.eq,
  maybeSingle: mocks.maybeSingle,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({ data: member, error: null });
  mocks.rpc.mockResolvedValue({ data: success, error: null });
});

describe('inventory server-action boundary', () => {
  it('returns field errors before creating a backend client for invalid input', async () => {
    const result = await submitInventory({
      ...command,
      payload: { ...command.payload, quantity: -1 },
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'validation',
      code: 'invalid_input',
      fieldErrors: { quantity: expect.any(String) },
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('uses verified identity and current staff membership, then submits normalized payload and the original request ID', async () => {
    expect(await submitInventory(command)).toEqual({
      ok: true,
      entityId: itemId,
      version: '2',
      changed: true,
    });
    expect(mocks.createClient).toHaveBeenCalledWith(true);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith('app_members');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mocks.rpc).toHaveBeenCalledWith('quantity_receive', {
      p_request_id: requestId,
      p_payload: { ...command.payload, reason: 'Delivery' },
    });
    expect(mocks.revalidate.mock.calls).toEqual([
      ['/inventory', 'layout'],
      ['/dashboard'],
      ['/locations', 'layout'],
      ['/history'],
    ]);
  });

  it.each([
    ['viewer', { ...member, role: 'viewer' }],
    ['inactive staff', { ...member, active: false }],
    ['nonmember', null],
    ['unrecognized role', { ...member, role: 'admin' }],
  ])('denies %s without calling a mutation RPC', async (_label, membership) => {
    mocks.maybeSingle.mockResolvedValue({ data: membership, error: null });
    // User-editable role metadata cannot elevate the server membership result.
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId, user_metadata: { role: 'staff' } } },
      error: null,
    });
    expect(await submitInventory(command)).toMatchObject({
      ok: false,
      kind: 'domain',
      code: 'forbidden',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    ['anonymous', { data: { user: null }, error: null }],
    [
      'unverified Auth response',
      {
        data: { user: { id: userId } },
        error: { message: 'secret Auth detail' },
      },
    ],
  ])('denies %s before the membership query', async (_label, auth) => {
    mocks.getUser.mockResolvedValue(auth);
    const result = await submitInventory(command);
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when current membership cannot be read', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: member,
      error: { message: 'internal SQL details' },
    });
    expect(await submitInventory(command)).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['P1001', 'forbidden'],
    ['P1002', 'stale_version'],
    ['P1003', 'insufficient_stock'],
    ['P1007', 'identifier_conflict'],
    ['P1009', 'idempotency_conflict'],
    ['P1012', 'invalid_input'],
  ])(
    'uses error.code for %s and never exposes raw backend messages',
    async (code, expected) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          code,
          message: 'sensitive table/account information',
          details: 'private SQL',
          hint: 'secret',
        },
      });
      const result = await submitInventory(command);
      expect(result).toMatchObject({ ok: false, code: expected });
      expect(JSON.stringify(result)).not.toMatch(
        /sensitive|private SQL|secret/,
      );
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it('returns a safe retry outcome for an unknown database error', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'private server detail' },
    });
    const result = await submitInventory(command);
    expect(result).toMatchObject({
      ok: false,
      kind: 'unexpected',
      code: 'unexpected',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(['client', 'auth', 'membership', 'rpc'])(
    'contains thrown %s failures without disclosing details',
    async (stage) => {
      const failing =
        stage === 'client'
          ? mocks.createClient
          : stage === 'auth'
            ? mocks.getUser
            : stage === 'membership'
              ? mocks.maybeSingle
              : mocks.rpc;
      failing.mockRejectedValue(new Error('private credential/backend detail'));
      const result = await submitInventory(command);
      expect(result).toMatchObject({
        ok: false,
        kind: 'unexpected',
        code: 'unexpected',
      });
      expect(JSON.stringify(result)).not.toContain('private');
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...success, entity_id: 'bad' },
    { ...success, version: '02' },
    { ...success, changed: 'yes' },
    { ...success, event_id: 'bad' },
  ])(
    'rejects malformed RPC data rather than reporting success: %j',
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect(await submitInventory(command)).toMatchObject({
        ok: false,
        kind: 'unexpected',
      });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it('preserves a successful no-change result and request identity on replay', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...success, version: 1, changed: false, event_id: null },
      error: null,
    });
    const first = await submitInventory(command);
    const second = await submitInventory(command);
    expect(first).toEqual({
      ok: true,
      entityId: itemId,
      version: '1',
      changed: false,
    });
    expect(second).toEqual(first);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });

  it('routes duplicate-serial lookup through the authenticated read helper', async () => {
    const rows = [
      { id: itemId, name: 'Laptop', assetTag: null, status: 'retired' },
    ];
    mocks.duplicateSerials.mockResolvedValue(rows);
    expect(await findDuplicateSerials('0001-A/B', itemId)).toEqual(rows);
    expect(mocks.duplicateSerials).toHaveBeenCalledWith('0001-A/B', itemId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

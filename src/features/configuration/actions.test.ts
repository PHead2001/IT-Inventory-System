import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  user: vi.fn(),
  from: vi.fn(),
  member: vi.fn(),
  rpc: vi.fn(),
  config: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.create,
}));
vi.mock('@/lib/supabase/config', () => ({ supabaseConfig: mocks.config }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { submitConfiguration } from './actions';
const actor = 'b1000000-0000-4000-8000-000000000001';
const other = 'b1000000-0000-4000-8000-000000000003';
const backend = 'https://isolated.supabase.co';
const command = {
  operation: 'label_defaults_update',
  requestId: 'b1000000-0000-4000-8000-000000000002',
  expectedActorId: actor,
  expectedBackend: backend,
  payload: {
    expected_version: '1',
    size: '90x50',
    page: 'letter',
    format: 'qr',
    layout: null,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mocks.member,
  };
  mocks.create.mockResolvedValue({
    auth: { getUser: mocks.user },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.config.mockReturnValue({ url: backend, key: 'public-test-key' });
  mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.from.mockReturnValue(query);
  mocks.member.mockResolvedValue({
    data: {
      user_id: actor,
      display_name: 'Maintainer',
      active: true,
      role: 'staff',
      can_manage_configuration: true,
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: { changed: true, version: '2', event_id: null },
    error: null,
  });
});
it('rejects a changed actor before membership reads or RPC', async () => {
  expect(
    await submitConfiguration({ ...command, expectedActorId: other }),
  ).toMatchObject({ ok: false, code: 'actor_changed' });
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('rejects a changed backend without choosing a client from input or calling RPC', async () => {
  expect(
    await submitConfiguration({
      ...command,
      expectedBackend: 'https://other.supabase.co',
    }),
  ).toMatchObject({ ok: false, code: 'backend_changed' });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  { expectedActorId: 'invalid' },
  ...[
    'https://isolated.supabase.co/',
    'https://name:password@isolated.supabase.co',
    'https://isolated.supabase.co/path',
    'https://isolated.supabase.co?token=secret',
    'file:///private',
    42,
  ].map((expectedBackend) => ({ expectedBackend })),
])('rejects malformed binding before creating a client', async (binding) => {
  expect(await submitConfiguration({ ...command, ...binding })).toMatchObject({
    ok: false,
    code: 'P1012',
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('retains matching caller authorization and sends only the existing RPC signature', async () => {
  expect(await submitConfiguration(command)).toMatchObject({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('label_defaults_update', {
    p_request_id: command.requestId,
    p_payload: command.payload,
  });
});
it.each([
  { role: 'viewer', active: true, can_manage_configuration: true },
  { role: 'staff', active: false, can_manage_configuration: true },
  { role: 'staff', active: true, can_manage_configuration: false },
])(
  'matching binding does not grant configuration permissions',
  async (member) => {
    mocks.member.mockResolvedValue({
      data: { user_id: actor, ...member },
      error: null,
    });
    expect(await submitConfiguration(command)).toMatchObject({
      ok: false,
      code: 'P1001',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('keeps unbound category callers backward compatible', async () => {
  const category = {
    operation: 'category_create',
    requestId: command.requestId,
    payload: { code: 'NEW', name: 'New', sort_order: 0 },
  };
  expect(await submitConfiguration(category)).toMatchObject({ ok: true });
  expect(mocks.config).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(category.operation, {
    p_request_id: category.requestId,
    p_payload: category.payload,
  });
});

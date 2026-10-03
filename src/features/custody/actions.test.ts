import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  user: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  member: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.create,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { submitCustody } from './actions';
const actor = 'b1000000-0000-4000-8000-000000000001';
const requestId = 'b1000000-0000-4000-8000-000000000002';
const other = 'b1000000-0000-4000-8000-000000000003';
const command = {
  operation: 'site_create',
  requestId,
  payload: { code: 'FICTIONAL', name: 'Fictional site', notes: null },
};
beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    maybeSingle: mocks.member,
  };
  mocks.create.mockResolvedValue({
    auth: { getUser: mocks.user },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.member.mockResolvedValue({
    data: {
      user_id: actor,
      display_name: 'Staff',
      role: 'staff',
      active: true,
      can_manage_configuration: true,
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: { entity_id: other, version: '1', event_id: null, changed: true },
    error: null,
  });
});
describe('custody action actor consistency', () => {
  it('rejects a different staff actor before membership reads or RPC', async () => {
    expect(
      await submitCustody({ ...command, expectedActorId: other }),
    ).toMatchObject({ ok: false, code: 'actor_changed' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid expected actor UUID before constructing a client', async () => {
    expect(
      await submitCustody({ ...command, expectedActorId: 'invalid' }),
    ).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('retains legacy envelope support and current active-role checks with matching actor', async () => {
    expect(await submitCustody(command)).toMatchObject({ ok: true });
    expect(
      await submitCustody({ ...command, expectedActorId: actor }),
    ).toMatchObject({ ok: true });
    mocks.rpc.mockClear();
    mocks.member.mockResolvedValue({
      data: {
        user_id: actor,
        display_name: 'Viewer',
        role: 'viewer',
        active: true,
      },
      error: null,
    });
    expect(
      await submitCustody({ ...command, expectedActorId: actor }),
    ).toMatchObject({ ok: false, code: 'P1001' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it('gives legacy lifecycle callers an actionable reasoned-action upgrade', async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { code: 'P1012', message: 'use_site_lifecycle' },
  });
  expect(
    await submitCustody({
      operation: 'site_update',
      requestId,
      expectedActorId: actor,
      payload: {
        site_id: other,
        expected_version: '1',
        name: 'Property',
        notes: null,
        active: false,
      },
    }),
  ).toMatchObject({
    ok: false,
    code: 'P1012',
    message:
      'Use Archive site or Restore site to change site availability and record a reason.',
  });
});

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
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import {
  reviewMetadataPublish,
  saveMetadataForm,
  submitMetadataDraft,
  verifyMetadataDesignerIdentity,
} from './actions';

const actor = '11111111-1111-4111-8111-111111111111';
const nextActor = '22222222-2222-4222-8222-222222222222';
const category = '33333333-3333-4333-8333-333333333333';
const draft = '44444444-4444-4444-8444-444444444444';
const published = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const baseline = {
  category_id: category,
  expected_actor_id: actor,
  expected_draft_id: draft,
  expected_draft_version: '1',
  expected_published_revision_id: published,
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
    data: { user: { id: actor } },
    error: null,
  });
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({
    data: {
      user_id: actor,
      display_name: 'Maintainer',
      role: 'staff',
      active: true,
      can_manage_configuration: true,
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: { draft_id: draft, version: '2' },
    error: null,
  });
});

describe('metadata designer identity boundary', () => {
  it('invokes form-save RPC with its Supabase client receiver', async () => {
    const rpc = vi.fn(function (this: { rest: { endpoint: string } }) {
      expect(this.rest.endpoint).toBe('/rest/v1');
      return Promise.resolve({
        data: null,
        error: { code: 'P1002' },
      });
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      rest: { endpoint: '/rest/v1' },
      rpc,
    });
    expect(
      await saveMetadataForm({
        requestId,
        expectedActorId: actor,
        payload: { ...baseline, definition: {} },
      }),
    ).toMatchObject({ ok: false, code: 'P1002' });
    expect(rpc).toHaveBeenCalledWith('metadata_form_save', {
      p_request_id: requestId,
      p_payload: { ...baseline, definition: {} },
    });
  });
  async function allActorGates() {
    return Promise.all([
      verifyMetadataDesignerIdentity(actor),
      saveMetadataForm({
        requestId,
        expectedActorId: actor,
        payload: { ...baseline, definition: {} },
      }),
      submitMetadataDraft({
        operation: 'metadata_draft_discard',
        requestId,
        expectedActorId: actor,
        payload: baseline,
      }),
      reviewMetadataPublish({
        categoryId: category,
        expectedActorId: actor,
        expectedDraftId: draft,
        expectedDraftVersion: '1',
        expectedPublishedRevisionId: published,
      }),
    ]);
  }
  it('treats returned transient auth errors as retryable across every actor gate', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503, code: 'service_unavailable' },
    });
    for (const result of await allActorGates())
      expect(result).toMatchObject({ ok: false, code: 'identity_unverified' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('treats known auth denial and an actual missing user as terminal', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401, code: 'invalid_jwt' },
    });
    for (const result of await allActorGates())
      expect(result).toMatchObject({ ok: false, code: 'P1001' });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    for (const result of await allActorGates())
      expect(result).toMatchObject({ ok: false, code: 'P1001' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('keeps returned membership errors retryable and proven inactive membership terminal', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { status: 500, code: 'server_error' },
    });
    for (const result of await allActorGates())
      expect(result).toMatchObject({ ok: false, code: 'identity_unverified' });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    for (const result of await allActorGates())
      expect(result).toMatchObject({ ok: false, code: 'P1001' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects an actor switch before mutation, review, or receipt replay', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: nextActor } },
      error: null,
    });
    expect(
      await submitMetadataDraft({
        operation: 'metadata_draft_save',
        requestId,
        expectedActorId: actor,
        payload: { ...baseline, definition: {} },
      }),
    ).toMatchObject({ ok: false, code: 'P1001' });
    expect(
      await reviewMetadataPublish({
        categoryId: category,
        expectedActorId: actor,
        expectedDraftId: draft,
        expectedDraftVersion: '1',
        expectedPublishedRevisionId: published,
      }),
    ).toMatchObject({ ok: false, code: 'P1001' });
    expect(await verifyMetadataDesignerIdentity(actor)).toMatchObject({
      ok: false,
      code: 'P1001',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a payload actor that differs from the fresh session', async () => {
    expect(
      await submitMetadataDraft({
        operation: 'metadata_draft_discard',
        requestId,
        expectedActorId: actor,
        payload: { ...baseline, expected_actor_id: nextActor },
      }),
    ).toMatchObject({ ok: false, code: 'P1001' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('passes the exact reviewed baseline only for an active maintainer', async () => {
    expect(await verifyMetadataDesignerIdentity(actor)).toEqual({ ok: true });
    await reviewMetadataPublish({
      categoryId: category,
      expectedActorId: actor,
      expectedDraftId: draft,
      expectedDraftVersion: '1',
      expectedPublishedRevisionId: published,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('metadata_publish_review', {
      p_payload: baseline,
    });
  });
});

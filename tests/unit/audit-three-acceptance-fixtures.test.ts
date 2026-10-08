import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { acceptanceFixtures } from '../e2e/audit-three-acceptance-fixtures';

const transport = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: transport.createClient,
}));

function client() {
  const faults = {
    revision: null as Error | null,
    create: null as Error | null,
    remove: null as Error | null,
  };
  let committed = false;
  const rpc = vi.fn(async (operation: string) => {
    if (operation === 'category_create') {
      committed = true;
      if (faults.create) throw faults.create;
      return { data: { category_id: 'owned' }, error: null };
    }
    if (operation === 'category_remove' && faults.remove) throw faults.remove;
    if (operation === 'asset_create_v3')
      return { data: { entity_id: 'asset' }, error: null };
    if (operation === 'quantity_create_v2')
      return { data: { entity_id: 'item' }, error: null };
    return {
      data: operation === 'category_removal_review' ? { token: 'review' } : {},
      error: null,
    };
  });
  const signInWithPassword = vi.fn(async () => ({
    data: { user: { id: 'actor' } },
    error: null,
  }));
  const signOut = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => {
    let columns = '',
      value: unknown;
    const result = () => ({
      data:
        table === 'categories'
          ? value === 'CABLES'
            ? { id: 'replacement' }
            : committed
              ? { id: 'owned' }
              : null
          : [],
      error: null,
    });
    const query = {
      select: (selected: string) => {
        columns = selected;
        return query;
      },
      eq: (_key: string, selected: unknown) => {
        value = selected;
        return query;
      },
      single: async () => {
        if (table === 'serialized_assets')
          return {
            data: { status: 'active', version: 1, site_id: null },
            error: null,
          };
        if (table === 'quantity_items')
          return { data: { archived: false, version: 1 }, error: null };
        if (columns === 'published_form_revision_id') {
          if (faults.revision) throw faults.revision;
          return {
            data: { published_form_revision_id: 'revision' },
            error: null,
          };
        }
        return result();
      },
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve(result())),
    };
    return query;
  });
  return { faults, rpc, from, auth: { signInWithPassword, signOut } };
}

describe('owned Audit3 browser fixture partial setup', () => {
  beforeEach(() => {
    vi.stubEnv('LOCAL_API_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3000');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('signs out after authentication throws without issuing a mutation', async () => {
    const caller = client(),
      failure = new Error('authentication transport failed');
    caller.auth.signInWithPassword.mockRejectedValueOnce(failure);
    transport.createClient.mockReturnValue(caller);
    await expect(acceptanceFixtures()).rejects.toBe(failure);
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(caller.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('removes the committed category when revision allocation fails before a handle returns', async () => {
    const caller = client(),
      failure = new Error('revision read failed');
    caller.faults.revision = failure;
    transport.createClient.mockReturnValue(caller);
    await expect(acceptanceFixtures()).rejects.toBe(failure);
    expect(caller.rpc).toHaveBeenCalledWith(
      'category_remove',
      expect.objectContaining({
        p_payload: expect.objectContaining({
          category_id: 'owned',
          review_token: 'review',
        }),
      }),
    );
    expect(caller.auth.signOut).toHaveBeenCalledOnce();
  });

  it('finds its unique category after a committed create loses its acknowledgement', async () => {
    const caller = client(),
      failure = new Error('create acknowledgement lost');
    caller.faults.create = failure;
    transport.createClient.mockReturnValue(caller);
    await expect(acceptanceFixtures()).rejects.toBe(failure);
    expect(caller.rpc).toHaveBeenCalledWith(
      'category_remove',
      expect.objectContaining({
        p_payload: expect.objectContaining({ category_id: 'owned' }),
      }),
    );
    expect(caller.auth.signOut).toHaveBeenCalledOnce();
  });

  it('uses numeric versions when cleaning up owned inventory through legacy RPCs', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    const owned = await acceptanceFixtures();
    await owned.asset('Owned asset', 'location');
    await owned.quantity('Owned quantity', 'location', 1);
    await owned.cleanup();
    for (const operation of ['asset_retire', 'quantity_archive_and_clear'])
      expect(caller.rpc).toHaveBeenCalledWith(
        operation,
        expect.objectContaining({
          p_payload: expect.objectContaining({ expected_version: 1 }),
        }),
      );
  });

  it('retains the setup and category-cleanup failures and still signs out', async () => {
    const caller = client(),
      setupFailure = new Error('revision read failed'),
      cleanupFailure = new Error('removal failed');
    caller.faults.revision = setupFailure;
    caller.faults.remove = cleanupFailure;
    transport.createClient.mockReturnValue(caller);
    const failure = await acceptanceFixtures().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    const combined = failure as AggregateError;
    expect(combined.errors[0]).toBe(setupFailure);
    expect(combined.errors[1]).toBeInstanceOf(AggregateError);
    expect((combined.errors[1] as AggregateError).errors).toContain(
      cleanupFailure,
    );
    expect(caller.auth.signOut).toHaveBeenCalledOnce();
  });
});

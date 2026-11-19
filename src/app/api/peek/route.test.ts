import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  read: vi.fn(),
  rethrow: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('@/features/peek/read.server', () => ({ readPeek: mocks.read }));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({ url: 'https://backend.test', key: 'public' }),
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: mocks.rethrow }));
import { GET, dynamic } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const context = { supabase: {}, member: { user_id: id, role: 'viewer' } };
const request = (query: string) =>
  new Request('https://app.test/api/peek?' + query);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue(context);
  mocks.read.mockResolvedValue({
    target: { kind: 'quantity', id },
    name: 'Adapters',
    status: 'active',
    stock: null,
    assetTag: null,
    locations: [],
    moreLocations: false,
    siteName: null,
    photo: null,
  });
});
afterEach(() => vi.useRealTimers());
it('uses one caller context for viewer reads and sends validated actor/backend with private no-store headers', async () => {
  const result = await GET(request('kind=quantity&id=' + id));
  expect(dynamic).toBe('force-dynamic');
  expect(mocks.member).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledWith(
    context,
    { kind: 'quantity', id },
    expect.any(AbortSignal),
  );
  expect(result.headers.get('Cache-Control')).toContain('private, no-store');
  expect(await result.json()).toMatchObject({
    actor: id,
    backend: 'https://backend.test',
  });
});
it.each([
  'kind=asset&id=no',
  'kind=location&code=ITC--D1',
  'kind=quantity&id=' + id + '&actor=' + id,
  'kind=asset&id=' + id + '&id=' + id,
  'kind=site&id=' + id,
])(
  'rejects invalid or client-authority target %s before any record read',
  async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.member).toHaveBeenCalledOnce();
  },
);
it.each(['inactive', 'nonmember', 'unauthenticated'])(
  'preserves %s authentication redirect control flow',
  async (state) => {
    const redirect = Object.assign(new Error(state), {
      digest: 'NEXT_REDIRECT',
    });
    mocks.member.mockRejectedValue(redirect);
    mocks.rethrow.mockImplementation((error) => {
      throw error;
    });
    await expect(GET(request('kind=quantity&id=' + id))).rejects.toBe(redirect);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it('returns forbidden on a caller permission failure and absence only on a genuine null read', async () => {
  mocks.read
    .mockRejectedValueOnce({ code: '42501' })
    .mockResolvedValueOnce(null);
  expect((await GET(request('kind=quantity&id=' + id))).status).toBe(403);
  expect((await GET(request('kind=quantity&id=' + id))).status).toBe(404);
});
it.each(['P1001', '42501', 'PGRST301', 'PGRST302', 'PGRST303'])(
  'classifies %s as access loss with private headers instead of a transient outage',
  async (code) => {
    mocks.read.mockRejectedValueOnce({
      code,
      message: 'Private database diagnostic',
    });
    const result = await GET(request('kind=quantity&id=' + id));
    expect(result.status).toBe(403);
    expect(result.headers.get('Cache-Control')).toContain('private, no-store');
    expect(await result.json()).toEqual({ error: 'forbidden' });
    expect(mocks.rethrow).toHaveBeenCalledWith({
      code,
      message: 'Private database diagnostic',
    });
  },
);
it('enforces an overall five-second deadline and aborts supported child reads', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  mocks.read.mockImplementation((_context, _target, abortSignal) => {
    signal = abortSignal;
    return new Promise(() => {});
  });
  const outcome = GET(request('kind=quantity&id=' + id));
  await vi.advanceTimersByTimeAsync(5000);
  expect((await outcome).status).toBe(503);
  expect(signal?.aborted).toBe(true);
});

it.each(['success', 'null', 'early failure', 'redirect'] as const)(
  'retires the shared child signal on %s while preserving the original outcome',
  async (outcome) => {
    let signal!: AbortSignal;
    const original = Object.assign(new Error('original'), { code: '42501' });
    mocks.read.mockImplementation((_context, _target, child) => {
      signal = child;
      if (outcome === 'early failure' || outcome === 'redirect') throw original;
      return outcome === 'null'
        ? null
        : {
            target: { kind: 'quantity', id },
            name: 'Adapters',
            status: 'active',
            stock: null,
            assetTag: null,
            locations: [],
            moreLocations: false,
            siteName: null,
            photo: null,
          };
    });
    if (outcome === 'redirect')
      mocks.rethrow.mockImplementation((error) => {
        throw error;
      });
    const result = GET(request('kind=quantity&id=' + id));
    if (outcome === 'redirect') await expect(result).rejects.toBe(original);
    else {
      const response = await result;
      expect(response.status).toBe(
        outcome === 'success' ? 200 : outcome === 'null' ? 404 : 403,
      );
      if (outcome === 'early failure')
        expect(mocks.rethrow).toHaveBeenCalledWith(original);
    }
    expect(signal.aborted).toBe(true);
  },
);
it('aborts parallel siblings after early failure and leaves late completion unable to change the error', async () => {
  let signal!: AbortSignal, finish!: () => void;
  let lateCommitted = false;
  const sibling = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const original = { code: '42501', message: 'Original permission failure' };
  mocks.read.mockImplementation((_context, _target, child) => {
    signal = child;
    return Promise.all([
      Promise.reject(original),
      sibling.then(() => {
        if (!child.aborted) lateCommitted = true;
      }),
    ]);
  });
  const result = await GET(request('kind=quantity&id=' + id));
  expect(signal.aborted).toBe(true);
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({ error: 'forbidden' });
  finish();
  await sibling;
  await Promise.resolve();
  expect(lateCommitted).toBe(false);
  expect(mocks.rethrow).toHaveBeenCalledWith(original);
});
it('rejects a late successful read after the original deadline', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal, finish!: (value: unknown) => void;
  mocks.read.mockImplementation((_context, _target, child) => {
    signal = child;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = GET(request('kind=quantity&id=' + id));
  await vi.advanceTimersByTimeAsync(5000);
  const result = await pending;
  finish({ name: 'Late private record' });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'unavailable' });
});

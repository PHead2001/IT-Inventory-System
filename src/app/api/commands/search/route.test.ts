import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  user: vi.fn(),
  member: vi.fn(),
  rpc: vi.fn(),
  abort: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.client,
}));
import { POST } from './route';
const result = { version: 1, rows: [], hasMore: false };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://backend.example');
  mocks.user.mockResolvedValue({
    data: { user: { id: 'actor' } },
    error: null,
  });
  mocks.member.mockResolvedValue({
    data: {
      user_id: 'actor',
      display_name: 'Staff',
      active: true,
      role: 'staff',
    },
    error: null,
  });
  mocks.abort.mockResolvedValue({ data: result, error: null });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.user },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.member }) }),
    }),
    rpc: mocks.rpc,
  });
});
afterEach(() => vi.unstubAllEnvs());
function request(
  body: unknown = { query: 'laptop' },
  origin = 'https://inventory.example',
) {
  return new NextRequest('https://inventory.example/api/commands/search', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('uses caller SDK and bounded parsed arguments and returns private no-store identity', async () => {
  const response = await POST(request({ query: ' Camera ', scope: 'all' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.rpc).toHaveBeenCalledWith('command_palette_search_v1', {
    p_query: 'Camera',
    p_scope: 'all',
    p_purpose: 'all',
  });
  expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect((await response.json()).identity.actorId).toBe('actor');
});
it.each([401, 403])(
  'rejects missing session or inactive membership (%s) before search',
  async (status) => {
    if (status === 401)
      mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    else
      mocks.member.mockResolvedValue({
        data: { user_id: 'actor', active: false, role: 'staff' },
        error: null,
      });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('preserves viewer access, distinguishes failed membership reads, and rejects foreign origin', async () => {
  mocks.member.mockResolvedValue({
    data: { user_id: 'actor', active: true, role: 'viewer' },
    error: null,
  });
  expect((await POST(request())).status).toBe(200);
  mocks.member.mockResolvedValue({ data: null, error: { message: 'offline' } });
  expect((await POST(request())).status).toBe(503);
  expect((await POST(request({}, 'https://foreign.example'))).status).toBe(403);
});
it.each([
  ['P1001', 403],
  ['P1012', 400],
  ['57014', 504],
  ['read_error', 503],
])('shows %s as an error, never no matches', async (code, status) => {
  mocks.abort.mockResolvedValue({ data: null, error: { code } });
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect(await response.json()).toHaveProperty('error');
});
it('rejects malformed, oversized, and invalid search without dispatch', async () => {
  for (const body of [
    { query: 'a'.repeat(5000) },
    { query: 'a\n' },
    { query: 'x', scope: 'other' },
    { query: 'x', purpose: 'hidden' },
  ])
    expect((await POST(request(body))).status).toBe(400);
  const raw = new NextRequest('https://inventory.example/api/commands/search', {
    method: 'POST',
    headers: { origin: 'https://inventory.example' },
    body: '{bad',
  });
  expect((await POST(raw)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['move', 'print'])(
  'forwards the validated %s purpose before database ranking',
  async (purpose) => {
    expect((await POST(request({ query: 'crowd', purpose }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('command_palette_search_v1', {
      p_query: 'crowd',
      p_scope: 'active',
      p_purpose: purpose,
    });
  },
);
it('rejects invalid result shape and thrown transport errors', async () => {
  mocks.abort.mockResolvedValue({ data: { rows: [] }, error: null });
  expect((await POST(request())).status).toBe(503);
  mocks.abort.mockRejectedValue(new Error('offline'));
  expect((await POST(request())).status).toBe(503);
});

it.each(['https://BACKEND.example:443/', 'https://backend.example/path/'])(
  'returns canonical backend origin for equivalent configured URL %s',
  async (configured) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).identity).toEqual({
      actorId: 'actor',
      backend: 'https://backend.example',
    });
  },
);
it.each(['', 'not a URL', 'mailto:backend@example.com'])(
  'fails closed for invalid backend configuration %s',
  async (configured) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  },
);

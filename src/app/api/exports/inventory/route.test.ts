import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createClient,
}));
import { GET } from './route';

const id = '00000000-0000-4000-8000-000000000001';
const query = {
  select: mocks.select,
  eq: mocks.eq,
  maybeSingle: mocks.maybeSingle,
};
const request = (search = '') =>
  new Request('https://inventory.example/api/exports/inventory' + search);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({
    data: { user_id: id, display_name: 'Viewer', role: 'viewer', active: true },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: { rows: [], total: 0, exported_at: '2026-09-24T15:18:37+00:00' },
    error: null,
  });
});
describe('authenticated inventory downloads', () => {
  it('denies anonymous and inactive members before querying inventory', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const anonymous = await GET(request());
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        user_id: id,
        display_name: 'Former member',
        role: 'viewer',
        active: false,
      },
      error: null,
    });
    const inactive = await GET(request());
    expect(inactive.status).toBe(403);
    expect(inactive.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lets a current viewer download all filtered rows in one scoped RPC call', async () => {
    const response = await GET(
      request(
        '?q=100%25_%5C&type=quantity&status=all&lowStock=true&page=8&export=low_stock',
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="preview-low-stock-20260924T151837Z.csv"',
    );
    expect(await response.text()).toContain('"Recorded Total"');
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('inventory_export_snapshot', {
      p_query: '100%_\\',
      p_type: 'quantity',
      p_status: 'all',
      p_category_id: undefined,
      p_location_code: undefined,
      p_low_stock: true,
      p_export_type: 'low_stock',
    });
  });
  it('marks production exports distinctly from isolated preview downloads', async () => {
    vi.stubEnv('APP_ENV', 'production');
    try {
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="inventory-20260924T151837Z.csv"',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('reports the bounded export limit without exposing backend details', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P1013', message: 'private SQL detail' },
    });
    const response = await GET(request());
    expect(response.status).toBe(413);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.text()).not.toContain('private');
  });
  it('rejects unsupported export kinds before invoking the snapshot', async () => {
    const response = await GET(request('?export=unknown'));
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

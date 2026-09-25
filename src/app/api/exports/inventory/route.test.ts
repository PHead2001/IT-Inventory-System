import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://supabase.example',
    key: 'public-test-key',
  }),
}));
vi.mock('@/features/inventory/export-reader.server', () => ({
  requestExportSnapshot: mocks.snapshot,
  SnapshotTooLargeError: class SnapshotTooLargeError extends Error {},
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
    auth: { getUser: mocks.getUser, getSession: mocks.getSession },
    from: mocks.from,
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({
    data: { user_id: id, display_name: 'Viewer', role: 'viewer', active: true },
    error: null,
  });
  mocks.snapshot.mockResolvedValue({
    data: { rows: [], total: 0, exported_at: '2026-09-24T15:18:37+00:00' },
  });
});
describe('authenticated inventory downloads', () => {
  it('denies anonymous and inactive members before querying inventory', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const anonymous = await GET(request());
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.snapshot).not.toHaveBeenCalled();
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
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('lets a current viewer download all filtered rows in one scoped RPC call', async () => {
    const response = await GET(
      request(
        '?q=100%25_%5C&type=quantity&status=all&lowStock=true&site=00000000-0000-4000-8000-000000000002&page=8&export=low_stock',
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="preview-low-stock-20260924T151837Z.csv"',
    );
    expect(await response.text()).toContain(
      '"Recorded Total","Reorder Threshold","Stock State"',
    );
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(mocks.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://supabase.example',
        accessToken: 'test-token',
        payload: {
          p_query: '100%_\\',
          p_type: 'quantity',
          p_status: 'all',
          p_category_id: null,
          p_location_code: null,
          p_site_id: '00000000-0000-4000-8000-000000000002',
          p_low_stock: true,
          p_export_type: 'low_stock',
          p_include_custom: false,
        },
      }),
    );
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
    mocks.snapshot.mockResolvedValue({
      data: null,
      code: 'P1013',
    });
    const response = await GET(request());
    expect(response.status).toBe(413);
    expect(response.headers.get('X-Inventory-Export-Error')).toBe(
      'export_row_limit',
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.text()).not.toContain('private');
  });
  it('rejects a single oversized custom record with an actionable 413 and no file header', async () => {
    mocks.snapshot.mockResolvedValue({ data: null, code: 'P1025' });
    const response = await GET(request('?customFields=true'));
    expect(response.status).toBe(413);
    expect(response.headers.get('X-Inventory-Export-Error')).toBe(
      'export_too_large',
    );
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(await response.text()).toContain('retry without custom fields');
    expect(mocks.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ p_include_custom: true }),
      }),
    );
  });
  it('returns a retryable timeout without a partial CSV when the request aborts', async () => {
    mocks.snapshot.mockImplementation(
      async ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const abort = new AbortController();
    const pending = GET(
      new Request('https://inventory.example/api/exports/inventory', {
        signal: abort.signal,
      }),
    );
    abort.abort();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('X-Inventory-Export-Error')).toBe(
      'export_timeout',
    );
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(await response.text()).toContain('Retry');
  });
  it('stops after an authentication wait expires before starting the export fetch', async () => {
    let finishUser: ((value: unknown) => void) | undefined;
    mocks.getUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUser = resolve;
        }),
    );
    const abort = new AbortController();
    const pending = GET(
      new Request('https://inventory.example/api/exports/inventory', {
        signal: abort.signal,
      }),
    );
    await Promise.resolve();
    abort.abort();
    const response = await pending;
    finishUser?.({ data: { user: { id } }, error: null });
    await Promise.resolve();
    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('maps database cancellation to a retryable timeout with no CSV', async () => {
    mocks.snapshot.mockResolvedValue({ data: null, code: '57014' });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('X-Inventory-Export-Error')).toBe(
      'export_timeout',
    );
    expect(response.headers.get('Content-Disposition')).toBeNull();
  });
  it('emits only bounded, anonymous diagnostics with explicit preview opt-in', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const secret = 'PRIVATE-INVENTORY-NAME-XYZ';
    mocks.snapshot.mockImplementation(
      async ({
        onStage,
      }: {
        onStage?: (
          stage: 'raw_chunk' | 'raw_read' | 'json_parsed',
          bytes: number,
        ) => void;
      }) => {
        onStage?.('raw_chunk', 256);
        onStage?.('raw_chunk', 512);
        onStage?.('raw_read', 512);
        onStage?.('json_parsed', 512);
        return {
          data: {
            rows: [
              {
                entity_id: id,
                kind: 'quantity',
                name: secret,
                category_name: 'Secret category',
                manufacturer: null,
                model: null,
                asset_tag: null,
                serial_number: null,
                status: 'active',
                quantity: 0,
                location_name: null,
                location_code: null,
                breadcrumb: null,
                custom_fields: { secret: 'Sensitive custom value' },
              },
            ],
            total: '1',
            exported_at: '2026-09-24T15:18:37+00:00',
          },
        };
      },
    );
    try {
      const response = await GET(request('?q=secret-filter&customFields=true'));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(secret);
      expect(log).toHaveBeenCalledOnce();
      const diagnostic = JSON.parse(String(log.mock.calls[0][0])) as Record<
        string,
        unknown
      >;
      expect(Object.keys(diagnostic).sort()).toEqual([
        'csv_bytes',
        'diagnostic_id',
        'elapsed_ms',
        'event',
        'raw_response_bytes',
        'sampled_heap_external_delta_bytes',
        'sampled_rss_delta_bytes',
      ]);
      expect(diagnostic.event).toBe('inventory_export_diagnostic');
      expect(diagnostic.diagnostic_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get('X-Inventory-Export-Diagnostic-Id')).toBe(
        diagnostic.diagnostic_id,
      );
      expect(diagnostic.raw_response_bytes).toBe(512);
      expect(diagnostic.csv_bytes).toBeGreaterThan(0);
      expect(
        diagnostic.sampled_heap_external_delta_bytes,
      ).toBeGreaterThanOrEqual(0);
      expect(diagnostic.sampled_rss_delta_bytes).toBeGreaterThanOrEqual(0);
      expect(diagnostic.elapsed_ms).toMatchObject({
        raw_read: expect.any(Number),
        raw_chunk: expect.any(Number),
        json_parsed: expect.any(Number),
        csv_row: expect.any(Number),
        csv_encoded: expect.any(Number),
        complete: expect.any(Number),
      });
      const logged = String(log.mock.calls[0][0]);
      for (const forbidden of [
        secret,
        'secret-filter',
        'Sensitive custom value',
        'test-token',
        id,
      ])
        expect(logged).not.toContain(forbidden);
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('keeps diagnostics silent outside preview or without server opt-in', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      vi.stubEnv('VERCEL_ENV', 'production');
      vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
      expect((await GET(request())).status).toBe(200);
      vi.stubEnv('VERCEL_ENV', 'preview');
      vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'false');
      expect((await GET(request())).status).toBe(200);
      expect(log).not.toHaveBeenCalled();
      expect(
        (await GET(request())).headers.get('X-Inventory-Export-Diagnostic-Id'),
      ).toBeNull();
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('keeps the completed CSV when preview logging fails', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('log sink unavailable');
    });
    try {
      const response = await GET(request('?customFields=true'));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Disposition')).toContain('.csv');
      expect(await response.text()).toContain('Custom Fields JSON');
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('falls back to ordinary export when diagnostic baseline sampling fails', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
    const memory = vi.spyOn(process, 'memoryUsage').mockImplementation(() => {
      throw new Error('memory sampler unavailable');
    });
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Disposition')).toContain('.csv');
      expect(
        response.headers.get('X-Inventory-Export-Diagnostic-Id'),
      ).toBeNull();
      expect(log).not.toHaveBeenCalled();
    } finally {
      memory.mockRestore();
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('keeps a preview timeout file-free while emitting one anonymous diagnostic', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.snapshot.mockResolvedValue({ data: null, code: '57014' });
    try {
      const response = await GET(request('?q=private-timeout-filter'));
      expect(response.status).toBe(503);
      expect(response.headers.get('Content-Disposition')).toBeNull();
      expect(log).toHaveBeenCalledOnce();
      expect(response.headers.get('X-Inventory-Export-Diagnostic-Id')).toBe(
        JSON.parse(String(log.mock.calls[0][0])).diagnostic_id,
      );
      expect(String(log.mock.calls[0][0])).not.toContain(
        'private-timeout-filter',
      );
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('checks the monotonic deadline during synchronous CSV encoding before success headers', async () => {
    mocks.snapshot.mockResolvedValue({
      data: {
        rows: [],
        total: '0',
        exported_at: '2026-09-24T15:18:37+00:00',
      },
    });
    let fakeTime = 100;
    const nowSpy = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => fakeTime);
    const encode = TextEncoder.prototype.encode;
    const encodeSpy = vi
      .spyOn(TextEncoder.prototype, 'encode')
      .mockImplementation(function (this: TextEncoder, input?: string) {
        const bytes = encode.call(this, input);
        if (input?.includes('"Record ID"')) fakeTime = 10101;
        return bytes;
      });
    try {
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(response.headers.get('X-Inventory-Export-Error')).toBe(
        'export_timeout',
      );
      expect(response.headers.get('Content-Disposition')).toBeNull();
    } finally {
      nowSpy.mockRestore();
      encodeSpy.mockRestore();
    }
  });
  it('rejects unsupported export kinds before invoking the snapshot', async () => {
    const response = await GET(request('?export=unknown'));
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});

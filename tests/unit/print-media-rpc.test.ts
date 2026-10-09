import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { dispatchPrintMediaRpc } from '../integration/print-media-configuration';

describe('print-media concurrency fixture dispatch', () => {
  it('starts the real SDK request before awaiting its pending result and sends it once', async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = createClient('http://127.0.0.1:54321', 'offline-test-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch },
    });
    const requestId = '00000000-0000-4000-8000-000000000001';
    const payload = {
      expected_version: '7',
      size: '90x50',
      page: 'letter',
      format: 'qr',
    };
    const pending = dispatchPrintMediaRpc(client, payload, requestId);
    // The independent SQL transaction must observe a dispatched request before
    // it commits. Awaiting pending first would deadlock that test sequence.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0]).toEqual([
      'http://127.0.0.1:54321/rest/v1/rpc/label_defaults_update',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ p_request_id: requestId, p_payload: payload }),
      }),
    ]);
    const result = { version: '7', event_id: null, changed: false };
    release(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect((await pending).data).toEqual(result);
    expect((await pending).error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

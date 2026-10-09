import { isDeepStrictEqual } from 'node:util';
import type { Page, Route } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observedLabelDefaultsCommand,
  withOwnedLabelDefaults,
} from '../e2e/label-defaults-fixture';
const transport = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: transport.createClient,
}));
const layout = {
  version: 1 as const,
  mode: 'single' as const,
  labelWidth: 900,
  labelHeight: 500,
};
const starting = {
  size: '90x50' as const,
  page: 'letter' as const,
  format: 'qr' as const,
  layout,
  version: '41',
};
const selected = {
  size: '70x35' as const,
  page: 'A4' as const,
  format: 'code128' as const,
  layout: null,
};
const requestId = 'bea94cf9-138b-4764-839b-fa463563a91c';
type Args = { p_request_id: string; p_payload: Record<string, unknown> };
function client(initial: Record<string, unknown> = starting) {
  let state = { ...initial },
    handler: ((route: Route) => Promise<void>) | undefined;
  const receipts = new Map<
    string,
    { payload: unknown; result: { version: string; changed: boolean } }
  >();
  const directWrite = vi.fn(() => {
    throw new Error('42501: permission denied for function valid_print_layout');
  });
  const single = vi.fn(async () => ({ data: { ...state }, error: null }));
  const select = vi.fn(() => ({ single }));
  const from = vi.fn(() => ({ select, update: directWrite }));
  const rpc = vi.fn(async (_operation: string, args: Args) => {
    const receipt = receipts.get(args.p_request_id);
    if (receipt) {
      if (!isDeepStrictEqual(receipt.payload, args.p_payload))
        return { data: null, error: { code: 'P1009' } };
      return { data: receipt.result, error: null };
    }
    const { expected_version, ...next } = args.p_payload;
    if (expected_version !== state.version)
      return { data: null, error: { code: 'P1002' } };
    const { version, ...current } = state;
    const changed = !isDeepStrictEqual(current, next);
    state = {
      ...next,
      version: (BigInt(String(version)) + BigInt(changed)).toString(),
    };
    const result = { version: String(state.version), changed };
    receipts.set(args.p_request_id, { payload: args.p_payload, result });
    return { data: result, error: null };
  });
  const auth = {
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  const page = {
    route: vi.fn(
      async (_pattern: string, observe: (route: Route) => Promise<void>) => {
        handler = observe;
      },
    ),
    unroute: vi.fn(async () => {
      handler = undefined;
    }),
  } as unknown as Pick<Page, 'route' | 'unroute'>;
  const args: Args = {
    p_request_id: requestId,
    p_payload: { expected_version: initial.version, ...selected },
  };
  const body = JSON.stringify([
    { operation: 'label_defaults_update', requestId, payload: args.p_payload },
  ]);
  const forward = vi.fn(async () => {
    await rpc('label_defaults_update', args);
  });
  const abort = vi.fn(async () => {});
  return {
    page,
    from,
    select,
    single,
    directWrite,
    rpc,
    auth,
    args,
    body,
    forward,
    abort,
    dispatch: async (send = true, observedBody = body) => {
      await handler!({
        request: () => ({
          method: () => 'POST',
          headers: () => ({ 'next-action': 'observed-action-id' }),
          url: () => 'http://localhost:3000/settings/labels',
          postData: () => observedBody,
        }),
        continue: send ? forward : async () => {},
        abort,
      } as unknown as Route);
    },
    external: (version: string, size = '70x35') => {
      state = { ...state, version, size };
    },
    state: () => state,
  };
}
describe('owned shared label defaults fixture', () => {
  beforeEach(() => {
    vi.stubEnv('LOCAL_API_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'local-public-key');
    vi.stubEnv('LOCAL_SERVICE_ROLE_KEY', 'must-not-be-used');
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([layout, null])(
    'restores explicit original layout %j after a later assertion fails',
    async (originalLayout) => {
      const caller = client({ ...starting, layout: originalLayout });
      transport.createClient.mockReturnValue(caller);
      const failure = new Error('later browser assertion failed');
      await expect(
        withOwnedLabelDefaults(caller.page, async (defaults) => {
          expect(defaults.starting).toEqual({
            ...starting,
            layout: originalLayout,
          });
          expect(defaults.reviewSave(selected)).toBe('Label settings saved.');
          await caller.dispatch();
          await defaults.confirmSaved();
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(transport.createClient).toHaveBeenCalledWith(
        'http://127.0.0.1:54321/',
        'local-public-key',
        expect.anything(),
      );
      expect(caller.select).toHaveBeenCalledWith(
        'size,page,format,layout,version',
      );
      expect(caller.from).toHaveBeenCalledWith('configuration_label_defaults');
      expect(caller.directWrite).not.toHaveBeenCalled();
      expect(caller.rpc.mock.calls[1]).toEqual([
        'label_defaults_update',
        caller.args,
      ]);
      expect(caller.rpc.mock.calls[2]).toEqual([
        'label_defaults_update',
        {
          p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          p_payload: {
            expected_version: '42',
            size: '90x50',
            page: 'letter',
            format: 'qr',
            layout: originalLayout,
          },
        },
      ]);
      expect(caller.state()).toEqual({
        ...starting,
        layout: originalLayout,
        version: '43',
      });
      expect(caller.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    },
  );
  it('settles delayed dispatch and its later original replay cannot overwrite restoration', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    const failure = new Error('browser response aborted');
    await expect(
      withOwnedLabelDefaults(caller.page, async (defaults) => {
        defaults.reviewSave(selected);
        await caller.dispatch(false);
        expect(caller.state()).toEqual(starting);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(caller.rpc.mock.calls[0]).toEqual([
      'label_defaults_update',
      caller.args,
    ]);
    expect(caller.state()).toEqual({ ...starting, version: '43' });
    await caller.rpc('label_defaults_update', caller.args);
    expect(caller.state()).toEqual({ ...starting, version: '43' });
  });
  it('waits for settlement before any ownership read or restore', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settle = caller.rpc.getMockImplementation()!;
    caller.rpc.mockImplementationOnce(async (operation, args) => {
      enter();
      await barrier;
      return settle(operation, args);
    });
    const run = withOwnedLabelDefaults(caller.page, async (defaults) => {
      defaults.reviewSave(selected);
      await caller.dispatch(false);
    });
    await entered;
    expect(caller.single).toHaveBeenCalledOnce();
    expect(caller.rpc).toHaveBeenCalledOnce();
    expect(caller.state()).toEqual(starting);
    release();
    await run;
    expect(caller.state()).toEqual({ ...starting, version: '43' });
  });
  it('handles no-op status and unchanged version without a restore mutation', async () => {
    const caller = client({ ...selected, version: '41' });
    transport.createClient.mockReturnValue(caller);
    await withOwnedLabelDefaults(caller.page, async (defaults) => {
      expect(defaults.reviewSave(selected)).toBe('No values changed.');
      await caller.dispatch();
      await defaults.confirmSaved();
    });
    expect(caller.rpc).toHaveBeenCalledTimes(2);
    expect(caller.state()).toEqual({ ...selected, version: '41' });
  });
  it('preserves exact versions above JavaScript safe integers', async () => {
    const caller = client({ ...starting, version: '9007199254740993' });
    transport.createClient.mockReturnValue(caller);
    await withOwnedLabelDefaults(caller.page, async (defaults) => {
      defaults.reviewSave(selected);
      await caller.dispatch();
      await defaults.confirmSaved();
    });
    expect(caller.rpc.mock.calls[2][1].p_payload.expected_version).toBe(
      '9007199254740994',
    );
    expect(caller.state().version).toBe('9007199254740995');
  });
  it.each([
    ['43', '70x35'],
    ['42', '90x50'],
  ])(
    'refuses external version/state %s/%s after settling original receipt',
    async (version, size) => {
      const caller = client();
      transport.createClient.mockReturnValue(caller);
      await expect(
        withOwnedLabelDefaults(caller.page, async (defaults) => {
          defaults.reviewSave(selected);
          await caller.dispatch();
          await defaults.confirmSaved();
          caller.external(version, size);
        }),
      ).rejects.toThrow();
      expect(caller.rpc).toHaveBeenCalledTimes(2);
      expect(caller.rpc.mock.calls[1][1]).toEqual(caller.args);
      expect(caller.state()).toMatchObject({ version, size });
    },
  );
  it('fails closed on an uncaptured save without claiming an unchanged read is safe', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    await expect(
      withOwnedLabelDefaults(caller.page, async (defaults) => {
        defaults.reviewSave(selected);
      }),
    ).rejects.toThrow();
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(caller.single).toHaveBeenCalledOnce();
    expect(caller.auth.signOut).toHaveBeenCalledOnce();
  });
  it('aborts unsupported serialization before forwarding and fails cleanup closed', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    await expect(
      withOwnedLabelDefaults(caller.page, async (defaults) => {
        defaults.reviewSave(selected);
        await caller.dispatch(true, 'unsupported flight serialization');
      }),
    ).rejects.toThrow();
    expect(caller.forward).not.toHaveBeenCalled();
    expect(caller.abort).toHaveBeenCalledWith('failed');
    expect(caller.rpc).not.toHaveBeenCalled();
  });
  it('does not restore after failed settlement or rebase onto a newer version', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    caller.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { code: '57014' },
    }));
    await expect(
      withOwnedLabelDefaults(caller.page, async (defaults) => {
        defaults.reviewSave(selected);
        await caller.dispatch(false);
      }),
    ).rejects.toThrow();
    expect(caller.rpc).toHaveBeenCalledExactlyOnceWith(
      'label_defaults_update',
      caller.args,
    );
    expect(caller.single).toHaveBeenCalledOnce();
    expect(caller.state()).toEqual(starting);
  });
  it('keeps expected owned version if an external update races restoration', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    const original = caller.rpc.getMockImplementation()!;
    caller.rpc.mockImplementation(async (operation, args) => {
      if (args.p_request_id !== requestId) caller.external('43');
      return original(operation, args);
    });
    await expect(
      withOwnedLabelDefaults(caller.page, async (defaults) => {
        defaults.reviewSave(selected);
        await caller.dispatch();
        await defaults.confirmSaved();
      }),
    ).rejects.toThrow();
    expect(caller.rpc.mock.calls[2][1].p_payload.expected_version).toBe('42');
    expect(caller.state()).toMatchObject({ ...selected, version: '43' });
  });
  it('signs out without mutation if failure precedes shared save', async () => {
    const caller = client();
    transport.createClient.mockReturnValue(caller);
    const failure = new Error('category workflow failed');
    await expect(
      withOwnedLabelDefaults(caller.page, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(caller.auth.signOut).toHaveBeenCalledOnce();
  });
});
describe('observed Next Settings action mapping', () => {
  const command = {
    operation: 'label_defaults_update',
    requestId,
    payload: { expected_version: '9007199254740993', ...selected },
  };
  it('maps retained trace serialization through canonical validation without replacing identity', () => {
    expect(observedLabelDefaultsCommand(JSON.stringify([command]))).toEqual(
      command,
    );
  });
  it.each([
    null,
    '{}',
    '[]',
    JSON.stringify([command, command]),
    JSON.stringify([{ ...command, requestId: 'invalid' }]),
    JSON.stringify([
      {
        ...command,
        payload: { ...command.payload, layout: { mode: 'single' } },
      },
    ]),
    JSON.stringify([{ ...command, extra: true }]),
  ])('rejects unknown or invalid transport %s', (body) => {
    expect(() => observedLabelDefaultsCommand(body)).toThrow();
  });
});

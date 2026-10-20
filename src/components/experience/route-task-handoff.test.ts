import { afterEach, expect, it, vi } from 'vitest';
import { createNativeTaskHandoff, type TaskSource } from './route-task-handoff';
import { routeKey } from './route-key';
import { replaceAppHistoryUrl } from '@/lib/navigation/history';
const path = '/inventory/assets/a3010000-0000-4000-8000-0000000000ab';
const key = () =>
  routeKey(location.pathname, new URLSearchParams(location.search));
function source(overrides: Partial<TaskSource> = {}): TaskSource {
  return {
    root: document.body,
    actorId: 'actor',
    contentIdentity: 'record',
    serverAnchor: path,
    cleanKey: path,
    navigationIdentity: 0,
    securityRevision: 'security-1',
    pendingEpoch: 1,
    committedKey: key(),
    fresh: true,
    idle: true,
    visible: true,
    ...overrides,
  };
}
function admitted(clean = path) {
  history.replaceState({}, '', clean);
  const handoff = createNativeTaskHandoff();
  const accepted = source({ serverAnchor: clean, cleanKey: clean });
  handoff.observe(accepted, true);
  return { handoff, accepted };
}
function task(query = 'task=asset_move') {
  history.replaceState(
    { __NA: true, _N: true, user: 'kept' },
    '',
    path + '?' + query + '#tasks',
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});
it.each([false, true])(
  'an opaque document cannot mint a receipt or throw when accepted=%s',
  (acceptedPrimary) => {
    history.replaceState({}, '', path);
    const handoff = createNativeTaskHandoff();
    const initial = source();
    vi.stubGlobal('location', { origin: 'null' });
    const apply = vi.fn();
    try {
      expect(() => handoff.observe(initial, acceptedPrimary)).not.toThrow();
      expect(handoff.consume(initial, path, 'asset_move', apply)).toBeNull();
      expect(apply).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
it('rejects a malformed accepted route without minting a receipt', () => {
  const handoff = createNativeTaskHandoff();
  const initial = source({ cleanKey: 'http://[', committedKey: 'http://[' });
  const apply = vi.fn();
  expect(() => handoff.observe(initial, true)).not.toThrow();
  expect(handoff.consume(initial, path, 'asset_move', apply)).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
it('does not admit a registration, stale router snapshot, task URL, or retired cached receipt', () => {
  for (const reason of ['unaccepted', 'stale', 'task', 'retired']) {
    history.replaceState({}, '', path);
    const handoff = createNativeTaskHandoff();
    const initial = source();
    if (reason === 'task') {
      task();
      initial.cleanKey = key();
      initial.committedKey = key();
    }
    if (reason === 'stale') initial.committedKey = '/history';
    handoff.observe(initial, reason !== 'unaccepted');
    if (reason === 'retired') handoff.retire();
    task();
    expect(
      handoff.consume(source(), path, 'asset_move', replaceAppHistoryUrl),
    ).toBeNull();
  }
});
it('preserves unknown repeated query, hash and user history state, and keeps the immutable server anchor across repeated native consumption', () => {
  const clean = path + '?keep=Case&keep=Other';
  const { handoff, accepted } = admitted(clean);
  for (let repeat = 0; repeat < 2; repeat++) {
    task('keep=Case&keep=Other&returnTo=%2Finventory&task=asset_move');
    const result = handoff.consume(
      source({ ...accepted, committedKey: key() }),
      path,
      'asset_move',
      replaceAppHistoryUrl,
    );
    expect(result).toEqual({
      sourceKey: clean,
      destinationKey: clean + '&returnTo=%2Finventory',
    });
    expect(location.hash).toBe('#tasks');
    expect(history.state).toEqual({ user: 'kept' });
    expect(location.search).toBe('?keep=Case&keep=Other&returnTo=%2Finventory');
  }
});
it.each([
  'task=asset_move&task=asset_move',
  'task=quantity_move',
  'task=unknown',
  'task=asset_move&returnTo=%2Finventory&returnTo=%2Fhistory',
  'task=asset_move&returnTo=https%3A%2F%2Fevil.invalid',
  'task=asset_move&returnTo=',
  'task=asset_move&keep=changed',
  'task=asset_move&keep=Case&keep=Changed',
])(
  'rejects invalid or semantically changed query %s without applying, then permanently retires that receipt',
  (query) => {
    const { handoff, accepted } = admitted(path + '?keep=Case&keep=Other');
    task(query);
    const apply = vi.fn();
    expect(
      handoff.consume(
        source({ ...accepted, committedKey: key() }),
        path,
        'asset_move',
        apply,
      ),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    task('keep=Case&keep=Other&task=asset_move');
    expect(
      handoff.consume(
        source({ ...accepted, committedKey: key() }),
        path,
        'asset_move',
        replaceAppHistoryUrl,
      ),
    ).toBeNull();
  },
);
it.each([
  'actor',
  'root',
  'content',
  'anchor',
  'navigation',
  'security',
  'epoch',
  'fresh',
  'idle',
  'visible',
  'router',
  'record',
  'apply-error',
  'apply-noop',
  'apply-revoke',
])('refuses %s without reviving after the cause clears', (reason) => {
  const { handoff, accepted } = admitted();
  task();
  let current = source({ ...accepted, committedKey: key() });
  const updates: Record<string, Partial<TaskSource>> = {
    actor: { actorId: 'other' },
    root: { root: document.createElement('div') },
    content: { contentIdentity: 'other' },
    anchor: { serverAnchor: '/history' },
    navigation: { navigationIdentity: 2 },
    security: { securityRevision: 'security-2' },
    epoch: { pendingEpoch: 2 },
    fresh: { fresh: false },
    idle: { idle: false },
    visible: { visible: false },
    router: { committedKey: path },
  };
  current = { ...current, ...updates[reason] };
  const apply = vi.fn((href: string) => {
    if (reason === 'apply-error') throw Error('denied');
    if (reason === 'apply-noop') return;
    replaceAppHistoryUrl(href);
    if (reason === 'apply-revoke') handoff.retire();
  });
  expect(
    handoff.consume(
      current,
      reason === 'record' ? path + 'x' : path,
      'asset_move',
      apply,
    ),
  ).toBeNull();
  task();
  expect(
    handoff.consume(
      source({ ...accepted, committedKey: key() }),
      path,
      'asset_move',
      replaceAppHistoryUrl,
    ),
  ).toBeNull();
});
it('permits a genuinely new accepted navigation binding after retirement, but refuses a new binding from registration alone', () => {
  const { handoff, accepted } = admitted();
  handoff.retire();
  const next = { ...accepted, navigationIdentity: 2 };
  handoff.observe(next, false);
  task();
  expect(
    handoff.consume(
      source({ ...next, committedKey: key() }),
      path,
      'asset_move',
      replaceAppHistoryUrl,
    ),
  ).toBeNull();
  history.replaceState({}, '', path);
  handoff.observe(next, true);
  task();
  expect(
    handoff.consume(
      source({ ...next, committedKey: key() }),
      path,
      'asset_move',
      replaceAppHistoryUrl,
    ),
  ).not.toBeNull();
});

it('refuses empty task values and unsupported record routes', () => {
  for (const record of [path, '/history', '/inventory/assets/record/extra']) {
    const { handoff, accepted } = admitted(record);
    history.replaceState({}, '', record + '?task=');
    const apply = vi.fn();
    expect(
      handoff.consume(
        source({ ...accepted, committedKey: key() }),
        record,
        '',
        apply,
      ),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  }
});

it('a fresh exact accepted busy primary is only a candidate until its unchanged binding becomes idle', () => {
  history.replaceState({}, '', path);
  const handoff = createNativeTaskHandoff();
  const busy = source({ idle: false });
  handoff.observe(busy, true);
  handoff.observe({ ...busy, idle: true }, true);
  task();
  expect(
    handoff.consume(
      source({ ...busy, idle: true, committedKey: key() }),
      path,
      'asset_move',
      replaceAppHistoryUrl,
    ),
  ).not.toBeNull();
});
it.each([
  'retire',
  'security',
  'epoch',
  'hidden',
  'stale',
  'semantic',
  'return-path',
  'task-before-idle',
  'unaccepted-binding',
] as const)(
  'does not revive deferred busy candidate after %s even if the current source later becomes fresh and idle',
  (reason) => {
    history.replaceState({}, '', path);
    const handoff = createNativeTaskHandoff();
    const busy = source({ idle: false });
    handoff.observe(busy, true);
    const changes: Record<string, Partial<TaskSource>> = {
      security: { securityRevision: 'reverified' },
      epoch: { pendingEpoch: 2 },
      hidden: { visible: false },
      stale: { fresh: false },
      semantic: { committedKey: path + '?unknown=changed' },
      'return-path': {
        cleanKey: path + '?returnTo=%2Finventory',
        committedKey: path + '?returnTo=%2Finventory',
      },
      'task-before-idle': { committedKey: path + '?task=asset_move' },
      'unaccepted-binding': { navigationIdentity: 2 },
    };
    if (reason === 'retire') handoff.retire();
    else
      handoff.observe(
        { ...busy, ...changes[reason] },
        reason !== 'unaccepted-binding',
      );
    handoff.observe({ ...busy, idle: true }, true);
    task();
    expect(
      handoff.consume(
        source({ ...busy, idle: true, committedKey: key() }),
        path,
        'asset_move',
        replaceAppHistoryUrl,
      ),
    ).toBeNull();
    // Only an explicitly new accepted navigation binding can replace the tombstone.
    history.replaceState({}, '', path);
    const next = { ...busy, idle: true, navigationIdentity: 3 };
    handoff.observe(next, true);
    task();
    expect(
      handoff.consume(
        source({ ...next, committedKey: key() }),
        path,
        'asset_move',
        replaceAppHistoryUrl,
      ),
    ).not.toBeNull();
  },
);
it('initial unverified renders cannot create or poison a candidate before the first fresh accepted primary', () => {
  history.replaceState({}, '', path);
  const handoff = createNativeTaskHandoff();
  handoff.observe(
    source({ fresh: false, securityRevision: 'bootstrap' }),
    false,
  );
  handoff.retire();
  handoff.observe(source(), true);
  task();
  expect(
    handoff.consume(source(), path, 'asset_move', replaceAppHistoryUrl),
  ).not.toBeNull();
});

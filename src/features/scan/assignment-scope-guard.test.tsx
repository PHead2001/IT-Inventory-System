import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { AssignmentScopeGuard } from './assignment-scope-guard';
import {
  assignmentEpoch,
  adoptAssignmentScope,
  invalidateAssignmentPrivacy,
  batchKey,
  emptyBatch,
  readBatch,
  storeBatch,
} from './assign-batch';
const mocks = vi.hoisted(() => ({
  changed: null as
    null | ((event: string, session: { user: { id: string } } | null) => void),
  unsubscribe: vi.fn(),
  subscribed: vi.fn(),
  clientFailure: false,
  subscriptionFailure: false,
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => {
    if (mocks.clientFailure) throw new Error('client unavailable');
    return {
      auth: {
        onAuthStateChange: (fn: typeof mocks.changed) => {
          if (mocks.subscriptionFailure)
            throw new Error('subscription unavailable');
          mocks.subscribed(fn);
          mocks.changed = fn;
          return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
        },
      },
    };
  },
}));
const id = '00000000-0000-4000-8000-000000000001';
const scope = {
  actor: id,
  origin: window.location.origin,
  backend: 'https://isolated.supabase.co',
};
beforeEach(() => {
  sessionStorage.clear();
  mocks.unsubscribe.mockClear();
  mocks.subscribed.mockClear();
  mocks.changed = null;
  mocks.clientFailure = false;
  mocks.subscriptionFailure = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  invalidateAssignmentPrivacy(true);
});
it.each(['SIGNED_OUT', 'SIGNED_IN'])(
  'retains the auth listener after adoption fails and applies %s cleanup when storage returns',
  (event) => {
    sessionStorage.setItem('inventory-assign-v1:old', 'original command');
    sessionStorage.setItem(batchKey(scope), JSON.stringify(emptyBatch(scope)));
    const storage = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable');
      });
    const view = render(
      <AssignmentScopeGuard actorId={id} backend={scope.backend} />,
    );
    expect(mocks.subscribed).toHaveBeenCalledOnce();
    act(() =>
      mocks.changed?.(
        event,
        event === 'SIGNED_OUT' ? null : { user: { id: 'different' } },
      ),
    );
    if (event === 'SIGNED_OUT')
      act(() => mocks.changed?.('SIGNED_IN', { user: { id: 'another' } }));
    storage.mockRestore();
    adoptAssignmentScope(scope);
    expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe(
      event === 'SIGNED_OUT' ? null : 'original command',
    );
    expect(readBatch(scope).value).toBeNull();
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  },
);
it('unsubscribes each StrictMode and actor/backend scope subscription', () => {
  const view = render(
    <StrictMode>
      <AssignmentScopeGuard actorId={id} backend={scope.backend} />
    </StrictMode>,
  );
  expect(mocks.subscribed).toHaveBeenCalledTimes(2);
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  view.rerender(
    <StrictMode>
      <AssignmentScopeGuard
        actorId="another"
        backend="https://other.supabase.co"
      />
    </StrictMode>,
  );
  expect(mocks.subscribed).toHaveBeenCalledTimes(3);
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(3);
});
it.each(['client', 'subscription'])(
  'fails closed when %s creation fails',
  (failure) => {
    sessionStorage.setItem(batchKey(scope), JSON.stringify(emptyBatch(scope)));
    sessionStorage.setItem('inventory-assign-v1:old', 'original command');
    mocks.clientFailure = failure === 'client';
    mocks.subscriptionFailure = failure === 'subscription';
    const before = assignmentEpoch();
    render(<AssignmentScopeGuard actorId={id} backend={scope.backend} />);
    expect(assignmentEpoch()).toBeGreaterThan(before);
    expect(readBatch(scope).value).toBeNull();
    expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe(
      'original command',
    );
  },
);
it('clears private batch state on auth mismatch away from Scan while retaining original uncertainty', () => {
  render(<AssignmentScopeGuard actorId={id} backend={scope.backend} />);
  storeBatch(emptyBatch(scope), null);
  sessionStorage.setItem('inventory-assign-v1:old', 'original');
  const before = assignmentEpoch();
  act(() => mocks.changed?.('SIGNED_IN', { user: { id: 'different-actor' } }));
  expect(assignmentEpoch()).toBeGreaterThan(before);
  expect(readBatch(scope).value).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe('original');
});
it('authoritative logout clears unknown commands and unsubscribes when the shell leaves', () => {
  const view = render(
    <AssignmentScopeGuard actorId={id} backend={scope.backend} />,
  );
  sessionStorage.setItem('inventory-assign-v1:old', 'original');
  act(() => mocks.changed?.('SIGNED_OUT', null));
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull();
  view.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});
it('detects persisted backend scope drift before loading a new shell even without a scan workspace', () => {
  sessionStorage.setItem(
    'inventory-assign-scope-v1',
    batchKey({ ...scope, backend: 'https://old.supabase.co' }),
  );
  sessionStorage.setItem(batchKey(scope), JSON.stringify(emptyBatch(scope)));
  sessionStorage.setItem('inventory-assign-v1:old', 'original');
  render(<AssignmentScopeGuard actorId={id} backend={scope.backend} />);
  expect(readBatch(scope).value).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe('original');
});

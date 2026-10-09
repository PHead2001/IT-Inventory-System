import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignmentScopeGuard } from './assignment-scope-guard';
import {
  assignmentEpoch,
  batchKey,
  emptyBatch,
  readBatch,
  storeBatch,
} from './assign-batch';
const mocks = vi.hoisted(() => ({
  changed: null as
    null | ((event: string, session: { user: { id: string } } | null) => void),
  unsubscribe: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (fn: typeof mocks.changed) => {
        mocks.changed = fn;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  }),
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
});
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

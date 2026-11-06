import { useLayoutEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  invalidateAssignmentCallbacks,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { useStrictPresentation } from './strict-presentation';

const fresh = () => ({
  ready: true,
  visible: true,
  generation: 'member',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
let current: () => boolean;
const withdraw = vi.fn();
function Probe({ identity = 'backend:actor' }: { identity?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const read = useStrictPresentation(host, identity, withdraw);
  useLayoutEffect(() => {
    current = read;
  });
  return <div ref={host} data-testid="guarded" />;
}
function view(grant = fresh(), identity?: string) {
  return (
    <PrivacyReadinessContext value={grant}>
      <Probe identity={identity} />
    </PrivacyReadinessContext>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  withdraw.mockReset();
});

it.each(['revocation', 'assignment'] as const)(
  'withdraws synchronously on %s without borrowing a retained render',
  (kind) => {
    const mounted = render(view());
    expect(current()).toBe(true);
    withdraw.mockClear();
    act(() => {
      if (kind === 'revocation') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
      expect(withdraw).toHaveBeenCalled();
      expect(current()).toBe(false);
    });
    mounted.rerender(view());
    expect(current()).toBe(true);
  },
);

it.each([
  'unmanaged',
  'not-ready',
  'not-visible',
  'stale-epoch',
  'stale-revision',
] as const)('refuses %s presentation even with a connected host', (kind) => {
  const grant = fresh();
  if (kind === 'unmanaged') grant.generation = 'unmanaged';
  if (kind === 'not-ready') grant.ready = false;
  if (kind === 'not-visible') grant.visible = false;
  if (kind === 'stale-epoch') grant.verifiedEpoch--;
  if (kind === 'stale-revision') grant.revocationRevision--;
  render(view(grant));
  expect(current()).toBe(false);
  expect(withdraw).toHaveBeenCalled();
});

it.each(['hidden', 'inert'] as const)(
  'withdraws when an ancestor becomes %s and requires current connected visibility',
  async (attribute) => {
    const mounted = render(view());
    expect(current()).toBe(true);
    withdraw.mockClear();
    mounted.container.setAttribute(attribute, '');
    expect(current()).toBe(false);
    await act(async () => {});
    expect(withdraw).toHaveBeenCalled();
    mounted.container.removeAttribute(attribute);
    await act(async () => {});
    expect(current()).toBe(true);
  },
);

it('withdraws a hidden tab and retires unmounted callbacks without changing global authority', () => {
  const revision = readPrivacyRevocationRevision(),
    epoch = assignmentEpoch();
  const mounted = render(view());
  const oldCurrent = current;
  mounted.rerender(view(fresh(), 'other-backend:actor'));
  expect(withdraw).toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(current()).toBe(false);
  mounted.unmount();
  expect(oldCurrent()).toBe(false);
  expect(readPrivacyRevocationRevision()).toBe(revision);
  expect(assignmentEpoch()).toBe(epoch);
});

it('permanently retires original actor/backend callbacks on scope drift until a legitimate remount', () => {
  const revision = readPrivacyRevocationRevision(),
    epoch = assignmentEpoch();
  const mounted = render(view());
  const original = current;
  mounted.rerender(view(fresh(), 'other-backend:actor'));
  expect(current()).toBe(false);
  mounted.rerender(view());
  expect(current()).toBe(false);
  expect(original()).toBe(false);
  mounted.unmount();
  render(view());
  expect(current()).toBe(true);
  expect(original()).toBe(false);
  expect(readPrivacyRevocationRevision()).toBe(revision);
  expect(assignmentEpoch()).toBe(epoch);
});

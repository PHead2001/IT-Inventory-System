import { useContext, useLayoutEffect } from 'react';
import { TaskStateContext, type TaskState } from './task-state';
import { RouteMotionProvider } from '@/components/experience/route-motion';
import { MotionPreference } from '@/components/experience/motion-preference';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { CustodyChangeForm } from '@/features/custody/custody-change-form';
import { TaskWorkspace } from './task-workspace';
import { MutationForm } from './mutation-form';
import { ArchiveQuantityForm } from './archive-quantity-form';
const actions = vi.hoisted(() => ({ inventory: vi.fn(), custody: vi.fn() }));
vi.mock('../actions', () => ({
  submitInventory: actions.inventory,
  findDuplicateSerials: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/custody/actions', () => ({
  submitCustody: actions.custody,
}));
vi.mock('../asset-tag.actions', () => ({
  checkAssetTag: vi.fn().mockResolvedValue(null),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));
vi.mock('motion', () => ({
  animate: vi.fn((element: HTMLElement, target: { opacity?: number }) => {
    element.style.opacity = String(target.opacity ?? 1);
    return { cancel: vi.fn() };
  }),
}));
const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const location = {
  id: id(1),
  code: 'ITC-S1A',
  name: 'Shelf 1A',
  breadcrumb: 'IT Closet / Shelf 1A',
  active: true,
  can_hold_inventory: true,
  parentId: null,
};
const item = {
  id: id(2),
  name: 'Adapters',
  description: null,
  categoryId: id(3),
  categoryName: 'Cables',
  manufacturer: null,
  model: null,
  version: 1,
  archived: false,
  itemCode: null,
  reorderThreshold: null,
};
const archive = {
  item_id: item.id,
  version: '1',
  archived: false,
  removed_total: '4',
  locations: [
    {
      location_id: location.id,
      code: location.code,
      breadcrumb: location.breadcrumb,
      active: true,
      quantity: 4,
    },
  ],
};
let reportCurrent: ((state: TaskState) => void) | null = null;
function CurrentForm({ kind }: { kind: 'mutation' | 'archive' | 'custody' }) {
  const report = useContext(TaskStateContext);
  useLayoutEffect(() => {
    reportCurrent = report;
  }, [report]);
  return forms[kind]();
}
const forms = {
  mutation: () => (
    <MutationForm
      operation="quantity_update"
      item={item}
      locations={[location]}
      categories={[{ id: item.categoryId, name: 'Cables', active: true }]}
    />
  ),
  archive: () => <ArchiveQuantityForm latestReview={archive} />,
  custody: () => (
    <CustodyChangeForm
      kind="quantity"
      action="issue"
      entityId={item.id}
      version="1"
      locations={[location]}
      sites={[
        {
          id: id(4),
          code: 'PROPERTY',
          name: 'Fictional Property',
          active: true,
          notes: null,
          version: '1',
        },
      ]}
      storageBalances={[{ location, quantity: 4 }]}
    />
  ),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 120, 32),
  ] as unknown as DOMRectList);
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.motion;
});
function associations(form: HTMLFormElement) {
  for (const label of form.querySelectorAll<HTMLLabelElement>('label[for]')) {
    expect(label.control).not.toBeNull();
    expect(form.contains(label.control)).toBe(true);
  }
  for (const element of form.querySelectorAll(
    '[aria-describedby],[aria-controls]',
  ))
    for (const attribute of ['aria-describedby', 'aria-controls'])
      for (const reference of (element.getAttribute(attribute) ?? '')
        .split(/\s+/)
        .filter(Boolean)) {
        const target = document.getElementById(reference);
        expect(target, `${attribute}: ${reference}`).not.toBeNull();
        expect(form.contains(target)).toBe(true);
      }
}
it.each(['mutation', 'archive', 'custody'] as const)(
  'keeps native labels, descriptions and validation focus in the new %s instance while the old form exits',
  (kind) => {
    const view = render(
      <PrivacyReadinessContext
        value={{
          ready: true,
          visible: true,
          generation: 'verified',
          verifiedEpoch: assignmentEpoch(),
          revocationRevision: readPrivacyRevocationRevision(),
        }}
      >
        <MotionPreference>
          <RouteMotionProvider actorId="actor">
            <TaskWorkspace
              choices={[{ id: 'same', label: 'Open task' }]}
              context="Record"
            >
              {() => <CurrentForm kind={kind} />}
            </TaskWorkspace>
          </RouteMotionProvider>
        </MotionPreference>
      </PrivacyReadinessContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));
    const outgoing = view.container.querySelector('form')!;
    // An accepted completed-task reentry may overlap the same operation.
    // A second Close->Open transition instead drops the older exit by contract.
    act(() =>
      reportCurrent?.({
        dirty: false,
        pending: false,
        uncertain: false,
        completed: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));
    const mounted = view.container.querySelectorAll('form'),
      incoming = mounted[1];
    expect(mounted).toHaveLength(2);
    expect(outgoing.closest('[data-spring-presence]')).toHaveAttribute('inert');
    expect(incoming).not.toBe(outgoing);
    associations(incoming);
    const ids = [...view.container.querySelectorAll<HTMLElement>('[id]')].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    if (kind === 'mutation')
      fireEvent.change(within(incoming).getByLabelText(/^Name/), {
        target: { value: '' },
      });
    fireEvent.submit(incoming);
    expect(incoming.contains(document.activeElement)).toBe(true);
    associations(incoming);
    const errorLink =
      incoming.querySelector<HTMLAnchorElement>('a[href^="#"]')!;
    expect(errorLink).not.toBeNull();
    const invalid = document.getElementById(
      errorLink.getAttribute('href')!.slice(1),
    )!;
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(errorLink);
    expect(invalid).toHaveFocus();
    expect(incoming.contains(invalid)).toBe(true);
    if (kind === 'mutation')
      fireEvent.change(within(incoming).getByLabelText(/^Name/), {
        target: { value: 'Updated adapters' },
      });
    for (const select of incoming.querySelectorAll<HTMLSelectElement>(
      'select',
    )) {
      const choice = [...select.options].find(
        (option) => !option.disabled && option.value,
      );
      if (select.required && !select.value && choice)
        fireEvent.change(select, { target: { value: choice.value } });
    }
    for (const textarea of incoming.querySelectorAll<HTMLTextAreaElement>(
      'textarea[required]',
    ))
      fireEvent.change(textarea, { target: { value: 'Reviewed change' } });
    for (const checkbox of incoming.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][required]',
    ))
      if (!checkbox.checked) fireEvent.click(checkbox);
    fireEvent.submit(incoming);
    expect(
      within(incoming).getByRole('region', { name: 'Review changes' }),
    ).toBeVisible();
    associations(incoming);
    fireEvent.submit(outgoing);
    expect(actions.inventory).not.toHaveBeenCalled();
    expect(actions.custody).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(outgoing.isConnected).toBe(false);
    expect(incoming.isConnected).toBe(true);
    associations(incoming);
  },
);

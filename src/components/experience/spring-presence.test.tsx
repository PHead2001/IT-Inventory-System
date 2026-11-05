import { AddItemLauncher } from '@/features/inventory/components/add-item-launcher';
import { InventoryCaptureRegionsContext } from './inventory-capture-region';
import { RouteMotionProvider } from './route-motion';
import { MotionPreference } from './motion-preference';
import { useEffect, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { animate } from 'motion';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { SpringPresence } from './spring-presence';
import { SpringDisclosure } from './spring-disclosure';
import { TaskWorkspace } from '@/features/inventory/components/task-workspace';
import { LocationPicker } from '@/features/locations/location-picker';
import { RoomToolbar } from '@/features/room/scene/room-toolbar';
import {
  useTaskDiscard,
  useTaskInteraction,
  useTaskReset,
  useTaskWarning,
  useReportTaskState,
} from '@/features/inventory/components/task-state';
const animation = vi.hoisted(() => ({
  stops: [] as ReturnType<typeof vi.fn>[],
  updates: [] as (() => void)[],
}));
vi.mock('next/navigation', () => ({
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
  animate: vi.fn(
    (
      element: HTMLElement,
      target: { opacity?: number },
      options: { onUpdate: () => void },
    ) => {
      if (target.opacity !== undefined)
        element.style.opacity = String(target.opacity);
      const cancel = vi.fn();
      animation.stops.push(cancel);
      animation.updates.push(options.onUpdate ?? (() => {}));
      return { cancel };
    },
  ),
}));
vi.mock('motion/mini', () => ({ animate: vi.fn(() => ({ cancel: vi.fn() })) }));
const grant = () => ({
  ready: true,
  visible: true,
  generation: 'managed',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function Managed({ children }: { children: React.ReactNode }) {
  return (
    <PrivacyReadinessContext value={grant()}>
      <MotionPreference>
        <RouteMotionProvider actorId="managed">{children}</RouteMotionProvider>
      </MotionPreference>
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  animation.stops = [];
  animation.updates = [];
  document.documentElement.dataset.motion = 'full';
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 120, 32),
  ] as unknown as DOMRectList);
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'animate');
});
it('retains only the original inert subtree during exit, blocks clicks, and removes at 250 ms', () => {
  const action = vi.fn();
  const body = <button onClick={action}>Action</button>;
  const view = render(
    <Managed>
      <SpringPresence open instanceKey="A" kind="popover" retainExit>
        {body}
      </SpringPresence>
    </Managed>,
  );
  const original = screen.getByText('Action');
  view.rerender(
    <Managed>
      <SpringPresence open={false} instanceKey="A" kind="popover" retainExit>
        {body}
      </SpringPresence>
    </Managed>,
  );
  expect(view.container.querySelector('button')).toBe(original);
  expect(original.closest('[data-spring-presence]')).toHaveAttribute('inert');
  expect(original.closest('[data-spring-presence]')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  fireEvent.click(original);
  expect(action).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(249));
  expect(original.isConnected).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(original.isConnected).toBe(false);
});
it('reverses close/open without stale removal or duplicate nodes', () => {
  const tree = (open: boolean) => (
    <Managed>
      <SpringPresence open={open} instanceKey="A" kind="panel" retainExit>
        <input aria-label="Draft" />
      </SpringPresence>
    </Managed>
  );
  const view = render(tree(true));
  const original = screen.getByLabelText('Draft');
  fireEvent.change(original, { target: { value: 'retained' } });
  view.rerender(tree(false));
  act(() => vi.advanceTimersByTime(100));
  view.rerender(tree(true));
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByLabelText('Draft')).toBe(original);
  expect(original).toHaveValue('retained');
  expect(view.container.querySelectorAll('input')).toHaveLength(1);
});
it('keeps the original exit deadline when a parent supplies a new completion callback', () => {
  const done = vi.fn();
  const tree = (open: boolean) => (
    <Managed>
      <SpringPresence
        open={open}
        instanceKey="A"
        kind="panel"
        retainExit
        onExitComplete={() => done()}
      >
        Content
      </SpringPresence>
    </Managed>
  );
  const view = render(tree(true));
  view.rerender(tree(false));
  act(() => vi.advanceTimersByTime(200));
  view.rerender(tree(false));
  act(() => vi.advanceTimersByTime(50));
  expect(screen.queryByText('Content')).toBeNull();
  expect(done).toHaveBeenCalledTimes(1);
});
it.each(['reduced', 'privacy'] as const)(
  'removes an existing exit immediately on %s',
  (kind) => {
    const tree = (open: boolean) => (
      <Managed>
        <SpringPresence open={open} instanceKey="A" kind="toast" retainExit>
          Original
        </SpringPresence>
      </Managed>
    );
    const view = render(tree(true));
    view.rerender(tree(false));
    expect(screen.getByText('Original').isConnected).toBe(true);
    act(() => {
      if (kind === 'privacy') revokePrivatePresentation();
      else {
        localStorage.setItem('it-inventory-reduce-motion', 'true');
        window.dispatchEvent(new Event('it-inventory-motion-change'));
      }
    });
    expect(screen.queryByText('Original')).toBeNull();
    animation.stops.forEach((stop) => expect(stop).toHaveBeenCalled());
  },
);
it('disclosure summary activates once, retains a pending form and collapses its original nodes', () => {
  let complete!: () => void;
  let mounts = 0;
  function Operation() {
    const [saved, setSaved] = useState(false);
    useEffect(() => {
      mounts++;
      complete = () => setSaved(true);
    }, []);
    return (
      <form>
        <input aria-label="Retained draft" />
        <p>{saved ? 'Confirmed receipt' : 'Saving'}</p>
      </form>
    );
  }
  const view = render(
    <Managed>
      <SpringDisclosure summary="Details">
        <Operation />
      </SpringDisclosure>
    </Managed>,
  );
  const summary = screen.getByText('Details');
  const original = view.container.querySelector('input');
  fireEvent.click(summary);
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(summary);
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(view.container.querySelector('details')).toHaveAttribute('open');
  act(() => {
    complete();
    vi.advanceTimersByTime(250);
  });
  expect(view.container.querySelector('details')).not.toHaveAttribute('open');
  expect(view.container.querySelector('input')).toBe(original);
  expect(mounts).toBe(1);
  fireEvent.click(summary);
  expect(screen.getByText('Confirmed receipt')).toBeVisible();
});
it('animates a fresh authorized disclosure open initially and after a settled native close', async () => {
  render(
    <Managed>
      <SpringDisclosure summary="Details">
        <p>Original content</p>
      </SpringDisclosure>
    </Managed>,
  );
  vi.mocked(animate).mockClear();
  fireEvent.click(screen.getByText('Details'));
  expect(animate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Details'));
  act(() => vi.advanceTimersByTime(250));
  await act(async () => {
    await Promise.resolve();
  });
  vi.mocked(animate).mockClear();
  fireEvent.click(screen.getByText('Details'));
  expect(animate).toHaveBeenCalledOnce();
});
it('does not replay entry when an already-open surface regains privacy verification', () => {
  const tree = (ready: boolean) => (
    <PrivacyReadinessContext value={{ ...grant(), ready, visible: true }}>
      <SpringPresence open instanceKey="A" kind="panel">
        <input aria-label="Draft" />
      </SpringPresence>
    </PrivacyReadinessContext>
  );
  const view = render(tree(true));
  const original = screen.getByLabelText('Draft');
  view.rerender(tree(false));
  vi.mocked(animate).mockClear();
  view.rerender(tree(true));
  expect(animate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Draft')).toBe(original);
});
it('keeps closed server markup natively actionable before hydration and adopts the original prehydration open state', async () => {
  const tree = (
    <Managed>
      <SpringDisclosure summary="Native details">
        <a href="/inventory">Open inventory</a>
        <input aria-label="Native draft" defaultValue="" />
      </SpringDisclosure>
    </Managed>
  );
  const host = document.createElement('div');
  host.innerHTML = renderToString(tree);
  document.body.append(host);
  const details = host.querySelector('details')!,
    summary = host.querySelector('summary')!,
    original = host.querySelector('a')!,
    input = host.querySelector('input')!;
  expect(details.open).toBe(false);
  expect(
    original.closest('[hidden], [inert], [aria-hidden="true"]'),
  ).toBeNull();
  summary.click();
  expect(details.open).toBe(true);
  input.value = 'Before hydration';
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(host, tree);
    await Promise.resolve();
  });
  expect(details.open).toBe(true);
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  expect(host.querySelector('a')).toBe(original);
  expect(input).toHaveValue('Before hydration');
  expect(
    original.closest('[hidden], [inert], [aria-hidden="true"]'),
  ).toBeNull();
  act(() => root.unmount());
  host.remove();
});
it('retires task callbacks immediately while preserving original outgoing content during the new version wait', () => {
  const callbacks = new Map<
    string,
    {
      report: ReturnType<typeof useReportTaskState>;
      reset: ReturnType<typeof useTaskReset>;
      warning: ReturnType<typeof useTaskWarning>;
      canStart: () => boolean;
    }
  >();
  const discarded = vi.fn(() => true);
  function Task({ id }: { id: string }) {
    const report = useReportTaskState({
      dirty: false,
      pending: false,
      uncertain: false,
      completed: false,
    });
    const reset = useTaskReset(),
      warning = useTaskWarning(),
      canStart = useTaskInteraction();
    useTaskDiscard(discarded);
    callbacks.set(id, { report, reset, warning, canStart });
    return <input aria-label={id} />;
  }
  render(
    <Managed>
      <TaskWorkspace
        choices={[
          { id: 'a', label: 'Task A' },
          { id: 'b', label: 'Task B' },
        ]}
        recordVersion="1"
        context="Record"
      >
        {(id) => <Task id={id} />}
      </TaskWorkspace>
    </Managed>,
  );
  fireEvent.click(screen.getByText('Task A', { selector: 'button' }));
  const old = callbacks.get('a')!,
    original = screen.getByLabelText('a');
  act(() => old.report({ completed: true, completedVersion: '2' }));
  fireEvent.click(screen.getByText('Task B', { selector: 'button' }));
  expect(old.canStart()).toBe(false);
  expect(original.isConnected).toBe(true);
  expect(original.closest('[data-spring-presence]')).toHaveAttribute('inert');
  expect(
    screen.getByText(
      'Loading the current record before starting another transaction…',
    ),
  ).toBeVisible();
  act(() => {
    old.report({ pending: true });
    old.reset?.();
    old.warning?.('Stale warning');
  });
  expect(screen.queryByText('Stale warning')).toBeNull();
  expect(screen.getByText('Task A', { selector: 'button' })).not.toBeDisabled();
  act(() => vi.advanceTimersByTime(250));
  expect(original.isConnected).toBe(false);
  fireEvent.click(screen.getByText('Close task'));
  expect(discarded).toHaveBeenCalledTimes(1);
});
it('close/reopen isolates the new task from old callbacks and exact-instance discard cleanup', () => {
  const callbacks: Array<{
    report: ReturnType<typeof useReportTaskState>;
    reset: ReturnType<typeof useTaskReset>;
    warning: ReturnType<typeof useTaskWarning>;
    canStart: () => boolean;
  }> = [];
  const discarded = vi.fn(() => true);
  function Task() {
    const report = useReportTaskState({
      dirty: false,
      pending: false,
      uncertain: false,
      completed: false,
    });
    const reset = useTaskReset(),
      warning = useTaskWarning(),
      canStart = useTaskInteraction();
    const [saved] = useState(() => ({ report, reset, warning, canStart }));
    useTaskDiscard(discarded);
    if (!callbacks.includes(saved)) callbacks.push(saved);
    return <input aria-label="Task draft" />;
  }
  render(
    <Managed>
      <TaskWorkspace choices={[{ id: 'a', label: 'Task A' }]} context="Record">
        {() => <Task />}
      </TaskWorkspace>
    </Managed>,
  );
  fireEvent.click(screen.getByText('Task A', { selector: 'button' }));
  const old = callbacks[0],
    outgoing = screen.getByRole('textbox');
  outgoing.focus();
  fireEvent.click(screen.getByText('Close task'));
  expect(old.canStart()).toBe(false);
  expect(outgoing).not.toHaveFocus();
  fireEvent.click(screen.getByText('Task A', { selector: 'button' }));
  const incoming = screen.getByRole('textbox');
  expect(incoming).not.toBe(outgoing);
  act(() => {
    old.report({ pending: true, uncertain: true });
    old.reset?.();
    old.warning?.('Retired task');
  });
  expect(screen.queryByText('Retired task')).toBeNull();
  expect(screen.getByRole('button', { name: 'Close task' })).toBeEnabled();
  act(() => vi.advanceTimersByTime(250));
  expect(outgoing.isConnected).toBe(false);
  expect(incoming.isConnected).toBe(true);
  expect(callbacks[1].canStart()).toBe(true);
  fireEvent.click(screen.getByText('Close task'));
  expect(discarded).toHaveBeenCalledTimes(2);
});

it('preserves the picker node through exit, keeps its current query reset, and reverses into fresh interactive state', () => {
  const choose = vi.fn();
  render(
    <Managed>
      <LocationPicker
        label="Location"
        mode="destination"
        onValueChange={choose}
        locations={[
          {
            id: 'drawer',
            code: 'ITC-D1',
            name: 'Drawer',
            breadcrumb: 'IT Closet / Drawer',
            parentId: null,
            active: true,
            can_hold_inventory: true,
          },
        ]}
      />
    </Managed>,
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Location' }));
  const input = screen.getByRole('combobox', { name: 'Search locations' });
  fireEvent.change(input, { target: { value: 'Draw' } });
  const option = screen.getByRole('option', { name: /Drawer/ });
  fireEvent.click(option);
  expect(choose).toHaveBeenCalledOnce();
  expect(input).toHaveValue('');
  expect(input.closest('[data-spring-presence]')).toHaveAttribute('inert');
  fireEvent.click(option);
  expect(choose).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(100));
  fireEvent.click(screen.getByRole('combobox', { name: 'Location' }));
  expect(screen.getByRole('combobox', { name: 'Search locations' })).toBe(
    input,
  );
  expect(input).toHaveValue('');
  act(() => vi.advanceTimersByTime(250));
  expect(input.isConnected).toBe(true);
});
it('runs More commands exactly once before semantic close and retains the actual original obstruction until removal', () => {
  const command = vi.fn(),
    changed = vi.fn();
  render(
    <Managed>
      <RoomToolbar
        active={false}
        onActiveChange={vi.fn()}
        canFocusSelected={false}
        onRequestFocus={vi.fn()}
        onCommand={command}
        mode="guided"
        onModeChange={vi.fn()}
        showLabels={false}
        onLabelsChange={vi.fn()}
        showCounts={false}
        onCountsChange={vi.fn()}
        onOverlayChange={changed}
      />
    </Managed>,
  );
  const more = screen.getByRole('button', { name: 'More map controls' });
  fireEvent.click(more);
  const original = screen.getByRole('region', { name: 'More map controls' });
  const recenter = screen.getByRole('button', { name: 'Recenter' });
  fireEvent.click(recenter);
  expect(command).toHaveBeenCalledExactlyOnceWith('recenter');
  expect(more).toHaveFocus();
  expect(original).toHaveAttribute('data-room-obstruction', 'true');
  expect(original).toHaveAttribute('inert');
  fireEvent.click(recenter);
  expect(command).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(249));
  expect(original.isConnected).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(original.isConnected).toBe(false);
  expect(changed).toHaveBeenCalled();
});

it('keeps the actual Add item launcher native, activates once and retains both creation links through semantic close', () => {
  render(
    <Managed>
      <AddItemLauncher query="location=ITC-S1A" />
    </Managed>,
  );
  const summary = screen.getByLabelText('Add item');
  expect(summary.tagName).toBe('SUMMARY');
  fireEvent.click(summary);
  const quantity = screen.getByRole('link', { name: 'Add quantity item' });
  expect(quantity).toHaveAttribute(
    'href',
    '/inventory/quantity/new?location=ITC-S1A',
  );
  expect(
    screen.getByRole('link', { name: 'Add individual asset' }),
  ).toHaveAttribute('href', '/inventory/assets/new?location=ITC-S1A');
  fireEvent.click(summary);
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(quantity.closest('[data-spring-presence]')).toHaveAttribute('inert');
  expect(quantity.closest('[data-spring-presence]')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  act(() => vi.advanceTimersByTime(250));
  expect(quantity.isConnected).toBe(true); // Native disclosure keeps the same mounted choices.
  expect(quantity.closest('[hidden]')).not.toBeNull();
});
it('keeps keyed task fibers under capture composition, drops older exits on A to B to C, and withdraws only the current exit', () => {
  const mounts = new Map<string, number>();
  function Task({ id }: { id: string }) {
    useState(() => {
      mounts.set(id, (mounts.get(id) ?? 0) + 1);
      return id;
    });
    return <input aria-label={id} />;
  }
  render(
    <Managed>
      <InventoryCaptureRegionsContext
        value={{
          enabled: true,
          pairedInventory: true,
          conventionalPrimary: true,
        }}
      >
        <TaskWorkspace
          choices={[
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ]}
          context="Record"
        >
          {(id) => <Task id={id} />}
        </TaskWorkspace>
      </InventoryCaptureRegionsContext>
    </Managed>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'A' }));
  const a = screen.getByLabelText('a');
  fireEvent.click(screen.getByRole('button', { name: 'B' }));
  const b = screen.getByLabelText('b');
  expect(a.isConnected).toBe(true);
  expect(mounts.get('a')).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'C' }));
  const c = screen.getByLabelText('c');
  expect(a.isConnected).toBe(false);
  expect(b.isConnected).toBe(true);
  expect(mounts.get('b')).toBe(1);
  expect(mounts.get('c')).toBe(1);
  expect(b.closest('[data-spring-presence]')).toHaveAttribute('inert');
  expect(c.closest('[data-spring-presence]')).not.toHaveAttribute('inert');
  act(() => revokePrivatePresentation());
  expect(b.isConnected).toBe(false);
});
it('closes in the same commit as privacy withdrawal without an insertion-effect update or retained private exit', () => {
  const error = vi.spyOn(console, 'error');
  const tree = (open: boolean, ready: boolean) => (
    <PrivacyReadinessContext value={{ ...grant(), ready, visible: ready }}>
      <MotionPreference>
        <RouteMotionProvider actorId="managed">
          <SpringPresence
            open={open}
            instanceKey="same"
            kind="panel"
            retainExit
          >
            Private exit
          </SpringPresence>
        </RouteMotionProvider>
      </MotionPreference>
    </PrivacyReadinessContext>
  );
  const view = render(tree(true, true));
  view.rerender(tree(false, false));
  expect(screen.queryByText('Private exit')).toBeNull();
  expect(
    error.mock.calls
      .flat()
      .some((value) =>
        String(value).includes('useInsertionEffect must not schedule'),
      ),
  ).toBe(false);
});

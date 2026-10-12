import { useState, type FormEvent } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TaskWorkspace } from './task-workspace';
import {
  RouteReady,
  RouteReadyContext,
} from '@/components/experience/route-ready';
import { createRouteReadiness } from '@/components/experience/route-readiness';
import { createRoutePendingState } from '@/components/experience/route-pending-state';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { useReportTaskState, useTaskReset } from './task-state';
function IntentWorkspace({
  intent,
  fresh = true,
  hidden = false,
  hiddenWorkspace = false,
}: {
  intent?: string;
  fresh?: boolean;
  hidden?: boolean;
  hiddenWorkspace?: boolean;
}) {
  const [readiness] = useState(() =>
    createRouteReadiness('actor', createRoutePendingState(), () => {}),
  );
  return (
    <PrivacyReadinessContext
      value={{
        ready: fresh,
        visible: true,
        generation: 'actor',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RouteReadyContext value={readiness}>
        <div hidden={hidden}>
          <RouteReady
            actorId="actor"
            routeKey={location.pathname + location.search}
            contentIdentity="record"
          >
            <h1>Record primary</h1>
            <div hidden={hiddenWorkspace}>
              <TaskWorkspace
                choices={[
                  { id: 'receive', label: 'Receive stock' },
                  { id: 'quantity_move', label: 'Move stock' },
                ]}
                context="Item"
                recordIdentity="quantity:record"
                taskIntent={intent}
              >
                {(id) => <Draft id={id} />}
              </TaskWorkspace>
            </div>
          </RouteReady>
        </div>
      </RouteReadyContext>
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => vi.restoreAllMocks());
function intentUrl(intent: string) {
  window.history.replaceState(
    { next: 'retained' },
    '',
    '/inventory/quantity/record?returnTo=%2Finventory&task=' +
      intent +
      '#tasks',
  );
}
it('consumes a move intent once, opens an eligible task, and never reopens on rerender', async () => {
  window.history.replaceState(
    {},
    '',
    '/inventory/quantity/record?task=quantity_move',
  );
  const view = render(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Move stock' })).toHaveFocus();
  expect(window.location.search).not.toContain('task=');
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  view.rerender(<IntentWorkspace intent="quantity_move" />);
  expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
  view.unmount();
  render(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
});
it('routes an incoming intent through explicit dirty discard guards', async () => {
  const view = render(<IntentWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'Retained draft' },
  });
  intentUrl('quantity_move');
  view.rerender(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(screen.getByRole('alertdialog')).toBeVisible();
  expect(screen.getByLabelText('receive entry')).toHaveValue('Retained draft');
  expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stay with this task' }));
  view.rerender(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByLabelText('receive entry')).toHaveValue('Retained draft');
  view.rerender(<IntentWorkspace />);
  await act(async () => {});
  intentUrl('quantity_move');
  view.rerender(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(screen.getByRole('alertdialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Discard and switch' }));
  expect(screen.getByLabelText('quantity_move entry')).toHaveValue('');
});
it.each(['pending', 'unknown'])(
  'does not replace a %s task with an incoming intent',
  async (phase) => {
    const view = render(<IntentWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    fireEvent.click(screen.getByRole('button', { name: phase }));
    intentUrl('quantity_move');
    view.rerender(<IntentWorkspace intent="quantity_move" />);
    await act(async () => {});
    expect(screen.getByLabelText('receive entry')).toBeInTheDocument();
    expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Finish the current task',
    );
  },
);
it.each(['unknown_task', 'asset_move'])(
  'explains unavailable %s without erasing a draft',
  async (intent) => {
    const view = render(<IntentWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    fireEvent.change(screen.getByLabelText('receive entry'), {
      target: { value: 'Keep' },
    });
    intentUrl(intent);
    view.rerender(<IntentWorkspace intent={intent} />);
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent(
      'unavailable for this item',
    );
    expect(screen.getByLabelText('receive entry')).toHaveValue('Keep');
  },
);
it('preserves router state, unrelated query/hash, and permits a later deliberate absent-to-present intent', async () => {
  intentUrl('quantity_move');
  const view = render(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(window.history.state).toEqual({ next: 'retained' });
  expect(window.location.search).toBe('?returnTo=%2Finventory');
  expect(window.location.hash).toBe('#tasks');
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  view.rerender(<IntentWorkspace />);
  await act(async () => {});
  intentUrl('quantity_move');
  view.rerender(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Move stock' })).toBeVisible();
});
it('does not consume an intent for a newer record while old record props remain', async () => {
  window.history.replaceState(
    {},
    '',
    '/inventory/quantity/newer?task=quantity_move',
  );
  render(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(window.location.search).toBe('?task=quantity_move');
  expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
});
const choices = [
  { id: 'receive', label: 'Receive stock' },
  { id: 'move', label: 'Move stock' },
];
function Draft({
  id,
  completedVersion,
}: {
  id: string;
  completedVersion?: string;
}) {
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState('');
  const reset = useTaskReset();
  const reportTask = useReportTaskState({
    dirty: !!value,
    pending: phase === 'pending' || phase === 'completed-pending',
    uncertain: phase === 'unknown',
    completed: phase === 'complete' || phase === 'completed-pending',
    completedVersion: phase === 'complete' ? completedVersion : undefined,
  });
  return (
    <div>
      <label>
        {id} entry
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {['pending', 'unknown', 'complete', 'completed-pending'].map((p) => (
        <button key={p} onClick={() => setPhase(p)}>
          {p}
        </button>
      ))}
      <button
        onClick={() => {
          reportTask({ pending: true });
          document
            .querySelector<HTMLButtonElement>('button[aria-pressed="false"]')
            ?.click();
          setPhase('pending');
        }}
      >
        Synchronous dispatch
      </button>
      {(phase === 'complete' || phase === 'completed-pending') && (
        <button onClick={reset!}>New transaction</button>
      )}
    </div>
  );
}
function Workspace({ tasks = choices }: { tasks?: typeof choices }) {
  return (
    <TaskWorkspace choices={tasks} context="Cable � Quantity item">
      {(id) => <Draft id={id} />}
    </TaskWorkspace>
  );
}
it('does not steal focus on the initial clean workspace mount', () => {
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  render(<Workspace />);
  expect(outside).toHaveFocus();
  outside.remove();
});
it('returns keyboard focus to the enabled launcher after an explicit new transaction', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Receive stock' });
  await user.click(launcher);
  await user.click(screen.getByRole('button', { name: 'complete' }));
  expect(launcher).toBeEnabled();
  screen.getByRole('button', { name: 'New transaction' }).focus();
  await user.keyboard('{Enter}');
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  expect(launcher).toBeEnabled();
  expect(launcher).toHaveFocus();
});

it('returns focus to Tasks when the completed task launcher was removed', async () => {
  const user = userEvent.setup();
  const view = render(<Workspace />);
  await user.click(screen.getByRole('button', { name: 'Receive stock' }));
  await user.click(screen.getByRole('button', { name: 'complete' }));
  view.rerender(<Workspace tasks={[choices[1]]} />);
  await user.click(screen.getByRole('button', { name: 'New transaction' }));
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Tasks' })).toHaveFocus();
});

it('falls back to Tasks when a connected launcher cannot take focus', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Receive stock' });
  await user.click(launcher);
  await user.click(screen.getByRole('button', { name: 'complete' }));
  // jsdom has no collapsed-details layout: model the browser ignoring focus.
  const focus = vi.spyOn(launcher, 'focus').mockImplementation(() => {});
  await user.click(screen.getByRole('button', { name: 'New transaction' }));
  expect(launcher.isConnected).toBe(true);
  expect(launcher).toBeEnabled();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Tasks' })).toHaveFocus();
  focus.mockRestore();
});

it('keeps focus on the draft after Stay and restores the launcher after explicit discard and close', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole('button', { name: 'Receive stock' }));
  await user.type(screen.getByLabelText('receive entry'), 'retained');
  await user.click(screen.getByRole('button', { name: 'Close task' }));
  await user.click(screen.getByRole('button', { name: 'Stay with this task' }));
  expect(screen.getByRole('heading', { name: 'Receive stock' })).toHaveFocus();
  expect(screen.getByLabelText('receive entry')).toHaveValue('retained');
  await user.click(screen.getByRole('button', { name: 'Close task' }));
  await user.click(screen.getByRole('button', { name: 'Discard and close' }));
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  expect(screen.getByRole('button', { name: 'Receive stock' })).toHaveFocus();
});
it('mounts lazily, retains a dirty draft on Stay, then discards only explicitly', () => {
  render(<Workspace />);
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'retained' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
  expect(screen.getByLabelText('receive entry')).toHaveValue('retained');
  expect(screen.queryByLabelText('move entry')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stay with this task' }));
  expect(screen.getByLabelText('receive entry')).toHaveValue('retained');
  fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard and switch' }));
  expect(screen.getByLabelText('move entry')).toHaveValue('');
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  expect(screen.getByRole('button', { name: 'Move stock' })).toHaveFocus();
});
it.each(['pending', 'unknown'])(
  'blocks switching during %s and retains the mounted task after eligibility changes',
  (phase) => {
    const view = render(<Workspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    fireEvent.click(screen.getByRole('button', { name: phase }));
    expect(screen.getByRole('button', { name: 'Move stock' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close task' })).toBeDisabled();
    view.rerender(<Workspace tasks={[choices[1]]} />);
    expect(screen.getByLabelText('receive entry')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Receive stock' }),
    ).toBeVisible();
  },
);
it('allows another task or Close after a known committed operation without discard confirmation', () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'Saved entries' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'complete' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByLabelText('move entry')).toBeVisible();
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  expect(screen.getByRole('button', { name: 'Move stock' })).toHaveFocus();
});
it('isolates drafts when the actor and record workspace identity changes', () => {
  const view = render(<Workspace key="actor1:item1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'private draft' },
  });
  view.rerender(<Workspace key="actor2:item1" />);
  expect(screen.queryByDisplayValue('private draft')).toBeNull();
  expect(screen.queryByLabelText('receive entry')).toBeNull();
});

it('does not discard a draft whose submission starts while discard confirmation is open', () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'retained' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
  fireEvent.click(screen.getByRole('button', { name: 'pending' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Close task' })).toBeDisabled();
  expect(screen.getByLabelText('receive entry')).toHaveValue('retained');
  expect(screen.queryByLabelText('move entry')).toBeNull();
});

it('fences a same-event task switch before a pending render commits', () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Synchronous dispatch' }));
  expect(screen.getByLabelText('receive entry')).toBeInTheDocument();
  expect(screen.queryByLabelText('move entry')).toBeNull();
  expect(screen.getByRole('button', { name: 'Move stock' })).toBeDisabled();
});

it('keeps completed pending work truthful and locked until the follow-up finishes', () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.click(screen.getByRole('button', { name: 'complete' }));
  fireEvent.click(screen.getByRole('button', { name: 'completed-pending' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Updating this task. Wait before starting another transaction.',
  );
  expect(screen.getByRole('status')).not.toHaveTextContent('Saving');
  expect(screen.getByRole('button', { name: 'Move stock' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close task' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'New transaction' }));
  expect(screen.getByLabelText('receive entry')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Tasks' })).not.toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'complete' }));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New transaction' }));
  expect(screen.queryByLabelText('receive entry')).toBeNull();
});

it('keeps Close task next to the form actions in keyboard order', async () => {
  const user = userEvent.setup();
  render(
    <TaskWorkspace choices={choices} context="Cable">
      {() => (
        <form>
          <button type="button">Review move</button>
          <button type="button">Cancel</button>
        </form>
      )}
    </TaskWorkspace>,
  );
  await user.click(screen.getByRole('button', { name: 'Move stock' }));
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  cancel.focus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Close task' })).toHaveFocus();
  expect(screen.getAllByRole('heading', { name: 'Move stock' })).toHaveLength(
    1,
  );
});
it.each(['Receive stock', 'Move stock'])(
  'explicit %s reentry starts a fresh completed task without a close detour',
  async (label) => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: label }));
    const entry = screen.getByRole('textbox');
    await user.type(entry, 'completed draft');
    await user.click(screen.getByRole('button', { name: 'complete' }));
    await user.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'New transaction' }),
    ).toBeNull();
    expect(screen.getByRole('heading', { name: label })).toHaveFocus();
  },
);
it.each(['Receive stock', 'Move stock'])(
  'fences an explicit %s form behind its known completion version and keeps later drafts intact',
  async (label) => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockImplementationOnce(() => {
      throw new Error('offline');
    });
    const content = (version: string) => (
      <TaskWorkspace
        choices={choices}
        context="This item"
        recordVersion={version}
        onRefresh={refresh}
      >
        {(id) => <Draft id={id} completedVersion="9007199254740993" />}
      </TaskWorkspace>
    );
    const view = render(content('9007199254740992'));
    await user.click(screen.getByRole('button', { name: 'Receive stock' }));
    await user.type(screen.getByRole('textbox'), 'saved');
    await user.click(screen.getByRole('button', { name: 'complete' }));
    expect(screen.getByRole('textbox')).toHaveValue('saved');
    await user.click(screen.getByRole('button', { name: label }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'current record could not be loaded',
    );
    expect(refresh).toHaveBeenCalledOnce();
    await user.click(
      screen.getByRole('button', { name: 'Retry loading record' }),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('textbox')).toBeNull();
    view.rerender(content('9007199254740993'));
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'new draft');
    view.rerender(content('9007199254740994'));
    expect(screen.getByRole('textbox')).toHaveValue('new draft');
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
it('opens a same-version no-op completion immediately and keeps pending/uncertain forms on their original instance', () => {
  const refresh = vi.fn();
  render(
    <TaskWorkspace
      choices={choices}
      context="This item"
      recordVersion="4"
      onRefresh={refresh}
    >
      {(id) => <Draft id={id} completedVersion="4" />}
    </TaskWorkspace>,
  );
  const launcher = screen.getByRole('button', { name: 'Receive stock' });
  fireEvent.click(launcher);
  fireEvent.click(screen.getByRole('button', { name: 'complete' }));
  fireEvent.click(launcher);
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(refresh).not.toHaveBeenCalled();
  for (const phase of ['pending', 'unknown']) {
    fireEvent.click(screen.getByRole('button', { name: phase }));
    const input = screen.getByRole('textbox');
    fireEvent.click(launcher);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(launcher).toBeDisabled();
  }
});

it('blocks a withdrawn task immediately and never silently revives its retained dirty draft', () => {
  const view = render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'retained private draft' },
  });
  const input = screen.getByLabelText('receive entry');
  view.rerender(<Workspace tasks={[choices[1]]} />);
  expect(input).not.toBeVisible();
  expect(input).toBeDisabled();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('no longer available');
  view.rerender(<Workspace />);
  expect(input).not.toBeVisible();
  expect(input).toHaveValue('retained private draft');
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  expect(screen.getByRole('alertdialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Stay with this task' }));
  expect(input).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard and switch' }));
  expect(screen.getByLabelText('receive entry')).toHaveValue('');
  expect(screen.getByRole('heading', { name: 'Receive stock' })).toHaveFocus();
});
it('keeps a withdrawn clean task inaccessible and returns focus to Tasks on Close', () => {
  const view = render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  view.rerender(<Workspace tasks={[choices[1]]} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByLabelText('receive entry')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Tasks' })).toHaveFocus();
});

it('rejects interaction and submission from a retained withdrawn form', () => {
  const submit = vi.fn((event: FormEvent) => event.preventDefault());
  const click = vi.fn();
  const content = (eligible: boolean) => (
    <TaskWorkspace choices={eligible ? choices : [choices[1]]} context="Cable">
      {() => (
        <form aria-label="Receive form" onSubmit={submit}>
          <button type="submit" onClick={click}>
            Save receipt
          </button>
        </form>
      )}
    </TaskWorkspace>
  );
  const view = render(content(true));
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  const form = screen.getByRole('form', { name: 'Receive form' });
  const save = screen.getByRole('button', { name: 'Save receipt' });
  view.rerender(content(false));
  expect(screen.queryByRole('form', { name: 'Receive form' })).toBeNull();
  expect(save).toBeDisabled();
  fireEvent.click(save);
  fireEvent.submit(form);
  expect(click).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it.each(['recheck', 'hidden'] as const)(
  'does not consume or open a task from a %s source until fresh visible primary ownership returns',
  async (kind) => {
    intentUrl('quantity_move');
    const view = render(
      <IntentWorkspace
        intent="quantity_move"
        fresh={kind !== 'recheck'}
        hidden={kind === 'hidden'}
      />,
    );
    await act(async () => {});
    expect(location.search).toContain('task=quantity_move');
    expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
    view.rerender(<IntentWorkspace intent="quantity_move" />);
    await act(async () => {});
    expect(location.search).not.toContain('task=');
    expect(screen.getByLabelText('quantity_move entry')).toBeVisible();
  },
);

it('refuses a hidden retained workspace even inside an otherwise visible authoritative primary', async () => {
  intentUrl('quantity_move');
  const view = render(
    <IntentWorkspace intent="quantity_move" hiddenWorkspace />,
  );
  await act(async () => {});
  expect(screen.getByText('Record primary')).toBeVisible();
  expect(location.search).toContain('task=quantity_move');
  expect(screen.queryByLabelText('quantity_move entry')).toBeNull();
  view.rerender(<IntentWorkspace intent="quantity_move" />);
  await act(async () => {});
  expect(location.search).not.toContain('task=');
  expect(screen.getByLabelText('quantity_move entry')).toBeVisible();
});

import { useState, type FormEvent } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TaskWorkspace } from './task-workspace';
import { useReportTaskState, useTaskReset } from './task-state';
import { holdTransitionCapture } from '../../../../tests/helpers/transition-capture';
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
it.each(['release', 'switch', 'unmount'])(
  'defers task heading focus through capture and cancels stale intent on %s',
  async (outcome) => {
    const view = render(<Workspace />);
    const capture = holdTransitionCapture();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
      const heading = screen.getByRole('heading', { name: 'Receive stock' });
      expect(heading).not.toHaveFocus();
      if (outcome === 'switch')
        fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
      if (outcome === 'unmount') view.unmount();
      await act(capture.release);
      if (outcome === 'release') expect(heading).toHaveFocus();
      else expect(heading).not.toHaveFocus();
      if (outcome === 'switch')
        expect(
          screen.getByRole('heading', { name: 'Move stock' }),
        ).toHaveFocus();
    } finally {
      capture.dispose();
    }
  },
);
it('returns focus to the launcher after capture without consuming the intent early', async () => {
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Receive stock' });
  fireEvent.click(launcher);
  const capture = holdTransitionCapture();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(launcher).not.toHaveFocus();
    await act(capture.release);
    expect(launcher).toHaveFocus();
  } finally {
    capture.dispose();
  }
});
it('defers discard-dialog autofocus until capture completes', async () => {
  const view = render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'Draft' },
  });
  const capture = holdTransitionCapture();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
    const stay = screen.getByRole('button', { name: 'Stay with this task' });
    expect(stay).not.toHaveFocus();
    await act(capture.release);
    expect(stay).toHaveFocus();
    expect(screen.getByLabelText('receive entry')).toHaveValue('Draft');
  } finally {
    view.unmount();
    await act(capture.release);
    capture.dispose();
  }
});
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
it('focuses the retained task only after Stay removes its inert ancestor', () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'retained' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  const heading = screen.getByRole('heading', { name: 'Receive stock' });
  const nativeFocus = heading.focus.bind(heading);
  const inertAttempts: boolean[] = [];
  const focus = vi.spyOn(heading, 'focus').mockImplementation(() => {
    const inert = Boolean(heading.closest('[inert]'));
    inertAttempts.push(inert);
    // JSDOM does not enforce inert. Model the browser rejecting this focus.
    if (!inert) nativeFocus();
  });
  try {
    fireEvent.click(
      screen.getByRole('button', { name: 'Stay with this task' }),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('receive entry')).toHaveValue('retained');
    expect(heading).toHaveFocus();
    expect(inertAttempts).toEqual([false]);
  } finally {
    focus.mockRestore();
  }
});
it.each([
  'release',
  'reopen',
  'switch',
  'unmount',
  'hidden',
  'css-hidden',
  'aria-hidden',
  'inert',
  'pending',
  'complete',
  'repeat-stay',
])('fences retained-task Stay focus through capture on %s', async (outcome) => {
  const view = render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
  fireEvent.change(screen.getByLabelText('receive entry'), {
    target: { value: 'retained' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  const heading = screen.getByRole('heading', { name: 'Receive stock' });
  const focus = vi.spyOn(heading, 'focus');
  const capture = holdTransitionCapture();
  try {
    fireEvent.click(
      screen.getByRole('button', { name: 'Stay with this task' }),
    );
    expect(focus).not.toHaveBeenCalled();
    if (outcome === 'reopen' || outcome === 'repeat-stay') {
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
      if (outcome === 'repeat-stay')
        fireEvent.click(
          screen.getByRole('button', { name: 'Stay with this task' }),
        );
    }
    if (outcome === 'switch') {
      fireEvent.click(screen.getByRole('button', { name: 'Move stock' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Discard and switch' }),
      );
    }
    if (outcome === 'unmount') view.unmount();
    if (outcome === 'hidden') heading.parentElement!.hidden = true;
    if (outcome === 'css-hidden') heading.parentElement!.style.display = 'none';
    if (outcome === 'aria-hidden')
      heading.parentElement!.setAttribute('aria-hidden', 'true');
    if (outcome === 'inert') heading.parentElement!.setAttribute('inert', '');
    if (outcome === 'pending' || outcome === 'complete')
      fireEvent.click(screen.getByRole('button', { name: outcome }));
    await act(capture.release);
    if (outcome === 'release' || outcome === 'repeat-stay') {
      expect(heading).toHaveFocus();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('receive entry')).toHaveValue('retained');
    } else {
      expect(focus).not.toHaveBeenCalled();
      if (outcome === 'reopen')
        expect(
          screen.getByRole('button', { name: 'Stay with this task' }),
        ).toHaveFocus();
      if (outcome === 'switch')
        expect(
          screen.getByRole('heading', { name: 'Move stock' }),
        ).toHaveFocus();
    }
  } finally {
    view.unmount();
    await act(capture.release);
    capture.dispose();
    focus.mockRestore();
  }
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

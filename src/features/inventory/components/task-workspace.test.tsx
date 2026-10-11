import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TaskWorkspace } from './task-workspace';
import { useReportTaskState, useTaskReset } from './task-state';
const choices = [
  { id: 'receive', label: 'Receive stock' },
  { id: 'move', label: 'Move stock' },
];
function Draft({ id }: { id: string }) {
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState('');
  const reset = useTaskReset();
  const reportTask = useReportTaskState({
    dirty: !!value,
    pending: phase === 'pending' || phase === 'completed-pending',
    uncertain: phase === 'unknown',
    completed: phase === 'complete' || phase === 'completed-pending',
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

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
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
it.each(['pending', 'unknown', 'complete'])(
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
    if (phase === 'complete') {
      fireEvent.click(screen.getByRole('button', { name: 'New transaction' }));
      expect(screen.queryByLabelText('receive entry')).toBeNull();
      expect(screen.getByRole('button', { name: 'Move stock' })).toBeEnabled();
    }
  },
);
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
  expect(screen.getByText(/Completed transaction retained/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Move stock' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close task' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'New transaction' }));
  expect(screen.getByLabelText('receive entry')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'complete' }));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New transaction' }));
  expect(screen.queryByLabelText('receive entry')).toBeNull();
});

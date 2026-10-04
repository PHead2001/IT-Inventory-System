'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  TaskStateContext,
  TaskResetContext,
  type TaskState,
} from './task-state';
import { Button } from '@/components/ui/button';
export type TaskChoice = {
  id: string;
  label: string;
  group?: 'secondary' | 'consequential';
  description?: string;
};
const clean: TaskState = {
  dirty: false,
  pending: false,
  uncertain: false,
  completed: false,
};
export function TaskWorkspace({
  choices,
  children,
  context,
}: {
  choices: TaskChoice[];
  children: (id: string) => ReactNode;
  context: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null | undefined>(
    undefined,
  );
  const [state, setState] = useState(clean);
  const stateRef = useRef(clean);
  const requestedLauncher = useRef<HTMLButtonElement | null>(null);
  const [activeLabel, setActiveLabel] = useState('');
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [selected]);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const locked = state.pending || state.uncertain;
  const report = useCallback((next: TaskState) => {
    stateRef.current = next;
    setState(next);
    if (next.pending || next.uncertain || next.completed)
      setRequested(undefined);
  }, []);
  const change = (id: string | null) => {
    if (
      stateRef.current.pending ||
      stateRef.current.uncertain ||
      stateRef.current.completed ||
      id === selected
    )
      return;
    if (state.dirty) setRequested(id);
    else {
      setActiveLabel(
        choices.find((choice) => choice.id === id)?.label ?? activeLabel,
      );
      setSelected(id);
      stateRef.current = clean;
      setState(clean);
      if (id === null) launcher.current?.focus();
    }
  };
  return (
    <section
      aria-label="Record tasks"
      className="experience-surface my-5 space-y-4 p-4"
    >
      <h2 className="text-xl font-semibold">Tasks</h2>
      {context}
      {(['primary', 'secondary', 'consequential'] as const).map((group) => {
        const tasks = choices.filter(
          (choice) => (choice.group ?? 'primary') === group,
        );
        if (!tasks.length) return null;
        const controls = (
          <div className="flex flex-wrap gap-2">
            {tasks.map((choice) => (
              <Button
                key={choice.id}
                type="button"
                variant="outline"
                disabled={locked || state.completed}
                aria-pressed={choice.id === selected}
                onClick={(event) => {
                  if (stateRef.current.dirty)
                    requestedLauncher.current = event.currentTarget;
                  else launcher.current = event.currentTarget;
                  change(choice.id);
                }}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        );
        return group === 'primary' ? (
          <div key={group}>{controls}</div>
        ) : (
          <details key={group}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
              {group === 'secondary'
                ? 'Other tasks'
                : 'Lifecycle & consequential actions'}
            </summary>
            {controls}
            {tasks.map(
              (task) =>
                task.description && (
                  <p className="mt-2 text-sm text-slate-400" key={task.id}>
                    {task.label}: {task.description}
                  </p>
                ),
            )}
          </details>
        );
      })}
      {locked && (
        <p role="status" className="text-sm text-amber-100">
          {state.uncertain
            ? 'The result is unconfirmed. Retry the same transaction before switching tasks.'
            : state.completed
              ? 'Updating this task. Wait before starting another transaction.'
              : 'Saving this task. Wait for its result before switching.'}
        </p>
      )}
      {state.completed && (
        <p className="text-sm text-cyan-200">
          Completed transaction retained. Start a new transaction explicitly
          before switching tasks.
        </p>
      )}
      {requested !== undefined && (
        <div
          role="alertdialog"
          aria-label="Discard task draft?"
          className="space-y-3 rounded border border-amber-700 p-3"
        >
          <p>Your current task has unsaved entries.</p>
          <Button
            type="button"
            autoFocus
            disabled={locked || state.completed}
            onClick={() => {
              setRequested(undefined);
              heading.current?.focus();
            }}
          >
            Stay with this task
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              locked ||
              state.completed ||
              (requested !== null &&
                !choices.some((choice) => choice.id === requested))
            }
            onClick={() => {
              if (
                stateRef.current.pending ||
                stateRef.current.uncertain ||
                stateRef.current.completed ||
                (requested !== null &&
                  !choices.some((choice) => choice.id === requested))
              )
                return;
              if (requested !== null)
                launcher.current = requestedLauncher.current;
              setActiveLabel(
                choices.find((choice) => choice.id === requested)?.label ??
                  activeLabel,
              );
              setSelected(requested);
              setRequested(undefined);
              stateRef.current = clean;
              setState(clean);
              if (requested === null) launcher.current?.focus();
            }}
          >
            Discard and {requested === null ? 'close' : 'switch'}
          </Button>
        </div>
      )}
      {selected && (
        <div
          key={selected}
          inert={requested !== undefined}
          className="min-w-0 space-y-3"
        >
          <h3 ref={heading} tabIndex={-1} className="font-semibold">
            {activeLabel}
          </h3>
          <Button
            type="button"
            variant="outline"
            disabled={locked || state.completed}
            onClick={() => change(null)}
          >
            Close task
          </Button>
          <TaskResetContext.Provider
            value={() => {
              if (stateRef.current.pending || stateRef.current.uncertain)
                return;
              stateRef.current = clean;
              setSelected(null);
              setState(clean);
              launcher.current?.focus();
            }}
          >
            <TaskStateContext.Provider value={report}>
              {children(selected)}
            </TaskStateContext.Provider>
          </TaskResetContext.Provider>
        </div>
      )}
    </section>
  );
}

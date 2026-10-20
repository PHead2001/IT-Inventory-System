'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  TaskStateContext,
  TaskResetContext,
  TaskDiscardContext,
  TaskWarningContext,
  TaskEligibilityContext,
  type TaskState,
  type TaskDiscard,
} from './task-state';
import {
  InventoryCaptureGroup,
  InventoryCaptureRegion,
} from '@/components/experience/inventory-capture-region';
import { Button } from '@/components/ui/button';
import { afterTransitionCapture } from '@/components/forms/transition-capture';
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
  recordVersion,
  onRefresh,
}: {
  choices: TaskChoice[];
  children: (id: string) => ReactNode;
  context: ReactNode;
  recordVersion?: string | number;
  onRefresh?: () => void;
}) {
  const scope = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [instance, setInstance] = useState(0);
  const [invalidated, setInvalidated] = useState(false);
  const selectedEligible =
    selected === null || choices.some((choice) => choice.id === selected);
  // Once withdrawn, a task needs explicit reentry even if a later refresh
  // offers it again. Retain its draft/retry instance until deliberate closure.
  if (!selectedEligible && !invalidated) setInvalidated(true);
  const acknowledgedVersion = useRef<string | undefined>(undefined);
  const [requiredVersion, setRequiredVersion] = useState<string | undefined>(
    undefined,
  );
  const [refreshError, setRefreshError] = useState(false);
  const waitingForRecord =
    recordVersion !== undefined &&
    requiredVersion !== undefined &&
    BigInt(recordVersion) < BigInt(requiredVersion);
  const [requested, setRequested] = useState<string | null | undefined>(
    undefined,
  );
  const [state, setState] = useState(clean);
  const [warning, setWarning] = useState('');
  const stateRef = useRef(clean);
  const discardTask = useRef<TaskDiscard | null>(null);
  const registerDiscard = useCallback((discard: TaskDiscard | null) => {
    discardTask.current = discard;
  }, []);
  const requestedLauncher = useRef<HTMLButtonElement | null>(null);
  const [activeLabel, setActiveLabel] = useState('');
  const heading = useRef<HTMLHeadingElement | null>(null);
  const tasksHeading = useRef<HTMLHeadingElement | null>(null);
  const returnFocusRequested = useRef(false);
  const stayFocusRequested = useRef<{
    selected: string;
    instance: number;
  } | null>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const locked = state.pending || state.uncertain;
  useEffect(() => {
    if (selected)
      return afterTransitionCapture(document, () => heading.current?.focus());
  }, [selected, instance, invalidated]);
  useEffect(() => {
    if (requested !== undefined && !locked)
      return afterTransitionCapture(document, () =>
        stayButton.current?.focus(),
      );
  }, [requested, locked]);
  useEffect(() => {
    const intent = stayFocusRequested.current;
    if (!intent) return;
    if (
      requested !== undefined ||
      selected !== intent.selected ||
      instance !== intent.instance ||
      !selectedEligible ||
      invalidated ||
      locked ||
      state.completed
    ) {
      stayFocusRequested.current = null;
      return;
    }
    // React has now removed the task's inert attribute. Capture may still own
    // the DOM, so retain only this exact task instance's one-shot focus intent.
    const target = heading.current;
    const cancel = afterTransitionCapture(document, () => {
      if (stayFocusRequested.current !== intent) return;
      stayFocusRequested.current = null;
      if (
        !target?.isConnected ||
        target !== heading.current ||
        stateRef.current.pending ||
        stateRef.current.uncertain ||
        stateRef.current.completed ||
        target.closest('[hidden], [inert], [aria-hidden="true"]')
      )
        return;
      for (
        let node: HTMLElement | null = target;
        node;
        node = node.parentElement
      ) {
        const style = node.ownerDocument.defaultView?.getComputedStyle(node);
        if (
          style?.display === 'none' ||
          style?.visibility === 'hidden' ||
          style?.visibility === 'collapse'
        )
          return;
      }
      target.focus();
    });
    return () => {
      cancel();
      if (stayFocusRequested.current === intent)
        stayFocusRequested.current = null;
    };
  }, [
    requested,
    selected,
    instance,
    selectedEligible,
    invalidated,
    locked,
    state.completed,
  ]);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const unavailable = invalidated && !locked && !state.completed;
  useEffect(() => {
    if (
      selected !== null ||
      state.dirty ||
      state.pending ||
      state.uncertain ||
      state.completed ||
      !returnFocusRequested.current
    )
      return;
    return afterTransitionCapture(document, () => {
      // Consume only after capture permits the closed task's focus transfer.
      returnFocusRequested.current = false;
      const target = launcher.current;
      if (target?.isConnected && !target.disabled) target.focus();
      if (!target || target.ownerDocument.activeElement !== target)
        tasksHeading.current?.focus();
    });
  }, [selected, state]);
  const report = useCallback((next: TaskState) => {
    if (
      next.completed &&
      next.completedVersion &&
      (!acknowledgedVersion.current ||
        BigInt(next.completedVersion) > BigInt(acknowledgedVersion.current))
    )
      acknowledgedVersion.current = next.completedVersion;
    stateRef.current = next;
    setState(next);
    if (next.pending || next.uncertain || next.completed)
      setRequested(undefined);
  }, []);
  const change = (id: string | null) => {
    if (
      stateRef.current.pending ||
      stateRef.current.uncertain ||
      (id === selected && !stateRef.current.completed && !invalidated)
    )
      return;
    if (
      (stateRef.current.completed || !stateRef.current.dirty) &&
      discardTask.current &&
      !discardTask.current({
        newIntent: id !== null && stateRef.current.completed,
      })
    )
      return;
    if (stateRef.current.dirty && !stateRef.current.completed) setRequested(id);
    else {
      setInvalidated(false);
      setInstance((value) => value + 1);
      setRequiredVersion(id === null ? undefined : acknowledgedVersion.current);
      setRefreshError(false);
      if (
        id !== null &&
        recordVersion !== undefined &&
        acknowledgedVersion.current &&
        BigInt(recordVersion) < BigInt(acknowledgedVersion.current)
      ) {
        try {
          onRefresh?.();
        } catch {
          setRefreshError(true);
        }
      }
      setActiveLabel(
        choices.find((choice) => choice.id === id)?.label ?? activeLabel,
      );
      setSelected(id);
      stateRef.current = clean;
      setState(clean);
      if (id === null) returnFocusRequested.current = true;
    }
  };
  return (
    <section
      aria-label="Record tasks"
      className="experience-surface my-5 space-y-4 p-4"
    >
      <InventoryCaptureGroup region="task-launcher" className="space-y-4">
        <h2 ref={tasksHeading} tabIndex={-1} className="text-xl font-semibold">
          Tasks
        </h2>
        {context}
        {warning && (
          <div className="experience-feedback space-y-2 text-sm text-amber-200">
            <p role="alert">{warning}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setWarning('')}
            >
              Dismiss warning
            </Button>
          </div>
        )}
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
                  disabled={locked}
                  aria-pressed={choice.id === selected}
                  aria-describedby={
                    choice.description
                      ? `${scope}-${choice.id}-description`
                      : undefined
                  }
                  onClick={(event) => {
                    if (stateRef.current.dirty && !stateRef.current.completed)
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
          const descriptions = tasks.map(
            (task) =>
              task.description && (
                <p
                  id={`${scope}-${task.id}-description`}
                  className="mt-2 text-sm text-slate-400"
                  key={task.id}
                >
                  {task.label}: {task.description}
                </p>
              ),
          );
          return group === 'primary' ? (
            <div key={group}>
              {controls}
              {descriptions}
            </div>
          ) : (
            <details key={group}>
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {group === 'secondary' ? 'Other tasks' : 'Retire or archive'}
              </summary>
              {controls}
              {descriptions}
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
        {requested !== undefined && (
          <div
            role="alertdialog"
            aria-label="Discard task draft?"
            className="space-y-3 rounded border border-amber-700 p-3"
          >
            <p>Your current task has unsaved entries.</p>
            <Button
              type="button"
              ref={stayButton}
              disabled={locked}
              onClick={() => {
                stayFocusRequested.current = selected
                  ? { selected, instance }
                  : null;
                setRequested(undefined);
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
                if (discardTask.current && !discardTask.current()) return;
                if (requested !== null)
                  launcher.current = requestedLauncher.current;
                setActiveLabel(
                  choices.find((choice) => choice.id === requested)?.label ??
                    activeLabel,
                );
                setInvalidated(false);
                setInstance((value) => value + 1);
                setSelected(requested);
                setRequested(undefined);
                stateRef.current = clean;
                setState(clean);
                if (requested === null) returnFocusRequested.current = true;
              }}
            >
              Discard and {requested === null ? 'close' : 'switch'}
            </Button>
          </div>
        )}
      </InventoryCaptureGroup>
      {selected && (
        <div
          key={`${selected}:${instance}`}
          inert={requested !== undefined}
          className="min-w-0 space-y-3"
        >
          <InventoryCaptureGroup region="task-heading" className="space-y-3">
            <h3 ref={heading} tabIndex={-1} className="font-semibold">
              {activeLabel}
            </h3>

            {invalidated && (
              <p role="status">
                This task is no longer available for a new transaction.
                {unavailable && ' Close it or choose another task to continue.'}
              </p>
            )}
          </InventoryCaptureGroup>
          <TaskEligibilityContext.Provider
            value={!invalidated && selectedEligible}
          >
            <TaskResetContext.Provider
              value={() => {
                if (stateRef.current.pending || stateRef.current.uncertain)
                  return;
                if (discardTask.current && !discardTask.current()) return;
                stateRef.current = clean;
                setInvalidated(false);
                setSelected(null);
                setState(clean);
                returnFocusRequested.current = true;
              }}
            >
              <TaskDiscardContext.Provider value={registerDiscard}>
                <TaskStateContext.Provider value={report}>
                  <TaskWarningContext.Provider value={setWarning}>
                    {waitingForRecord ? (
                      <div className="space-y-3">
                        <p role={refreshError ? 'alert' : 'status'}>
                          {refreshError
                            ? 'The current record could not be loaded. Retry before starting another transaction.'
                            : 'Loading the current record before starting another transaction…'}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setRefreshError(false);
                            try {
                              onRefresh?.();
                            } catch {
                              setRefreshError(true);
                            }
                          }}
                        >
                          Retry loading record
                        </Button>
                      </div>
                    ) : (
                      <fieldset
                        hidden={unavailable}
                        inert={unavailable}
                        disabled={unavailable}
                        onClickCapture={(event) => {
                          if (!unavailable) return;
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onSubmitCapture={(event) => {
                          if (!unavailable) return;
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        className="min-w-0 space-y-3"
                      >
                        {children(selected)}
                      </fieldset>
                    )}
                  </TaskWarningContext.Provider>
                </TaskStateContext.Provider>
              </TaskDiscardContext.Provider>
            </TaskResetContext.Provider>
          </TaskEligibilityContext.Provider>
          <InventoryCaptureRegion region="task-close">
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => change(null)}
            >
              Close task
            </Button>
          </InventoryCaptureRegion>
        </div>
      )}
    </section>
  );
}

'use client';
import { createContext, useContext, useLayoutEffect } from 'react';
export type TaskState = {
  dirty: boolean;
  pending: boolean;
  uncertain: boolean;
  completed: boolean;
  completedVersion?: string;
};
export const TaskStateContext = createContext<
  ((state: TaskState) => void) | null
>(null);
export const TaskResetContext = createContext<(() => void) | null>(null);
export const TaskWarningContext = createContext<
  ((message: string) => void) | null
>(null);
export type TaskDiscard = (options?: { newIntent: boolean }) => boolean;
export const TaskDiscardContext = createContext<
  ((discard: TaskDiscard | null) => void) | null
>(null);
export function useTaskDiscard(discard: TaskDiscard) {
  const register = useContext(TaskDiscardContext);
  useLayoutEffect(() => {
    register?.(discard);
    return () => register?.(null);
  }, [register, discard]);
}
export const useTaskReset = () => useContext(TaskResetContext);
export const useTaskWarning = () => useContext(TaskWarningContext);
export function useReportTaskState(state: TaskState, enabled = true) {
  const report = useContext(TaskStateContext);
  const { dirty, pending, uncertain, completed, completedVersion } = state;
  useLayoutEffect(() => {
    if (enabled)
      report?.({ dirty, pending, uncertain, completed, completedVersion });
  }, [report, dirty, pending, uncertain, completed, completedVersion, enabled]);
  return (patch: Partial<TaskState>) =>
    report?.({
      dirty,
      pending,
      uncertain,
      completed,
      completedVersion,
      ...patch,
    });
}

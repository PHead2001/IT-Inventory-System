'use client';
import { createContext, useContext, useLayoutEffect } from 'react';
export type TaskState = {
  dirty: boolean;
  pending: boolean;
  uncertain: boolean;
  completed: boolean;
};
export const TaskStateContext = createContext<
  ((state: TaskState) => void) | null
>(null);
export const TaskResetContext = createContext<(() => void) | null>(null);
export const TaskDiscardContext = createContext<
  ((discard: (() => boolean) | null) => void) | null
>(null);
export function useTaskDiscard(discard: () => boolean) {
  const register = useContext(TaskDiscardContext);
  useLayoutEffect(() => {
    register?.(discard);
    return () => register?.(null);
  }, [register, discard]);
}
export const useTaskReset = () => useContext(TaskResetContext);
export function useReportTaskState(state: TaskState, enabled = true) {
  const report = useContext(TaskStateContext);
  const { dirty, pending, uncertain, completed } = state;
  useLayoutEffect(() => {
    if (enabled) report?.({ dirty, pending, uncertain, completed });
  }, [report, dirty, pending, uncertain, completed, enabled]);
  return (patch: Partial<TaskState>) =>
    report?.({ dirty, pending, uncertain, completed, ...patch });
}

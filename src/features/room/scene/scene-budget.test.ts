import { expect, it, vi } from 'vitest';
import { createSceneBudget } from './scene-budget';
it('reserves initialization and disposal until actual completion, even for priority requests', () => {
  const budget = createSceneBudget();
  const withdraw = vi.fn(),
    grant = vi.fn();
  const preview = budget.request(0, vi.fn(), withdraw);
  expect(preview.allocate()).toBe(true);
  const picker = budget.request(2, grant, vi.fn());
  expect(withdraw).toHaveBeenCalledOnce();
  expect(picker.allocate()).toBe(false);
  expect(grant).not.toHaveBeenCalled();
  preview.complete();
  expect(grant).toHaveBeenCalledOnce();
  expect(picker.allocate()).toBe(true);
  preview.complete();
  picker.cancel();
  const next = vi.fn();
  budget.request(1, next, vi.fn());
  expect(next).not.toHaveBeenCalled();
  picker.complete();
  expect(next).toHaveBeenCalledOnce();
});
it('releases cancelled requests immediately when no renderer was allocated and removes waiters', () => {
  const budget = createSceneBudget();
  const first = budget.request(0, vi.fn(), vi.fn());
  const next = vi.fn();
  budget.request(2, next, vi.fn());
  expect(next).toHaveBeenCalledOnce();
  expect(first.allocate()).toBe(false);
  const waiting = vi.fn();
  const cancelled = budget.request(0, waiting, vi.fn());
  cancelled.cancel();
  budget.dispose();
  expect(waiting).not.toHaveBeenCalled();
});

it('retires a lease before withdrawal and keeps its renderer slot occupied until real disposal', () => {
  const budget = createSceneBudget();
  const withdrawn = vi.fn(() => expect(original.current()).toBe(false));
  const original = budget.request(0, vi.fn(), withdrawn);
  expect(original.current()).toBe(true);
  expect(original.allocate()).toBe(true);
  const granted = vi.fn();
  const successor = budget.request(2, granted, vi.fn());
  expect(withdrawn).toHaveBeenCalledOnce();
  expect(original.current()).toBe(false);
  expect(successor.current()).toBe(false);
  expect(granted).not.toHaveBeenCalled();
  original.complete();
  expect(successor.current()).toBe(true);
  expect(granted).toHaveBeenCalledOnce();
  expect(original.current()).toBe(false);
  original.cancel();
  original.complete();
  expect(original.current()).toBe(false);
  expect(successor.current()).toBe(true);
});

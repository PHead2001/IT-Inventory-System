/** One layout-owned GPU slot, including renderer initialization and disposal. */
export function createSceneBudget() {
  type Entry = {
    priority: number;
    grant(): void;
    withdraw(): void;
    allocated: boolean;
    cancelled: boolean;
  };
  let active: Entry | null = null;
  const waiting: Entry[] = [];
  const promote = () => {
    if (active) return;
    waiting.sort((a, b) => b.priority - a.priority);
    const next = waiting.shift();
    if (!next) return;
    active = next;
    next.grant();
  };
  const retire = (entry: Entry) => {
    if (entry.cancelled) return;
    entry.cancelled = true;
    const index = waiting.indexOf(entry);
    if (index >= 0) waiting.splice(index, 1);
    entry.withdraw();
    if (active === entry && !entry.allocated) {
      active = null;
      promote();
    }
  };
  return {
    request(priority: number, grant: () => void, withdraw: () => void) {
      const entry: Entry = {
        priority,
        grant,
        withdraw,
        allocated: false,
        cancelled: false,
      };
      waiting.push(entry);
      // Withdrawal begins teardown; allocation is still occupied until complete.
      if (active && priority > active.priority) retire(active);
      promote();
      return {
        allocate() {
          if (active !== entry || entry.cancelled) return false;
          entry.allocated = true;
          return true;
        },
        cancel: () => retire(entry),
        complete() {
          if (active !== entry) return;
          active = null;
          entry.cancelled = true;
          promote();
        },
      };
    },
    dispose() {
      waiting.splice(0).forEach(retire);
      if (active) retire(active);
    },
  };
}
export type SceneLease = ReturnType<
  ReturnType<typeof createSceneBudget>['request']
>;

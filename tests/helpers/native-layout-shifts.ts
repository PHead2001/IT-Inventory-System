export const shiftProbeId = 'inventory-location-results-tree-2';

type ShiftSource = {
  element: boolean;
  target: 'probe' | 'other' | 'absent';
  previousRect: number[];
  currentRect: number[];
};
export type LayoutShiftObservation = {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
  sources: ShiftSource[];
};

// Stronger than reconstructing provider callback batches: a single probe shift
// outweighs every other eligible shift combined. Every winning CLS window must
// then contain it, and it must be that window's largest individual shift.
export function nativeProbeDominance(entries: LayoutShiftObservation[]) {
  const eligible = entries.filter((entry) => !entry.hadRecentInput);
  const largest = eligible.reduce<LayoutShiftObservation | undefined>(
    (previous, entry) =>
      previous && previous.value > entry.value ? previous : entry,
    undefined,
  );
  const source =
    largest?.sources.find((entry) => entry.element) ?? largest?.sources[0];
  const otherValue = eligible.reduce(
    (sum, entry) => sum + (entry === largest ? 0 : entry.value),
    0,
  );
  return {
    dominates: source?.target === 'probe' && (largest?.value ?? 0) > otherValue,
    value: largest?.value ?? 0,
    otherValue,
    target: source?.target ?? 'absent',
  };
}

// Diagnostic reconstruction only; provider delivery-batch grouping can differ.
// Session and tie rules from the pinned official speed-insights-script.js:
// gap < 1 s, session < 5 s, strictly greater winning total, later largest tie.
export function winningLayoutShift(entries: LayoutShiftObservation[]) {
  let session: LayoutShiftObservation[] = [];
  let sessionValue = 0;
  let value = 0;
  let winning: LayoutShiftObservation[] = [];
  for (const entry of entries) {
    if (entry.hadRecentInput) continue;
    if (
      sessionValue &&
      entry.startTime - session.at(-1)!.startTime < 1000 &&
      entry.startTime - session[0].startTime < 5000
    ) {
      session.push(entry);
      sessionValue += entry.value;
    } else {
      session = [entry];
      sessionValue = entry.value;
    }
    if (sessionValue > value) {
      value = sessionValue;
      winning = [...session];
    }
  }
  const largest = winning.reduce<LayoutShiftObservation | undefined>(
    (previous, entry) =>
      previous && previous.value > entry.value ? previous : entry,
    undefined,
  );
  const source =
    largest?.sources.find((entry) => entry.element) ?? largest?.sources[0];
  return { value, largest, target: source?.target ?? 'absent' };
}

// Serializable browser function. Only a fixed fixture target classification is
// retained: no arbitrary DOM ID, class, selector, text or URL enters diagnostics.
export function observeNativeLayoutShifts() {
  const observed = window as Window & {
    __testLayoutShifts?: LayoutShiftObservation[];
    __testDrainLayoutShifts?: () => void;
  };
  observed.__testLayoutShifts = [];
  const record = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: {
          node?: Node;
          previousRect: DOMRectReadOnly;
          currentRect: DOMRectReadOnly;
        }[];
      };
      observed.__testLayoutShifts!.push({
        startTime: shift.startTime,
        value: shift.value,
        hadRecentInput: shift.hadRecentInput,
        sources: (shift.sources ?? []).map((source) => ({
          element: source.node instanceof Element,
          target:
            source.node instanceof Element
              ? source.node.id === 'inventory-location-results-tree-2'
                ? 'probe'
                : 'other'
              : 'absent',
          previousRect: [
            source.previousRect.x,
            source.previousRect.y,
            source.previousRect.width,
            source.previousRect.height,
          ],
          currentRect: [
            source.currentRect.x,
            source.currentRect.y,
            source.currentRect.width,
            source.currentRect.height,
          ],
        })),
      });
    }
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: 'layout-shift', buffered: true });
  observed.__testDrainLayoutShifts = () => record(observer.takeRecords());
}

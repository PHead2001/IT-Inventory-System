import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  observeNativeLayoutShifts,
  nativeProbeDominance,
  winningLayoutShift,
  type LayoutShiftObservation,
} from '../helpers/native-layout-shifts';

const shift = (
  startTime: number,
  value: number,
  target: 'probe' | 'other' | 'absent' = 'other',
): LayoutShiftObservation => ({
  startTime,
  value,
  hadRecentInput: false,
  sources: [{ element: true, target, previousRect: [], currentRect: [] }],
});

describe('native CLS fixture winning session proof', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires strict probe dominance over all other eligible native shifts', () => {
    const entries = [
      shift(100, 0.2),
      shift(500, 0.2),
      shift(1600, 0.4, 'probe'),
    ];
    expect(nativeProbeDominance(entries).dominates).toBe(false);
    entries[2].value = 0.5;
    expect(nativeProbeDominance(entries)).toMatchObject({
      dominates: true,
      otherValue: 0.4,
    });
    entries.push({ ...shift(2000, 1), hadRecentInput: true });
    expect(nativeProbeDominance(entries).dominates).toBe(true);
    entries[2].sources.unshift({
      element: true,
      target: 'other',
      previousRect: [],
      currentRect: [],
    });
    expect(nativeProbeDominance(entries).dominates).toBe(false);
    expect(nativeProbeDominance([]).dominates).toBe(false);
  });

  it('captures buffered timing/rectangles without private node IDs or text', () => {
    const node = document.createElement('div');
    node.id = 'private-record-sentinel';
    node.textContent = 'private-text-sentinel';
    const entry = {
      startTime: 123,
      value: 0.25,
      hadRecentInput: false,
      sources: [
        {
          node,
          previousRect: { x: 0, y: 0, width: 100, height: 50 },
          currentRect: { x: 0, y: 50, width: 100, height: 50 },
        },
      ],
    };
    const observe = vi.fn();
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        observe = observe;
        takeRecords = () => [entry];
      },
    );
    observeNativeLayoutShifts();
    const observed = window as Window & {
      __testDrainLayoutShifts?: () => void;
      __testLayoutShifts?: LayoutShiftObservation[];
    };
    observed.__testDrainLayoutShifts!();
    expect(observe).toHaveBeenCalledWith({
      type: 'layout-shift',
      buffered: true,
    });
    expect(observed.__testLayoutShifts![0]).toEqual({
      startTime: 123,
      value: 0.25,
      hadRecentInput: false,
      sources: [
        {
          element: true,
          target: 'other',
          previousRect: [0, 0, 100, 50],
          currentRect: [0, 50, 100, 50],
        },
      ],
    });
    expect(JSON.stringify(observed.__testLayoutShifts)).not.toMatch(/private-/);
  });
  it('refuses a probe present in a losing session despite being largest overall', () => {
    const winner = winningLayoutShift([
      shift(100, 0.2),
      shift(500, 0.2),
      shift(1600, 0.3, 'probe'),
    ]);
    expect(winner.value).toBe(0.4);
    expect(winner.target).toBe('other');
  });
  it('excludes recent input and uses the later largest shift on ties', () => {
    const winner = winningLayoutShift([
      { ...shift(0, 1), hadRecentInput: true },
      shift(100, 0.2),
      shift(500, 0.2, 'probe'),
    ]);
    expect(winner.value).toBe(0.4);
    expect(winner.target).toBe('probe');
    expect(winner.largest?.startTime).toBe(500);
  });
  it('splits at exactly one second and retains the earlier winning total tie', () => {
    const winner = winningLayoutShift([
      shift(100, 0.2),
      shift(1100, 0.2, 'probe'),
    ]);
    expect(winner.target).toBe('other');
    expect(winner.value).toBe(0.2);
  });
  it('splits a session at exactly five seconds even with sub-second gaps', () => {
    const entries = Array.from({ length: 7 }, (_, i) => shift(i * 800, 0.1));
    entries.push(shift(5000, 0.6, 'probe'));
    expect(winningLayoutShift(entries).target).toBe('other');
    entries.push(shift(5100, 0.2, 'probe'));
    expect(winningLayoutShift(entries).target).toBe('probe');
  });
  it('uses first Element source, preserving unknown and missing attribution', () => {
    const entry = shift(100, 0.3, 'probe');
    entry.sources.unshift({
      element: true,
      target: 'other',
      previousRect: [],
      currentRect: [],
    });
    expect(winningLayoutShift([entry]).target).toBe('other');
    entry.sources[0].element = false;
    expect(winningLayoutShift([entry]).target).toBe('probe');
    entry.sources = [];
    expect(winningLayoutShift([entry]).target).toBe('absent');
    expect(winningLayoutShift([]).value).toBe(0);
  });
});

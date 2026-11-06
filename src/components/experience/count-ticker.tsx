'use client';

import { useRef, useState } from 'react';
import { usePresentationAdmission } from './presentation-admission';

export function integerCount(value: number | string | bigint): bigint | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const text = String(value);
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
}

/** Integer interpolation never converts a persisted bigint through Number. */
export function interpolateCount(from: bigint, to: bigint, progress: number) {
  const scaled = BigInt(
    Math.round(Math.max(0, Math.min(1, progress)) * 1_000_000),
  );
  return from + ((to - from) * scaled) / 1_000_000n;
}

export function CountTicker({
  value,
  unit,
  initialZero = false,
  announce = true,
  grouped = false,
}: {
  value: number | string | bigint;
  unit?: string;
  initialZero?: boolean;
  /** Disable when the containing status region already announces the full result. */
  announce?: boolean;
  grouped?: boolean;
}) {
  const visual = useRef<HTMLSpanElement>(null);
  const prior = useRef<bigint | null>(null);
  const format = (value: number | string | bigint) => {
    const integer = integerCount(value);
    const amount =
      grouped && integer !== null
        ? integer.toLocaleString('en-US')
        : String(value);
    return unit ? amount + ' ' + (integer === 1n ? unit : unit + 's') : amount;
  };
  const final = format(value);
  // Reserve both endpoint strings intrinsically, including digit and plural changes.
  const [range, setRange] = useState({
    to: final,
    from: initialZero ? format(0) : final,
  });
  if (range.to !== final) setRange({ to: final, from: range.to });
  usePresentationAdmission(
    visual,
    JSON.stringify([String(value), final, unit, initialZero]),
    ({ animate: allowed, initial, current: admittedNow }) => {
      const element = visual.current;
      const target = integerCount(value);
      const from = initial ? (initialZero ? 0n : target) : prior.current;
      prior.current = target;
      if (!element) return;
      element.textContent = final;
      if (!allowed || target === null || from === null || target === from)
        return;
      let frame = 0;
      const started = performance.now();
      const tick = (time: number) => {
        if (!admittedNow()) return;
        const progress = Math.min(1, (time - started) / 500);
        const current = interpolateCount(from, target, 1 - (1 - progress) ** 3);
        element.textContent = progress === 1 ? final : format(current);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(frame);
        element.textContent = final;
      };
    },
    () => {
      prior.current = null;
      if (visual.current && visual.current.textContent !== final)
        visual.current.textContent = final;
      setRange((current) =>
        current.to === final && current.from === final
          ? current
          : { to: final, from: final },
      );
    },
  );
  return (
    <span className="relative inline-grid max-w-full overflow-x-auto align-bottom tabular-nums">
      <span
        aria-hidden="true"
        data-count-footprint
        className="invisible col-start-1 row-start-1 whitespace-nowrap"
      >
        {range.from}
      </span>
      <span
        aria-hidden="true"
        data-count-footprint
        className="invisible col-start-1 row-start-1 whitespace-nowrap"
      >
        {final}
      </span>
      <span
        aria-hidden="true"
        data-count-visual
        ref={visual}
        className="col-start-1 row-start-1 whitespace-nowrap"
      >
        {final}
      </span>
      <span
        className="sr-only"
        data-count-final
        aria-live={announce ? 'polite' : undefined}
        aria-atomic="true"
      >
        {final}
      </span>
    </span>
  );
}

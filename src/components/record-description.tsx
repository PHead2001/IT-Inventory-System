'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';

/** The actual text stays mounted; only its ordinary-flow viewport expands. */
export function RecordTextDisclosure({
  text,
  label,
  lines,
}: {
  text: string;
  label: 'description' | 'manufacturer and model';
  lines: 1 | 3;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [measurement, setMeasurement] = useState<{
    text: string;
    lines: number;
  } | null>(null);
  const measured = measurement?.text === text && measurement.lines === lines;
  const paragraph = useRef<HTMLParagraphElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const reduced = useEffectiveReducedMotion();
  const limit = `${lines * 1.5}em`;
  const controls = useAnimationControls();
  const presentation = useRef<{
    text: string;
    lines: number;
    target: string;
    measured: boolean;
  } | null>(null);
  const target = expanded || !truncated ? 'auto' : limit;

  useLayoutEffect(() => {
    const previous = presentation.current;
    controls.stop();
    // The first measured cap must replace the server max-height before paint.
    // Explicit set also settles an in-flight animation when Reduced changes
    // while Motion's target remains unchanged. Updating duration alone cannot.
    if (
      reduced ||
      !measured ||
      !previous?.measured ||
      previous.text !== text ||
      previous.lines !== lines ||
      previous.target === target
    ) {
      controls.set({ height: target });
      // Motion may batch its visual render. Keep the same owned height at its
      // final value before paint while releasing the initial CSS max-height.
      if (viewport.current) viewport.current.style.height = target;
    } else {
      void controls.start({ height: target, transition: { duration: 0.22 } });
    }
    presentation.current = { text, lines, target, measured };
    return () => controls.stop();
  }, [controls, target, reduced, measured, text, lines]);

  useEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    let current = true;
    const measure = () => {
      if (!current || element.clientWidth <= 0) return;
      const computed = getComputedStyle(element);
      const lineHeight =
        Number.parseFloat(computed.lineHeight) ||
        Number.parseFloat(computed.fontSize) * 1.5;
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
      // The inner paragraph keeps its natural height even while the outer
      // viewport is clipped. No character guess or private measurement clone.
      const over =
        element.scrollHeight > lineHeight * lines + 1 ||
        element.scrollWidth > element.clientWidth + 1;
      if (!over && !expanded && document.activeElement === toggle.current)
        element.focus();
      // An expanded control stays available after reflow, including while focused.
      setTruncated(over || expanded);
      setMeasurement((previous) =>
        previous?.text === text && previous.lines === lines
          ? previous
          : { text, lines },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    document.fonts?.addEventListener('loadingdone', measure);
    document.fonts?.addEventListener('loadingerror', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      current = false;
      observer.disconnect();
      window.removeEventListener('resize', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
      document.fonts?.removeEventListener('loadingerror', measure);
    };
  }, [text, lines, expanded]);

  const buttonLabel = expanded ? `Show less ${label}` : `Show full ${label}`;
  return (
    <div className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_44px] items-start gap-2 text-base leading-6">
      <motion.div
        ref={viewport}
        initial={false}
        animate={controls}
        style={{
          overflow: 'hidden',
          maxHeight: !measured && !expanded ? limit : undefined,
        }}
      >
        <p
          ref={paragraph}
          id={id}
          tabIndex={-1}
          className="whitespace-pre-wrap break-words"
        >
          {text}
        </p>
      </motion.div>
      <div className="h-11 w-11">
        {truncated && (
          <Button
            ref={toggle}
            type="button"
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label={buttonLabel}
            title={buttonLabel}
            aria-controls={id}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" size={18} />
            ) : (
              <ChevronDown aria-hidden="true" size={18} />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function RecordDescription({
  description,
}: {
  description: string | null;
}) {
  return (
    <RecordTextDisclosure
      text={description || 'No description'}
      label="description"
      lines={3}
    />
  );
}

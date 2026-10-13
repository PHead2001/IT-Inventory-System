'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { RecordTitle } from '@/components/experience/record-transition';
import type { RecordIdentity } from '@/components/experience/route-motion-state';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function RecordName({
  name,
  record,
}: {
  name: string;
  record?: RecordIdentity;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = heading.current;
    if (!element) return;
    let current = true;
    const measure = () => {
      if (!current || element.clientWidth <= 0) return;
      // Expanded text needs a temporary, hidden three-line measurement at the
      // same width and computed typography. Never guess from character count.
      const probe = expanded
        ? (element.cloneNode(true) as HTMLElement)
        : element;
      if (probe !== element) {
        probe.removeAttribute('id');
        probe.style.viewTransitionName = 'none';
        probe.setAttribute('aria-hidden', 'true');
        const computed = getComputedStyle(element);
        Object.assign(probe.style, {
          position: 'fixed',
          visibility: 'hidden',
          pointerEvents: 'none',
          left: '-10000px',
          top: '0',
          width: element.clientWidth + 'px',
          margin: '0',
          height: 'auto',
          minHeight: '0',
          maxHeight: 'none',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: '3',
          overflow: 'hidden',
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
          letterSpacing: computed.letterSpacing,
          overflowWrap: computed.overflowWrap,
          wordBreak: computed.wordBreak,
        });
        document.body.append(probe);
      }
      const over =
        probe.scrollHeight > probe.clientHeight + 1 ||
        probe.scrollWidth > probe.clientWidth + 1;
      if (probe !== element) probe.remove();
      if (!over) {
        if (document.activeElement === toggle.current) element.focus();
        setExpanded(false);
      }
      setTruncated(over);
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
  }, [name, expanded]);
  const headingProps = {
    ref: heading,
    tabIndex: -1,
    id,
    className: `experience-heading min-w-0 break-words ${expanded ? '' : 'line-clamp-3'}`,
  };
  return (
    <div
      data-record-name-row
      className="mt-2 grid min-h-11 grid-cols-[minmax(0,1fr)_44px] items-start gap-2"
    >
      {record ? (
        <RecordTitle record={record} {...headingProps}>
          {name}
        </RecordTitle>
      ) : (
        <h1 {...headingProps}>{name}</h1>
      )}
      <div data-record-name-control className="h-11 w-11">
        {truncated && (
          <Button
            ref={toggle}
            type="button"
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label={expanded ? 'Show less' : 'Show full name'}
            title={expanded ? 'Show less' : 'Show full name'}
            aria-expanded={expanded}
            aria-controls={id}
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

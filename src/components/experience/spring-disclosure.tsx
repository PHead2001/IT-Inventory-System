'use client';

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { SpringPresence } from './spring-presence';

/** Native summary remains the sole activation path. Collapse changes visibility,
 * never discards a draft or cancels the business operation inside these nodes. */
export function SpringDisclosure({
  summary,
  summaryProps,
  children,
  open: initialOpen = false,
  ...props
}: HTMLAttributes<HTMLDetailsElement> & {
  summary: ReactNode;
  summaryProps?: HTMLAttributes<HTMLElement>;
  open?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialOpen);
  const [enhanced, setEnhanced] = useState(false);
  const [closing, setClosing] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const heading = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const instance = useId();
  const semanticOpen = useRef(expanded);
  const closingIntent = useRef(false);
  const adopted = useRef(false);
  const requestedOpen = useRef(initialOpen);
  const adopt = useCallback((node: HTMLDetailsElement | null) => {
    details.current = node;
    if (!node || adopted.current) return;
    adopted.current = true;
    semanticOpen.current = node.open;
    setExpanded(node.open);
    setEnhanced(true);
  }, []);
  useLayoutEffect(() => {
    semanticOpen.current = expanded;
  }, [expanded]);
  useLayoutEffect(() => {
    if (requestedOpen.current === initialOpen) return;
    requestedOpen.current = initialOpen;
    if (initialOpen === semanticOpen.current) return;
    semanticOpen.current = initialOpen;
    closingIntent.current = !initialOpen;
    if (!initialOpen && body.current?.contains(document.activeElement))
      heading.current?.focus();
    setClosing(!initialOpen);
    setExpanded(initialOpen);
  }, [initialOpen]);
  const finishClose = useCallback(() => {
    if (!semanticOpen.current) {
      closingIntent.current = false;
      setClosing(false);
    }
  }, []);
  return (
    <details
      {...props}
      ref={adopt}
      open={enhanced ? expanded || closing : initialOpen}
      suppressHydrationWarning
      onToggle={(event) => {
        // Direct native changes (including an existing form's Done action) are
        // semantic changes too. Internal hold-open never reopens the workflow.
        if (!event.currentTarget.open && semanticOpen.current) {
          semanticOpen.current = false;
          closingIntent.current = true;
          if (body.current?.contains(document.activeElement))
            heading.current?.focus();
          event.currentTarget.open = true;
          setExpanded(false);
          setClosing(true);
        } else if (
          event.currentTarget.open &&
          !semanticOpen.current &&
          !closingIntent.current
        ) {
          semanticOpen.current = true;
          setExpanded(true);
        }
        props.onToggle?.(event);
      }}
    >
      <summary
        {...summaryProps}
        ref={heading}
        aria-expanded={enhanced ? expanded : undefined}
        onClick={(event) => {
          summaryProps?.onClick?.(event);
          if (event.defaultPrevented || !enhanced) return;
          event.preventDefault();
          const next = !semanticOpen.current;
          semanticOpen.current = next;
          closingIntent.current = !next;
          if (!next && body.current?.contains(document.activeElement))
            heading.current?.focus();
          setClosing(!next);
          setExpanded(next);
        }}
      >
        {summary}
      </summary>
      <SpringPresence
        open={enhanced ? expanded : true}
        animateEnter={enhanced}
        instanceKey={instance}
        kind="disclosure"
        retainExit
        keepMounted
        surfaceRef={body}
        onExitComplete={finishClose}
      >
        {children}
      </SpringPresence>
    </details>
  );
}

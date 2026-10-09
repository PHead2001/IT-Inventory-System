'use client';

import { CopyTechnicalDetails } from './copy-technical-details';
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type AnchorHTMLAttributes,
} from 'react';
import {
  browserDisplayTimeZone,
  initialDisplayTimeZone,
  formatOperationalTimestamp,
  exportTimeZoneHref,
} from '@/lib/operational-time';
import {
  subscribeRelativeClock,
  relativeClockSnapshot,
  relativeClockServerSnapshot,
  relativeTimeLabel,
} from '@/lib/relative-clock';

const TimeZoneContext = createContext(initialDisplayTimeZone);
export const useOperationalTimeZone = () => useContext(TimeZoneContext);
const subscribe = () => () => {};
export function OperationalTimeProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    let resolved: ReturnType<typeof browserDisplayTimeZone> | undefined;
    return { snapshot: () => (resolved ??= browserDisplayTimeZone()) };
  });
  // Server and first hydration know only UTC. Resolve once per application mount.
  const context = useSyncExternalStore(
    subscribe,
    store.snapshot,
    () => initialDisplayTimeZone,
  );
  return <TimeZoneContext value={context}>{children}</TimeZoneContext>;
}
export function OperationalTimestamp({
  value,
  className,
  relative = false,
}: {
  value: unknown;
  className?: string;
  relative?: boolean;
}) {
  return relative ? (
    <RelativeTimestamp value={value} className={className} />
  ) : (
    <ExactTimestamp value={value} className={className} />
  );
}
function RelativeTimestamp({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const now = useSyncExternalStore(
    subscribeRelativeClock,
    relativeClockSnapshot,
    relativeClockServerSnapshot,
  );
  const timestamp = formatOperationalTimestamp(
    value,
    useContext(TimeZoneContext),
  );
  if (!timestamp) return <span className={className}>Time unavailable</span>;
  const label = relativeTimeLabel(timestamp.dateTime, now) ?? timestamp.text;
  return (
    <details className={className}>
      <summary
        className="min-h-11 cursor-pointer py-2 tabular-nums"
        title={timestamp.text}
      >
        <time dateTime={timestamp.dateTime}>{label}</time>
        <span className="sr-only"> Recorded {timestamp.accessibleText}</span>
      </summary>
      <p className="max-w-full break-words text-xs">{timestamp.text}</p>
      <CopyTechnicalDetails
        details={`Recorded instant: ${timestamp.dateTime}`}
      />
    </details>
  );
}
function ExactTimestamp({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const timestamp = formatOperationalTimestamp(
    value,
    useContext(TimeZoneContext),
  );
  return timestamp ? (
    <time className={className} dateTime={timestamp.dateTime}>
      {timestamp.text}
    </time>
  ) : (
    <span className={className}>Time unavailable</span>
  );
}
export function ExportLink({
  href,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string }) {
  const context = useContext(TimeZoneContext);
  return <a {...props} href={exportTimeZoneHref(href, context)} />;
}

'use client';

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

const TimeZoneContext = createContext(initialDisplayTimeZone);
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

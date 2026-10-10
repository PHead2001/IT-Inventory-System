'use client';

import Link, { useLinkStatus } from 'next/link';
import { useContext, type ComponentProps } from 'react';
import { RoutePendingContext, useReportRoutePending } from './route-pending';

function PendingLink() {
  const { pending } = useLinkStatus();
  useReportRoutePending(pending);
  return null;
}

/** Next retains modifiers, downloads, prefetch, focus and navigation guards. */
export default function RouteLink({
  children,
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const scope = useContext(RoutePendingContext);
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        const href =
          typeof props.href === 'string' ? props.href : props.href.pathname;
        const transaction = href ? scope?.beginNavigation?.(href) : undefined;
        let prevented = false;
        try {
          onNavigate?.({
            preventDefault: () => {
              prevented = true;
              event.preventDefault();
            },
          });
          if (!prevented && href && (!transaction || transaction.current()))
            scope?.navigation?.(href);
        } finally {
          transaction?.close();
        }
      }}
    >
      {children}
      <PendingLink />
    </Link>
  );
}

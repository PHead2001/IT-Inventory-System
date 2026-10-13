'use client';

import Link, { useLinkStatus } from 'next/link';
import { useContext, type ComponentProps } from 'react';
import { RoutePendingContext, useReportRoutePending } from './route-pending';
import { documentRecordRoute } from '@/lib/document-route';

function inventoryDestination(href: ComponentProps<typeof Link>['href']) {
  // Application links are root-relative (including documented pathname/query
  // objects). Never reinterpret an external or protocol-relative URL as local.
  if (
    typeof href !== 'string' &&
    (href.protocol || href.host || href.hostname || href.auth)
  )
    return false;
  const path = typeof href === 'string' ? href : href.pathname;
  if (!path?.startsWith('/') || path.startsWith('//')) return false;
  let url: URL;
  try {
    url = new URL(path, 'https://inventory.invalid');
  } catch {
    return false;
  }
  if (url.origin !== 'https://inventory.invalid') return false;
  if (url.pathname === '/inventory' || url.pathname === '/inventory/')
    return true;
  const record = documentRecordRoute(url.pathname);
  return Boolean(
    record?.prefix.startsWith('/inventory/') && record.key !== 'new',
  );
}

function PendingLink() {
  const { pending } = useLinkStatus();
  useReportRoutePending(pending);
  return null;
}

/** Next retains modifiers, downloads, focus and navigation guards. */
export default function RouteLink({
  children,
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const scope = useContext(RoutePendingContext);
  return (
    <Link
      {...props}
      // Next 16.3.6 can select a fulfilled-null partial prefetch before the
      // available primary, committing an empty paired source. All links to
      // these destinations must opt out, including plain sibling detail links
      // and links mounted while Reduced motion is active.
      prefetch={inventoryDestination(props.href) ? false : props.prefetch}
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

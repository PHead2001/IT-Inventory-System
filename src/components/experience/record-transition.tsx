'use client';

import {
  ViewTransition,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from 'react';
import Link from '@/components/experience/route-link';
import { useRouteMotion } from './route-motion';
import {
  titleTarget,
  sameHolding,
  matchesTitleListRoute,
  type HoldingIdentity,
  type RecordIdentity,
} from './route-motion-state';
import { sharedTitleMotion } from './shared-title-motion';
import { RouteContentIdentityContext } from './route-content-identity';
import { routeKey } from './route-key';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from './presentation-privacy';

function sameRecord(intent: RecordIdentity | null, record: RecordIdentity) {
  return intent?.kind === record.kind && intent.id === record.id;
}

function listRouteKey(href: string | undefined) {
  if (!href) return null;
  const url = new URL(href, 'https://inventory.invalid');
  return routeKey(url.pathname, url.searchParams);
}

export function InventoryRecordLink({
  record,
  holding,
  pairable = true,
  returnTo,
  href,
  className,
  children,
}: {
  record: RecordIdentity;
  holding: HoldingIdentity | null;
  pairable?: boolean;
  returnTo?: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const {
    intent,
    arm,
    retireTitle,
    validNow,
    listHref,
    finishAfterSnapshot,
    current,
  } = useRouteMotion();
  const contentIdentity = useContext(RouteContentIdentityContext);
  const target =
    returnTo && pairable
      ? titleTarget(record, returnTo, holding, contentIdentity?.rawRouteKey)
      : null;
  const targetListKey = target ? listRouteKey(target.listHref) : null;
  const matches =
    intent &&
    target &&
    sameRecord(intent, record) &&
    sameHolding(intent.holding, target.holding) &&
    listRouteKey(intent.listHref) === targetListKey &&
    listRouteKey(contentIdentity ? contentIdentity.listHref : listHref) ===
      targetListKey;
  return (
    <ViewTransition
      default="none"
      share={matches ? 'record-title' : 'none'}
      name={matches ? intent?.name : undefined}
      onShare={(instance) => {
        if (!current()) return;
        const cleanup = sharedTitleMotion(instance, validNow);
        finishAfterSnapshot(instance);
        return cleanup;
      }}
    >
      <Link
        href={href}
        className={className}
        onNavigate={() => {
          if (
            target &&
            document.querySelectorAll(`[id="${target.anchor}"]`).length === 1
          )
            arm(target);
          else retireTitle();
        }}
      >
        {children}
      </Link>
    </ViewTransition>
  );
}

export function RecordTitle({
  record,
  children,
  ref,
  ...headingProps
}: {
  record: RecordIdentity;
} & ComponentProps<'h1'>) {
  const {
    intent,
    arrival,
    enabled,
    validNow,
    pathname,
    finishAfterSnapshot,
    current,
  } = useRouteMotion();
  const privacy = usePrivacyReadiness();
  const heading = useRef<HTMLHeadingElement>(null);
  const revealed = useRef<string | null>(null);
  useImperativeHandle(ref, () => heading.current!, []);
  const contentIdentity = useContext(RouteContentIdentityContext);
  const matches =
    sameRecord(intent, record) &&
    (contentIdentity ? contentIdentity.pathname : pathname) ===
      intent?.detailPath;
  useLayoutEffect(() => {
    const element = heading.current;
    if (
      !element ||
      !enabled ||
      !matches ||
      !intent ||
      !arrival ||
      revealed.current === intent.name ||
      !matchesTitleListRoute(intent, arrival.sourceKey) ||
      arrival.destinationKey !== contentIdentity?.rawRouteKey ||
      !freshPresentationGrant(privacy) ||
      !current() ||
      !validNow() ||
      !element.isConnected ||
      element.closest('[hidden], [inert]') ||
      !element.getClientRects().length
    )
      return;
    revealed.current = intent.name;
    const rect = element.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.experience-header');
    const position = header && getComputedStyle(header).position;
    const inset =
      header && (position === 'fixed' || position === 'sticky')
        ? Math.max(0, header.getBoundingClientRect().bottom)
        : 0;
    const margin =
      Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const top = inset + margin;
    if (rect.top < top || rect.top >= window.innerHeight) {
      // React has captured the source before layout effects, but measures the
      // incoming shared H1 afterwards. Reveal only this authorized forward
      // primary now; native history and app Back keep their own scroll behavior.
      window.scrollBy({ top: rect.top - top, behavior: 'instant' });
    }
  });
  return (
    <ViewTransition
      default="none"
      share={matches ? 'record-title' : 'none'}
      name={matches ? intent!.name : undefined}
      onShare={(instance) => {
        if (!current()) return;
        const cleanup = sharedTitleMotion(instance, validNow);
        finishAfterSnapshot(instance);
        return cleanup;
      }}
    >
      <h1 {...headingProps} ref={heading}>
        {children}
      </h1>
    </ViewTransition>
  );
}

export function InventoryBackLink({
  record,
  href,
  className,
  children,
}: {
  record: RecordIdentity;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { armBack } = useRouteMotion();
  return (
    <Link
      href={href}
      className={className}
      onNavigate={() => {
        armBack(record, href);
      }}
    >
      {children}
    </Link>
  );
}

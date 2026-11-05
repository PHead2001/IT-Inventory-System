'use client';
import { PeekAnchor, PeekLink } from '@/features/peek/peek-link';

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
  sameTitleSource,
  samePresentationTarget,
  historyTitleTarget,
  locationTitleTarget,
  type PresentationTarget,
  type LocationIdentity,
  type TitleTarget,
  matchesTitleListRoute,
  type HoldingIdentity,
  type RecordIdentity,
} from './route-motion-state';
import { sharedTitleMotion } from './shared-title-motion';
import { RouteContentIdentityContext } from './route-content-identity';
import { routeKey } from './route-key';
import { recordDetailReturnPath } from '@/features/inventory/detail-return';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from './presentation-privacy';
import { hasBlockingPresentationAncestor } from '@/components/forms/transition-capture-boundary';

function sameRecord(
  intent: PresentationTarget | null,
  record: PresentationTarget,
) {
  return samePresentationTarget(intent, record);
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
    finishTitleAfterSnapshot,
    current,
    rejectTitleSnapshot,
    captureAvailable,
    registerReturnSource,
  } = useRouteMotion();
  const source = useRef<HTMLAnchorElement>(null);
  const contentIdentity = useContext(RouteContentIdentityContext);
  const target =
    returnTo && pairable
      ? titleTarget(record, returnTo, holding, contentIdentity?.rawRouteKey)
      : null;
  const targetListKey = target ? listRouteKey(target.listHref) : null;
  useLayoutEffect(() => {
    if (target && source.current)
      return registerReturnSource(target, source.current);
  });
  const matches =
    captureAvailable !== false &&
    intent &&
    target &&
    sameRecord(intent, record) &&
    sameTitleSource(intent, target) &&
    listRouteKey(intent.listHref) === targetListKey &&
    listRouteKey(contentIdentity ? contentIdentity.listHref : listHref) ===
      targetListKey;
  return (
    <PeekAnchor target={record}>
      {(trigger) => (
        <ViewTransition
          default="none"
          share={matches ? 'record-title' : 'none'}
          name={matches ? intent?.name : undefined}
          onShare={(instance) => {
            if (!current() || finishTitleAfterSnapshot(instance) === false)
              return;
            const cleanup = sharedTitleMotion(
              instance,
              validNow,
              rejectTitleSnapshot,
            );
            return cleanup;
          }}
        >
          <Link
            {...trigger}
            ref={source}
            href={href}
            className={className}
            onNavigate={() => {
              if (
                target &&
                document.querySelectorAll(`[id="${target.anchor}"]`).length ===
                  1
              )
                arm(target);
              else retireTitle();
            }}
          >
            {children}
          </Link>
        </ViewTransition>
      )}
    </PeekAnchor>
  );
}

export function RecordTitle({
  record,
  children,
  ref,
  ...headingProps
}: {
  record: PresentationTarget;
} & ComponentProps<'h1'>) {
  const {
    intent,
    titleArrival,
    enabled,
    validNow,
    pathname,
    finishTitleAfterSnapshot,
    current,
    rejectTitleSnapshot,
    captureAvailable,
  } = useRouteMotion();
  const privacy = usePrivacyReadiness();
  const heading = useRef<HTMLHeadingElement>(null);
  const revealed = useRef<string | null>(null);
  useImperativeHandle(ref, () => heading.current!, []);
  const contentIdentity = useContext(RouteContentIdentityContext);
  const matches =
    captureAvailable !== false &&
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
      !titleArrival ||
      revealed.current === intent.name ||
      !matchesTitleListRoute(intent, titleArrival.sourceKey) ||
      titleArrival.destinationKey !== contentIdentity?.rawRouteKey ||
      !freshPresentationGrant(privacy) ||
      !current() ||
      !validNow() ||
      !element.isConnected ||
      hasBlockingPresentationAncestor(element) ||
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
        if (!current() || finishTitleAfterSnapshot(instance) === false) return;
        const cleanup = sharedTitleMotion(
          instance,
          validNow,
          rejectTitleSnapshot,
        );
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
  record: PresentationTarget;
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

function visibleUniqueSource(anchor: string) {
  const sources = document.querySelectorAll<HTMLElement>(`[id="${anchor}"]`);
  const source = sources.length === 1 ? sources[0] : null;
  return (
    !!source &&
    source.isConnected &&
    !hasBlockingPresentationAncestor(source) &&
    source.getClientRects().length > 0 &&
    getComputedStyle(source).visibility !== 'hidden'
  );
}
function scopedSourceMatches(
  intent: ReturnType<typeof useRouteMotion>['intent'],
  target: TitleTarget | null,
  rawKey: string | undefined,
) {
  return (
    !!intent &&
    !!target &&
    sameTitleSource(intent, target) &&
    !!rawKey &&
    matchesTitleListRoute(intent, rawKey)
  );
}
export function HistoryRecordLink({
  record,
  event,
  returnTo,
  href,
  className,
  children,
}: {
  record: RecordIdentity;
  event: { kind: 'asset' | 'quantity'; id: string };
  returnTo: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const motion = useRouteMotion();
  const identity = useContext(RouteContentIdentityContext);
  const target = historyTitleTarget(
    record,
    event,
    returnTo,
    identity?.rawRouteKey,
  );
  const matches =
    motion.captureAvailable !== false &&
    scopedSourceMatches(motion.intent, target, identity?.rawRouteKey);
  return (
    <PeekAnchor target={record}>
      {(trigger) => (
        <ViewTransition
          default="none"
          share={matches ? 'record-title' : 'none'}
          name={matches ? motion.intent!.name : undefined}
          onShare={(instance) => {
            if (
              !motion.current() ||
              motion.finishTitleAfterSnapshot(instance) === false
            )
              return;
            const cleanup = sharedTitleMotion(
              instance,
              motion.validNow,
              motion.rejectTitleSnapshot,
            );
            return cleanup;
          }}
        >
          <Link
            {...trigger}
            href={href}
            className={className}
            onNavigate={() => {
              if (target && visibleUniqueSource(target.anchor))
                motion.arm(target);
              else motion.retireTitle();
            }}
          >
            {children}
          </Link>
        </ViewTransition>
      )}
    </PeekAnchor>
  );
}
export function LocationTitleSourceName({
  location,
  occurrence,
  returnTo,
  as: Tag = 'span',
  className,
  children,
}: {
  location: LocationIdentity;
  occurrence: import('@/features/inventory/detail-return').LocationOccurrence;
  returnTo: string;
  as?: 'span' | 'h2';
  className?: string;
  children: React.ReactNode;
}) {
  const motion = useRouteMotion();
  const identity = useContext(RouteContentIdentityContext);
  const target = locationTitleTarget(
    location,
    occurrence,
    returnTo,
    identity?.rawRouteKey,
  );
  const matches =
    motion.captureAvailable !== false &&
    scopedSourceMatches(motion.intent, target, identity?.rawRouteKey);
  // Even a mismatched/unfresh draft preserves one stable occurrence anchor.
  const anchor = `location-row-${occurrence}-${location.id}`;
  return (
    <ViewTransition
      default="none"
      share={matches ? 'record-title' : 'none'}
      name={matches ? motion.intent!.name : undefined}
      onShare={(instance) => {
        if (
          !motion.current() ||
          motion.finishTitleAfterSnapshot(instance) === false
        )
          return;
        const cleanup = sharedTitleMotion(
          instance,
          motion.validNow,
          motion.rejectTitleSnapshot,
        );
        return cleanup;
      }}
    >
      <Tag id={anchor} className={className}>
        {children}
      </Tag>
    </ViewTransition>
  );
}
export function LocationDetailLink({
  location,
  label,
  occurrence,
  returnTo,
  onLeave,
  className,
  children,
}: {
  location: LocationIdentity;
  label: string;
  occurrence: import('@/features/inventory/detail-return').LocationOccurrence;
  returnTo: string;
  onLeave: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const motion = useRouteMotion();
  const identity = useContext(RouteContentIdentityContext);
  const target = locationTitleTarget(
    location,
    occurrence,
    returnTo,
    identity?.rawRouteKey,
  );
  const href = recordPathForLocation(location, returnTo);
  return (
    <PeekLink
      peekTarget={{ kind: 'location', code: location.code }}
      href={href}
      aria-label={'View ' + label + ' location details'}
      className={className}
      onNavigate={() => {
        onLeave();
        if (target && visibleUniqueSource(target.anchor)) motion.arm(target);
        else motion.retireTitle();
      }}
    >
      {children}
    </PeekLink>
  );
}
function recordPathForLocation(location: LocationIdentity, returnTo: string) {
  return (
    '/locations/' +
    encodeURIComponent(location.code) +
    '?' +
    new URLSearchParams({
      returnTo: recordDetailReturnPath(returnTo, '/locations'),
    })
  );
}

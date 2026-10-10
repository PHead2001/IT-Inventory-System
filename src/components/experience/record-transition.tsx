'use client';

import { ViewTransition } from 'react';
import Link from '@/components/experience/route-link';
import { useRouteMotion } from './route-motion';
import {
  titleTarget,
  sameHolding,
  type HoldingIdentity,
  type RecordIdentity,
} from './route-motion-state';
import { sharedTitleMotion } from './shared-title-motion';

function sameRecord(intent: RecordIdentity | null, record: RecordIdentity) {
  return intent?.kind === record.kind && intent.id === record.id;
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
  const target =
    returnTo && pairable ? titleTarget(record, returnTo, holding) : null;
  const matches =
    intent &&
    target &&
    sameRecord(intent, record) &&
    sameHolding(intent.holding, target.holding) &&
    intent.listHref === target.listHref &&
    listHref === target.listHref;
  return (
    <ViewTransition
      default="none"
      share={matches ? 'record-title' : 'none'}
      name={matches ? intent?.name : undefined}
      onShare={(instance) => {
        if (!current()) return;
        sharedTitleMotion(instance, validNow);
        finishAfterSnapshot(instance);
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
  className,
  children,
}: {
  record: RecordIdentity;
  className?: string;
  children: React.ReactNode;
}) {
  const { intent, validNow, pathname, finishAfterSnapshot, current } =
    useRouteMotion();
  const matches = sameRecord(intent, record) && pathname === intent?.detailPath;
  return (
    <ViewTransition
      default="none"
      share={matches ? 'record-title' : 'none'}
      name={matches ? intent!.name : undefined}
      onShare={(instance) => {
        if (!current()) return;
        sharedTitleMotion(instance, validNow);
        finishAfterSnapshot(instance);
      }}
    >
      <h1 className={className}>{children}</h1>
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

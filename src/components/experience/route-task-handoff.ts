import { recordDetailReturnPath } from '@/features/inventory/detail-return';
import { canonicalRecordPath, routeKey } from './route-key';
import type { PrivacyTaskQueryContinuity } from '@/components/auth/privacy-task-query';
import {
  isControllerTaskContinuity,
  taskQueryDestination,
} from '@/components/auth/privacy-task-query';

export type TaskSource = {
  root: HTMLElement;
  actorId: string;
  contentIdentity: string;
  serverAnchor: string;
  cleanKey: string;
  navigationIdentity: number;
  securityRevision: string;
  pendingEpoch: number;
  committedKey: string;
  fresh: boolean;
  idle: boolean;
  visible: boolean;
  continuity?: PrivacyTaskQueryContinuity;
};
function semanticKey(key: string) {
  const url = new URL(key, location.origin);
  url.searchParams.delete('task');
  url.searchParams.delete('returnTo');
  return routeKey(url.pathname, url.searchParams);
}
function validReturn(url: URL) {
  const values = url.searchParams.getAll('returnTo');
  return (
    values.length <= 1 &&
    (!values.length || recordDetailReturnPath(values[0], '') !== '')
  );
}
function sameBinding(a: TaskSource, b: TaskSource) {
  return (
    a.root === b.root &&
    a.actorId === b.actorId &&
    a.contentIdentity === b.contentIdentity &&
    a.serverAnchor === b.serverAnchor &&
    a.navigationIdentity === b.navigationIdentity
  );
}

/** Consumption-only receipt. A raw URL or registration can never mint one. */
export function createNativeTaskHandoff() {
  // A busy accepted primary remembers its binding only. It grants no task
  // capability until that same clean source is observed idle and fresh.
  let candidate: TaskSource | null = null;
  let receipt: TaskSource | null = null;
  let retired = false;
  let preservedBy: PrivacyTaskQueryContinuity | null = null;
  let consumedBy: symbol | null = null;
  const retire = () => {
    if (candidate) retired = true;
  };
  const current = (source: TaskSource) => {
    if (!receipt || retired) return false;
    if (!sameBinding(receipt, source)) {
      retire();
      return false;
    }
    const continuity = source.continuity;
    const cleanup =
      continuity?.kind === 'cleanup' &&
      continuity.parent === consumedBy &&
      consumedBy !== null &&
      continuity.destinationKey === receipt.cleanKey;
    const matchingContinuity =
      continuity?.current() === true &&
      continuity.securityRevision === receipt.securityRevision &&
      source.committedKey === continuity.destinationKey &&
      (cleanup ||
        (continuity.kind === 'task' &&
          (continuity.sourceKey === receipt.cleanKey ||
            (preservedBy?.identity === continuity.identity &&
              consumedBy === continuity.identity))));
    const consumptionFresh =
      source.fresh || (matchingContinuity && continuity!.consumptionReady());
    if (
      preservedBy &&
      ((!preservedBy.current() && !cleanup) ||
        (continuity?.identity !== preservedBy.identity && !cleanup))
    ) {
      retire();
      return false;
    }
    if (
      !source.idle ||
      !source.visible ||
      (source.fresh
        ? source.securityRevision !== receipt.securityRevision
        : !matchingContinuity) ||
      source.pendingEpoch !== receipt.pendingEpoch ||
      semanticKey(source.committedKey) !== semanticKey(receipt.cleanKey)
    ) {
      retire();
      return false;
    }
    if (matchingContinuity) {
      preservedBy = continuity!;
      if (cleanup && consumptionFresh && continuity!.status() === 'verified') {
        preservedBy = null;
        consumedBy = null;
      } else if (!consumptionFresh || continuity!.status() === 'pending')
        return false;
    } else if (preservedBy) {
      retire();
      return false;
    }
    if (!consumptionFresh) return false;
    return true;
  };
  return {
    retire,
    transfer(
      before: TaskSource,
      after: TaskSource,
      handoff: { sourceKey: string; destinationKey: string },
      continuity: PrivacyTaskQueryContinuity,
    ) {
      if (
        !before.fresh ||
        !after.fresh ||
        !before.visible ||
        !after.visible ||
        !before.idle ||
        !after.idle ||
        !sameBinding(before, after) ||
        before.securityRevision !== after.securityRevision ||
        before.pendingEpoch !== after.pendingEpoch ||
        before.committedKey !== handoff.sourceKey ||
        before.cleanKey !== handoff.sourceKey ||
        after.committedKey !== before.committedKey ||
        (candidate && sameBinding(candidate, before) && retired) ||
        !isControllerTaskContinuity(continuity) ||
        continuity.kind !== 'task' ||
        continuity.status() !== 'consumed' ||
        !continuity.current() ||
        !continuity.consumptionReady() ||
        continuity.sourceKey !== handoff.sourceKey ||
        continuity.destinationKey !== handoff.sourceKey ||
        continuity.securityRevision !== before.securityRevision ||
        taskQueryDestination(handoff.destinationKey, handoff.sourceKey) !==
          handoff.destinationKey ||
        routeKey(location.pathname, new URLSearchParams(location.search)) !==
          handoff.destinationKey
      )
        return false;
      candidate = { ...before };
      receipt = { ...before, cleanKey: handoff.destinationKey };
      preservedBy = continuity;
      consumedBy = continuity.identity;
      retired = false;
      return true;
    },
    observe(source: TaskSource, acceptedPrimary: boolean) {
      if (receipt && sameBinding(receipt, source)) {
        current(source);
        return;
      }
      // Only a new accepted exact server/navigation binding can replace a
      // retired receipt. Reverification or a cached render cannot revive it.
      let eligible =
        acceptedPrimary &&
        source.fresh &&
        source.visible &&
        source.committedKey === source.cleanKey;
      if (eligible) {
        try {
          const url = new URL(source.cleanKey, location.origin);
          eligible = !url.searchParams.has('task') && validReturn(url);
        } catch {
          // An opaque document or malformed key supplies no task capability.
          eligible = false;
        }
      }
      if (!candidate || !sameBinding(candidate, source)) {
        retire();
        if (!eligible) return;
        candidate = { ...source };
        receipt = null;
        preservedBy = null;
        consumedBy = null;
        retired = false;
      } else if (retired) return;
      if (
        !source.fresh ||
        !source.visible ||
        source.securityRevision !== candidate.securityRevision ||
        source.pendingEpoch !== candidate.pendingEpoch ||
        source.cleanKey !== candidate.cleanKey ||
        source.committedKey !== candidate.cleanKey
      ) {
        retire();
        return;
      }
      if (eligible && source.idle) receipt = { ...source };
    },
    consume(
      source: TaskSource,
      recordPath: string,
      task: string,
      apply: (href: string) => void,
    ) {
      if (!receipt) {
        retire();
        return null;
      }
      if (!current(source) || !receipt) return null;
      const url = new URL(location.href);
      const kind = /^\/inventory\/(assets|quantity)\/[^/]+$/.exec(
        url.pathname,
      )?.[1];
      if (
        !kind ||
        source.committedKey !== routeKey(url.pathname, url.searchParams) ||
        canonicalRecordPath(url.pathname) !== canonicalRecordPath(recordPath) ||
        canonicalRecordPath(url.pathname) !== receipt.cleanKey.split('?')[0] ||
        task !==
          (kind === 'assets'
            ? 'asset_move'
            : kind === 'quantity'
              ? 'quantity_move'
              : '') ||
        url.searchParams.getAll('task').length !== 1 ||
        url.searchParams.get('task') !== task ||
        !validReturn(url)
      ) {
        retire();
        return null;
      }
      const before = location.href;
      url.searchParams.delete('task');
      try {
        if (!current(source) || location.href !== before) return null;
        apply(url.pathname + url.search + url.hash);
      } catch {
        retire();
        return null;
      }
      if (preservedBy?.kind === 'task') {
        if (!preservedBy.complete(routeKey(url.pathname, url.searchParams))) {
          retire();
          return null;
        }
        consumedBy = preservedBy.identity;
      }
      if (!current(source) || location.href !== url.href) {
        retire();
        return null;
      }
      receipt.cleanKey = routeKey(url.pathname, url.searchParams);
      return {
        sourceKey: source.serverAnchor,
        destinationKey: receipt.cleanKey,
      };
    },
  };
}

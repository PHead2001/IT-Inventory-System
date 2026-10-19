import { recordDetailReturnPath } from '@/features/inventory/detail-return';
import { canonicalRecordPath, routeKey } from './route-key';

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
  let receipt: TaskSource | null = null;
  let retired = false;
  const retire = () => {
    if (receipt) retired = true;
  };
  const current = (source: TaskSource) => {
    if (!receipt || retired) return false;
    if (!sameBinding(receipt, source)) {
      retire();
      return false;
    }
    if (
      !source.fresh ||
      !source.idle ||
      !source.visible ||
      source.securityRevision !== receipt.securityRevision ||
      source.pendingEpoch !== receipt.pendingEpoch ||
      semanticKey(source.committedKey) !== semanticKey(receipt.cleanKey)
    ) {
      retire();
      return false;
    }
    return true;
  };
  return {
    retire,
    observe(source: TaskSource, acceptedPrimary: boolean) {
      if (receipt && sameBinding(receipt, source)) {
        current(source);
        return;
      }
      // Only a new accepted exact server/navigation binding can replace a
      // retired receipt. Reverification or a cached render cannot revive it.
      const url = new URL(source.cleanKey, location.origin);
      if (
        !acceptedPrimary ||
        !source.fresh ||
        !source.idle ||
        !source.visible ||
        source.committedKey !== source.cleanKey ||
        url.searchParams.has('task') ||
        !validReturn(url)
      ) {
        retire();
        return;
      }
      receipt = { ...source };
      retired = false;
    },
    consume(
      source: TaskSource,
      recordPath: string,
      task: string,
      apply: (href: string) => void,
    ) {
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

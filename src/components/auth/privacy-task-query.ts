import {
  canonicalRecordPath,
  routeKey,
} from '@/components/experience/route-key';
import { recordDetailReturnPath } from '@/features/inventory/detail-return';

/** Preservation of an existing receipt only; never private-content admission. */
export type PrivacyTaskQueryContinuity = Readonly<{
  identity: symbol;
  parent: symbol | null;
  kind: 'task' | 'cleanup';
  sourceKey: string;
  destinationKey: string;
  securityRevision: string;
  status: () => 'pending' | 'verified' | 'consumed' | 'retired';
  current: () => boolean;
  complete: (cleanKey: string) => boolean;
}>;

/** A task may add/change only its one valid return scope on the same record. */
export function taskQueryDestination(source: string, destination: string) {
  try {
    const origin = 'https://inventory.invalid';
    const before = new URL(source, origin);
    const after = new URL(destination, origin);
    const kind =
      /^\/inventory\/(assets|quantity)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(
        canonicalRecordPath(after.pathname),
      )?.[1];
    if (
      !kind ||
      before.origin !== origin ||
      after.origin !== origin ||
      canonicalRecordPath(before.pathname) !==
        canonicalRecordPath(after.pathname) ||
      before.hash ||
      after.hash ||
      before.searchParams.has('task') ||
      after.searchParams.getAll('task').length !== 1 ||
      after.searchParams.get('task') !==
        (kind === 'assets' ? 'asset_move' : 'quantity_move') ||
      [before, after].some((url) => {
        const values = url.searchParams.getAll('returnTo');
        return (
          values.length > 1 ||
          (values.length === 1 && recordDetailReturnPath(values[0], '') === '')
        );
      })
    )
      return null;
    const clean = new URL(after);
    clean.searchParams.delete('task');
    before.searchParams.delete('returnTo');
    after.searchParams.delete('returnTo');
    after.searchParams.delete('task');
    if (
      routeKey(before.pathname, before.searchParams) !==
      routeKey(after.pathname, after.searchParams)
    )
      return null;
    return routeKey(clean.pathname, clean.searchParams);
  } catch {
    return null;
  }
}

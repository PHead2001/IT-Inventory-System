'use server';

import { unstable_rethrow } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { requireMember } from '@/lib/auth/session.server';
import { mayMutateInventory } from '@/lib/auth/membership';
import { validReturnPath } from '@/features/scan/targets';
import { OverviewReadError } from './contracts';
import { getOverviewSnapshot } from './queries.server';
import type { OverviewResult } from './refresh-contract';

export async function refreshOverview(): Promise<OverviewResult> {
  let mayEdit: boolean | undefined;
  try {
    const { member } = await requireMember();
    mayEdit = mayMutateInventory(member);
    const snapshot = await getOverviewSnapshot('UTC');
    return { ok: true, snapshot, mayEdit };
  } catch (error) {
    if (isRedirectError(error)) {
      const destination = getURLFromRedirectError(error);
      const url = new URL(destination, 'https://inventory.invalid');
      const next = url.searchParams.get('next');
      const knownLogin =
        destination === '/login' ||
        (destination.startsWith('/login?next=') &&
          url.pathname === '/login' &&
          url.searchParams.size === 1 &&
          next !== null &&
          validReturnPath(next) === next);
      if (
        url.origin === 'https://inventory.invalid' &&
        !url.hash &&
        (destination === '/access-denied' || knownLogin)
      ) {
        return {
          ok: false,
          code: 'forbidden',
          clearSnapshot: true,
          mayEdit: false,
        };
      }
    }
    unstable_rethrow(error);
    if (error instanceof OverviewReadError)
      return {
        ok: false,
        code: error.code,
        clearSnapshot: error.clearSnapshot,
        mayEdit: error.clearSnapshot ? false : mayEdit,
      };
    return { ok: false, code: 'unexpected', clearSnapshot: false, mayEdit };
  }
}

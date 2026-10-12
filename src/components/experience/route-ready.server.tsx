import 'server-only';
import { requireMember } from '@/lib/auth/session.server';
import { routeKey, type RouteQuery } from './route-key';

/** Auth is request-cached; primary page data has already resolved before JSX. */
export async function routeReadyProps(
  pathname: string,
  searchParams?: Promise<RouteQuery>,
) {
  const [{ member }, query] = await Promise.all([
    requireMember(),
    searchParams,
  ]);
  return {
    actorId: member.user_id,
    routeKey: routeKey(pathname, query ?? {}),
    contentIdentity: pathname,
  };
}

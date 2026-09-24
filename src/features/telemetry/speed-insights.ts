const measuredRoutes = new Set([
  '/dashboard',
  '/inventory',
  '/locations',
  '/room',
  '/labels',
]);

type VitalEvent = { type: 'vital'; url: string; route?: string };

const sensitiveAuthParameters = new Set([
  'auth',
  'authorization',
  'code',
  'error',
  'error_description',
  'jwt',
  'nonce',
  'oauth_code',
  'otp',
  'password',
  'pkce',
  'session',
  'state',
  'ticket',
]);

function hasAuthParameters(url: URL) {
  const fragment = url.hash.slice(1);
  const fragmentQuery = fragment.includes('?')
    ? fragment.slice(fragment.indexOf('?') + 1)
    : fragment;
  for (const parameters of [
    url.searchParams,
    new URLSearchParams(fragmentQuery),
  ]) {
    for (const name of parameters.keys()) {
      const normalized = name.toLowerCase().replace(/[.-]/g, '_');
      if (
        sensitiveAuthParameters.has(normalized) ||
        /token|secret|password|credential|assertion|verifier|challenge/.test(
          normalized,
        )
      )
        return true;
    }
  }
  return false;
}

export function beforeSendPrivateVitals<T extends VitalEvent>(
  event: T,
): T | null {
  // The Vercel intake script uses the returned URL, but retains its original
  // route. Both the original route and URL must be safe before rewriting.
  if (
    event.type !== 'vital' ||
    !event.route ||
    !measuredRoutes.has(event.route)
  )
    return null;
  try {
    const current = new URL(window.location.href);
    const url = new URL(event.url, current.origin);
    if (
      !measuredRoutes.has(current.pathname) ||
      hasAuthParameters(current) ||
      url.origin !== current.origin ||
      !measuredRoutes.has(url.pathname) ||
      event.route !== url.pathname ||
      hasAuthParameters(url)
    )
      return null;
    return { ...event, url: url.origin + url.pathname, route: url.pathname };
  } catch {
    return null;
  }
}

export function speedInsightsEnabled(env: {
  VERCEL_ENV?: string;
  SPEED_INSIGHTS_ENABLED?: string;
}) {
  return (
    (env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'production') &&
    env.SPEED_INSIGHTS_ENABLED === 'true'
  );
}

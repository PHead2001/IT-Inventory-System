import 'server-only';

/** A privacy read must never consume a refresh token or mutate provider state. */
export function createPrivacyReadFetch(
  backend: string,
  outbound: typeof fetch,
) {
  const origin = new URL(backend).origin;
  let blocked = false;
  return {
    blocked: () => blocked,
    fetch: (async (input, init?: RequestInit) => {
      let allowed = false;
      try {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request?.url ?? String(input));
        const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
        allowed =
          method === 'GET' &&
          url.origin === origin &&
          !url.username &&
          !url.password &&
          (url.pathname === '/auth/v1/user' ||
            url.pathname === '/rest/v1/app_members');
      } catch {
        /* Invalid request targets fail closed. */
      }
      if (!allowed) {
        blocked = true;
        // AuthApiError (not a retryable fetch/server error), including when the
        // SDK preserves a still-valid JWT after a proactive refresh failure.
        return Response.json(
          {
            code: 'privacy_read_only',
            message: 'Privacy verification requires a current session.',
          },
          { status: 400 },
        );
      }
      return outbound(input, { ...init, redirect: 'error' });
    }) satisfies typeof fetch,
  };
}

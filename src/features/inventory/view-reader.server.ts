import 'server-only';
import type { requireMember } from '@/lib/auth/session.server';
import { supabaseConfig } from '@/lib/supabase/config';
import { readBoundedJson, SnapshotTooLargeError } from './export-reader.server';

const limits = {
  inventory_grouped_page: 2097152,
  inventory_search_v3: 2097152,
  metadata_inventory_columns: 524288,
  metadata_selected_preview: 131072,
} as const;
export type ViewReadClient = {
  rpc(
    name: keyof typeof limits,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; status?: number } | null;
  }>;
};
export class ViewReadDeadlineError extends Error {
  constructor() {
    super('Inventory took too long to load. Narrow the filters and try again.');
  }
}
type Context = Awaited<ReturnType<typeof requireMember>>;
/** One read scope; the very same bearer is verified before any inventory request.
 * Session user metadata is never an authority. Credentials stay local to this
 * read scope; they are never persisted, cached or logged. */
export async function withInventoryViewReader<T>(
  context: Context,
  read: (client: ViewReadClient) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const check = () => {
    if (controller.signal.aborted) throw new ViewReadDeadlineError();
  };
  const bounded = <V>(work: PromiseLike<V>) =>
    new Promise<V>((resolve, reject) => {
      check();
      const abort = () => reject(new ViewReadDeadlineError());
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(work).then(
        (value) => {
          controller.signal.removeEventListener('abort', abort);
          if (controller.signal.aborted) reject(new ViewReadDeadlineError());
          else resolve(value);
        },
        (error) => {
          controller.signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  try {
    const session = await bounded(context.supabase.auth.getSession());
    const token = session.data.session?.access_token;
    if (session.error || !token)
      throw new Error('Inventory authentication could not be verified.');
    const verified = await bounded(context.supabase.auth.getUser(token));
    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== context.member.user_id
    )
      throw new Error('Inventory authentication could not be verified.');
    const config = supabaseConfig(),
      origin = new URL(config.url);
    if (
      !['https:', 'http:'].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      throw new Error('Inventory service configuration is unavailable.');
    return await bounded(
      read({
        rpc: async (name, args) => {
          check();
          if (!Object.hasOwn(limits, name))
            throw new Error('Unsupported inventory read.');
          const response = await fetch(
            new URL('/rest/v1/rpc/' + name, origin),
            {
              method: 'POST',
              headers: {
                apikey: config.key,
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify(args),
              signal: controller.signal,
              cache: 'no-store',
              redirect: 'error',
            },
          );
          if (controller.signal.aborted) {
            // Fetch may deliver headers after retirement, before an abortable
            // pipe owns its body. Retire that late body as well.
            void response.body?.cancel().catch(() => {});
            check();
          }
          check();
          if (response.status === 401 || response.status === 403) {
            // Denial is already known. Retire its body without allowing malformed,
            // oversized or delayed error prose to turn denial into an empty view.
            void response.body?.cancel().catch(() => {});
            return {
              data: null,
              error: { code: 'access_denied', status: response.status },
            };
          }
          try {
            const body =
              response.body?.pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>(),
                { signal: controller.signal },
              ) ?? null;
            const data = await readBoundedJson(
              new Response(body, {
                status: response.status,
                headers: response.headers,
              }),
              response.ok ? limits[name] : 65536,
              check,
            );
            if (!response.ok) {
              const code =
                response.status === 401 || response.status === 403
                  ? 'access_denied'
                  : data &&
                      typeof data === 'object' &&
                      'code' in data &&
                      typeof data.code === 'string'
                    ? data.code
                    : 'read_failed';
              return { data: null, error: { code, status: response.status } };
            }
            return { data, error: null };
          } catch (error) {
            check();
            if (error instanceof SnapshotTooLargeError)
              return {
                data: null,
                error: {
                  code:
                    response.status === 401 || response.status === 403
                      ? 'access_denied'
                      : response.ok
                        ? 'P1025'
                        : 'read_failed',
                  status: response.status,
                },
              };
            throw error;
          }
        },
      }),
    );
  } catch (error) {
    check();
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

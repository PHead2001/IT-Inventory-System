import 'server-only';
import type { requireMember } from '@/lib/auth/session.server';
import { supabaseConfig } from '@/lib/supabase/config';
import { readBoundedJson, SnapshotTooLargeError } from './export-reader.server';

const limits = {
  inventory_history_v2: 2097152,
  inventory_history_actors: 131072,
  inventory_history_export_snapshot: 2097152,
} as const;
export type HistoryReadClient = {
  rpc(
    name: keyof typeof limits,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; status?: number } | null;
  }>;
};
export class HistoryReadActorChangedError extends Error {
  constructor() {
    super('History authentication could not be verified.');
  }
}
export class HistoryReadDeadlineError extends Error {
  constructor() {
    super('History took too long to load. Narrow the filters and try again.');
  }
}
type MemberContext = Awaited<ReturnType<typeof requireMember>>;
type Context = {
  supabase: MemberContext['supabase'];
  member: Pick<MemberContext['member'], 'user_id'>;
};
/** One read scope; the very same bearer is verified before any inventory request.
 * Session user metadata is never an authority. Credentials stay local to this
 * read scope; they are never persisted, cached or logged. */
export async function withHistoryReader<T>(
  context: Context,
  read: (client: HistoryReadClient) => Promise<T>,
  parentSignal?: AbortSignal,
  onStage?: Parameters<typeof readBoundedJson>[3],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const check = () => {
    if (controller.signal.aborted) throw new HistoryReadDeadlineError();
  };
  const bounded = <V>(work: PromiseLike<V>) =>
    new Promise<V>((resolve, reject) => {
      check();
      const abort = () => reject(new HistoryReadDeadlineError());
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(work).then(
        (value) => {
          controller.signal.removeEventListener('abort', abort);
          if (controller.signal.aborted) reject(new HistoryReadDeadlineError());
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
      throw new Error('History authentication could not be verified.');
    const verified = await bounded(context.supabase.auth.getUser(token));
    if (verified.error || !verified.data.user)
      throw new Error('History authentication could not be verified.');
    if (verified.data.user.id !== context.member.user_id)
      throw new HistoryReadActorChangedError();
    const config = supabaseConfig(),
      origin = new URL(config.url);
    if (
      !['https:', 'http:'].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      throw new Error('History service configuration is unavailable.');
    return await bounded(
      read({
        rpc: async (name, args) => {
          check();
          if (!Object.hasOwn(limits, name))
            throw new Error('Unsupported history read.');
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
            // Fetch can settle in the same turn as retirement, before the stream
            // acquires its abortable pipe. Do not leave that body alive.
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
              onStage,
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
    parentSignal?.removeEventListener('abort', abort);
  }
}

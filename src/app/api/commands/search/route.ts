import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import { commandQuery, commandResults } from '@/features/commands/contracts';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function denialStatus(error: unknown, status?: number): 401 | 403 | null {
  const details = error && typeof error === 'object' ? error : {};
  const code = 'code' in details ? details.code : undefined;
  const httpStatus =
    ('status' in details ? details.status : undefined) ?? status;
  if (
    httpStatus === 401 ||
    ['PGRST301', 'PGRST302', 'PGRST303'].includes(String(code))
  )
    return 401;
  if (httpStatus === 403 || code === '42501' || code === 'P1001') return 403;
  if ('name' in details && details.name === 'AuthSessionMissingError')
    return 401;
  return null;
}
/** Bounds SDK adapters as well as fetch; late results never advance the route. */
function withinLifetime<T>(signal: AbortSignal, run: () => PromiseLike<T>) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return run();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function POST(request: NextRequest) {
  const reply = (error: string, status: number) =>
    NextResponse.json({ error }, { status, headers });
  if (request.headers.get('origin') !== request.nextUrl.origin)
    return reply('Request unavailable.', 403);
  if (Number(request.headers.get('content-length') ?? 0) > 4096)
    return reply('Search is too long.', 400);
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let timedOut = false;
  const cancel = () => lifetime.abort(request.signal.reason);
  if (request.signal.aborted) cancel();
  else request.signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    lifetime.abort(
      new DOMException('Search deadline elapsed.', 'TimeoutError'),
    );
  }, 8000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyFinished = false;
  try {
    let raw: unknown;
    try {
      reader = request.body?.getReader();
      if (!reader) return reply('Enter a search.', 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await withinLifetime(signal, () => reader!.read());
        if (chunk.done) {
          bodyFinished = true;
          break;
        }
        length += chunk.value.byteLength;
        if (length > 4096) {
          return reply('Search is too long.', 400);
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
      if (signal.aborted) throw error;
      return reply('Check your search and try again.', 400);
    }
    const parsed = commandQuery.safeParse(raw);
    if (!parsed.success)
      return reply('Use up to 200 characters without control characters.', 400);
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (!['http:', 'https:'].includes(backend.protocol))
      return reply('Search could not be loaded. Try again.', 503);
    const supabase = await withinLifetime(signal, () =>
      createSupabaseServerClient(true, null, signal),
    );
    const {
      data: { user },
      error: authError,
    } = await withinLifetime(signal, () => supabase.auth.getUser());
    if (authError) {
      const status = denialStatus(authError);
      return status
        ? reply('Your session cannot access inventory. Sign in again.', status)
        : reply('Your session could not be checked. Try again.', 503);
    }
    if (!user) return reply('Your session ended. Sign in again.', 401);
    const {
      data: member,
      error: memberError,
      status: memberStatus,
    } = await withinLifetime(signal, () =>
      supabase
        .from('app_members')
        .select('user_id, display_name, role, active')
        .eq('user_id', user.id)
        .abortSignal(signal)
        .maybeSingle(),
    );
    if (memberError) {
      const status = denialStatus(memberError, memberStatus);
      if (status) return reply('Your account cannot access inventory.', status);
      return reply('Access could not be checked. Try again.', 503);
    }
    if (!isActiveMember(member))
      return reply('Your account cannot access inventory.', 403);
    const {
      data,
      error,
      status: rpcStatus,
    } = await withinLifetime(signal, () =>
      supabase
        .rpc('command_palette_search_v1', {
          p_query: parsed.data.query,
          p_scope: parsed.data.scope,
          p_purpose: parsed.data.purpose,
        })
        .abortSignal(signal),
    );
    if (error) {
      if (timedOut)
        return reply(
          'Search took too long. Try a more specific name or code.',
          504,
        );
      const status = denialStatus(error, rpcStatus);
      if (status) return reply('Your account cannot access inventory.', status);
      if (error.code === 'P1012')
        return reply('Check your search and try again.', 400);
      if (error.code === '57014')
        return reply(
          'Search took too long. Try a more specific name or code.',
          504,
        );
      return reply('Inventory search could not be loaded. Try again.', 503);
    }
    signal.throwIfAborted();
    const result = commandResults.safeParse(data);
    if (!result.success)
      return reply('Inventory search could not be loaded. Try again.', 503);
    return NextResponse.json(
      {
        identity: {
          actorId: user.id,
          backend: backend.origin,
        },
        result: result.data,
      },
      { headers },
    );
  } catch (error) {
    if (timedOut)
      return reply(
        'Search took too long. Try a more specific name or code.',
        504,
      );
    if (request.signal.aborted) return reply('Search cancelled.', 499);
    const status = denialStatus(error);
    if (status) return reply('Your account cannot access inventory.', status);
    return reply('Search could not be loaded. Try again.', 503);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    if (reader) {
      // Cancellation may never settle for an adversarial stream. Do not await it.
      try {
        if (!bodyFinished) void reader.cancel().catch(() => {});
        reader.releaseLock();
      } catch {
        /* Cleanup cannot replace the request's terminal result. */
      }
    }
  }
}

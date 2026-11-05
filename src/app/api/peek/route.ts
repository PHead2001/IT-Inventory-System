import { unstable_rethrow } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { supabaseConfig } from '@/lib/supabase/config';
import {
  peekTargetSchema,
  peekEnvelopeSchema,
} from '@/features/peek/contracts';
import { readPeek } from '@/features/peek/read.server';

export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
export async function GET(request: Request) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      // Authentication and membership run once, before any target-specific read.
      const context = await requireMember();
      if (controller.signal.aborted) throw new Error('Deadline');
      const url = new URL(request.url);
      const entries = [...url.searchParams.entries()];
      if (new Set(entries.map(([key]) => key)).size !== entries.length)
        return reply({ error: 'invalid_target' }, 400);
      const target = peekTargetSchema.safeParse(Object.fromEntries(entries));
      if (!target.success) return reply({ error: 'invalid_target' }, 400);
      const payload = await readPeek(context, target.data, controller.signal);
      if (controller.signal.aborted) throw new Error('Deadline');
      if (!payload) return reply({ error: 'not_found' }, 404);
      return reply(
        peekEnvelopeSchema.parse({
          actor: context.member.user_id,
          backend: new URL(supabaseConfig().url).origin,
          payload,
        }),
      );
    };
    return await Promise.race([
      work(),
      new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(reply({ error: 'unavailable' }, 503));
        }, 5000);
      }),
    ]);
  } catch (error) {
    unstable_rethrow(error);
    const code =
      typeof error === 'object' && error && 'code' in error ? error.code : null;
    // JWT failures are access loss, matching Overview; they must not preserve a
    // previously fresh private preview as though this were a transient outage.
    const forbidden =
      typeof code === 'string' &&
      ['42501', 'P1001', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code);
    return reply(
      { error: forbidden ? 'forbidden' : 'unavailable' },
      forbidden ? 403 : 503,
    );
  } finally {
    // Retire all parallel reads on success, early failure and framework exits.
    // Aborting here must never replace the original result or thrown redirect.
    controller.abort();
    if (timer) clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

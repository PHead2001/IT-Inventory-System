import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import { commandQuery, commandResults } from '@/features/commands/contracts';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: NextRequest) {
  const reply = (error: string, status: number) =>
    NextResponse.json({ error }, { status, headers });
  if (request.headers.get('origin') !== request.nextUrl.origin)
    return reply('Request unavailable.', 403);
  if (Number(request.headers.get('content-length') ?? 0) > 4096)
    return reply('Search is too long.', 400);
  let raw: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply('Enter a search.', 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096) {
        await reader.cancel();
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
  } catch {
    return reply('Check your search and try again.', 400);
  }
  const deadline = AbortSignal.timeout(8000);
  try {
    const parsed = commandQuery.safeParse(raw);
    if (!parsed.success)
      return reply('Use up to 200 characters without control characters.', 400);
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (!['http:', 'https:'].includes(backend.protocol))
      return reply('Search could not be loaded. Try again.', 503);
    const supabase = await createSupabaseServerClient(true);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return reply('Your session ended. Sign in again.', 401);
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id, display_name, role, active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberError)
      return reply('Access could not be checked. Try again.', 503);
    if (!isActiveMember(member))
      return reply('Your account cannot access inventory.', 403);
    const { data, error } = await supabase
      .rpc('command_palette_search_v1', {
        p_query: parsed.data.query,
        p_scope: parsed.data.scope,
        p_purpose: parsed.data.purpose,
      })
      .abortSignal(AbortSignal.any([request.signal, deadline]));
    if (error) {
      if (deadline.aborted)
        return reply(
          'Search took too long. Try a more specific name or code.',
          504,
        );
      if (error.code === 'P1001' || error.code === '42501')
        return reply('Your account cannot access inventory.', 403);
      if (error.code === 'P1012')
        return reply('Check your search and try again.', 400);
      if (error.code === '57014')
        return reply(
          'Search took too long. Try a more specific name or code.',
          504,
        );
      return reply('Inventory search could not be loaded. Try again.', 503);
    }
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
  } catch {
    if (deadline.aborted)
      return reply(
        'Search took too long. Try a more specific name or code.',
        504,
      );
    return reply('Search could not be loaded. Try again.', 503);
  }
}

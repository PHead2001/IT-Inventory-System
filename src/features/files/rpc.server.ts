import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { InvalidFileContentError } from './inspection-error';

type RpcResult = { data: unknown; error: { code?: string } | null };
export type FileClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function staffClient(): Promise<{
  client: FileClient;
  userId: string;
} | null> {
  const client = await createSupabaseServerClient(true);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: member } = await client
    .from('app_members')
    .select('role,active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member?.active || member.role !== 'staff') return null;
  return { client, userId: user.id };
}

export async function fileRpc(
  client: FileClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const rpc = client.rpc.bind(client) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<RpcResult>;
  const { data, error } = await rpc(name, args);
  if (error) {
    const e = new Error('File operation failed.');
    (e as Error & { code?: string }).code = error.code;
    throw e;
  }
  return data;
}

export function fileError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'P1001') return 'Only active staff can manage files.';
  if (code === 'P1002')
    return 'Files changed. Review the current collection and replacement file versions, then submit a new request.';
  if (code === 'P1009') return 'This request ID was used for another change.';
  if (code === 'P1012') return 'The file or request could not be validated.';
  if (error instanceof InvalidFileContentError)
    return 'The uploaded content is invalid or exceeds supported limits. Choose another file or cancel this upload.';
  return 'The file operation could not be confirmed. Refresh the record before retrying.';
}

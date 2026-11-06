import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import { getHistoryRecord } from '@/features/inventory/queries.server';
import {
  parseHistoryFilters,
  historyRpcFilters,
} from '@/features/inventory/history-filters';
import { historyExportCsv } from '@/features/inventory/history-export';
import { SnapshotTooLargeError } from '@/features/inventory/export-reader.server';
import {
  withHistoryReader,
  HistoryReadDeadlineError,
  HistoryReadActorChangedError,
} from '@/features/inventory/history-reader.server';
import { ExportTooLargeError } from '@/features/inventory/export';
import { createExportDiagnostics } from '@/features/inventory/export-diagnostics.server';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const failure = (message: string, status: number, code: string) =>
  new Response(message, {
    status,
    headers: {
      ...privateHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Inventory-Export-Error': code,
    },
  });
const timeoutResponse = () =>
  failure(
    'Export timed out. Retry with narrower filters.',
    503,
    'export_timeout',
  );
class DeadlineError extends Error {}
async function build(
  request: Request,
  signal: AbortSignal,
  check: () => void,
  diagnostics: ReturnType<typeof createExportDiagnostics>,
) {
  try {
    check();
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    check();
    diagnostics?.sample('authenticated');
    if (authError || !user)
      return failure(
        'Sign in to export history.',
        401,
        'authentication_required',
      );
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active')
      .eq('user_id', user.id)
      .maybeSingle();
    check();
    diagnostics?.sample('member_checked');
    if (memberError || !isActiveMember(member))
      return failure('Inventory access denied.', 403, 'access_denied');
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const filter = parseHistoryFilters(params);
    if (filter.errors.entityId)
      return failure(
        'Check the history filters before exporting.',
        400,
        'invalid_history_filters',
      );
    // The same caller-scoped resolver as the page; unavailable record never means all.
    if (filter.entityId) {
      const record = await getHistoryRecord(filter.entityId);
      check();
      if (!record)
        return failure(
          'Record history is unavailable.',
          404,
          'record_unavailable',
        );
      params.type = record.kind;
    }
    // Record resolution can change event compatibility. Validate the same final
    // scope as the page, retaining every invalid value rather than broadening.
    if (!parseHistoryFilters(params).valid)
      return failure(
        'Check the history filters before exporting.',
        400,
        'invalid_history_filters',
      );
    diagnostics?.sample('snapshot_requested');
    const { data, error } = await withHistoryReader(
      { supabase, member },
      async (client) =>
        client.rpc(
          'inventory_history_export_snapshot',
          historyRpcFilters(params),
        ),
      signal,
      diagnostics?.readerStage,
    );
    const code = error?.code;
    if (error?.status === 401 || error?.status === 403 || code === '42501')
      return failure('Inventory access denied.', 403, 'access_denied');
    check();
    diagnostics?.sample('snapshot_finished');
    if (code === 'P1013')
      return failure(
        'Export exceeds 10,000 data rows. Narrow the filters and retry.',
        413,
        'export_row_limit',
      );
    if (code === 'P1025')
      return failure(
        'Export is too large. Narrow the filters and retry.',
        413,
        'export_too_large',
      );
    if (code === '57014' || code === '55P03') return timeoutResponse();
    if (code === 'P1001')
      return failure(
        'Check the history filters before exporting.',
        400,
        'invalid_history_filters',
      );
    if (code || data === null)
      return failure(
        'History export could not be created.',
        500,
        'export_failed',
      );
    const preview =
      process.env.VERCEL_ENV !== 'production' &&
      process.env.APP_ENV !== 'production';
    const result = historyExportCsv(
      data,
      preview ? 'Preview' : 'Production',
      url.searchParams.get('displayTimeZone') ?? params.zone ?? 'UTC',
      check,
      diagnostics?.csvRow,
    );
    check();
    diagnostics?.csvEncoded(Buffer.byteLength(result.csv, 'utf8'));
    const stamp = new Date(result.exportedAt)
      .toISOString()
      .replaceAll(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const response = new Response(result.csv, {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${preview ? 'preview-' : ''}history-${stamp}.csv"`,
        'X-Content-Type-Options': 'nosniff',
        'X-History-Event-Count': String(result.eventCount),
        'X-History-Data-Row-Count': String(result.rowCount),
        'X-History-Snapshot-At': result.exportedAt,
      },
    });
    check();
    diagnostics?.sample('response_ready');
    return response;
  } catch (error) {
    if (error instanceof HistoryReadActorChangedError)
      return failure('Inventory access denied.', 403, 'access_denied');
    if (
      error instanceof DeadlineError ||
      error instanceof HistoryReadDeadlineError ||
      signal.aborted
    )
      return timeoutResponse();
    if (
      error instanceof SnapshotTooLargeError ||
      error instanceof ExportTooLargeError
    )
      return failure(
        'Export is too large. Narrow the filters and retry.',
        413,
        'export_too_large',
      );
    return failure(
      'History export could not be created.',
      500,
      'export_failed',
    );
  }
}
export async function GET(request: Request) {
  const deadlineAt = performance.now() + 10000;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  const check = () => {
    if (signal.aborted || performance.now() >= deadlineAt)
      throw new DeadlineError();
  };
  const diagnostics = createExportDiagnostics();
  let aborted: (() => void) | undefined;
  const timedOut = new Promise<Response>((resolve) => {
    aborted = () => resolve(timeoutResponse());
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    const response = await Promise.race([
      build(request, signal, check, diagnostics),
      timedOut,
    ]);
    diagnostics?.emit();
    return signal.aborted || performance.now() >= deadlineAt
      ? timeoutResponse()
      : response;
  } finally {
    if (aborted) signal.removeEventListener('abort', aborted);
  }
}

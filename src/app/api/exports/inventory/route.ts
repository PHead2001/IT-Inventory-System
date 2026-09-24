import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseConfig } from '@/lib/supabase/config';
import { isActiveMember } from '@/lib/auth/membership';
import {
  exportCsv,
  ExportTooLargeError,
  type ExportType,
} from '@/features/inventory/export';
import {
  requestExportSnapshot,
  SnapshotTooLargeError,
} from '@/features/inventory/export-reader.server';
import { readFilters } from '@/features/inventory/read-model';
import { createExportDiagnostics } from '@/features/inventory/export-diagnostics.server';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const errorResponse = (message: string, status: number, code: string) =>
  new Response(message, {
    status,
    headers: {
      ...privateHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Inventory-Export-Error': code,
    },
  });

class ExportDeadlineError extends Error {}

async function buildExport(
  request: Request,
  signal: AbortSignal,
  checkDeadline: () => void,
  diagnostics: ReturnType<typeof createExportDiagnostics>,
) {
  try {
    checkDeadline();
    const supabase = await createSupabaseServerClient();
    checkDeadline();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    checkDeadline();
    diagnostics?.sample('authenticated');
    if (authError || !user)
      return errorResponse(
        'Sign in to export inventory.',
        401,
        'authentication_required',
      );
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active')
      .eq('user_id', user.id)
      .maybeSingle();
    checkDeadline();
    diagnostics?.sample('member_checked');
    if (memberError || !isActiveMember(member))
      return errorResponse('Inventory access denied.', 403, 'access_denied');
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    checkDeadline();
    diagnostics?.sample('session_checked');
    if (sessionError || !session?.access_token)
      return errorResponse(
        'Sign in to export inventory.',
        401,
        'authentication_required',
      );
    const url = new URL(request.url);
    const requestedType = url.searchParams.get('export');
    if (
      requestedType &&
      requestedType !== 'inventory' &&
      requestedType !== 'low_stock'
    )
      return errorResponse(
        'Unsupported export type.',
        400,
        'invalid_export_type',
      );
    const exportType: ExportType =
      requestedType === 'low_stock' ? 'low_stock' : 'inventory';
    const params = Object.fromEntries(url.searchParams.entries());
    const filter = readFilters(params);
    const includeCustom = url.searchParams.get('customFields') === 'true';
    const { url: backendUrl, key } = supabaseConfig();
    diagnostics?.sample('snapshot_requested');
    const { data, code } = await requestExportSnapshot({
      url: backendUrl,
      key,
      accessToken: session.access_token,
      signal,
      checkDeadline,
      onStage: diagnostics?.readerStage,
      payload: {
        p_query: filter.query,
        p_type: filter.type,
        p_status: filter.status,
        p_category_id: filter.category ?? null,
        p_location_code: filter.location ?? null,
        p_low_stock: filter.lowStock,
        p_export_type: exportType,
        p_include_custom: includeCustom,
      },
    });
    checkDeadline();
    diagnostics?.sample('snapshot_finished');
    if (code === 'P1013')
      return errorResponse(
        'Export exceeds 10,000 rows. Narrow the filters and retry.',
        413,
        'export_row_limit',
      );
    if (code === 'P1025')
      return errorResponse(
        'Export is too large. Narrow filters, disable custom fields, or select fewer records. For one oversized record, retry without custom fields.',
        413,
        'export_too_large',
      );
    if (code === '57014' || code === '55P03')
      return errorResponse(
        'Export timed out. Retry with narrower filters.',
        503,
        'export_timeout',
      );
    if (code || data === null)
      return errorResponse(
        'Inventory export could not be created.',
        500,
        'export_failed',
      );
    const preview =
      process.env.VERCEL_ENV !== 'production' &&
      process.env.APP_ENV !== 'production';
    const { csv, exportedAt } = exportCsv(
      exportType,
      data,
      preview ? 'Preview' : 'Production',
      includeCustom,
      checkDeadline,
      diagnostics?.csvRow,
    );
    checkDeadline();
    if (diagnostics) {
      try {
        diagnostics.csvEncoded(Buffer.byteLength(csv, 'utf8'));
      } catch {
        // Preview measurements cannot change a completed export.
      }
    }
    checkDeadline();
    const timestamp = new Date(exportedAt)
      .toISOString()
      .replaceAll(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const fileName =
      (preview ? 'preview-' : '') +
      (exportType === 'low_stock' ? 'low-stock' : 'inventory') +
      '-' +
      timestamp +
      '.csv';
    const response = new Response(csv, {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
    checkDeadline();
    diagnostics?.sample('response_ready');
    checkDeadline();
    return response;
  } catch (error) {
    if (
      error instanceof SnapshotTooLargeError ||
      error instanceof ExportTooLargeError
    )
      return errorResponse(
        'Export is too large. Narrow filters, disable custom fields, or select fewer records. For one oversized record, retry without custom fields.',
        413,
        'export_too_large',
      );
    if (error instanceof ExportDeadlineError || signal.aborted)
      return errorResponse(
        'Export timed out. Retry with narrower filters.',
        503,
        'export_timeout',
      );
    return errorResponse(
      'Inventory export could not be created.',
      500,
      'export_failed',
    );
  }
}

export async function GET(request: Request) {
  const deadlineAt = performance.now() + 10000;
  const deadline = AbortSignal.timeout(10000);
  const signal = AbortSignal.any([request.signal, deadline]);
  let diagnostics: ReturnType<typeof createExportDiagnostics> = null;
  try {
    diagnostics = createExportDiagnostics();
  } catch {
    // Preview diagnostics cannot prevent an export from starting.
  }
  const checkDeadline = () => {
    if (signal.aborted || performance.now() >= deadlineAt)
      throw new ExportDeadlineError('export_timeout');
  };
  const response = await Promise.race([
    buildExport(request, signal, checkDeadline, diagnostics),
    new Promise<Response>((resolve) =>
      signal.addEventListener(
        'abort',
        () =>
          resolve(
            errorResponse(
              'Export timed out. Retry with narrower filters.',
              503,
              'export_timeout',
            ),
          ),
        { once: true },
      ),
    ),
  ]);
  diagnostics?.emit();
  const terminal =
    signal.aborted || performance.now() >= deadlineAt
      ? errorResponse(
          'Export timed out. Retry with narrower filters.',
          503,
          'export_timeout',
        )
      : response;
  if (diagnostics) {
    try {
      terminal.headers.set('X-Inventory-Export-Diagnostic-Id', diagnostics.id);
    } catch {
      // The diagnostic header is optional; preserve the export response.
    }
  }
  return terminal;
}

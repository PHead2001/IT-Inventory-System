import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseConfig } from '@/lib/supabase/config';
import { isActiveMember } from '@/lib/auth/membership';
import { exportCsv, ExportTooLargeError, type ExportType } from '@/features/inventory/export';
import { requestExportSnapshot, SnapshotTooLargeError } from '@/features/inventory/export-reader.server';
import { readFilters } from '@/features/inventory/read-model';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const errorResponse = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  });

async function buildExport(request: Request, signal: AbortSignal) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return errorResponse('Sign in to export inventory.', 401);
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberError || !isActiveMember(member))
      return errorResponse('Inventory access denied.', 403);
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token)
      return errorResponse('Sign in to export inventory.', 401);
    const url = new URL(request.url);
    const requestedType = url.searchParams.get('export');
    if (
      requestedType &&
      requestedType !== 'inventory' &&
      requestedType !== 'low_stock'
    )
      return errorResponse('Unsupported export type.', 400);
    const exportType: ExportType =
      requestedType === 'low_stock' ? 'low_stock' : 'inventory';
    const params = Object.fromEntries(url.searchParams.entries());
    const filter = readFilters(params);
    const includeCustom = url.searchParams.get('customFields') === 'true';
    const { url: backendUrl, key } = supabaseConfig();
    const { data, code } = await requestExportSnapshot({
      url: backendUrl,
      key,
      accessToken: session.access_token,
      signal,
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
    if (code === 'P1013')
      return errorResponse(
        'Export exceeds 10,000 rows. Narrow the filters and retry.',
        413,
      );
    if (code === 'P1025')
      return errorResponse('Export is too large. Narrow filters, disable custom fields, or select fewer records. For one oversized record, retry without custom fields.', 413);
    if (code || data === null)
      return errorResponse('Inventory export could not be created.', 500);
    const preview =
      process.env.VERCEL_ENV !== 'production' &&
      process.env.APP_ENV !== 'production';
    const { csv, exportedAt } = exportCsv(
      exportType,
      data,
      preview ? 'Preview' : 'Production',
      includeCustom,
    );
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
    return new Response(csv, {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof SnapshotTooLargeError || error instanceof ExportTooLargeError)
      return errorResponse('Export is too large. Narrow filters, disable custom fields, or select fewer records. For one oversized record, retry without custom fields.', 413);
    if (signal.aborted)
      return errorResponse('Export timed out. Retry with narrower filters.', 503);
    return errorResponse('Inventory export could not be created.', 500);
  }
}

export async function GET(request: Request) {
  const deadline = AbortSignal.timeout(10000);
  const signal = AbortSignal.any([request.signal, deadline]);
  return Promise.race([
    buildExport(request, signal),
    new Promise<Response>((resolve) => signal.addEventListener('abort', () =>
      resolve(errorResponse('Export timed out. Retry with narrower filters.', 503)), { once: true })),
  ]);
}

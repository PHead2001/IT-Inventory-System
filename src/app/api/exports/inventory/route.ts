import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import { exportCsv, type ExportType } from '@/features/inventory/export';
import { readFilters } from '@/features/inventory/read-model';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const errorResponse = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  });

export async function GET(request: Request) {
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
    const { data, error } = await supabase.rpc('inventory_export_snapshot', {
      p_query: filter.query,
      p_type: filter.type,
      p_status: filter.status,
      p_category_id: filter.category,
      p_location_code: filter.location,
      p_low_stock: filter.lowStock,
      p_export_type: exportType,
    });
    if (error?.code === 'P1013')
      return errorResponse(
        'Export exceeds 10,000 rows. Narrow the filters and retry.',
        413,
      );
    if (error || data === null)
      return errorResponse('Inventory export could not be created.', 500);
    const preview =
      process.env.VERCEL_ENV !== 'production' &&
      process.env.APP_ENV !== 'production';
    const { csv, exportedAt } = exportCsv(
      exportType,
      data,
      preview ? 'Preview' : 'Production',
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
  } catch {
    return errorResponse('Inventory export could not be created.', 500);
  }
}

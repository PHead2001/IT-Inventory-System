'use server';

import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { assetRow, quantityRow } from '@/features/inventory/read-model';
import type { RecordMetadata } from './reconciliation';
import { describeValues, getPublishedForm } from './queries.server';
import type { MetadataForm } from './contracts';

export type RecordRefreshResult =
  | {
      ok: true;
      record: RecordMetadata;
      form: MetadataForm;
      draftForm: MetadataForm;
    }
  | { ok: false; message: string };
/** Caller credentials and fresh membership apply to every read, including post-save reads. */
export async function refreshMetadataRecord(
  kind: 'quantity' | 'asset',
  id: string,
  expectedActorId?: string,
  draftCategoryId?: string,
): Promise<RecordRefreshResult> {
  const { supabase, member } = await requireMember();
  if (expectedActorId && member.user_id !== expectedActorId)
    return {
      ok: false,
      message:
        'The signed-in staff member changed. Return to the original account to continue.',
    };
  if (
    !z.enum(['quantity', 'asset']).safeParse(kind).success ||
    !z.uuid().safeParse(id).success ||
    (draftCategoryId && !z.uuid().safeParse(draftCategoryId).success)
  )
    return { ok: false, message: 'Choose a valid inventory record.' };
  try {
    const { data, error } = await supabase
      .from(kind === 'quantity' ? 'quantity_items' : 'serialized_assets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data)
      return {
        ok: false,
        message: 'The current record could not be loaded. Retry.',
      };
    const row = (kind === 'quantity' ? quantityRow : assetRow).parse(data);
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('name')
      .eq('id', row.category_id)
      .maybeSingle();
    if (categoryError || !category) throw new Error('Category unavailable');
    const form = await getPublishedForm(row.category_id);
    const draftForm =
      draftCategoryId && draftCategoryId !== row.category_id
        ? await getPublishedForm(draftCategoryId)
        : form;
    if (!form || !draftForm) throw new Error('Form unavailable');
    const customDisplay = await describeValues(
      supabase,
      row.custom_values,
      row.category_id,
    );
    const metadata = {
      customDisplay,
      id: row.id,
      name: row.name,
      description: row.description,
      categoryId: row.category_id,
      categoryName: category.name,
      manufacturer: row.manufacturer,
      model: row.model,
      version: row.version,
      customValues: row.custom_values,
      validatedFormRevisionId: row.validated_form_revision_id,
      needsMetadata: row.needs_metadata,
    };
    const record: RecordMetadata =
      'archived' in row
        ? {
            ...metadata,
            archived: row.archived,
            itemCode: row.item_code,
            reorderThreshold: row.reorder_threshold,
          }
        : {
            ...metadata,
            status: row.status,
            assetTag: row.asset_tag,
            serialNumber: row.serial_number,
          };
    return { ok: true, record, form, draftForm };
  } catch {
    return {
      ok: false,
      message:
        'The current record and category form could not be loaded. Retry.',
    };
  }
}

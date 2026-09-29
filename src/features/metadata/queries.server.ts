import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import type { Json } from '@/lib/supabase/database.types';
import {
  formEnvelope,
  type MetadataForm,
  type StoredCustomValues,
} from './contracts';

export async function getPublishedForms(
  categoryIds: string[],
): Promise<Record<string, MetadataForm>> {
  const { supabase } = await requireMember();
  const pairs = await Promise.all(
    categoryIds.map(async (id) => {
      const { data, error } = await supabase.rpc('metadata_form_get_v2', {
        p_category_id: id,
      });
      if (error)
        throw new Error('Published inventory forms could not be loaded.');
      return [id, formEnvelope.parse(data)] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

/** Load only the form used by an inventory page's initial category. */
export async function getPublishedForm(
  categoryId: string,
): Promise<MetadataForm | null> {
  const forms = await getPublishedForms([categoryId]);
  return forms[categoryId] ?? null;
}

export type DescribedValue = {
  value: unknown;
  validated_revision_id: string;
  label: string;
  field_type: string;
  option_paths: string[][];
  legacy: boolean;
  category_id: string;
  current_published_revision_id: string;
};
type MemberClient = Awaited<ReturnType<typeof requireMember>>['supabase'];
export type BatchKey = { kind: 'quantity' | 'asset'; id: string };
const canonicalId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const eventCustomPageSchema = z.object({
  event_id: canonicalId,
  kind: z.enum(['quantity', 'asset']),
  side: z.enum(['before', 'after']),
  field_id: canonicalId.nullable(),
  next_field_id: canonicalId.nullable(),
  present: z.boolean(),
  value: z.unknown().nullable().optional(),
  validated_revision_id: canonicalId.nullable().optional(),
  label: z.string().optional(),
  field_type: z.string().optional(),
  owner_category_id: canonicalId.nullable().optional(),
  event_category_id: canonicalId.nullable().optional(),
  current_published_revision_id: canonicalId.nullable().optional(),
  legacy: z.boolean().optional(),
  option_paths: z.array(z.array(z.string())),
  option_offset: z.number().int().nonnegative().optional(),
  next_option_offset: z.number().int().nonnegative().nullable(),
});
export type EventCustomPage = z.infer<typeof eventCustomPageSchema>;
export async function getEventCustomPage(input: {
  kind: 'quantity' | 'asset';
  eventId: string;
  side: 'before' | 'after';
  fieldId?: string;
  optionOffset: number;
}): Promise<EventCustomPage> {
  canonicalId.parse(input.eventId);
  if (input.fieldId) canonicalId.parse(input.fieldId);
  if (
    !Number.isSafeInteger(input.optionOffset) ||
    input.optionOffset < 0 ||
    input.optionOffset > 1000
  )
    throw new Error('Invalid history page.');
  const { supabase } = await requireMember();
  const { data, error } = await supabase.rpc('metadata_event_custom_page', {
    p_kind: input.kind,
    p_event_id: input.eventId,
    p_side: input.side,
    ...(input.fieldId ? { p_field_id: input.fieldId } : {}),
    p_option_offset: input.optionOffset,
  });
  if (error?.code === 'P1025')
    throw new Error(
      'This custom history field exceeds the 2 MiB page limit. Try another field or contact an administrator.',
    );
  if (error || !data)
    throw new Error('Inventory custom history could not be loaded.');
  return eventCustomPageSchema.parse(data);
}
export async function describeValues(
  supabase: MemberClient,
  values: StoredCustomValues,
  categoryId: string,
): Promise<Record<string, DescribedValue>> {
  if (Object.keys(values).length === 0) return {};
  const { data, error } = await supabase.rpc('metadata_describe_values', {
    p_values: values as Json,
    p_current_category: categoryId,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Inventory metadata could not be loaded.');
  return data as Record<string, DescribedValue>;
}

export async function describeSearchBatch(
  supabase: MemberClient,
  keys: BatchKey[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  if (keys.length > 25) throw new Error('Inventory search page is too large.');
  const { data, error } = await supabase.rpc('metadata_describe_batch', {
    p_mode: 'search',
    p_keys: keys as Json,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Inventory metadata could not be loaded.');
  const result = data as Record<string, unknown>;
  if (Object.values(result).some((value) => typeof value !== 'string'))
    throw new Error('Inventory metadata could not be loaded.');
  return result as Record<string, string>;
}

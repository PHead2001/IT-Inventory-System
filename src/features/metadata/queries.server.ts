import 'server-only';
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
      const { data, error } = await supabase.rpc('metadata_form_get', {
        p_category_id: id,
      });
      if (error)
        throw new Error('Published inventory forms could not be loaded.');
      return [id, formEnvelope.parse(data)] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

export type DescribedValue = {
  value: unknown;
  validated_revision_id: string;
  label: string;
  field_type: string;
  option_paths: string[][];
  legacy: boolean;
};
export async function describeValues(
  values: StoredCustomValues,
  categoryId: string,
): Promise<Record<string, DescribedValue>> {
  if (Object.keys(values).length === 0) return {};
  const { supabase } = await requireMember();
  const { data, error } = await supabase.rpc('metadata_describe_values', {
    p_values: values as Json,
    p_current_category: categoryId,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Inventory metadata could not be loaded.');
  return data as Record<string, DescribedValue>;
}

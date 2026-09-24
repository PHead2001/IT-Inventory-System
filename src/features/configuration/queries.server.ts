import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';

const category = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  sort_order: z.number().int(),
  version: z.string().regex(/^[1-9]\d*$/),
  removed_at: z.string().nullable(),
});
const labelDefaults = z.object({
  size: z.enum(['90x50', '70x35']),
  page: z.enum(['letter', 'A4']),
  format: z.enum(['qr', 'code128']),
  version: z.string().regex(/^[1-9]\d*$/),
});
export type ConfigurationCategory = z.infer<typeof category>;
export type LabelDefaults = z.infer<typeof labelDefaults>;

export async function getLabelDefaults(): Promise<LabelDefaults> {
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('configuration_label_defaults')
    .select('size,page,format,version')
    .single();
  if (error) throw new Error('Shared label defaults could not be loaded.');
  return labelDefaults.parse(data);
}

export async function getConfiguration() {
  const { supabase, member } = await requireMember();
  const [categories, defaults] = await Promise.all([
    supabase
      .from('configuration_categories')
      .select('id,code,name,active,sort_order,version,removed_at')
      .order('sort_order')
      .order('code'),
    supabase
      .from('configuration_label_defaults')
      .select('size,page,format,version')
      .single(),
  ]);
  if (categories.error || defaults.error)
    throw new Error('Settings could not be loaded.');
  return {
    categories: z.array(category).parse(categories.data),
    labelDefaults: labelDefaults.parse(defaults.data),
    canManage: member.role === 'staff' && member.can_manage_configuration,
  };
}

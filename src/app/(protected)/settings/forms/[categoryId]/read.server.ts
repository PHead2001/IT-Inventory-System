import 'server-only';
import { cache } from 'react';
import { getConfigurationCategories } from '@/features/configuration/queries.server';

export const readCategoryFormPage = cache(async (categoryId: string) => {
  const configuration = await getConfigurationCategories();
  const category = configuration.categories.find(
    (entry) => entry.id === categoryId && entry.active && !entry.removed_at,
  );
  return category ? { ...configuration, category } : null;
});

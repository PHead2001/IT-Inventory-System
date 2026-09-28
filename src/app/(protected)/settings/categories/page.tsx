import { getConfigurationCategories } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function CategoriesPage() {
  const { categories, canManage } = await getConfigurationCategories();
  return (
    <>
      <h1 className="mb-4 text-3xl font-semibold">Categories</h1>
      <SettingsPanel
        mode="categories"
        categories={categories}
        canManage={canManage}
      />
    </>
  );
}

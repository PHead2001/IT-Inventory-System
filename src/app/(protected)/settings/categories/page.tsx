import { getConfigurationCategories } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function CategoriesPage() {
  const { categories, canManage } = await getConfigurationCategories();
  return (
    <>
      <p className="experience-eyebrow">Settings · Categories</p>
      <h1 className="experience-heading mb-4 mt-3">Categories</h1>
      <SettingsPanel
        mode="categories"
        categories={categories}
        canManage={canManage}
      />
    </>
  );
}

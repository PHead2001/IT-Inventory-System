import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { getConfigurationCategories } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const { categories, canManage } = await getConfigurationCategories();
  return (
    <ProtectedPrivacyContent>
      <RouteReady
        {...await routeReadyProps('/settings/categories', searchParams)}
      >
        <>
          <p className="experience-eyebrow">Settings · Categories</p>
          <h1 className="experience-heading mb-4 mt-3">Categories</h1>
          <SettingsPanel
            mode="categories"
            categories={categories}
            canManage={canManage}
          />
        </>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}

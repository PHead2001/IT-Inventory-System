import { getConfiguration } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { MetadataSettings } from '@/features/metadata/metadata-settings';

export default async function SettingsPage() {
  const settings = await getConfiguration();
  const forms = await getPublishedForms(
    settings.categories.map((category) => category.id),
  );
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Settings</h1>
      <p className="mb-6 text-slate-400">
        Manage inventory categories and shared print defaults.
      </p>
      <SettingsPanel {...settings} />
      {settings.canManage && (
        <div className="mt-8">
          <MetadataSettings categories={settings.categories} forms={forms} />
        </div>
      )}
    </>
  );
}

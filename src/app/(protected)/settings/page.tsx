import { getConfiguration } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function SettingsPage() {
  const settings = await getConfiguration();
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Settings</h1>
      <p className="mb-6 text-slate-400">
        Manage inventory categories and shared print defaults.
      </p>
      <SettingsPanel {...settings} />
    </>
  );
}

import { getLabelSettings } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function LabelSettingsPage() {
  const { labelDefaults, canManage } = await getLabelSettings();
  return (
    <>
      <h1 className="mb-4 text-3xl font-semibold">
        Labels & printing defaults
      </h1>
      <SettingsPanel
        mode="labels"
        labelDefaults={labelDefaults}
        canManage={canManage}
      />
    </>
  );
}

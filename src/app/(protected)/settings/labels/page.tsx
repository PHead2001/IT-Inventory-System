import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { getLabelSettings } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function LabelSettingsPage() {
  const { labelDefaults, canManage } = await getLabelSettings();
  return (
    <ProtectedPrivacyContent>
      <>
        <p className="experience-eyebrow">Settings · Print defaults</p>
        <h1 className="experience-heading mb-4 mt-3">
          Labels & printing defaults
        </h1>
        <SettingsPanel
          mode="labels"
          labelDefaults={labelDefaults}
          canManage={canManage}
        />
      </>
    </ProtectedPrivacyContent>
  );
}

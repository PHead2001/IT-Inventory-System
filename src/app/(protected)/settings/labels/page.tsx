import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { getLabelSettings } from '@/features/configuration/queries.server';
import { SettingsPanel } from '@/features/configuration/settings-panel';

export default async function LabelSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const { labelDefaults, canManage, labelBinding } = await getLabelSettings();
  return (
    <ProtectedPrivacyContent>
      <RouteReady {...await routeReadyProps('/settings/labels', searchParams)}>
        <>
          <p className="experience-eyebrow">Settings · Print defaults</p>
          <h1 className="experience-heading mb-4 mt-3">
            Labels & printing defaults
          </h1>
          <SettingsPanel
            mode="labels"
            labelDefaults={labelDefaults}
            labelBinding={labelBinding}
            canManage={canManage}
          />
        </>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}

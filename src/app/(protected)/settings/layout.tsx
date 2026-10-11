export const metadata = { title: { absolute: 'Settings · IT Inventory' } };
import { SettingsNavigation } from './settings-navigation';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ProtectedPrivacyContent>
        <SettingsNavigation />
      </ProtectedPrivacyContent>
      {children}
    </>
  );
}

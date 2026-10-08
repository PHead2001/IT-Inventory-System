export const metadata = { title: { absolute: 'Settings · IT Inventory' } };
import { SettingsNavigation } from './settings-navigation';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SettingsNavigation />
      {children}
    </>
  );
}

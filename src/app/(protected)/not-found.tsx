import { UnavailablePage } from '@/components/unavailable-page';

export const metadata = {
  title: { absolute: 'Page not found · IT Inventory' },
};

export default function ProtectedNotFound() {
  // The protected layout already owns the main landmark and skip-link target.
  return <UnavailablePage />;
}

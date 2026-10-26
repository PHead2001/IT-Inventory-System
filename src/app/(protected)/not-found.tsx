import { UnavailablePage } from '@/components/unavailable-page';
import { requireMember } from '@/lib/auth/session.server';

export const metadata = {
  title: { absolute: 'Page not found · IT Inventory' },
};

export default async function ProtectedNotFound() {
  // Next can serialize fallback nodes concurrently with the protected layout.
  await requireMember();
  // The protected layout already owns the main landmark and skip-link target.
  return <UnavailablePage />;
}

import { UnavailablePage } from '@/components/unavailable-page';
import { requireMember } from '@/lib/auth/session.server';

export async function generateMetadata() {
  await requireMember();
  return {
    title: { absolute: 'Inventory record unavailable · IT Inventory' },
  };
}
export default async function InventoryNotFound() {
  await requireMember();
  return <UnavailablePage inventory />;
}

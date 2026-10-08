import { UnavailablePage } from '@/components/unavailable-page';
export const metadata = {
  title: { absolute: 'Inventory record unavailable · IT Inventory' },
};
export default function InventoryNotFound() {
  return <UnavailablePage inventory />;
}

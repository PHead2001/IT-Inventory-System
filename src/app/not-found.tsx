import { UnavailablePage } from '@/components/unavailable-page';
import { headers } from 'next/headers';
import { documentPathHeader, isInventoryDocument } from '@/lib/document-route';
async function inventoryDocument() {
  return isInventoryDocument((await headers()).get(documentPathHeader) ?? '');
}
export async function generateMetadata() {
  return {
    title: {
      absolute: `${(await inventoryDocument()) ? 'Inventory record unavailable' : 'Page not found'} · IT Inventory`,
    },
  };
}
export default async function NotFound() {
  const inventory = await inventoryDocument();
  return (
    <main id="main-content" tabIndex={-1}>
      <UnavailablePage inventory={inventory} />
    </main>
  );
}

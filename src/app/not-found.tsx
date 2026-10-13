import { UnavailablePage } from '@/components/unavailable-page';
import { headers } from 'next/headers';
import { documentPathHeader, isInventoryDocument } from '@/lib/document-route';
import { requireMember } from '@/lib/auth/session.server';
async function inventoryDocument() {
  const inventory = isInventoryDocument(
    (await headers()).get(documentPathHeader) ?? '',
  );
  // The root fallback is rendered independently of the protected layout.
  // A trusted route selector must never substitute for its membership check.
  if (inventory) await requireMember();
  return inventory;
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

import { UnavailablePage } from '@/components/unavailable-page';
export const metadata = {
  title: { absolute: 'Page not found · IT Inventory' },
};
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1}>
      <UnavailablePage />
    </main>
  );
}

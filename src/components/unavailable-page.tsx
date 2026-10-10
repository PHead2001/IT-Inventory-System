import Link from '@/components/experience/route-link';
import { Boxes } from 'lucide-react';
import { RoutePendingTerminal } from '@/components/experience/route-pending';

export function UnavailablePage({
  inventory = false,
}: {
  inventory?: boolean;
}) {
  return (
    <section
      className="experience-surface mx-auto my-10 max-w-xl p-6"
      aria-labelledby="unavailable-heading"
    >
      <RoutePendingTerminal />
      <span className="experience-brand-mark mb-5">
        <Boxes aria-hidden="true" size={24} />
      </span>
      <p className="experience-eyebrow">IT Inventory · 404</p>
      <h1 id="unavailable-heading" className="experience-heading mt-3">
        {inventory ? 'Inventory record unavailable' : 'Page not found'}
      </h1>
      <p className="mt-4 text-sm text-slate-300">
        {inventory
          ? 'This link does not lead to an inventory record you can open. Search inventory to find what you need.'
          : 'This address does not lead to a page. Open Overview or search inventory to continue.'}
      </p>
      <nav aria-label="Recovery options" className="mt-5 flex flex-wrap gap-3">
        <Link
          href="/inventory"
          className="inline-flex min-h-11 items-center rounded border border-[var(--accent)] px-4 text-[var(--accent)]"
        >
          Search inventory
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center px-4 text-[var(--accent)] underline"
        >
          Open Overview
        </Link>
      </nav>
    </section>
  );
}

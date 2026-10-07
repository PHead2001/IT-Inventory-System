import Link from 'next/link';
import { Plus } from 'lucide-react';

/** Native disclosure keeps both creation paths available without displacing results. */
export function AddItemLauncher({ query }: { query: string }) {
  return (
    <details className="experience-add-item-launcher experience-surface relative my-2 max-w-xl p-3 sm:my-3">
      <summary
        aria-label="Add item"
        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-cyan-100"
      >
        <Plus size={17} aria-hidden="true" /> Add item
        <span className="ml-auto text-xs font-normal text-slate-300">
          Choose tracking type
        </span>
      </summary>
      <div className="grid gap-2 pt-2 sm:grid-cols-2">
        <Link
          aria-label="Add quantity item"
          aria-describedby="quantity-choice-description"
          href={'/inventory/quantity/new?' + query}
          className="min-w-0 rounded-lg border border-cyan-400/30 p-3 hover:bg-cyan-400/10 focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <strong className="block text-sm">Add quantity item</strong>
          <span
            id="quantity-choice-description"
            className="mt-1 block text-sm text-slate-300"
          >
            Track interchangeable items by count, such as cables and adapters.
          </span>
        </Link>
        <Link
          aria-label="Add individual asset"
          aria-describedby="asset-choice-description"
          href={'/inventory/assets/new?' + query}
          className="min-w-0 rounded-lg border border-cyan-400/30 p-3 hover:bg-cyan-400/10 focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <strong className="block text-sm">Add individual asset</strong>
          <span
            id="asset-choice-description"
            className="mt-1 block text-sm text-slate-300"
          >
            Track one specific device, such as a laptop or switch.
          </span>
        </Link>
      </div>
    </details>
  );
}

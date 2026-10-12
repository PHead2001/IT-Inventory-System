'use client';
import Link from '@/components/experience/route-link';
import { useId } from 'react';
import { Plus } from 'lucide-react';

export function TrackingTypeChoices({
  query = '',
  onNavigate,
}: {
  query?: string;
  onNavigate?: (href: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-2 pt-2 sm:grid-cols-2">
      {[
        {
          kind: 'quantity',
          label: 'Add quantity item',
          description:
            'Track interchangeable items by count, such as cables and adapters.',
        },
        {
          kind: 'assets',
          label: 'Add individual asset',
          description: 'Track one specific device, such as a laptop or switch.',
        },
      ].map((choice) => {
        const href =
          '/inventory/' + choice.kind + '/new' + (query ? '?' + query : '');
        return (
          <Link
            key={choice.kind}
            aria-label={choice.label}
            aria-describedby={id + '-' + choice.kind}
            href={href}
            data-command-navigation={onNavigate ? 'true' : undefined}
            onClick={(event) => {
              if (
                onNavigate &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                onNavigate(href);
              }
            }}
            className="min-w-0 rounded-lg border border-[color:var(--button-outline-border)] p-3 hover:bg-[var(--button-outline-hover-background)] focus-visible:outline-2 focus-visible:outline-[color:var(--control-focus-outline)]"
          >
            <strong className="block text-sm">{choice.label}</strong>
            <span
              id={id + '-' + choice.kind}
              className="experience-muted mt-1 block text-sm"
            >
              {choice.description}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
/** Native disclosure keeps both creation paths available without displacing results. */
export function AddItemLauncher({ query }: { query: string }) {
  return (
    <details className="experience-add-item-launcher experience-surface relative my-2 max-w-xl p-3 sm:my-3">
      <summary
        aria-label="Add item"
        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold"
      >
        <Plus size={17} aria-hidden="true" /> Add item
        <span className="experience-muted ml-auto text-xs font-normal">
          Choose tracking type
        </span>
      </summary>
      <TrackingTypeChoices query={query} />
    </details>
  );
}

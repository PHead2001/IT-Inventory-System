'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { LocationRef } from '../inventory/contracts-ui';
import { LocationBrowser } from './location-browser';

export function LocationsBrowserPage({
  locations,
}: {
  locations: LocationRef[];
}) {
  const [code, setCode] = useState<string | null>(null);
  const selected = locations.find((location) => location.code === code);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <LocationBrowser
        locations={locations}
        selectedCode={code}
        onSelect={setCode}
      />
      <section
        aria-label="Selected location"
        className="experience-surface min-w-0 self-start p-4"
      >
        {selected ? (
          <>
            <p className="experience-eyebrow">Selected location</p>
            <h2 className="mt-1 break-words text-xl font-semibold">
              {selected.name}
            </h2>
            <p className="mt-2 break-words text-sm text-slate-300">
              {selected.breadcrumb} · {selected.code}
            </p>
            <p className="mt-2 text-sm text-slate-200">
              {!selected.active
                ? 'Inactive: cannot be chosen as a new inventory destination.'
                : selected.can_hold_inventory
                  ? 'Eligible inventory destination'
                  : 'Group: select to browse aggregate inventory; cannot directly hold stock.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-4">
              <Link
                className="min-h-11 py-2 text-cyan-300 underline"
                href={'/locations/' + encodeURIComponent(selected.code)}
              >
                View contents and history
              </Link>
              <Link
                className="min-h-11 py-2 text-cyan-300 underline"
                href={'/room?location=' + encodeURIComponent(selected.code)}
              >
                Open in Spaces
              </Link>
            </div>
          </>
        ) : (
          <p className="text-slate-300">Select a location to see details.</p>
        )}
      </section>
    </div>
  );
}

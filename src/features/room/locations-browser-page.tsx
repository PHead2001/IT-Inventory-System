'use client';
import Link from '@/components/experience/route-link';
import { useState } from 'react';
import { motion } from 'motion/react';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import type { LocationRef } from '../inventory/contracts-ui';
import { LocationCode } from '../inventory/components/read-ui';
import { countLabel } from '@/lib/count';
import { LocationBrowser } from './location-browser';

export function LocationsBrowserPage({
  locations,
}: {
  locations: LocationRef[];
}) {
  const [code, setCode] = useState<string | null>(null);
  const reducedMotion = useEffectiveReducedMotion();
  const selected = locations.find((location) => location.code === code);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <LocationBrowser
        locations={locations}
        selectedCode={code}
        onSelect={setCode}
      />
      <motion.section
        aria-label="Selected location"
        className="experience-surface min-w-0 self-start p-4"
        layout={!reducedMotion}
      >
        {selected ? (
          <motion.div
            key={selected.code}
            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="experience-eyebrow">Selected location</p>
            <h2 className="mt-1 break-words text-xl font-semibold">
              {selected.name}
            </h2>
            <p className="mt-2 break-words text-sm text-slate-300">
              {selected.breadcrumb}
            </p>
            <LocationCode code={selected.code} />
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
          </motion.div>
        ) : (
          <div>
            <p className="experience-eyebrow">Location hierarchy</p>
            <h2 className="mt-1 text-xl font-semibold">
              Find a physical place
            </h2>
            <p className="experience-muted mt-2 text-sm leading-6">
              Browse {countLabel(locations.length, 'logical location')},
              including{' '}
              {countLabel(
                locations.filter((location) => location.can_hold_inventory)
                  .length,
                'inventory destination',
              )}
              . Select a group to explore its contents or a destination to see
              the stock held there.
            </p>
            <Link
              href="/room"
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 underline"
            >
              Open Spaces &amp; maps
            </Link>
          </div>
        )}
      </motion.section>
    </div>
  );
}

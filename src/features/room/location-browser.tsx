'use client';
import { useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import type { LocationRef } from '../inventory/contracts-ui';
import { LocationCode } from '../inventory/components/read-ui';
import {
  locationAncestorIds,
  pickerTree,
  visiblePickerTree,
} from '../locations/picker-model';

function BrowserLocation({
  location,
  selected,
  search,
  onSelect,
  indent,
}: {
  location: LocationRef;
  selected: boolean;
  search: boolean;
  onSelect: (code: string) => void;
  indent?: number;
}) {
  return (
    <div className="min-w-0 flex-1" style={{ marginLeft: indent }}>
      <button
        aria-current={selected ? 'location' : undefined}
        aria-label={`${search ? location.breadcrumb : location.name} ${location.code}${!location.active ? ' Inactive' : ''}`}
        className="min-h-11 w-full min-w-0 break-words rounded-lg px-2 text-left text-sm hover:bg-slate-800 aria-[current=location]:bg-cyan-900"
        onClick={() => onSelect(location.code)}
      >
        <span className="block">
          {search ? location.breadcrumb : location.name}
        </span>
        {location.code.length <= 24 && (
          <span className="block overflow-x-auto whitespace-nowrap text-xs text-slate-300">
            {location.code}
          </span>
        )}
        {!location.active && <span className="text-amber-200">Inactive</span>}
      </button>
      {location.code.length > 24 && (
        <div className="px-2 pb-2">
          <LocationCode code={location.code} />
        </div>
      )}
    </div>
  );
}

export function LocationBrowser({
  locations,
  selectedCode,
  onSelect,
}: {
  locations: LocationRef[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const navigationRef = useRef<HTMLElement>(null);
  const statusId = useId();
  const reducedMotion = useEffectiveReducedMotion();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<string | null | undefined>(undefined);
  const rows = useMemo(() => pickerTree(locations, 'browse'), [locations]);
  const selected = locations.find((location) => location.code === selectedCode);
  const visibleLevel =
    level === undefined ? (selected?.parentId ?? null) : level;
  const revealed = new Set([
    ...expanded,
    ...(selected ? locationAncestorIds(selected, locations) : []),
  ]);
  const visible = visiblePickerTree(rows, revealed);
  const search = query.trim().toLocaleLowerCase();
  const matched = search
    ? rows.filter((row) =>
        [row.location.name, row.location.code, row.location.breadcrumb].some(
          (text) => text.toLocaleLowerCase().includes(search),
        ),
      )
    : visible;
  const mobileRows = search
    ? matched
    : rows.filter((row) => row.parentId === visibleLevel);
  const current = locations.find((location) => location.id === visibleLevel);
  return (
    <nav
      ref={navigationRef}
      tabIndex={-1}
      aria-label="Location browser"
      aria-describedby={statusId}
      className="experience-surface min-w-0 p-3"
    >
      <label
        className="block text-sm font-semibold"
        htmlFor="location-browser-search"
      >
        Browse locations
      </label>
      <input
        id="location-browser-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search names, codes, paths"
        className="experience-field mt-2 min-h-11 w-full px-3"
      />
      {current && !search && (
        <button
          className="mt-2 min-h-11 text-sm text-cyan-300 underline md:hidden"
          onClick={() => {
            setLevel(current.parentId);
            navigationRef.current?.focus();
          }}
        >
          Back to{' '}
          {current.parentId
            ? locations.find((item) => item.id === current.parentId)?.name
            : 'spaces'}
        </button>
      )}
      <p id={statusId} role="status" className="sr-only">
        Browsing {search ? 'search results' : (current?.breadcrumb ?? 'spaces')}
      </p>
      {selected && (
        <p className="my-2 break-words text-xs leading-5 text-slate-300">
          Selected path: {selected.breadcrumb}
        </p>
      )}
      <ul className="mt-2 max-h-[28rem] space-y-1 overflow-auto md:hidden">
        {mobileRows.map((row) => (
          <motion.li
            key={row.location.id}
            layout={!reducedMotion}
            className="flex min-w-0 items-center gap-1"
          >
            <BrowserLocation
              location={row.location}
              selected={selectedCode === row.location.code}
              search={Boolean(search)}
              onSelect={onSelect}
            />
            {row.hasChildren && !search && (
              <button
                aria-label={'Open ' + row.location.name}
                className="min-h-11 min-w-11 rounded border border-slate-700"
                onClick={() => {
                  setLevel(row.location.id);
                  navigationRef.current?.focus();
                }}
              >
                ›
              </button>
            )}
          </motion.li>
        ))}
      </ul>
      <ul className="mt-2 hidden max-h-[28rem] space-y-1 overflow-auto md:block">
        {matched.map((row) => (
          <motion.li
            key={row.location.id}
            layout={!reducedMotion}
            initial={reducedMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex min-w-0 items-center gap-1"
          >
            {!search && row.hasChildren && (
              <button
                aria-label={
                  (expanded.has(row.location.id) ? 'Collapse ' : 'Expand ') +
                  row.location.name
                }
                aria-expanded={expanded.has(row.location.id)}
                className="min-h-10 min-w-10 rounded-lg border border-slate-600"
                style={{ marginLeft: row.depth * 12 }}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(row.location.id)) next.delete(row.location.id);
                    else next.add(row.location.id);
                    return next;
                  })
                }
              >
                {expanded.has(row.location.id) ? '⌄' : '›'}
              </button>
            )}
            <BrowserLocation
              location={row.location}
              selected={selectedCode === row.location.code}
              search={Boolean(search)}
              onSelect={onSelect}
              indent={
                !search && !row.hasChildren ? row.depth * 12 + 40 : undefined
              }
            />
          </motion.li>
        ))}
      </ul>
      {!matched.length && (
        <p className="p-3 text-sm text-slate-400">No matching locations.</p>
      )}
    </nav>
  );
}

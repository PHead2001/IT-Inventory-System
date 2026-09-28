'use client';
import { useMemo, useState } from 'react';
import type { LocationRef } from '../inventory/contracts-ui';
import {
  locationAncestorIds,
  pickerTree,
  visiblePickerTree,
} from '../locations/picker-model';

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
      aria-label="Location browser"
      className="min-w-0 rounded-xl border border-slate-700 bg-slate-900/70 p-3"
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
        className="mt-2 min-h-11 w-full rounded-md border border-slate-600 bg-slate-950 px-3 text-sm"
      />
      {current && !search && (
        <button
          className="mt-2 min-h-11 text-sm text-cyan-300 underline md:hidden"
          onClick={() => setLevel(current.parentId)}
        >
          Back to{' '}
          {current.parentId
            ? locations.find((item) => item.id === current.parentId)?.name
            : 'spaces'}
        </button>
      )}
      {selected && (
        <p className="my-2 break-words text-xs text-slate-300">
          Selected path: {selected.breadcrumb}
        </p>
      )}
      <ul className="mt-2 max-h-[28rem] space-y-1 overflow-auto md:hidden">
        {mobileRows.map((row) => (
          <li key={row.location.id} className="flex items-center gap-1">
            <button
              aria-current={
                selectedCode === row.location.code ? 'location' : undefined
              }
              className="min-h-11 min-w-0 flex-1 rounded px-2 text-left text-sm hover:bg-slate-800 aria-[current=location]:bg-cyan-900"
              onClick={() => onSelect(row.location.code)}
            >
              {row.location.name}{' '}
              <span className="text-xs text-slate-400">
                {row.location.code}
              </span>
              {!row.location.active && (
                <span className="ml-2 text-amber-200">Inactive</span>
              )}
            </button>
            {row.hasChildren && !search && (
              <button
                aria-label={'Open ' + row.location.name}
                className="min-h-11 min-w-11 rounded border border-slate-700"
                onClick={() => setLevel(row.location.id)}
              >
                ›
              </button>
            )}
          </li>
        ))}
      </ul>
      <ul className="mt-2 hidden max-h-[28rem] space-y-1 overflow-auto md:block">
        {matched.map((row) => (
          <li key={row.location.id} className="flex items-center gap-1">
            {!search && row.hasChildren && (
              <button
                aria-label={
                  (expanded.has(row.location.id) ? 'Collapse ' : 'Expand ') +
                  row.location.name
                }
                aria-expanded={expanded.has(row.location.id)}
                className="min-h-9 min-w-9 rounded border border-slate-700"
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
            <button
              aria-current={
                selectedCode === row.location.code ? 'location' : undefined
              }
              style={{
                marginLeft:
                  !search && !row.hasChildren ? row.depth * 12 + 40 : undefined,
              }}
              className="min-h-10 min-w-0 flex-1 rounded px-2 text-left text-sm hover:bg-slate-800 aria-[current=location]:bg-cyan-900"
              onClick={() => onSelect(row.location.code)}
            >
              {row.location.name}{' '}
              <span className="text-xs text-slate-400">
                {row.location.code}
              </span>
              {!row.location.active && (
                <span className="ml-2 text-amber-200">Inactive</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!matched.length && (
        <p className="p-3 text-sm text-slate-400">No matching locations.</p>
      )}
    </nav>
  );
}

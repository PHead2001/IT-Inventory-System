'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import type { ManagedLocation } from '@/features/custody/queries.server';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import {
  pickerLocations,
  pickerTree,
  visiblePickerTree,
  type PickerTreeRow,
} from './picker-model';

export function SettingsLocationTree({
  locations,
}: {
  locations: ManagedLocation[];
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(
    () => new Set(locations.map((item) => item.id)),
  );
  const [focused, setFocused] = useState<string | null>(null);
  const refs = useMemo<LocationRef[]>(() => {
    const byId = new Map(locations.map((item) => [item.id, item]));
    return locations.map((item) => {
      const path = [item.name];
      const seen = new Set([item.id]);
      let parent = item.parent_id;
      while (parent && byId.has(parent) && !seen.has(parent)) {
        seen.add(parent);
        const ancestor = byId.get(parent)!;
        path.unshift(ancestor.name);
        parent = ancestor.parent_id;
      }
      return {
        ...item,
        parentId: item.parent_id,
        sortOrder: item.sort_order,
        breadcrumb: path.join(' / '),
      };
    });
  }, [locations]);
  const tree = pickerTree(refs, 'browse');
  const searching = Boolean(query.trim());
  const rows: Pick<
    PickerTreeRow,
    'location' | 'depth' | 'hasChildren' | 'parentId'
  >[] = searching
    ? pickerLocations(refs, 'browse', { query }).map((location) => ({
        location,
        depth: 0,
        hasChildren: false,
        parentId: null,
      }))
    : visiblePickerTree(tree, expanded);
  function toggle(locationId: string, open: boolean) {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(locationId);
      else next.delete(locationId);
      return next;
    });
  }
  function focus(index: number) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row) {
      setFocused(row.location.id);
      document.getElementById(`${id}-${rows.indexOf(row)}`)?.focus();
    }
  }
  return (
    <section
      className="experience-surface mt-5 p-4"
      aria-label="Location configuration"
    >
      <label htmlFor={`${id}-search`} className="block text-sm font-medium">
        Search locations
      </label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setFocused(null);
        }}
        className="experience-field mt-2 min-h-11 w-full px-3 py-2"
        placeholder="Name, permanent code or full path"
      />
      <p role="status" className="my-3 text-xs text-slate-300">
        {searching
          ? `${rows.length} matching locations`
          : `${locations.length} locations`}
      </p>
      <ul
        role={searching ? 'list' : 'tree'}
        aria-label="Locations"
        className="divide-y divide-slate-700/70"
      >
        {rows.map((row, index) => (
          <li
            key={row.location.id}
            role={searching ? 'listitem' : 'none'}
            className="flex min-w-0 items-start gap-2 py-2"
            style={{ paddingLeft: row.depth * 16 }}
          >
            {row.hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  toggle(row.location.id, !expanded.has(row.location.id));
                  focus(index);
                }}
                aria-label={`${expanded.has(row.location.id) ? 'Collapse' : 'Expand'} ${row.location.name}`}
                className="min-h-11 min-w-11 text-cyan-300"
              >
                {expanded.has(row.location.id) ? '⌄' : '›'}
              </button>
            ) : (
              <span className="w-11 shrink-0" aria-hidden="true" />
            )}
            <Link
              id={`${id}-${index}`}
              role={searching ? undefined : 'treeitem'}
              aria-level={searching ? undefined : row.depth + 1}
              aria-expanded={
                row.hasChildren ? expanded.has(row.location.id) : undefined
              }
              tabIndex={
                searching ||
                focused === row.location.id ||
                (focused === null && index === 0)
                  ? 0
                  : -1
              }
              onFocus={() => setFocused(row.location.id)}
              onKeyDown={(event) => {
                if (searching) return;
                if (
                  ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                ) {
                  event.preventDefault();
                  focus(
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? rows.length - 1
                        : index + (event.key === 'ArrowDown' ? 1 : -1),
                  );
                }
                if (event.key === 'ArrowRight' && row.hasChildren) {
                  event.preventDefault();
                  if (!expanded.has(row.location.id))
                    toggle(row.location.id, true);
                  else focus(index + 1);
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  if (row.hasChildren && expanded.has(row.location.id))
                    toggle(row.location.id, false);
                  else if (row.parentId)
                    focus(
                      rows.findIndex(
                        (candidate) => candidate.location.id === row.parentId,
                      ),
                    );
                }
              }}
              href={`/settings/locations/${encodeURIComponent(row.location.code)}`}
              className="min-w-0 flex-1 rounded py-2 text-cyan-200 underline focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <span className="block break-words font-medium">
                {row.location.name}
              </span>
              <span className="block break-words text-xs text-slate-300">
                {row.location.breadcrumb}
              </span>
              <span className="block break-words text-xs text-slate-300">
                {row.location.code} ·{' '}
                {row.location.active ? 'Active' : 'Inactive'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!rows.length && (
        <p className="text-sm">No locations match this search.</p>
      )}
    </section>
  );
}

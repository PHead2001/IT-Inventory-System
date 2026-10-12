'use client';
import { useRouteTransition } from '@/components/experience/route-pending';
import { useRouteRouter as useRouter } from '@/components/experience/route-pending';

import Link from '@/components/experience/route-link';
import { useEffect, useRef, useState } from 'react';

import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import type { CategoryRef, LocationRef } from '../contracts-ui';
import type { Site } from '@/features/custody/queries.server';
import { field } from './read-ui';
import { readFilters } from '../read-model';
import { inventoryFilterParams } from '../scope-presentation';

type FilterKey =
  'q' | 'type' | 'status' | 'category' | 'location' | 'site' | 'lowStock';
const filterKeys: FilterKey[] = [
  'q',
  'type',
  'status',
  'category',
  'location',
  'site',
  'lowStock',
];

export function SearchForm({
  params,
  categories,
  locations,
  sites,
  action = '/inventory',
  diagnosticsEnabled = false,
}: {
  params: Record<string, string | undefined>;
  categories: CategoryRef[];
  locations: LocationRef[];
  sites: Site[];
  action?: string;
  diagnosticsEnabled?: boolean;
}) {
  useEffect(() => {
    if (!diagnosticsEnabled) return;
    try {
      // This marks this client island's effect, not hydration of the whole page.
      performance.mark('itinv:auth:search-island-effect');
    } catch {
      // Optional measurement must not affect inventory search.
    }
  }, [diagnosticsEnabled]);
  const filters = readFilters(params);
  const router = useRouter();
  const [pending, startTransition] = useRouteTransition();
  const appliedSignature = inventoryFilterParams(params).toString();
  const [draft, setDraft] = useState(params);
  const [syncedSignature, setSyncedSignature] = useState(appliedSignature);
  const [unsentEdits, setUnsentEdits] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  // A committed navigation (including Back/Forward) restores all controls together.
  if (syncedSignature !== appliedSignature) {
    setSyncedSignature(appliedSignature);
    // An earlier response must not erase typing made after its request.
    if (!unsentEdits) setDraft(params);
  }
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  function cancelDebounce() {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
  }
  useEffect(() => {
    function restoreHistory() {
      cancelDebounce();
      composing.current = false;
      setUnsentEdits(false);
      setDraft(Object.fromEntries(new URLSearchParams(window.location.search)));
    }
    window.addEventListener('popstate', restoreHistory);
    return () => {
      cancelDebounce();
      window.removeEventListener('popstate', restoreHistory);
    };
  }, []);
  useEffect(() => {
    function deliberateLink(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (
        target.origin !== window.location.origin ||
        target.pathname === '/api' ||
        target.pathname.startsWith('/api/') ||
        (target.hash &&
          target.pathname === window.location.pathname &&
          target.search === window.location.search)
      )
        return;
      cancelDebounce();
      composing.current = false;
      setUnsentEdits(false);
      if (target.pathname === action) {
        const next = Object.fromEntries(target.searchParams);
        draftRef.current = next;
        setDraft(next);
      }
    }
    // Includes pagination and Clear filters links rendered alongside this island.
    document.addEventListener('click', deliberateLink, true);
    return () => document.removeEventListener('click', deliberateLink, true);
  }, [action]);
  function navigate(
    next: Record<string, string | undefined>,
    deliberate: boolean,
  ) {
    cancelDebounce();
    setUnsentEdits(false);
    const query = inventoryFilterParams(next).toString();
    const href = action + (query ? '?' + query : '');
    startTransition(() => {
      if (deliberate) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    });
  }
  function change(key: FilterKey, value: string, deliberate = true) {
    const next = { ...draftRef.current, [key]: value, page: undefined };
    draftRef.current = next;
    setDraft(next);
    setUnsentEdits(true);
    cancelDebounce();
    if (deliberate) navigate(next, true);
    else if (!composing.current)
      debounce.current = setTimeout(
        () => navigate(draftRef.current, false),
        250,
      );
  }
  const draftFilters = readFilters(draft);
  const [expanded, setExpanded] = useState(() =>
    Boolean(
      filters.category || filters.location || filters.site || filters.lowStock,
    ),
  );
  const reduced = useEffectiveReducedMotion();
  const active: Record<FilterKey, string | undefined> = {
    q: filters.query || undefined,
    type: filters.type === 'all' ? undefined : filters.type,
    status: filters.status === 'active' ? undefined : filters.status,
    category: filters.category,
    location: filters.location,
    site: filters.site,
    lowStock: filters.lowStock ? 'true' : undefined,
  };
  const chips = filterKeys.flatMap((key) => {
    const value = active[key];
    if (!value) return [];
    const label =
      key === 'q'
        ? `Search: ${value}`
        : key === 'type'
          ? `Type: ${value === 'asset' ? 'Individual assets' : 'Quantity items'}`
          : key === 'status'
            ? `Status: ${value === 'all' ? 'All' : 'Archived / retired'}`
            : key === 'category'
              ? `Category: ${categories.find((item) => item.id === value)?.name ?? 'Unavailable category'}`
              : key === 'location'
                ? `Location: ${locations.find((item) => item.code === value || item.id === value)?.name ?? value}`
                : key === 'site'
                  ? `Site: ${sites.find((item) => item.id === value)?.name ?? 'Unavailable site'}`
                  : 'Needs restocking';
    const next = new URLSearchParams();
    Object.entries(params).forEach(([name, entry]) => {
      if (name !== key && name !== 'page' && entry) next.set(name, entry);
    });
    return [{ key, label, href: `${action}${next.size ? `?${next}` : ''}` }];
  });

  return (
    <div className="experience-inventory-search experience-surface mb-3 px-4 py-2 sm:mb-4 sm:p-4">
      <form
        action={action}
        aria-label="Search inventory"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing.current) navigate(draftRef.current, true);
        }}
      >
        <div className="experience-search-top">
          <div className="min-w-0 flex-1">
            <label
              className="mb-1 block text-sm font-semibold"
              htmlFor="inventory-query"
            >
              Search inventory
            </label>
            <Input
              id="inventory-query"
              name="q"
              data-inventory-search="true"
              value={draft.q ?? ''}
              onChange={(event) => change('q', event.target.value, false)}
              onCompositionStart={() => {
                composing.current = true;
                cancelDebounce();
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                change('q', event.currentTarget.value, false);
              }}
              maxLength={200}
              placeholder="Name, model, serial, category or location"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="inventory-type" className="mb-1 block text-xs">
              Tracking type
            </label>
            <select
              className={field}
              id="inventory-type"
              name="type"
              value={draftFilters.type === 'all' ? '' : draftFilters.type}
              onChange={(event) => change('type', event.target.value)}
            >
              <option value="">All types</option>
              <option value="quantity">Quantity items</option>
              <option value="asset">Individual assets</option>
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="inventory-status" className="mb-1 block text-xs">
              Status
            </label>
            <select
              className={field}
              id="inventory-status"
              name="status"
              value={draftFilters.status}
              onChange={(event) => change('status', event.target.value)}
            >
              <option value="active">Active</option>
              <option value="historical">Archived / retired</option>
              <option value="all">All statuses</option>
            </select>
          </div>
          <Button type="submit" className="self-end">
            Search
          </Button>
        </div>
        <button
          type="button"
          className="experience-filter-toggle mt-3"
          aria-expanded={expanded}
          aria-controls="inventory-more-filters"
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? '−' : '+'}</span>{' '}
          {expanded ? 'Fewer filters' : 'More filters'}
        </button>
        <motion.div
          id="inventory-more-filters"
          initial={false}
          animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.22 }}
          style={{ overflow: 'hidden' }}
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="inventory-category" className="text-sm">
                Category
              </label>
              <select
                className={field}
                id="inventory-category"
                name="category"
                value={draftFilters.category ?? ''}
                onChange={(event) => change('category', event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <LocationPicker
              id="inventory-location"
              label="Location"
              locations={locations}
              mode="browse"
              name="location"
              value={draftFilters.location ?? ''}
              onValueChange={(value) => change('location', value)}
              allowAll
            />
            <div>
              <label htmlFor="inventory-site" className="text-sm">
                Property/site
              </label>
              <select
                className={field}
                id="inventory-site"
                name="site"
                value={draftFilters.site ?? ''}
                onChange={(event) => change('site', event.target.value)}
              >
                <option value="">All sites and storage</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} ({site.code}){site.active ? '' : ' — archived'}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="lowStock"
                value="true"
                checked={draftFilters.lowStock}
                onChange={(event) =>
                  change('lowStock', event.target.checked ? 'true' : '')
                }
              />
              Needs restocking only (available in storage)
            </label>
          </div>
        </motion.div>
      </form>
      <p
        role="status"
        aria-live="polite"
        className="mt-2 text-xs text-slate-300"
      >
        {pending || unsentEdits
          ? 'Updating results. Displayed rows, active filters and CSV still use the previous applied search.'
          : 'Results and CSV use the applied search.'}
      </p>
      {chips.length > 0 && (
        <nav
          aria-label="Active inventory filters"
          className="experience-active-inventory-filters mt-3 flex flex-wrap items-center gap-2 border-t border-cyan-100/10 pt-3 text-xs"
        >
          <span className="sr-only text-slate-400 sm:not-sr-only">
            Active filters
          </span>
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                const next = Object.fromEntries(
                  new URL(chip.href, window.location.href).searchParams,
                );
                draftRef.current = next;
                setDraft(next);
                navigate(next, true);
              }}
              className="experience-filter-chip"
              aria-label={`Remove ${chip.label} filter`}
            >
              {chip.label} <span aria-hidden="true">×</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import type { CategoryRef, LocationRef } from '../contracts-ui';
import type { Site } from '@/features/custody/queries.server';
import { field } from './read-ui';
import { readFilters } from '../read-model';

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
}: {
  params: Record<string, string | undefined>;
  categories: CategoryRef[];
  locations: LocationRef[];
  sites: Site[];
  action?: string;
}) {
  const filters = readFilters(params);
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
          ? `Type: ${value === 'asset' ? 'Serialized assets' : 'Quantity'}`
          : key === 'status'
            ? `Status: ${value === 'all' ? 'All' : 'Archived / retired'}`
            : key === 'category'
              ? `Category: ${categories.find((item) => item.id === value)?.name ?? value}`
              : key === 'location'
                ? `Location: ${locations.find((item) => item.code === value || item.id === value)?.name ?? value}`
                : key === 'site'
                  ? `Site: ${sites.find((item) => item.id === value)?.name ?? value}`
                  : 'Needs restocking';
    const next = new URLSearchParams();
    Object.entries(params).forEach(([name, entry]) => {
      if (name !== key && name !== 'page' && entry) next.set(name, entry);
    });
    return [{ key, label, href: `${action}${next.size ? `?${next}` : ''}` }];
  });

  return (
    <div className="experience-inventory-search experience-surface mb-4 p-4">
      <form action={action} aria-label="Search inventory">
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
              defaultValue={filters.query}
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
              defaultValue={filters.type === 'all' ? '' : filters.type}
            >
              <option value="">All types</option>
              <option value="quantity">Quantity</option>
              <option value="asset">Serialized assets</option>
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
              defaultValue={filters.status}
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
                defaultValue={filters.category ?? ''}
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
              key={filters.location ?? ''}
              id="inventory-location"
              label="Location"
              locations={locations}
              mode="browse"
              name="location"
              defaultValue={filters.location ?? ''}
              allowAll
            />
            <div>
              <label htmlFor="inventory-site" className="text-sm">
                Property / site
              </label>
              <select
                className={field}
                id="inventory-site"
                name="site"
                defaultValue={filters.site ?? ''}
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
                defaultChecked={filters.lowStock}
              />
              Needs restocking only (available in storage)
            </label>
          </div>
        </motion.div>
      </form>
      {chips.length > 0 && (
        <nav
          aria-label="Active inventory filters"
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-cyan-100/10 pt-3 text-xs"
        >
          <span className="text-slate-400">Active filters</span>
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
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

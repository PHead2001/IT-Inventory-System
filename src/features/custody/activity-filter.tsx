'use client';
import { useId, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { field, panel } from '@/features/inventory/components/read-ui';
import {
  browserDisplayTimeZone,
  formatOperationalTimestamp,
  resolveDisplayTimeZone,
} from '@/lib/operational-time';
import {
  parseActivityRange,
  resolveActivityPreset,
  type ActivityErrors,
  type ActivityPreset,
} from './activity-range';
const subscribe = () => () => {};

export function ActivityFilter({
  base,
  filters,
  errors = {},
}: {
  base: string;
  filters: Record<string, string | undefined>;
  errors?: ActivityErrors;
}) {
  const router = useRouter();
  const scope = useId();
  const [preset, setPreset] = useState<ActivityPreset>('custom');
  const [zoneChoice, setZone] = useState<string | null>(
    filters.zone ? resolveDisplayTimeZone(filters.zone).timeZone : null,
  );
  const [store] = useState(() => {
    let resolved: string | undefined;
    return { snapshot: () => (resolved ??= browserDisplayTimeZone().timeZone) };
  });
  const localZone = useSyncExternalStore(
    subscribe,
    store.snapshot,
    () => 'UTC',
  );
  const zone = zoneChoice ?? localZone;
  const [from, setFrom] = useState(filters.from ?? '');
  const [until, setUntil] = useState(filters.until ?? '');
  const [issues, setIssues] = useState(errors);
  const applied = parseActivityRange(filters);
  const context = resolveDisplayTimeZone(filters.zone ?? localZone);
  const formatted = (value: string | null) =>
    value ? formatOperationalTimestamp(value, context)?.text : 'Unbounded';
  return (
    <div className="space-y-3">
      <form
        noValidate
        className={panel + ' flex flex-wrap items-end gap-3'}
        onSubmit={(event) => {
          event.preventDefault();
          let range = parseActivityRange({ from, until });
          if (preset !== 'custom') {
            try {
              range = parseActivityRange(resolveActivityPreset(preset, zone));
            } catch {
              setIssues({
                from: 'Choose a supported timezone and calendar range.',
              });
              return;
            }
          }
          setIssues(range.errors);
          if (!range.valid) {
            document
              .getElementById(
                scope + '-' + (range.errors.from ? 'from' : 'until'),
              )
              ?.focus();
            return;
          }
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(filters))
            if (value && !['from', 'until', 'preset', 'zone'].includes(key))
              query.set(key, value);
          if (range.from) query.set('from', range.from);
          if (range.until) query.set('until', range.until);
          query.set('zone', zone);
          // Explicit instants survive refresh. Never re-resolve an old Today URL.
          router.push(base + '?' + query.toString() + '#activity-heading');
        }}
      >
        <label className="space-y-2">
          Activity range
          <select
            className={field}
            value={preset}
            onChange={(e) => setPreset(e.target.value as ActivityPreset)}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="space-y-2">
          Display / preset timezone
          <select
            className={field}
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {Array.from(
              new Set([
                localZone,
                filters.zone
                  ? resolveDisplayTimeZone(filters.zone).timeZone
                  : localZone,
                'UTC',
              ]),
            ).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="space-y-2">
              From (UTC, inclusive)
              <input
                aria-label="From (UTC, inclusive)"
                id={scope + '-from'}
                className={field}
                value={from}
                placeholder="2026-10-07T00:00:00Z"
                aria-invalid={!!issues.from}
                aria-describedby={
                  issues.from ? scope + '-from-error' : undefined
                }
                onChange={(e) => setFrom(e.target.value)}
              />
              {issues.from && (
                <span
                  id={scope + '-from-error'}
                  className="block text-sm text-amber-200"
                >
                  {issues.from}
                </span>
              )}
            </label>
            <label className="space-y-2">
              Until (UTC, exclusive)
              <input
                aria-label="Until (UTC, exclusive)"
                id={scope + '-until'}
                className={field}
                value={until}
                placeholder="2026-10-08T00:00:00Z"
                aria-invalid={!!issues.until}
                aria-describedby={
                  issues.until ? scope + '-until-error' : undefined
                }
                onChange={(e) => setUntil(e.target.value)}
              />
              {issues.until && (
                <span
                  id={scope + '-until-error'}
                  className="block text-sm text-amber-200"
                >
                  {issues.until}
                </span>
              )}
            </label>
          </>
        )}
        <Button type="submit">Filter activity</Button>
        <a
          href={
            base +
            (Object.entries(filters).some(
              ([key, value]) =>
                value && !['from', 'until', 'preset', 'zone'].includes(key),
            )
              ? '?' +
                new URLSearchParams(
                  Object.entries(filters).filter(
                    ([key, value]) =>
                      !!value &&
                      !['from', 'until', 'preset', 'zone'].includes(key),
                  ) as [string, string][],
                ).toString()
              : '') +
            '#activity-heading'
          }
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
        >
          Clear activity dates
        </a>
        {Object.keys(issues).length > 0 && (
          <p role="alert" className="w-full text-sm text-amber-200">
            Check the activity date filters. Holdings and site navigation remain
            available.
          </p>
        )}
      </form>
      {applied.valid && (
        <p className="break-words text-sm text-slate-300">
          Applied range ({context.timeZone}): {formatted(applied.from)}{' '}
          inclusive → {formatted(applied.until)} exclusive. Current holdings do
          not use this range.
        </p>
      )}
    </div>
  );
}

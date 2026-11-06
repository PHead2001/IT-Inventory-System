'use client';
import Link from '@/components/experience/route-link';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useRouteRouter as useRouter } from '@/components/experience/route-pending';
import { useStrictPresentation } from '@/components/experience/strict-presentation';
import { SpringDisclosure } from '@/components/experience/spring-disclosure';
import { PrivateRestorationGate } from '@/components/auth/privacy-readiness';
import type { InventoryColumn } from '../views.server';
import {
  applyPreferences,
  decodeSavedViews,
  emptySavedViews,
  encodeSavedViews,
  inventoryViewParams,
  readViewPreferences,
  savedViewStorageKey,
  columnMappingCsv,
  type SavedViews,
  type ViewPreferences,
} from '../view-preferences';
import { field } from './read-ui';

type Props = {
  params: Record<string, string | undefined>;
  columns: InventoryColumn[];
  truncated: boolean;
  catalogError?: string;
  memberId: string;
  backend: string;
  action?: string;
};
export function InventoryViewControls(props: Props) {
  const scope = savedViewStorageKey(props.memberId, props.backend);
  return (
    <PrivateRestorationGate scope={scope}>
      <Controls key={scope} {...props} storageKey={scope} />
    </PrivateRestorationGate>
  );
}
function Controls({
  params,
  columns,
  truncated,
  catalogError,
  storageKey,
  action = '/inventory',
}: Props & { storageKey: string }) {
  const router = useRouter();
  const host = useRef<HTMLElement>(null);
  const { preferences, error: urlError } = readViewPreferences(params);
  const [saved, setSaved] = useState<SavedViews>(emptySavedViews);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState(params.columnSearch ?? '');
  const restored = useRef(false);
  const defaultConsidered = useRef(false);
  const admitted = useRef(false);
  const revision = useRef(0);
  const check = useRef<() => boolean>(() => false);
  const [admission, setAdmission] = useState(0);
  const withdraw = useCallback(() => {
    if (!admitted.current) return;
    admitted.current = false;
    revision.current++;
    restored.current = false;
    setSaved(emptySavedViews());
    setHydrated(false);
    setName('');
    setSelected('');
    setError('');
  }, []);
  const readmit = useCallback(() => {
    if (!check.current() || admitted.current) return;
    admitted.current = true;
    setAdmission((value) => value + 1);
  }, []);
  const current = useStrictPresentation(host, storageKey, withdraw, readmit);
  useLayoutEffect(() => {
    check.current = current;
    readmit();
    return () => {
      check.current = () => false;
    };
  }, [current, readmit]);
  // A retained handler or queued restore cannot revive after A -> B -> A.
  const ownerRevision = revision.current;
  const owned = useCallback(
    () => current() && admitted.current && revision.current === ownerRevision,
    [current, ownerRevision],
  );
  const signature = inventoryViewParams(params).toString();
  const restorationInput = JSON.stringify(params);
  const [synced, setSynced] = useState(signature);
  if (synced !== signature) {
    setSynced(signature);
    setSearch(params.columnSearch ?? '');
  }
  const navigate = useCallback(
    (query: URLSearchParams, replace = false) => {
      if (!owned()) return;
      if (action.startsWith('/locations/') && params.location)
        query.set('location', params.location);
      // Cancel unsent search typing before this deliberate navigation, including A/B/A.
      window.dispatchEvent(
        new CustomEvent('inventory-view-navigation', {
          detail: query.toString(),
        }),
      );
      const href = action + (query.size ? '?' + query : '');
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [owned, action, params.location, router],
  );
  useEffect(() => {
    if (!admission || !owned() || restored.current) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || !owned() || restored.current) return;
      restored.current = true;
      try {
        const requestedParams: Record<string, string | undefined> =
          JSON.parse(restorationInput);
        const requestedPreferences =
          readViewPreferences(requestedParams).preferences;
        const value = decodeSavedViews(localStorage.getItem(storageKey));
        if (!owned()) return;
        setSaved(value);
        // Restore display preferences once. Explicit URL keys and later Back win.
        if (
          !defaultConsidered.current &&
          !['view', 'density', 'columns'].some(
            (key) => requestedParams[key] !== undefined,
          ) &&
          JSON.stringify(value.preferences) !==
            JSON.stringify(requestedPreferences)
        )
          navigate(applyPreferences(requestedParams, value.preferences), true);
      } catch {
        if (owned())
          setError(
            'Saved views could not be restored in this browser. Current URL settings remain active.',
          );
      } finally {
        if (owned()) {
          defaultConsidered.current = true;
          setHydrated(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [admission, owned, storageKey, restorationInput, navigate]);
  function persist(next: SavedViews) {
    if (!owned() || !hydrated) return false;
    try {
      localStorage.setItem(storageKey, encodeSavedViews(next));
      if (!owned()) return false;
      setSaved(next);
      setError('');
      return true;
    } catch (cause) {
      if (owned())
        setError(
          cause instanceof Error
            ? cause.message
            : 'Saved views could not be stored in this browser.',
        );
      return false;
    }
  }
  function change(next: ViewPreferences) {
    if (!owned() || !hydrated) return;
    persist({ ...saved, preferences: next });
    navigate(applyPreferences(params, next));
  }
  const applied = applyPreferences(params, preferences).toString();
  const selectedView = saved.views.find(
    (entry) =>
      entry.id === selected &&
      new URLSearchParams(entry.params).toString() === applied,
  );
  const shownSelected = selectedView ? selected : '';
  const selectedColumns = preferences.columns.map(
    (id, index) =>
      columns.find((column) => column.id === id) ?? {
        id,
        label: `Unavailable selected field ${index + 1}`,
        category: '',
        type: 'unavailable',
        legacy: true,
        ordinal: null,
      },
  );
  return (
    <section
      ref={host}
      aria-label="Inventory view settings"
      className="experience-surface mb-3 p-3 text-sm"
    >
      {(error || urlError || catalogError) && (
        <p role="alert" className="text-amber-200">
          {urlError ?? (error || catalogError)}
        </p>
      )}
      {urlError && (
        <Link
          href={`${action}?${inventoryViewParams({ ...params, view: undefined, density: undefined, columns: undefined })}`}
          className="text-cyan-300 underline"
        >
          Clear display settings
        </Link>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label>
          View
          <select
            disabled={!hydrated}
            aria-label="Inventory view"
            className={field}
            value={preferences.view}
            onChange={(event) =>
              change({
                ...preferences,
                view: event.target.value as ViewPreferences['view'],
              })
            }
          >
            <option value="items">Items</option>
            <option value="holdings">Holdings</option>
          </select>
        </label>
        <label>
          Density
          <select
            disabled={!hydrated}
            aria-label="Inventory density"
            className={field}
            value={preferences.density}
            onChange={(event) =>
              change({
                ...preferences,
                density: event.target.value as ViewPreferences['density'],
              })
            }
          >
            <option value="comfortable">Comfortable cards</option>
            <option value="compact">Compact table</option>
          </select>
        </label>
        <label>
          Saved view
          <select
            disabled={!hydrated}
            aria-label="Saved inventory view"
            className={field}
            value={shownSelected}
            onChange={(event) => {
              if (!owned() || !hydrated) return;
              const id = event.target.value;
              setSelected(id);
              const view = saved.views.find((entry) => entry.id === id);
              if (view) {
                setName(view.name);
                navigate(new URLSearchParams(view.params));
              }
            }}
          >
            <option value="">Choose a saved view</option>
            {saved.views.map((view) => (
              <option value={view.id} key={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          View name
          <input
            disabled={!hydrated}
            aria-label="View name"
            className={field}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          className="min-h-11 text-cyan-300 underline"
          disabled={
            !hydrated ||
            Boolean(urlError) ||
            !name.trim() ||
            saved.views.length >= 20
          }
          onClick={() => {
            const query = applyPreferences(params, preferences);
            const entry = {
              id: crypto.randomUUID(),
              name: name.trim(),
              params: Object.fromEntries(
                query,
              ) as SavedViews['views'][number]['params'],
            };
            if (
              persist({ ...saved, preferences, views: [...saved.views, entry] })
            )
              setSelected(entry.id);
          }}
        >
          Save view
        </button>
        <button
          className="min-h-11 text-cyan-300 underline"
          disabled={!hydrated || !shownSelected || !name.trim()}
          onClick={() =>
            persist({
              ...saved,
              views: saved.views.map((view) =>
                view.id === selected ? { ...view, name: name.trim() } : view,
              ),
            })
          }
        >
          Rename view
        </button>
        <button
          className="min-h-11 text-[var(--danger)] underline"
          aria-label={
            selectedView ? `Remove view ${selectedView.name}` : 'Remove view'
          }
          disabled={!hydrated || !shownSelected}
          onClick={() => {
            if (
              persist({
                ...saved,
                views: saved.views.filter((view) => view.id !== selected),
              })
            ) {
              setSelected('');
              setName('');
            }
          }}
        >
          Remove view
        </button>
      </div>
      <SpringDisclosure
        className="mt-2"
        summary={`Custom columns (${preferences.columns.length}/6)`}
        summaryProps={{ className: 'min-h-11 cursor-pointer py-3' }}
      >
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const query = inventoryViewParams(params);
            if (search.trim())
              query.set('columnSearch', search.trim().slice(0, 200));
            else query.delete('columnSearch');
            navigate(query);
          }}
        >
          <label className="min-w-0 flex-1">
            Find a published field
            <input
              className={field}
              maxLength={200}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button className="min-h-11 text-cyan-300 underline">
            Find fields
          </button>
        </form>
        {truncated && (
          <p role="status">
            Showing the first 200 matching fields. Refine the field name or
            category search; selected fields remain available.
          </p>
        )}
        <fieldset className="mt-2 grid gap-1 sm:grid-cols-2">
          <legend>Select up to six fields by identity</legend>
          {[
            ...selectedColumns,
            ...columns.filter(
              (column) => !preferences.columns.includes(column.id),
            ),
          ].map((column) => (
            <label
              key={column.id}
              className="flex min-h-11 items-center gap-2 [overflow-wrap:anywhere]"
            >
              <input
                type="checkbox"
                checked={preferences.columns.includes(column.id)}
                disabled={
                  !hydrated ||
                  (!preferences.columns.includes(column.id) &&
                    preferences.columns.length >= 6)
                }
                onChange={(event) =>
                  change({
                    ...preferences,
                    columns: event.target.checked
                      ? [...preferences.columns, column.id]
                      : preferences.columns.filter((id) => id !== column.id),
                  })
                }
              />
              {column.label}
              {column.category ? ` · ${column.category}` : ''}
              {column.ordinal ? ` (${column.ordinal})` : ''}
              {column.legacy ? ' · historical field' : ''}
            </label>
          ))}
        </fieldset>
      </SpringDisclosure>
      <button
        disabled={Boolean(urlError) || !selectedColumns.length}
        className="min-h-11 text-cyan-300 underline"
        onClick={() => {
          if (!owned() || !hydrated) return;
          const url = URL.createObjectURL(
            new Blob([columnMappingCsv(selectedColumns)], {
              type: 'text/csv;charset=utf-8',
            }),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'inventory-display-columns.csv';
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }}
      >
        Download display column mapping
      </button>
      <p className="mt-2 text-xs text-slate-400">
        Personal browser views contain filters and display settings only. CSV
        exports matching holdings rows, including all matching locations and
        sites. Display column mapping identifies your selected fields; it does
        not change the inventory CSV.
      </p>
    </section>
  );
}

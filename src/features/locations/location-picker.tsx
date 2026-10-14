'use client';
import { afterTransitionCapture } from '@/components/forms/transition-capture';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import {
  InventoryCaptureGroup,
  InventoryCaptureRegionsContext,
} from '@/components/experience/inventory-capture-region';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  freshPresentationGrant,
  retainedPresentationGrantCurrent,
} from '@/components/experience/presentation-privacy';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  subscribePrivacyRevocation,
  subscribeAssignmentInvalidation,
  subscribeAuthoritativeCleanup,
} from '@/features/scan/assign-batch';
import { RoomRegionBoundary } from '../room/room-region-boundary';
import { RequiredMark } from '@/components/forms/validation';
import { countLabel } from '@/lib/count';
import { pickerPosition } from './picker-position';
import type { LocationRef } from '../inventory/contracts-ui';
import {
  locationAncestorIds,
  pickerLocations,
  pickerTree,
  pickerValue,
  visiblePickerTree,
  type PickerMode,
  type PickerTreeRow,
} from './picker-model';
type MapIntent = {
  generation: string;
  revision: number;
  epoch: number;
  retired(): boolean;
  retire(): void;
};
function intentBindingCurrent(
  intent: MapIntent | null,
  privacy: ReturnType<typeof usePrivacyReadiness>,
) {
  return Boolean(
    intent &&
    !intent.retired() &&
    intent.generation === privacy.generation &&
    intent.revision === readPrivacyRevocationRevision() &&
    intent.epoch === assignmentEpoch() &&
    (privacy.generation === 'unmanaged' ||
      retainedPresentationGrantCurrent(privacy, intent)),
  );
}
const MapLoadingContext = createContext<{ cancel(): void }>({
  cancel: () => {},
});
function MapLoadingFeedback() {
  const { cancel } = useContext(MapLoadingContext);
  return (
    <div aria-busy="true" className="rounded-md border border-slate-600 p-3">
      <p role="status" aria-live="polite">
        Loading map… Your form draft remains available.
      </p>
      <button
        type="button"
        onClick={cancel}
        className="min-h-11 text-cyan-300 underline"
      >
        Cancel map loading
      </button>
    </div>
  );
}
const LocationMapPicker = dynamic(() => import('./location-map-picker'), {
  ssr: false,
  loading: () => <MapLoadingFeedback />,
});

export type LocationPickerProps = {
  mapEnabled?: boolean;
  locations: LocationRef[];
  mode: PickerMode;
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  excludeIds?: string[];
  sourceIds?: string[];
  /** Current item balances for source options; omitted counts remain unknown. */
  availability?: Record<string, number>;
  allowAll?: boolean;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  loading?: boolean;
  loadError?: string;
  description?: string;
  className?: string;
};

export function LocationPicker({
  mapEnabled = true,
  locations,
  mode,
  label,
  value,
  defaultValue = '',
  onValueChange,
  name,
  id,
  excludeIds,
  sourceIds,
  availability,
  allowAll = false,
  emptyLabel = 'All locations',
  required = false,
  disabled = false,
  error,
  loading = false,
  loadError,
  description,
  className = '',
}: LocationPickerProps) {
  const privacy = usePrivacyReadiness();
  const [mapIntent, setMapIntent] = useState<MapIntent | null>(null);
  const [mountedIntent, setMountedIntent] = useState<MapIntent | null>(null);
  const mapIntentRef = useRef<MapIntent | null>(null);
  const latestPrivacy = useRef(privacy);
  const emptyAccessibleLabel =
    emptyLabel === 'All locations'
      ? 'All locations, no location filter'
      : emptyLabel;
  const stockLabel = (location: LocationRef | null | undefined) =>
    location && availability && Object.hasOwn(availability, location.id)
      ? `${countLabel(availability[location.id], 'unit')} available`
      : '';
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const searchId = controlId + '-search';
  const listId = controlId + '-results';
  const messageId = controlId + '-message';
  const [localValue, setLocalValue] = useState(defaultValue);
  const selectedValue = value === undefined ? localValue : value;
  const [open, setOpen] = useState(false);
  const [wasDisabled, setWasDisabled] = useState(disabled);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    if (disabled) {
      setOpen(false);
      setQuery('');
      setActiveIndex(0);
    }
  }
  const visibleOpen = open && !disabled;
  const [panelPosition, setPanelPosition] = useState({
    left: 16,
    top: 16,
    width: 320,
    height: 416,
  });
  const [mobileViewport, setMobileViewport] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const intentCurrent = useCallback(
    (intent: MapIntent | null, candidate = latestPrivacy.current) =>
      mapIntentRef.current === intent &&
      intentBindingCurrent(intent, candidate),
    [],
  );
  const retireIntent = useCallback(
    (intent: MapIntent | null, restoreFocus = false) => {
      if (!intent || mapIntentRef.current !== intent) return;
      const candidate = latestPrivacy.current;
      const focus =
        restoreFocus &&
        intentCurrent(intent) &&
        (candidate.generation === 'unmanaged' ||
          freshPresentationGrant(candidate));
      intent.retire();
      mapIntentRef.current = null;
      setMapIntent(null);
      if (focus) triggerRef.current?.focus();
    },
    [intentCurrent],
  );
  useLayoutEffect(() => {
    latestPrivacy.current = privacy;
    const intent = mapIntentRef.current;
    if (
      intent &&
      (intent.generation !== privacy.generation ||
        intent.revision !== readPrivacyRevocationRevision() ||
        intent.epoch !== assignmentEpoch())
    )
      retireIntent(intent);
  }, [privacy, retireIntent]);
  useInsertionEffect(() => {
    const retire = () => retireIntent(mapIntentRef.current);
    const remove = [
      subscribePrivacyRevocation(retire),
      subscribeAssignmentInvalidation(retire),
      subscribeAuthoritativeCleanup(retire),
    ];
    return () => {
      mapIntentRef.current?.retire();
      mapIntentRef.current = null;
      remove.forEach((unsubscribe) => unsubscribe());
    };
  }, [retireIntent]);
  const mapVisible = intentBindingCurrent(mapIntent, privacy);
  const mapFresh =
    privacy.generation === 'unmanaged' || freshPresentationGrant(privacy);

  const hasOpenedRef = useRef(false);
  const expandedSelectedPathRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(
    () => pickerLocations(locations, mode, { excludeIds, sourceIds, query }),
    [locations, mode, excludeIds, sourceIds, query],
  );
  const options = allowAll && !query.trim() ? [null, ...entries] : entries;
  const searching = Boolean(query.trim());
  const treeRows = useMemo(
    () => pickerTree(locations, mode, { excludeIds, sourceIds }),
    [locations, mode, excludeIds, sourceIds],
  );
  const visibleTree = visiblePickerTree(treeRows, expanded);
  const treeItems: (PickerTreeRow | null)[] = allowAll
    ? [null, ...visibleTree]
    : visibleTree;
  const activeTreeStillVisible = treeItems.some(
    (row) => (row?.location.id ?? 'all') === activeTreeId,
  );
  // A refreshed hierarchy or eligibility set can remove the active row. Keep
  // initial null focus uncommitted, but redirect a stale active row to a visible one.
  const effectiveActiveTreeId =
    activeTreeId === null || activeTreeStillVisible
      ? activeTreeId
      : (visibleTree[0]?.location.id ?? null);
  useEffect(() => {
    if (!visibleOpen) return;
    const selectedRow = treeRows.find(
      (row) =>
        row.selectable && pickerValue(row.location, mode) === selectedValue,
    );
    const ancestors = selectedRow
      ? locationAncestorIds(selectedRow.location, locations)
      : [];
    const pathSignature = selectedRow
      ? [mode, selectedValue, selectedRow.location.id, ...ancestors].join('|')
      : null;
    const firstAvailableTree = !hasOpenedRef.current && treeRows.length > 0;
    const newSelectedPath = Boolean(
      pathSignature && pathSignature !== expandedSelectedPathRef.current,
    );
    if (firstAvailableTree || newSelectedPath)
      setExpanded(
        (current) =>
          new Set([
            ...current,
            ...(firstAvailableTree
              ? treeRows
                  .filter((row) => row.depth === 0 && row.hasChildren)
                  .map((row) => row.location.id)
              : []),
            ...(newSelectedPath ? ancestors : []),
          ]),
      );
    if (firstAvailableTree) hasOpenedRef.current = true;
    expandedSelectedPathRef.current = pathSignature;
  }, [visibleOpen, treeRows, selectedValue, mode, locations]);
  const activeTreeIndex = treeItems.findIndex(
    (row) => (row?.location.id ?? 'all') === effectiveActiveTreeId,
  );
  // DOM selectors can be included in performance attribution. Keep record IDs
  // in React/state only; the rendered tree IDs use local visible ordinals.
  const treeDomId = (locationId: string) =>
    listId +
    '-tree-' +
    treeItems.findIndex((row) => (row?.location.id ?? 'all') === locationId);
  useEffect(() => {
    if (
      visibleOpen &&
      !searching &&
      activeTreeId !== null &&
      !activeTreeStillVisible &&
      document.activeElement === document.body
    )
      return afterTransitionCapture(document, () => {
        if (document.activeElement === document.body)
          searchRef.current?.focus();
      });
  }, [visibleOpen, searching, activeTreeId, activeTreeStillVisible]);
  const activeOptionIndex = Math.min(activeIndex, options.length - 1);
  const selected = locations.find(
    (location) => pickerValue(location, mode) === selectedValue,
  );
  const eligible =
    selectedValue === ''
      ? !required || allowAll
      : entries.some(
          (location) => pickerValue(location, mode) === selectedValue,
        ) ||
        // A search query changes visible results, not the selected value's validity.
        pickerLocations(locations, mode, { excludeIds, sourceIds }).some(
          (location) => pickerValue(location, mode) === selectedValue,
        );
  const unavailable = Boolean(selectedValue && !eligible);
  const validationMessage =
    error ||
    (unavailable
      ? 'Selected location is unavailable. Choose another location.'
      : '');

  useEffect(() => {
    if (!visibleOpen) return;
    const cancelFocus = afterTransitionCapture(document, () =>
      searchRef.current?.focus(),
    );
    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => {
      cancelFocus();
      document.removeEventListener('pointerdown', outside);
    };
  }, [visibleOpen]);
  useEffect(() => {
    if (!visibleOpen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    function fitKeyboard() {
      setMobileViewport({
        top: viewport.offsetTop + 12,
        height: Math.max(1, viewport.height - 24),
      });
    }
    fitKeyboard();
    viewport.addEventListener('resize', fitKeyboard);
    viewport.addEventListener('scroll', fitKeyboard);
    return () => {
      viewport.removeEventListener('resize', fitKeyboard);
      viewport.removeEventListener('scroll', fitKeyboard);
    };
  }, [visibleOpen]);
  useEffect(() => {
    const id = searching
      ? activeOptionIndex >= 0
        ? listId + '-' + activeOptionIndex
        : null
      : activeTreeIndex >= 0
        ? listId + '-tree-' + activeTreeIndex
        : null;
    if (visibleOpen && id)
      document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionIndex, activeTreeIndex, listId, searching, visibleOpen]);
  useEffect(() => {
    if (!visibleOpen) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPosition(
        pickerPosition(
          rect,
          rootRef.current?.getBoundingClientRect().top ?? rect.top,
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [visibleOpen]);

  function close(returnFocus = false) {
    if (returnFocus) triggerRef.current?.focus();
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    setActiveTreeId(null);
  }
  function choose(next: string) {
    if (disabled || !visibleOpen) return;
    if (next === selectedValue) {
      close(true);
      return;
    }
    if (value === undefined) setLocalValue(next);
    onValueChange?.(next);
    close(true);
  }
  function openPicker() {
    if (disabled) return;
    const available = pickerLocations(locations, mode, {
      excludeIds,
      sourceIds,
    });
    const selectedIndex = selectedValue
      ? available.findIndex(
          (location) => pickerValue(location, mode) === selectedValue,
        )
      : -1;
    setQuery('');
    const selectedLocation = available.find(
      (location) => pickerValue(location, mode) === selectedValue,
    );
    const selectedAncestors = selectedLocation
      ? locationAncestorIds(selectedLocation, locations)
      : [];
    setExpanded(
      (current) =>
        new Set([
          ...current,
          ...(!hasOpenedRef.current
            ? treeRows
                .filter((row) => row.depth === 0 && row.hasChildren)
                .map((row) => row.location.id)
            : []),
          ...selectedAncestors,
        ]),
    );
    expandedSelectedPathRef.current = selectedLocation
      ? [mode, selectedValue, selectedLocation.id, ...selectedAncestors].join(
          '|',
        )
      : null;
    if (treeRows.length) hasOpenedRef.current = true;
    setActiveTreeId(
      selectedLocation?.id ?? (selectedValue ? null : allowAll ? 'all' : null),
    );
    setActiveIndex(
      selectedValue
        ? selectedIndex < 0
          ? -1
          : selectedIndex + (allowAll ? 1 : 0)
        : allowAll
          ? 0
          : -1,
    );
    setOpen(true);
  }
  function focusTreeIndex(nextIndex: number, focusRow = false) {
    if (!treeItems.length) return;
    const nextId =
      treeItems[Math.max(0, Math.min(treeItems.length - 1, nextIndex))]
        ?.location.id ?? 'all';
    setActiveTreeId(nextId);
    if (focusRow) document.getElementById(treeDomId(nextId))?.focus();
  }
  function moveTree(direction: number, focusRow = false) {
    focusTreeIndex(activeTreeIndex + direction, focusRow);
  }
  function expandRow(row: PickerTreeRow, next: boolean) {
    if (
      !next &&
      activeTreeId !== row.location.id &&
      treeRows.some(
        (item) =>
          item.location.id === activeTreeId &&
          locationAncestorIds(item.location, locations).includes(
            row.location.id,
          ),
      )
    )
      setActiveTreeId(row.location.id);
    setExpanded((current) => {
      const updated = new Set(current);
      if (next) updated.add(row.location.id);
      else updated.delete(row.location.id);
      return updated;
    });
  }
  function activateTree(row: PickerTreeRow | null) {
    if (!row) return choose('');
    if (row.selectable) choose(pickerValue(row.location, mode));
    else if (row.hasChildren) expandRow(row, !expanded.has(row.location.id));
  }
  function treeKey(event: React.KeyboardEvent, row: PickerTreeRow | null) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTree(
        event.key === 'ArrowDown' ? 1 : -1,
        event.currentTarget !== searchRef.current,
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusTreeIndex(
        event.key === 'Home' ? 0 : treeItems.length - 1,
        event.currentTarget !== searchRef.current,
      );
    } else if (event.key === 'ArrowRight' && row?.hasChildren) {
      event.preventDefault();
      if (!expanded.has(row.location.id)) expandRow(row, true);
      else moveTree(1, event.currentTarget !== searchRef.current);
    } else if (event.key === 'ArrowLeft' && row) {
      event.preventDefault();
      if (row.hasChildren && expanded.has(row.location.id))
        expandRow(row, false);
      else if (row.parentId) {
        setActiveTreeId(row.parentId);
        if (event.currentTarget !== searchRef.current)
          document.getElementById(treeDomId(row.parentId))?.focus();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!loading && !loadError && row) activateTree(row);
      else if (
        !loading &&
        !loadError &&
        effectiveActiveTreeId === 'all' &&
        allowAll
      )
        choose('');
    }
  }
  function searchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled || !visibleOpen) return;
    if (!searching) {
      treeKey(event, activeTreeIndex < 0 ? null : treeItems[activeTreeIndex]);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(
        Math.max(
          0,
          Math.min(
            options.length - 1,
            activeOptionIndex + (event.key === 'ArrowDown' ? 1 : -1),
          ),
        ),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!loading && !loadError && options[activeOptionIndex] !== undefined)
        choose(
          options[activeOptionIndex]?.[mode === 'browse' ? 'code' : 'id'] ?? '',
        );
    }
  }

  return (
    <div
      ref={rootRef}
      onKeyDownCapture={(event) => {
        if (visibleOpen && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        if (
          visibleOpen &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close();
      }}
      className={'relative min-w-0 space-y-2 ' + className}
    >
      <InventoryCaptureGroup
        region={mode === 'source' ? 'picker-source' : 'picker-destination'}
        className="space-y-2"
      >
        <label
          htmlFor={controlId}
          className="block text-sm font-medium text-slate-100"
        >
          {label}
          {required && <RequiredMark />}
        </label>
        {description && <p className="text-xs text-slate-400">{description}</p>}
        <button
          ref={triggerRef}
          id={controlId}
          aria-label={label}
          type="button"
          role={visibleOpen ? undefined : 'combobox'}
          disabled={disabled}
          aria-haspopup={searching ? 'listbox' : 'tree'}
          aria-required={visibleOpen ? undefined : required}
          aria-expanded={visibleOpen}
          aria-controls={visibleOpen ? listId : undefined}
          aria-invalid={visibleOpen ? undefined : Boolean(validationMessage)}
          aria-describedby={validationMessage ? messageId : undefined}
          onClick={() => (visibleOpen ? close() : openPicker())}
          onKeyDown={(event) => {
            if (
              !visibleOpen &&
              (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
              event.preventDefault();
              openPicker();
            }
          }}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-left text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:opacity-50"
        >
          <span className="min-w-0">
            <span className="block font-medium">
              {selected?.name ??
                (selectedValue
                  ? mode === 'browse'
                    ? selectedValue
                    : 'Unavailable location'
                  : allowAll
                    ? emptyLabel
                    : 'Select a location')}
            </span>
            {unavailable && (
              <span className="block text-xs text-amber-200">Unavailable</span>
            )}
          </span>
          <span aria-hidden="true" className="shrink-0 text-xs text-slate-400">
            {selected?.code ?? '⌄'}
          </span>
        </button>
        {name && <input type="hidden" name={name} value={selectedValue} />}
        {mode === 'destination' && mapEnabled && (
          <button
            type="button"
            className="min-h-11 text-sm text-cyan-300 underline disabled:opacity-50"
            disabled={disabled || loading || Boolean(loadError)}
            onClick={() => {
              close();
              const activation = latestPrivacy.current;
              const unmanaged = activation.generation === 'unmanaged';
              if (!unmanaged && !freshPresentationGrant(activation)) return;
              let retired = false;
              const intent: MapIntent = {
                generation: activation.generation,
                revision: unmanaged
                  ? readPrivacyRevocationRevision()
                  : activation.revocationRevision!,
                epoch: unmanaged
                  ? assignmentEpoch()
                  : activation.verifiedEpoch!,
                retired: () => retired,
                retire: () => {
                  retired = true;
                },
              };
              mapIntentRef.current?.retire();
              mapIntentRef.current = intent;
              setMountedIntent(null);
              setMapIntent(intent);
            }}
          >
            Pick on map
          </button>
        )}
      </InventoryCaptureGroup>
      {mapVisible && mapIntent && (
        <InventoryCaptureRegionsContext value={null}>
          <MapLoadingContext
            value={{
              cancel: () => retireIntent(mapIntent, true),
            }}
          >
            <RoomRegionBoundary
              fallback={
                <p role="status" className="text-sm">
                  Map unavailable. Choose a location in the browser.
                </p>
              }
            >
              {mountedIntent === mapIntent || mapFresh ? (
                <LocationMapPicker
                  locations={locations}
                  excludeIds={excludeIds}
                  disabled={disabled || loading || Boolean(loadError)}
                  initialValue={selectedValue}
                  onMounted={() => {
                    if (
                      intentCurrent(mapIntent, privacy) &&
                      (privacy.generation === 'unmanaged' ||
                        freshPresentationGrant(privacy))
                    )
                      setMountedIntent(mapIntent);
                  }}
                  onClose={() => retireIntent(mapIntent, true)}
                  onUse={(code) => {
                    if (
                      !intentCurrent(mapIntent) ||
                      disabled ||
                      loading ||
                      loadError ||
                      (latestPrivacy.current.generation !== 'unmanaged' &&
                        !freshPresentationGrant(latestPrivacy.current))
                    )
                      return;
                    // Resolve from the latest complete eligibility model only at explicit confirmation.
                    const destination = pickerLocations(
                      locations,
                      'destination',
                      {
                        excludeIds,
                      },
                    ).find((location) => location.code === code);
                    if (!destination) return;
                    if (value === undefined) setLocalValue(destination.id);
                    onValueChange?.(destination.id);
                    retireIntent(mapIntent, true);
                  }}
                />
              ) : (
                <MapLoadingFeedback />
              )}
            </RoomRegionBoundary>
          </MapLoadingContext>
        </InventoryCaptureRegionsContext>
      )}
      {(validationMessage || visibleOpen) && (
        <InventoryCaptureGroup
          region={
            mode === 'source'
              ? 'picker-browser-source'
              : 'picker-browser-destination'
          }
          className="space-y-2"
        >
          {validationMessage && (
            <p id={messageId} role="alert" className="text-sm text-amber-200">
              {validationMessage}
            </p>
          )}
          {visibleOpen && (
            <div
              style={
                {
                  '--picker-left': panelPosition.left + 'px',
                  '--picker-top': panelPosition.top + 'px',
                  '--picker-width': panelPosition.width + 'px',
                  '--picker-height': panelPosition.height + 'px',
                  '--picker-mobile-top': mobileViewport
                    ? mobileViewport.top + 'px'
                    : '0.75rem',
                  '--picker-mobile-height': mobileViewport
                    ? mobileViewport.height + 'px'
                    : 'calc(100dvh - 1.5rem)',
                } as React.CSSProperties
              }
              className="fixed inset-x-3 top-[var(--picker-mobile-top)] z-50 flex h-[var(--picker-mobile-height)] min-h-0 flex-col rounded-lg border border-slate-600 bg-slate-950 p-3 shadow-2xl sm:inset-auto sm:left-[var(--picker-left)] sm:top-[var(--picker-top)] sm:h-[var(--picker-height)] sm:w-[var(--picker-width)]"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Choose location</span>
                <button
                  type="button"
                  onClick={() => close(true)}
                  className="min-h-11 min-w-11 rounded text-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-400"
                  aria-label="Close location picker"
                >
                  Close
                </button>
              </div>
              <input
                ref={searchRef}
                id={searchId}
                type="search"
                role="combobox"
                value={query}
                autoComplete="off"
                placeholder="Search name, code or area"
                aria-label="Search locations"
                aria-expanded="true"
                aria-haspopup={searching ? 'listbox' : 'tree'}
                aria-autocomplete={searching ? 'list' : 'none'}
                aria-controls={listId}
                aria-activedescendant={
                  loading || loadError
                    ? undefined
                    : searching
                      ? activeOptionIndex >= 0
                        ? listId + '-' + activeOptionIndex
                        : undefined
                      : activeTreeIndex >= 0
                        ? listId + '-tree-' + activeTreeIndex
                        : undefined
                }
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={searchKey}
                className="min-h-11 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100 outline-none focus-visible:border-cyan-400"
              />
              <div
                id={listId}
                role={searching ? 'listbox' : 'tree'}
                aria-label={label}
                className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded border border-slate-800"
                style={{
                  scrollbarColor:
                    'var(--color-slate-600) var(--color-slate-950)',
                  scrollbarWidth: 'auto',
                }}
              >
                {loading && (
                  <p role="status" className="p-3 text-sm text-slate-300">
                    Loading locations…
                  </p>
                )}
                {loadError && (
                  <p role="alert" className="p-3 text-sm text-amber-200">
                    {loadError}
                  </p>
                )}
                {!loading &&
                  !loadError &&
                  (searching
                    ? options.length === 0
                    : treeItems.length === 0) && (
                    <p role="status" className="p-3 text-sm text-slate-300">
                      No matching locations.
                    </p>
                  )}
                {!loading &&
                  !loadError &&
                  (searching ? options : []).map((location, index) => {
                    const optionValue = location
                      ? pickerValue(location, mode)
                      : '';
                    return (
                      <div key={location?.id ?? 'all'} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-label={
                            location
                              ? `${location.name}, ${location.breadcrumb}, ${location.code}${stockLabel(location) ? ', ' + stockLabel(location) : ''}`
                              : emptyAccessibleLabel
                          }
                          id={listId + '-' + index}
                          aria-selected={selectedValue === optionValue}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => choose(optionValue)}
                          className={
                            'flex min-h-11 w-full items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-left text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-cyan-400 ' +
                            (index === activeOptionIndex ? 'bg-slate-800 ' : '')
                          }
                        >
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-100">
                              {location?.name ?? emptyLabel}
                              {selectedValue === optionValue ? ' ✓' : ''}
                            </span>
                            <span className="block break-words text-xs text-slate-400">
                              {location?.breadcrumb ??
                                (emptyLabel === 'All locations'
                                  ? 'No location filter'
                                  : emptyLabel)}
                            </span>
                            {stockLabel(location) && (
                              <span className="block text-sm text-slate-300">
                                {stockLabel(location)}
                              </span>
                            )}
                          </span>
                          {location && (
                            <span className="experience-code shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-400">
                              {location.code}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                {!loading &&
                  !loadError &&
                  !searching &&
                  treeItems.map((row, index) => {
                    const location = row?.location;
                    const rowId = location?.id ?? 'all';
                    const isNavigation = Boolean(row && !row.selectable);
                    const isGroup = Boolean(
                      row && (!row.location.can_hold_inventory || isNavigation),
                    );
                    const siblings = row
                      ? treeRows.filter(
                          (item) => item.parentId === row.parentId,
                        )
                      : treeRows.filter((item) => item.parentId === null);
                    const rootOffset =
                      allowAll && (!row || row.parentId === null) ? 1 : 0;
                    const selectedRow =
                      (!row || row.selectable) &&
                      selectedValue ===
                        (location ? pickerValue(location, mode) : '') &&
                      Boolean(location || allowAll);
                    const isExpanded = Boolean(row && expanded.has(rowId));
                    return (
                      <div
                        key={rowId}
                        role="presentation"
                        className="relative border-b border-slate-800"
                      >
                        <button
                          type="button"
                          role="treeitem"
                          id={listId + '-tree-' + index}
                          aria-level={row ? row.depth + 1 : 1}
                          aria-posinset={
                            row
                              ? siblings.findIndex(
                                  (item) => item.location.id === rowId,
                                ) +
                                1 +
                                rootOffset
                              : 1
                          }
                          aria-setsize={siblings.length + rootOffset}
                          aria-expanded={
                            row?.hasChildren ? isExpanded : undefined
                          }
                          aria-selected={
                            row?.selectable || !row ? selectedRow : undefined
                          }
                          aria-label={
                            location
                              ? `${location.name}, ${isNavigation ? 'navigation group' : isGroup ? 'selectable group' : 'selectable location'}, ${location.code}${!isNavigation && stockLabel(location) ? ', ' + stockLabel(location) : ''}`
                              : emptyAccessibleLabel
                          }
                          tabIndex={
                            effectiveActiveTreeId === rowId ||
                            (effectiveActiveTreeId === null &&
                              treeItems[0] === row)
                              ? 0
                              : -1
                          }
                          onMouseEnter={() => setActiveTreeId(rowId)}
                          onFocus={() => setActiveTreeId(rowId)}
                          onKeyDown={(event) => treeKey(event, row)}
                          onClick={(event) => {
                            setActiveTreeId(rowId);
                            if (
                              row?.hasChildren &&
                              (event.target as HTMLElement).closest(
                                '[data-disclosure]',
                              )
                            )
                              expandRow(row, !isExpanded);
                            else activateTree(row);
                          }}
                          style={{
                            paddingLeft: `${12 + (row?.depth ?? 0) * 16}px`,
                          }}
                          className={
                            'flex min-h-11 w-full items-center gap-2 py-2 pr-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-cyan-400 hover:bg-slate-800 ' +
                            (effectiveActiveTreeId === rowId
                              ? 'bg-slate-800 '
                              : '') +
                            (isGroup
                              ? 'bg-slate-900/70 text-slate-300 '
                              : 'text-slate-100 ')
                          }
                        >
                          <span
                            data-disclosure={row?.hasChildren ? '' : undefined}
                            aria-hidden="true"
                            className={
                              'flex size-7 shrink-0 items-center justify-center rounded ' +
                              (row?.hasChildren
                                ? 'border border-slate-600 text-cyan-300'
                                : 'text-slate-500')
                            }
                          >
                            {row?.hasChildren ? (isExpanded ? '⌄' : '›') : '·'}
                          </span>
                          <span className="min-w-0 flex-1 font-medium break-words">
                            {location?.name ?? emptyLabel}
                            {selectedRow ? ' ✓' : ''}
                            {!isNavigation && stockLabel(location) && (
                              <span className="block text-sm font-normal text-slate-300">
                                {stockLabel(location)}
                              </span>
                            )}
                            {isGroup && (
                              <span className="ml-2 text-xs font-normal text-slate-400">
                                {row?.destinationCount}{' '}
                                {mode === 'browse'
                                  ? 'nested locations'
                                  : 'eligible locations'}
                              </span>
                            )}
                          </span>
                          {location && (
                            <span className="experience-code shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-400">
                              {location.code}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </InventoryCaptureGroup>
      )}
    </div>
  );
}

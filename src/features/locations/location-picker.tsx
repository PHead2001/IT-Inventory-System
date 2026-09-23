'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LocationRef } from '../inventory/contracts-ui';
import {
  locationContext,
  pickerLocations,
  pickerValue,
  type PickerMode,
} from './picker-model';

export type LocationPickerProps = {
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
  allowAll?: boolean;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  loading?: boolean;
  loadError?: string;
  description?: string;
  className?: string;
};

export function LocationPicker({
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
  allowAll = false,
  required = false,
  disabled = false,
  error,
  loading = false,
  loadError,
  description,
  className = '',
}: LocationPickerProps) {
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
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    if (disabled) {
      setOpen(false);
      setQuery('');
      setActiveIndex(0);
    }
  }
  const visibleOpen = open && !disabled;
  const [panelPosition, setPanelPosition] = useState({ left: 16, top: 16 });
  const [mobileViewport, setMobileViewport] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(
    () => pickerLocations(locations, mode, { excludeIds, sourceIds, query }),
    [locations, mode, excludeIds, sourceIds, query],
  );
  const options = allowAll && !query.trim() ? [null, ...entries] : entries;
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
    searchRef.current?.focus();
    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
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
    if (visibleOpen && activeOptionIndex >= 0)
      document
        .getElementById(listId + '-' + activeOptionIndex)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionIndex, listId, visibleOpen]);
  useEffect(() => {
    if (!visibleOpen) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(384, window.innerWidth - 32);
      const height = Math.min(416, window.innerHeight * 0.65);
      setPanelPosition({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        top: Math.max(
          16,
          Math.min(rect.bottom + 4, window.innerHeight - height - 16),
        ),
      });
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
  function searchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled || !visibleOpen) return;
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

  let previousContext = '';
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
      <label
        htmlFor={controlId}
        className="block text-sm font-medium text-slate-100"
      >
        {label}
      </label>
      {description && <p className="text-xs text-slate-400">{description}</p>}
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        role={visibleOpen ? undefined : 'combobox'}
        disabled={disabled}
        aria-haspopup="listbox"
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
              (selectedValue ||
                (allowAll ? 'All locations' : 'Select a location'))}
          </span>
          {selected && (
            <span className="block break-words text-xs text-slate-400">
              {locationContext(selected)}
            </span>
          )}
          {unavailable && (
            <span className="block text-xs text-amber-200">Unavailable</span>
          )}
        </span>
        <span aria-hidden="true" className="shrink-0 text-cyan-300">
          {selected?.code ?? '⌄'}
        </span>
      </button>
      {name && <input type="hidden" name={name} value={selectedValue} />}
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
              '--picker-mobile-top': mobileViewport
                ? mobileViewport.top + 'px'
                : '0.75rem',
              '--picker-mobile-height': mobileViewport
                ? mobileViewport.height + 'px'
                : 'calc(100dvh - 1.5rem)',
            } as React.CSSProperties
          }
          className="fixed inset-x-3 top-[var(--picker-mobile-top)] z-50 flex h-[var(--picker-mobile-height)] min-h-0 flex-col rounded-lg border border-slate-600 bg-slate-950 p-3 shadow-2xl sm:inset-auto sm:left-[var(--picker-left)] sm:top-[var(--picker-top)] sm:h-auto sm:max-h-[min(26rem,65dvh)] sm:w-[min(24rem,calc(100vw-2rem))]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              Choose {label.toLocaleLowerCase()}
            </span>
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
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={
              !loading && !loadError && activeOptionIndex >= 0
                ? listId + '-' + activeOptionIndex
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
            role="listbox"
            aria-label={label}
            className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded border border-slate-800"
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
            {!loading && !loadError && options.length === 0 && (
              <p role="status" className="p-3 text-sm text-slate-300">
                No matching locations.
              </p>
            )}
            {!loading &&
              !loadError &&
              options.map((location, index) => {
                const context = location ? locationContext(location) : '';
                const showGroup = Boolean(
                  context && context !== previousContext,
                );
                previousContext = context;
                const optionValue = location ? pickerValue(location, mode) : '';
                return (
                  <div key={location?.id ?? 'all'} role="presentation">
                    {showGroup && (
                      <div
                        aria-hidden="true"
                        className="sticky top-0 border-y border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300"
                      >
                        {context}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-label={
                        location
                          ? `${location.name}, ${context || 'Root location'}, ${location.code}`
                          : 'All locations, no location filter'
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
                          {location?.name ?? 'All locations'}
                          {selectedValue === optionValue ? ' ✓' : ''}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {context.split(' / ').at(-1) ||
                            (location ? 'Root location' : 'No location filter')}
                        </span>
                      </span>
                      {location && (
                        <span className="shrink-0 rounded bg-slate-800 px-2 py-1 text-xs text-cyan-200">
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
    </div>
  );
}

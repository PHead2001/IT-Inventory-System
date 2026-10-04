'use client';
import { useId, useMemo, useState } from 'react';
import { buildOptionIndex, type Field } from './designer-model';

const input =
  'min-h-10 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm';
const PAGE = 50;
export type ChoicePickerProps = {
  options: Field['options'];
  type: Field['type'];
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  historicalLabel?: string;
};

/** Answers are canonical IDs. Selecting a different branch replaces the entire answer. */
export function ChoicePicker({
  options,
  type,
  value,
  onChange,
  label,
  id,
  describedBy,
  invalid,
  disabled,
  historicalLabel,
}: ChoicePickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const index = useMemo(() => buildOptionIndex(options), [options]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const multiple = type === 'multi_select';
  const hierarchy = type === 'hierarchical_select';
  const selected = multiple
    ? Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
    : typeof value === 'string' && value
      ? [value]
      : [];
  const selectedSet = new Set(selected);
  const path = (optionId: string) =>
    index.paths.get(optionId) ??
    historicalLabel ??
    'Previously selected option';
  const available = options.filter(
    (option) => option.active && index.paths.get(option.id) !== null,
  );
  const large = options.length > PAGE;
  const treeOrder = useMemo(() => {
    if (!hierarchy) return options;
    const ordered: Field['options'] = [];
    const seen = new Set<string>();
    const visit = (parent: string | null) => {
      for (const option of index.children.get(parent) ?? []) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        ordered.push(option);
        visit(option.id);
      }
    };
    visit(null);
    return ordered;
  }, [hierarchy, options, index]);
  const ordered = treeOrder.filter(
    (option) =>
      option.active &&
      index.paths.get(option.id) !== null &&
      path(option.id).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const effectivePage = Math.min(
    page,
    Math.max(0, Math.ceil(ordered.length / PAGE) - 1),
  );
  const listed = ordered.slice(
    effectivePage * PAGE,
    (effectivePage + 1) * PAGE,
  );
  const toggle = (optionId: string) =>
    onChange(
      multiple
        ? selectedSet.has(optionId)
          ? selected.filter((item) => item !== optionId)
          : [...selected, optionId]
        : optionId,
    );
  if (!hierarchy && !multiple && !large)
    return (
      <div className="space-y-1">
        <label htmlFor={inputId} className="block text-sm">
          {label}
        </label>
        <select
          id={inputId}
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={input}
          value={selected[0] ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Choose an option</option>
          {selected[0] &&
            !available.some((option) => option.id === selected[0]) && (
              <option value={selected[0]} disabled>
                {path(selected[0])} (unavailable)
              </option>
            )}
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label || 'Unnamed option'}
            </option>
          ))}
        </select>
      </div>
    );
  return (
    <fieldset
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement &&
          event.target.type !== 'checkbox'
        )
          event.preventDefault();
      }}
      className="space-y-2 rounded border border-slate-600 p-2"
    >
      <legend>{label}</legend>
      {multiple && (
        <p className="text-xs text-slate-400">Choose more than one.</p>
      )}
      <p className="break-words text-sm" aria-live="polite">
        {selected.length
          ? `Selected: ${selected.map(path).join('; ')}`
          : Array.isArray(value)
            ? 'No options selected'
            : 'No answer'}
      </p>
      {value !== undefined && (
        <button
          type="button"
          className="text-xs underline"
          onClick={() => onChange(undefined)}
        >
          Clear answer
        </button>
      )}
      {multiple && value === undefined && (
        <button
          type="button"
          className="text-xs underline"
          onClick={() => onChange([])}
        >
          Choose none
        </button>
      )}
      {(large || hierarchy) && (
        <label className="block text-xs">
          Search options
          <input
            className={input}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
      )}
      <ul
        aria-label="Available options"
        className="max-h-72 space-y-1 overflow-auto"
      >
        {listed.map((option) => (
          <li
            key={option.id}
            style={{
              paddingInlineStart:
                hierarchy && !search
                  ? `${Math.min((index.depths.get(option.id) ?? 1) - 1, 8) * 16}px`
                  : undefined,
            }}
          >
            {multiple ? (
              <label className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.id)}
                  onChange={() => toggle(option.id)}
                />
                {option.label}
              </label>
            ) : (
              <button
                type="button"
                aria-pressed={selectedSet.has(option.id)}
                className="min-h-10 w-full rounded border border-slate-700 px-2 text-left hover:bg-slate-800"
                onClick={() => toggle(option.id)}
              >
                {search ? path(option.id) : option.label || 'Unnamed option'}
                {hierarchy && (index.children.get(option.id)?.length ?? 0) > 0
                  ? ' — Choose this option'
                  : ''}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!listed.length && <p className="text-sm">No matching options.</p>}
      {ordered.length > PAGE && (
        <div className="flex items-center gap-3 text-xs">
          <span>
            {effectivePage * PAGE + 1}–
            {Math.min((effectivePage + 1) * PAGE, ordered.length)} of{' '}
            {ordered.length}
          </span>
          <button
            type="button"
            disabled={effectivePage === 0}
            onClick={() => setPage(effectivePage - 1)}
          >
            Previous options
          </button>
          <button
            type="button"
            disabled={(effectivePage + 1) * PAGE >= ordered.length}
            onClick={() => setPage(effectivePage + 1)}
          >
            Next options
          </button>
        </div>
      )}
      {selected
        .filter(
          (optionId) => !available.some((option) => option.id === optionId),
        )
        .map((optionId) => (
          <p key={optionId} className="text-xs text-amber-200">
            {path(optionId)} is unavailable. The existing answer is retained
            until you change it.
          </p>
        ))}
    </fieldset>
  );
}

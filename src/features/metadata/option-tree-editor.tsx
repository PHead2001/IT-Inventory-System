'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  buildOptionIndex,
  canReparent,
  newId,
  type Field,
} from './designer-model';
import { ChoicePicker } from './choice-picker';
const input =
  'min-h-10 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm';
const PAGE = 50;

export function OptionTreeEditor({
  field,
  change,
}: {
  field: Field;
  change: (next: Field) => void;
}) {
  const options = field.options;
  const hierarchy = field.type === 'hierarchical_select';
  const index = useMemo(() => buildOptionIndex(options), [options]);
  const [search, setSearch] = useState('');
  const [destinationSearch, setDestinationSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [page, setPage] = useState(0);
  const [removalId, setRemovalId] = useState<string | null>(null);
  const removalTitleId = useId();
  const keepOptionButton = useRef<HTMLButtonElement>(null);
  const addOptionButton = useRef<HTMLButtonElement>(null);
  const removing = removalId ? index.byId.get(removalId) : undefined;
  useEffect(() => {
    if (removalId) keepOptionButton.current?.focus();
  }, [removalId]);
  const cancelRemoval = () => {
    if (removalId) rowInputs.current.get(removalId)?.focus();
    setRemovalId(null);
  };
  const isInitialSelection = (optionId: string) =>
    field.default === optionId ||
    (Array.isArray(field.default) && field.default.includes(optionId));
  const removeOption = (optionId: string) => {
    // Recheck the latest tree at confirmation: no operation removes descendants.
    if ((index.children.get(optionId)?.length ?? 0) > 0) return;
    const next = {
      ...field,
      options: options.filter((option) => option.id !== optionId),
    };
    if (isInitialSelection(optionId))
      next.default = Array.isArray(field.default)
        ? field.default.filter((value) => value !== optionId)
        : undefined;
    change(next);
    if (selectedId === optionId) {
      setSelectedId(null);
      setMoving(false);
    }
    setRemovalId(null);
    addOptionButton.current?.focus();
  };
  const pendingFocus = useRef<string | null>(null);
  const rowInputs = useRef(new Map<string, HTMLInputElement>());
  const selected = selectedId ? index.byId.get(selectedId) : undefined;
  const ordered = useMemo(() => {
    if (!hierarchy) return options;
    const result: Field['options'] = [];
    const seen = new Set<string>();
    const visit = (parent: string | null) => {
      for (const option of index.children.get(parent) ?? []) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        result.push(option);
        visit(option.id);
      }
    };
    visit(null);
    for (const option of options) if (!seen.has(option.id)) result.push(option);
    return result;
  }, [hierarchy, options, index]);
  const matching = ordered.filter((option) =>
    (index.paths.get(option.id) ?? option.label)
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const effectivePage = Math.min(
    page,
    Math.max(0, Math.ceil(matching.length / PAGE) - 1),
  );
  const listed = matching.slice(
    effectivePage * PAGE,
    (effectivePage + 1) * PAGE,
  );
  useEffect(() => {
    const focusId = pendingFocus.current;
    if (!focusId) return;
    const row = rowInputs.current.get(focusId);
    if (row) {
      row.focus();
      row.scrollIntoView?.({ block: 'nearest' });
      pendingFocus.current = null;
    }
  }, [listed]);
  const patch = (optionId: string, next: Partial<Field['options'][number]>) =>
    change({
      ...field,
      options: options.map((option) =>
        option.id === optionId ? { ...option, ...next } : option,
      ),
    });
  const add = (parentId: string | null) => {
    if (
      options.length >= 1000 ||
      (parentId && (index.depths.get(parentId) ?? 64) >= 64)
    )
      return;
    const optionId = newId();
    const next = [
      ...options,
      {
        id: optionId,
        label: '',
        active: true,
        ...(parentId ? { parent_id: parentId } : {}),
      },
    ];
    // Insert just after the parent's current subtree so it is revealed on the correct page.
    const insertion = parentId
      ? ordered.findLastIndex((option) =>
          index.descendantsOf(parentId).has(option.id),
        ) + 1
      : ordered.length;
    change({ ...field, options: next });
    setSearch('');
    setPage(Math.floor(insertion / PAGE));
    setSelectedId(optionId);
    setMoving(false);
    pendingFocus.current = optionId;
  };
  const reorder = (optionId: string, direction: -1 | 1) => {
    const option = index.byId.get(optionId)!;
    const siblings = options.filter(
      (item) => (item.parent_id ?? null) === (option.parent_id ?? null),
    );
    const position = siblings.findIndex((item) => item.id === optionId);
    const adjacent = siblings[position + direction];
    if (!adjacent) return;
    const next = [...options],
      a = options.indexOf(option),
      b = options.indexOf(adjacent);
    [next[a], next[b]] = [next[b], next[a]];
    change({ ...field, options: next });
  };
  const destinations = selected
    ? options.filter(
        (option) =>
          option.active &&
          canReparent(options, selected.id, option.id) &&
          (index.paths.get(option.id) ?? option.label)
            .toLowerCase()
            .includes(destinationSearch.trim().toLowerCase()),
      )
    : [];
  return (
    <div
      className="space-y-2 rounded border border-slate-600 p-2 text-xs"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && removalId) {
          event.stopPropagation();
          cancelRemoval();
        }
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <p>
        Rename or reorder options without changing saved answers. Retiring keeps
        previous answers and makes the option unavailable for new selections.
      </p>
      {options.length > PAGE && (
        <label className="block">
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
      {!options.length && (
        <p>
          {hierarchy
            ? 'Add an option, then add children beneath it. For example: Connection → USB → USB-C.'
            : 'Add your first option.'}
        </p>
      )}
      <ul aria-label="Choices" className="max-h-96 space-y-2 overflow-auto">
        {listed.map((option) => {
          const siblings = index.children.get(option.parent_id ?? null) ?? [];
          const position = siblings.findIndex((item) => item.id === option.id);
          const children = index.children.get(option.id) ?? [];
          return (
            <li
              key={option.id}
              style={{
                marginInlineStart: hierarchy
                  ? `${Math.min((index.depths.get(option.id) ?? 1) - 1, 8) * 16}px`
                  : undefined,
              }}
              className={`space-y-1 rounded border p-2 ${selectedId === option.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-700'}`}
            >
              {hierarchy && option.parent_id && (
                <p className="break-words text-slate-400">
                  Under {index.paths.get(option.parent_id) ?? 'Invalid option'}
                </p>
              )}
              <label className="block">
                Option name
                <input
                  ref={(element) => {
                    if (element) rowInputs.current.set(option.id, element);
                    else rowInputs.current.delete(option.id);
                  }}
                  aria-label={`Option name: ${option.label || 'New option'}`}
                  className={input}
                  maxLength={200}
                  value={option.label}
                  onFocus={() => setSelectedId(option.id)}
                  onChange={(event) =>
                    patch(option.id, { label: event.target.value })
                  }
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {!option.active && (
                  <span className="text-amber-200">Retired</span>
                )}
                {hierarchy && (
                  <button
                    type="button"
                    className="underline"
                    disabled={
                      options.length >= 1000 ||
                      (index.depths.get(option.id) ?? 64) >= 64
                    }
                    onClick={() => add(option.id)}
                  >
                    Add child option{' '}
                    <span className="sr-only">
                      {' '}
                      to {option.label || 'New option'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="underline"
                  disabled={position === 0}
                  onClick={() => reorder(option.id, -1)}
                >
                  Move up <span className="sr-only"> {option.label}</span>
                </button>
                <button
                  type="button"
                  className="underline"
                  disabled={position === siblings.length - 1}
                  onClick={() => reorder(option.id, 1)}
                >
                  Move down <span className="sr-only"> {option.label}</span>
                </button>
                {hierarchy && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setSelectedId(option.id);
                      setMoving(!moving || selectedId !== option.id);
                      setDestinationSearch('');
                    }}
                  >
                    Move to… <span className="sr-only"> {option.label}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="underline"
                  onClick={() => patch(option.id, { active: !option.active })}
                >
                  {option.active ? 'Retire option' : 'Restore option'}{' '}
                  <span className="sr-only"> {option.label}</span>
                </button>
                <button
                  type="button"
                  className="text-rose-300 underline"
                  disabled={children.length > 0}
                  onClick={() => {
                    if (isInitialSelection(option.id)) setRemovalId(option.id);
                    else removeOption(option.id);
                  }}
                >
                  Remove option{' '}
                  <span className="sr-only">
                    {option.label || 'New option'}
                  </span>
                </button>
                {children.length > 0 && (
                  <span className="text-slate-400">
                    {children.length} child option
                    {children.length === 1 ? '' : 's'} retained. Move child
                    options elsewhere before removing this option, or retire it.
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {removing && (
        <div
          role="alertdialog"
          aria-labelledby={removalTitleId}
          className="space-y-2 rounded border border-amber-500 p-3"
        >
          <p id={removalTitleId} className="font-semibold">
            Remove {removing.label || 'New option'} and clear its initial
            selection?
          </p>
          <p>
            This option is selected in Starts with. Removing it clears that
            initial selection for new records. Other initial selections and
            historical answers are retained. Save changes reviews the impact on
            the published form.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              ref={keepOptionButton}
              className="underline"
              onClick={cancelRemoval}
            >
              Keep option
            </button>
            <button
              type="button"
              className="text-rose-300 underline"
              disabled={(index.children.get(removing.id)?.length ?? 0) > 0}
              onClick={() => removeOption(removing.id)}
            >
              Remove and clear initial selection
            </button>
          </div>
        </div>
      )}
      {matching.length > PAGE && (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {effectivePage * PAGE + 1}–
            {Math.min((effectivePage + 1) * PAGE, matching.length)} of{' '}
            {matching.length}
          </span>
          <button
            type="button"
            disabled={effectivePage === 0}
            onClick={() => setPage(effectivePage - 1)}
          >
            Previous choices
          </button>
          <button
            type="button"
            disabled={(effectivePage + 1) * PAGE >= matching.length}
            onClick={() => setPage(effectivePage + 1)}
          >
            Next choices
          </button>
        </div>
      )}
      {hierarchy && moving && selected && (
        <fieldset className="space-y-2 rounded border border-cyan-700 p-2">
          <legend>Move {selected.label || 'New option'}</legend>
          <p>
            Currently: {index.paths.get(selected.id)}. Child options move with
            it. Destinations that create a cycle or exceed 64 levels are
            excluded.
          </p>
          {options.length > PAGE && (
            <label className="block">
              Search destinations
              <input
                className={input}
                value={destinationSearch}
                onChange={(event) => setDestinationSearch(event.target.value)}
              />
            </label>
          )}
          <label className="block">
            Move under
            <select
              className={input}
              value={selected.parent_id ?? ''}
              onChange={(event) => {
                const parentId = event.target.value || null;
                if (canReparent(options, selected.id, parentId)) {
                  patch(selected.id, { parent_id: parentId });
                  setMoving(false);
                }
              }}
            >
              <option value="">Top level</option>
              {selected.parent_id &&
                !destinations
                  .slice(0, PAGE)
                  .some((option) => option.id === selected.parent_id) && (
                  <option value={selected.parent_id}>
                    {index.paths.get(selected.parent_id)}
                  </option>
                )}
              {destinations.slice(0, PAGE).map((option) => (
                <option key={option.id} value={option.id}>
                  {index.paths.get(option.id)}
                </option>
              ))}
            </select>
          </label>
          {destinations.length > PAGE && (
            <p>
              Showing 50 matching destinations. Search to find another option.
            </p>
          )}
          <button
            type="button"
            className="underline"
            onClick={() => setMoving(false)}
          >
            Cancel move
          </button>
        </fieldset>
      )}
      <Button
        ref={addOptionButton}
        type="button"
        variant="outline"
        disabled={options.length >= 1000}
        onClick={() => add(null)}
      >
        Add option
      </Button>
      {options.length >= 1000 && <p>The limit is 1,000 options per field.</p>}
    </div>
  );
}

export function ChoiceDefaultEditor({
  field,
  change,
}: {
  field: Field;
  change: (next: Field) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Initial selections apply to new records only.
      </p>
      <ChoicePicker
        options={field.options}
        type={field.type}
        value={field.default}
        label="Starts with (optional)"
        onChange={(value) => change({ ...field, default: value })}
      />
    </div>
  );
}

'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  buildOptionIndex,
  canReparent,
  newId,
  type Field,
} from './designer-model';

const input =
  'min-h-10 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm';
const PAGE = 50;

/** One editable choice at a time keeps a 1,000-node hierarchy practical. */
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
  const [parentSearch, setParentSearch] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const selected = (selectedId && index.byId.get(selectedId)) || null;
  const descendants = useMemo(
    () => (selected ? index.descendantsOf(selected.id) : new Set<string>()),
    [index, selected],
  );
  const subtreeHeight = useMemo(() => {
    if (!selected) return 0;
    const seen = new Set<string>([selected.id]);
    const queue = [{ id: selected.id, depth: 1 }];
    let height = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      height = Math.max(height, current.depth);
      for (const child of index.children.get(current.id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        queue.push({ id: child.id, depth: current.depth + 1 });
      }
    }
    return height;
  }, [index, selected]);
  const matching = options.filter((option) =>
    search.trim()
      ? (index.paths.get(option.id) ?? option.label)
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      : !hierarchy || (option.parent_id ?? null) === branch,
  );
  const listed = matching.slice(page * PAGE, (page + 1) * PAGE);
  const parentChoices = selected
    ? options
        .filter(
          (option) =>
            !descendants.has(option.id) &&
            index.depths.get(option.id) !== null &&
            (index.depths.get(option.id) ?? 65) + subtreeHeight <= 64 &&
            (index.paths.get(option.id) ?? option.label)
              .toLowerCase()
              .includes(parentSearch.trim().toLowerCase()),
        )
        .slice(0, PAGE)
    : [];
  const currentParent = selected?.parent_id
    ? index.byId.get(selected.parent_id)
    : null;
  if (
    currentParent &&
    !parentChoices.some((option) => option.id === currentParent.id)
  )
    parentChoices.unshift(currentParent);
  const patch = (id: string, next: Partial<Field['options'][number]>) =>
    change({
      ...field,
      options: options.map((option) =>
        option.id === id ? { ...option, ...next } : option,
      ),
    });
  const setBranchAndReset = (id: string | null) => {
    setBranch(id);
    setPage(0);
    setSearch('');
    setSelectedId(null);
  };
  return (
    <div className="space-y-2 rounded border border-slate-600 p-2 text-xs">
      <p>
        Choices ({options.length}/1,000). Retired choices keep their IDs and
        historical values.
      </p>
      {hierarchy && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="underline"
            onClick={() => setBranchAndReset(null)}
          >
            Root
          </button>
          {branch && (
            <>
              <span className="min-w-0 break-words">
                {index.paths.get(branch) ?? 'Invalid path'}
              </span>
              <button
                type="button"
                className="underline"
                onClick={() =>
                  setBranchAndReset(index.byId.get(branch)?.parent_id ?? null)
                }
              >
                Up
              </button>
            </>
          )}
        </div>
      )}
      <label className="block">
        Search choice paths
        <input
          className={input}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <ul className="max-h-64 space-y-1 overflow-auto" aria-label="Choices">
        {listed.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              aria-current={selected?.id === option.id ? 'true' : undefined}
              className="block w-full min-w-0 rounded border border-slate-700 p-2 text-left break-words hover:bg-slate-800"
              onClick={() => setSelectedId(option.id)}
            >
              {index.paths.get(option.id) ?? option.label} ·{' '}
              {option.active ? 'Active' : 'Retired'}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {matching.length
            ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, matching.length)} of ${matching.length}`
            : 'No choices in this branch'}
        </span>
        <button
          type="button"
          className="underline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous choices
        </button>
        <button
          type="button"
          className="underline"
          disabled={(page + 1) * PAGE >= matching.length}
          onClick={() => setPage(page + 1)}
        >
          Next choices
        </button>
      </div>
      {selected && (
        <div
          className="space-y-2 rounded border border-cyan-700 p-2"
          aria-label="Selected choice editor"
        >
          <p className="break-words">
            Editing {index.paths.get(selected.id) ?? selected.label}
          </p>
          <label className="block">
            Choice label
            <input
              className={input}
              maxLength={200}
              value={selected.label}
              onChange={(event) =>
                patch(selected.id, { label: event.target.value })
              }
            />
          </label>
          {hierarchy && (
            <>
              <button
                type="button"
                className="underline"
                onClick={() => setBranchAndReset(selected.id)}
              >
                Open children
              </button>
              <label className="block">
                Search parent paths
                <input
                  className={input}
                  value={parentSearch}
                  onChange={(event) => setParentSearch(event.target.value)}
                />
              </label>
              <label className="block">
                Parent
                <select
                  className={input}
                  value={selected.parent_id ?? ''}
                  onChange={(event) => {
                    const parent = event.target.value || null;
                    if (canReparent(options, selected.id, parent))
                      patch(selected.id, { parent_id: parent });
                  }}
                >
                  <option value="">Root</option>
                  {parentChoices.map((option) => (
                    <option key={option.id} value={option.id}>
                      {index.paths.get(option.id) ?? option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-slate-400">
                Showing up to 50 matching parent paths. Search to locate another
                parent.
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="underline"
              onClick={() => patch(selected.id, { active: !selected.active })}
            >
              {selected.active ? 'Retire' : 'Restore'}
            </button>
            <button
              type="button"
              className="text-rose-300 underline"
              disabled={(index.children.get(selected.id)?.length ?? 0) > 0}
              onClick={() => {
                change({
                  ...field,
                  options: options.filter(
                    (option) => option.id !== selected.id,
                  ),
                });
                setSelectedId(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={options.length >= 1000}
        onClick={() => {
          const id = newId();
          change({
            ...field,
            options: [
              ...options,
              {
                id,
                label: '',
                active: true,
                ...(hierarchy && branch ? { parent_id: branch } : {}),
              },
            ],
          });
          setSelectedId(id);
        }}
      >
        Add {hierarchy && branch ? 'child' : 'choice'}
      </Button>
    </div>
  );
}

/** Paged defaults share the indexed option paths and keep selected IDs visible. */
export function ChoiceDefaultEditor({
  field,
  change,
}: {
  field: Field;
  change: (next: Field) => void;
}) {
  const index = useMemo(() => buildOptionIndex(field.options), [field.options]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const multiple = field.type === 'multi_select';
  const selected = multiple
    ? Array.isArray(field.default)
      ? field.default.filter((id): id is string => typeof id === 'string')
      : []
    : typeof field.default === 'string'
      ? [field.default]
      : [];
  const selectedSet = new Set(selected);
  const matching = field.options.filter(
    (option) =>
      (option.active || selectedSet.has(option.id)) &&
      (index.paths.get(option.id) ?? option.label)
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const listed = matching.slice(page * PAGE, (page + 1) * PAGE);
  const toggle = (id: string) => {
    if (multiple) {
      const next = selectedSet.has(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id];
      change({ ...field, default: next.length ? next : undefined });
    } else change({ ...field, default: selectedSet.has(id) ? undefined : id });
  };
  return (
    <fieldset className="space-y-2 rounded border border-slate-600 p-2 text-sm">
      <legend>Default {multiple ? 'choices' : 'choice'} (optional)</legend>
      <p className="break-words text-xs">
        {selected.length
          ? `${selected.length} selected: ${selected
              .slice(0, 5)
              .map((id) => index.paths.get(id) ?? `Unknown ${id}`)
              .join(
                '; ',
              )}${selected.length > 5 ? `; and ${selected.length - 5} more` : ''}`
          : 'Unset'}
      </p>
      {selected.length > 0 && (
        <button
          type="button"
          className="text-xs underline"
          onClick={() => change({ ...field, default: undefined })}
        >
          Clear all defaults
        </button>
      )}
      <label className="block text-xs">
        Search default choices
        <input
          className={input}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <ul
        className="max-h-64 space-y-1 overflow-auto"
        aria-label="Default choices"
      >
        {listed.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              aria-pressed={selectedSet.has(option.id)}
              disabled={!option.active && !selectedSet.has(option.id)}
              className="block w-full rounded border border-slate-700 p-2 text-left break-words hover:bg-slate-800"
              onClick={() => toggle(option.id)}
            >
              {selectedSet.has(option.id) ? '✓ ' : ''}
              {index.paths.get(option.id) ?? option.label}
              {!option.active ? ' (retired)' : ''}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>
          {matching.length
            ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, matching.length)} of ${matching.length}`
            : 'No matching choices'}
        </span>
        <button
          type="button"
          className="underline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous defaults
        </button>
        <button
          type="button"
          className="underline"
          disabled={(page + 1) * PAGE >= matching.length}
          onClick={() => setPage(page + 1)}
        >
          Next defaults
        </button>
      </div>
    </fieldset>
  );
}

import { optionCasefold } from './option-casefold.generated';

// Explicit contract includes FEFF in addition to Unicode White_Space.
const whitespace =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
export function normalizeOptionLabel(label: string): string {
  return [...label.normalize('NFC')]
    .map((point) => optionCasefold[point] ?? point)
    .join('')
    .replace(whitespace, ' ')
    .replace(/^ | $/g, '')
    .normalize('NFC');
}
type LabeledOption = {
  id: string;
  label: string;
  parent_id?: string | null;
  active: boolean;
};
/** New active labels must be distinguishable throughout one field. */
export function ambiguousOptionIds(
  options: readonly LabeledOption[],
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const option of options) {
    if (!option.active) continue;
    const key = normalizeOptionLabel(option.label);
    const ids = groups.get(key) ?? [];
    ids.push(option.id);
    groups.set(key, ids);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}
/** The caller supplies this field's CURRENT server-published raw definition,
 * separately from its editable draft. Never infer provenance from IDs alone. */
export function invalidOptionCollisionIds(
  options: readonly LabeledOption[],
  publishedBaseline: readonly LabeledOption[] = [],
): Set<string> {
  const ambiguous = ambiguousOptionIds(options);
  const baseline = new Map(
    publishedBaseline.map((option) => [option.id, option]),
  );
  const changedKeys = new Set<string>();
  for (const option of options) {
    if (!ambiguous.has(option.id)) continue;
    const before = baseline.get(option.id);
    if (
      !before?.active ||
      before.label !== option.label ||
      (before.parent_id ?? null) !== (option.parent_id ?? null)
    )
      changedKeys.add(normalizeOptionLabel(option.label));
  }
  return new Set(
    options
      .filter(
        (option) =>
          option.active && changedKeys.has(normalizeOptionLabel(option.label)),
      )
      .map((option) => option.id),
  );
}

// Quote literal separators and quotation/escape characters so a label cannot
// impersonate a hierarchical path. SQL uses the same JSON string spelling.
const displaySegment = (rawLabel: string) => {
  // Match the compiler's existing PostgreSQL btrim(label), without changing
  // the raw label used for authoring/provenance comparisons.
  const label = rawLabel.replace(/^ +| +$/g, '') || 'Unnamed option';
  return /["\\/]/.test(label) ? JSON.stringify(label) : label;
};

/** Use the complete referenced revision in persisted order, including inactive
 * choices. Reserve all literal names before allocating human ordinal suffixes. */
export function optionDisplayLabels(
  options: readonly LabeledOption[],
): Map<string, string> {
  const reserved = new Set(
    options.map((option) =>
      normalizeOptionLabel(displaySegment(option.label || 'Unnamed option')),
    ),
  );
  const used = new Set<string>();
  const labels = new Map<string, string>();
  const nextOrdinal = new Map<string, number>();
  for (const option of options) {
    const base = displaySegment(option.label || 'Unnamed option');
    const key = normalizeOptionLabel(base);
    let ordinal = nextOrdinal.get(key) ?? 1;
    let display = base;
    if (used.has(key)) {
      do {
        ordinal = Math.max(2, ordinal);
        display = `${base} (${ordinal++})`;
      } while (
        reserved.has(normalizeOptionLabel(display)) ||
        used.has(normalizeOptionLabel(display))
      );
    }
    nextOrdinal.set(key, Math.max(2, ordinal));
    used.add(normalizeOptionLabel(display));
    labels.set(option.id, display);
  }
  return labels;
}

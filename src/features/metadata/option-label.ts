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
/** Siblings are scoped to one field's options and one parent identity. */
export function ambiguousOptionIds(
  options: readonly LabeledOption[],
): Set<string> {
  const siblings = new Map<string, string[]>();
  for (const option of options) {
    if (!option.active) continue;
    const key = JSON.stringify([
      option.parent_id ?? null,
      normalizeOptionLabel(option.label),
    ]);
    const ids = siblings.get(key) ?? [];
    ids.push(option.id);
    siblings.set(key, ids);
  }
  return new Set([...siblings.values()].filter((ids) => ids.length > 1).flat());
}
/** Full stable identities avoid collisions from truncated UUID prefixes. */
export function optionDisplayLabels(
  options: readonly LabeledOption[],
): Map<string, string> {
  const ambiguous = ambiguousOptionIds(options);
  return new Map(
    options.map((option) => [
      option.id,
      `${option.label || 'Unnamed option'}${ambiguous.has(option.id) ? ` [choice ${option.id}]` : ''}`,
    ]),
  );
}

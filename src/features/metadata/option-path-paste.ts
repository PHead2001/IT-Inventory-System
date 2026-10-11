import type { Field } from './designer-model';
import { newId } from './designer-model';
import { normalizeOptionLabel } from './option-label';

type Option = Field['options'][number];
export type OptionPathReview = {
  baseline: string;
  options: Option[];
  added: string[];
  reused: string[];
  skipped: string[];
  conflicts: string[];
};
export const optionPasteBaseline = (
  options: Option[],
  revisionOptionCount: number,
) => JSON.stringify([options, revisionOptionCount]);

/** Unescaped > separates segments; \> and \\ represent literal > and backslash. */
export function parseOptionPath(line: string): string[] {
  const parts: string[] = [];
  let part = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      const next = line[++i];
      if (next !== '>' && next !== '\\')
        throw new Error('Escape only > or backslash with a backslash.');
      part += next;
    } else if (line[i] === '>') {
      parts.push(part.trim());
      part = '';
    } else part += line[i];
  }
  parts.push(part.trim());
  if (parts.some((value) => !normalizeOptionLabel(value)))
    throw new Error('Every path segment needs a name.');
  if (parts.some((value) => [...value].length > 200))
    throw new Error('Option names must be at most 200 characters.');
  if (parts.length > 64) throw new Error('Paths may have at most 64 levels.');
  return parts;
}

/** Called by Review, never during render. Existing IDs and definitions remain intact. */
export function reviewOptionPaths(
  text: string,
  options: Option[],
  revisionOptionCount = options.length,
  createId: () => string = newId,
): OptionPathReview {
  const review: OptionPathReview = {
    baseline: optionPasteBaseline(options, revisionOptionCount),
    options: [...options],
    added: [],
    reused: [],
    skipped: [],
    conflicts: [],
  };
  if (new TextEncoder().encode(text).length > 262144) {
    review.conflicts.push('Paste at most 256 KiB of text.');
    return review;
  }
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim());
  if (!lines.length) review.conflicts.push('Paste at least one named path.');
  if (lines.length > 1000) {
    review.conflicts.push('Paste at most 1,000 nonblank lines.');
    return review;
  }
  const seen = new Set<string>();
  const reused = new Set<string>();
  const siblings = new Map<string | null, Option[]>();
  for (const option of options) {
    const parent = option.parent_id ?? null;
    siblings.set(parent, [...(siblings.get(parent) ?? []), option]);
  }
  for (const [i, line] of lines.entries()) {
    try {
      const parts = parseOptionPath(line);
      const normalized = JSON.stringify(parts.map(normalizeOptionLabel));
      const path = parts.join(' / ');
      if (seen.has(normalized)) {
        review.skipped.push(path);
        continue;
      }
      seen.add(normalized);
      let parent: string | null = null;
      let added = false;
      for (const [depth, name] of parts.entries()) {
        const prefix = parts.slice(0, depth + 1).join(' / ');
        const matches: Option[] = (siblings.get(parent) ?? []).filter(
          (option) =>
            normalizeOptionLabel(option.label) === normalizeOptionLabel(name),
        );
        if (matches.some((option) => !option.active))
          throw new Error(
            `${prefix}: a retired matching path exists. Resolve it in Choices first.`,
          );
        if (matches.length > 1)
          throw new Error(
            `${prefix}: matching siblings are ambiguous. Rename them in Choices first.`,
          );
        if (matches.length === 1) {
          parent = matches[0].id;
          if (options.some((option) => option.id === parent))
            reused.add(prefix);
        } else {
          if (
            review.options.some(
              (option) =>
                option.active &&
                normalizeOptionLabel(option.label) ===
                  normalizeOptionLabel(name),
            )
          )
            throw new Error(
              `${prefix}: an active choice elsewhere in this field has the same name. Use a distinct name.`,
            );
          if (
            review.options.length >= 1000 ||
            revisionOptionCount + review.options.length - options.length >= 5000
          )
            throw new Error(
              'The result exceeds 1,000 options per field or 5,000 per revision.',
            );
          const option: Option = {
            id: createId(),
            label: name,
            active: true,
            ...(parent ? { parent_id: parent } : {}),
          };
          review.options.push(option);
          siblings.set(parent, [...(siblings.get(parent) ?? []), option]);
          parent = option.id;
          added = true;
          review.added.push(prefix);
        }
      }
      if (!added) review.skipped.push(path);
    } catch (error) {
      review.conflicts.push(`Line ${i + 1}: ${(error as Error).message}`);
    }
  }
  review.reused = [...reused];
  return review;
}

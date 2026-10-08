import { payloadSchemas } from '@/features/inventory/contracts';
import type { CategoryRef } from '@/features/inventory/contracts-ui';
import {
  formatOperationalTimestamp,
  type DisplayTimeZone,
} from '@/lib/operational-time';
import { buildOptionIndex } from './designer-model';
import { formatCustomValue, type MetadataDefinition } from './contracts';
import {
  equalValue,
  initialCore,
  metadataLabels,
  sameAnswer,
  type RecordMetadata,
} from './reconciliation';

export function normalizeEditIntent(
  kind: 'quantity' | 'asset',
  payload: Record<string, unknown>,
) {
  const parsed =
    payloadSchemas[
      kind === 'quantity' ? 'quantity_update_v2' : 'asset_update_v3'
    ].safeParse(payload);
  if (!parsed.success) return null;
  const intent: Record<string, unknown> = { ...parsed.data };
  for (const key of [
    'description',
    'manufacturer',
    'model',
    'asset_tag',
    'serial_number',
  ])
    if (intent[key] === '') intent[key] = null;
  return intent;
}
export function editSummary(input: {
  baseline: RecordMetadata;
  intent: Record<string, unknown>;
  definition: MetadataDefinition;
  categories: CategoryRef[];
  timeZone: DisplayTimeZone;
}) {
  const { baseline, intent, definition } = input;
  const previous = initialCore(baseline, []);
  const rows: { key: string; label: string; before: string; after: string }[] =
    [];
  const coreValue = (key: string, value: unknown) =>
    key === 'category_id'
      ? (input.categories.find((category) => category.id === value)?.name ??
        (value === baseline.categoryId
          ? baseline.categoryName
          : 'Category unavailable'))
      : value === null || value === undefined || value === ''
        ? 'Unanswered'
        : String(value);
  for (const key of Object.keys(metadataLabels)) {
    if (!Object.hasOwn(intent, key)) continue;
    const before = previous[key as keyof typeof previous];
    const after = intent[key];
    const normalizedBefore =
      before === ''
        ? null
        : key === 'reorder_threshold'
          ? Number(before)
          : before;
    if (equalValue(normalizedBefore, after)) continue;
    rows.push({
      key,
      label: metadataLabels[key],
      before: coreValue(key, before),
      after: after === null ? 'Cleared (unanswered)' : coreValue(key, after),
    });
  }
  const patch = intent.custom_patch as {
    set: Record<string, unknown>;
    unset: string[];
  };
  for (const id of new Set([...Object.keys(patch.set), ...patch.unset])) {
    const field = definition.fields.find((field) => field.id === id);
    if (!field) continue;
    const old = baseline.customValues?.[id];
    const clearing = patch.unset.includes(id);
    const after = clearing ? undefined : patch.set[id];
    if (
      (!old && clearing) ||
      (old &&
        !clearing &&
        sameAnswer({ [id]: old.value }, { [id]: after }, id, field.type))
    )
      continue;
    const render = (value: unknown, historical: boolean) => {
      if (value === undefined) return 'Unanswered';
      if (value === null) return 'Empty value';
      if (value === '') return 'Empty text';
      if (Array.isArray(value) && !value.length) return 'No choices';
      if (field.type === 'datetime') {
        const rendered = formatOperationalTimestamp(
          value,
          input.timeZone,
        )?.text;
        const fraction =
          typeof value === 'string'
            ? /\.(\d{1,6})(?:Z|[+-])/.exec(value)?.[1]
            : undefined;
        return rendered
          ? fraction
            ? rendered.replace(/(\d{2}:\d{2}:\d{2})/, '$1.' + fraction)
            : rendered
          : String(value);
      }
      const stored = baseline.customDisplay?.[id];
      if (
        historical &&
        stored &&
        equalValue(stored.value, value) &&
        stored.option_paths.length
      )
        return formatCustomValue(value, stored.option_paths);
      if (field.options.length) {
        const paths = buildOptionIndex(field.options).paths;
        return (Array.isArray(value) ? value : [value])
          .map((entry) => paths.get(String(entry)) ?? 'Unavailable choice')
          .join('; ');
      }
      return formatCustomValue(value, []);
    };
    rows.push({
      key: id,
      label: field.label,
      before: render(old?.value, true),
      after: clearing ? 'Cleared (unanswered)' : render(after, false),
    });
  }
  return rows;
}

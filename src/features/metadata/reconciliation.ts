import type {
  AssetItem,
  CategoryRef,
  QuantityItem,
} from '@/features/inventory/contracts-ui';
import type { MetadataDefinition, StoredCustomValues } from './contracts';
import { instantMicros } from './field-value-validation';

export type RecordMetadata = QuantityItem | AssetItem;
export const metadataLabels: Record<string, string> = {
  name: 'Name',
  category_id: 'Category',
  description: 'Description',
  manufacturer: 'Manufacturer',
  model: 'Model',
  reorder_threshold: 'Reorder threshold (optional)',
  item_code: 'Item code (SKU)',
  asset_tag: 'Asset tag',
  serial_number: 'Serial number',
};
export const initialCore = (
  entity: RecordMetadata | undefined,
  categories: CategoryRef[],
) => ({
  name: entity?.name ?? '',
  description: entity?.description ?? '',
  category_id:
    entity?.categoryId ??
    categories.find((category) => category.active)?.id ??
    '',
  manufacturer: entity?.manufacturer ?? '',
  model: entity?.model ?? '',
  reorder_threshold:
    entity && 'reorderThreshold' in entity && entity.reorderThreshold !== null
      ? String(entity.reorderThreshold)
      : '',
  item_code: entity && 'itemCode' in entity ? (entity.itemCode ?? '') : '',
  asset_tag: entity && 'assetTag' in entity ? (entity.assetTag ?? '') : '',
  serial_number:
    entity && 'serialNumber' in entity ? (entity.serialNumber ?? '') : '',
  initial_quantity: '0',
  initial_location_id: '',
  location_id: '',
});
export type CoreValues = ReturnType<typeof initialCore>;
export function initialCustom(
  values: StoredCustomValues | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([id, entry]) => [id, entry.value]),
  );
}
// Objects compare by content; arrays remain one atomic value, with their order intact.
export function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equalValue(value, b[index]))
    );
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && equalValue(left[key], right[key]),
    )
  );
}
export function sameAnswer(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  id: string,
  type?: string,
) {
  if (Object.hasOwn(a, id) !== Object.hasOwn(b, id)) return false;
  if (type === 'datetime') {
    const left = instantMicros(a[id]),
      right = instantMicros(b[id]);
    if (left !== null && right !== null) return left === right;
  }
  return (
    Object.hasOwn(a, id) === Object.hasOwn(b, id) && equalValue(a[id], b[id])
  );
}
/** Layout and presentation changes cannot change the validation or identity contract. */
export function compatibleSchema(a: MetadataDefinition, b: MetadataDefinition) {
  const contract = (definition: MetadataDefinition) =>
    definition.fields
      .map((field) => ({
        id: field.id,
        type: field.type,
        applies_to: [...field.applies_to].sort(),
        required: field.required,
        rules: field.rules,
        default: field.default,
        options: field.options
          .map(({ id, parent_id, active }) => ({
            id,
            parent_id: parent_id ?? null,
            active,
          }))
          .sort((x, y) => x.id.localeCompare(y.id)),
      }))
      .sort((x, y) => x.id.localeCompare(y.id));
  return equalValue(contract(a), contract(b));
}
export type MetadataConflict = {
  key: string;
  label: string;
  latest: unknown;
  mine: unknown;
  custom?: boolean;
  dependency?: boolean;
  details?: { key: string; label: string; latest: unknown; mine: unknown }[];
};
export function reconcileMetadata(
  baseline: RecordMetadata,
  draft: CoreValues,
  custom: Record<string, unknown>,
  latest: RecordMetadata,
  definition: MetadataDefinition,
  choices: Record<string, 'latest' | 'mine'> = {},
) {
  const before = initialCore(baseline, []),
    after = initialCore(latest, []);
  const oldCustom = initialCustom(baseline.customValues),
    newCustom = initialCustom(latest.customValues);
  const same = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    id: string,
  ) =>
    sameAnswer(
      a,
      b,
      id,
      definition.fields.find((field) => field.id === id)?.type ??
        latest.customDisplay?.[id]?.field_type ??
        baseline.customDisplay?.[id]?.field_type,
    );
  const ids = new Set([
    ...Object.keys(oldCustom),
    ...Object.keys(custom),
    ...Object.keys(newCustom),
  ]);
  const core = { ...after },
    values = { ...newCustom },
    conflicts: MetadataConflict[] = [];
  const lifecycleChanged =
    ('archived' in baseline &&
      'archived' in latest &&
      (baseline.archived !== latest.archived || latest.archived)) ||
    ('status' in baseline &&
      'status' in latest &&
      baseline.status !== latest.status);
  const categoryIntent = draft.category_id !== before.category_id;
  const customChanged = [...ids].some((id) => !same(oldCustom, newCustom, id));
  const dirty =
    Object.keys(before).some(
      (key) =>
        draft[key as keyof CoreValues] !== before[key as keyof CoreValues],
    ) || [...ids].some((id) => !same(oldCustom, custom, id));
  const dependency =
    dirty &&
    (latest.categoryId !== baseline.categoryId ||
      (categoryIntent && customChanged));
  for (const key of Object.keys(before) as (keyof CoreValues)[]) {
    const mineChanged = draft[key] !== before[key];
    const overlap =
      mineChanged && after[key] !== before[key] && draft[key] !== after[key];
    if ((key === 'category_id' && dependency) || overlap) {
      const conflict = {
        key,
        label: metadataLabels[key] ?? key,
        latest: after[key],
        mine: draft[key],
        dependency: key === 'category_id' && dependency,
      };
      if (!choices[key]) conflicts.push(conflict);
      core[key] = choices[key] === 'latest' ? after[key] : draft[key];
    } else if (mineChanged) core[key] = draft[key];
  }
  for (const id of ids) {
    const intent = !same(oldCustom, custom, id);
    const overlap =
      intent && !same(oldCustom, newCustom, id) && !same(custom, newCustom, id);
    const decision = dependency ? choices.category_id : choices[`custom:${id}`];
    if (!dependency && overlap && !decision)
      conflicts.push({
        key: `custom:${id}`,
        label:
          definition.fields.find((field) => field.id === id)?.label ??
          latest.customDisplay?.[id]?.label ??
          'Retained custom field',
        latest: newCustom[id],
        mine: custom[id],
        custom: true,
      });
    if (intent && decision !== 'latest' && !same(custom, newCustom, id)) {
      if (Object.hasOwn(custom, id)) values[id] = custom[id];
      else delete values[id];
    }
  }
  const touched = [...ids].filter((id) => !same(values, newCustom, id));
  const group = conflicts.find((conflict) => conflict.dependency);
  if (group)
    group.details = [...ids]
      .filter((id) => !same(oldCustom, custom, id))
      .map((id) => ({
        key: `custom:${id}`,
        label:
          definition.fields.find((field) => field.id === id)?.label ??
          latest.customDisplay?.[id]?.label ??
          baseline.customDisplay?.[id]?.label ??
          'Retained custom field',
        latest: newCustom[id],
        mine: custom[id],
      }));
  return { core, custom: values, conflicts, touched, lifecycleChanged };
}

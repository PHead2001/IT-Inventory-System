import { payloadSchemas } from '@/features/inventory/contracts';
import { custodySchemas } from '@/features/custody/contracts';
import type {
  CategoryRef,
  LocationRef,
} from '@/features/inventory/contracts-ui';
import { formatCustomValue, type MetadataDefinition } from './contracts';
import { buildOptionIndex } from './designer-model';
import { controlVisible } from './effective-controls';

type Kind = 'quantity' | 'asset';
/** Reuse command validation, then mirror existing RPC core text/tag normalization. */
export function normalizeCreationIntent(
  kind: Kind,
  siteOpening: boolean,
  payload: Record<string, unknown>,
) {
  const schema = siteOpening
    ? custodySchemas[
        kind === 'quantity' ? 'quantity_site_open' : 'asset_site_open_v3'
      ]
    : payloadSchemas[
        kind === 'quantity' ? 'quantity_create_v2' : 'asset_create_v3'
      ];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return null;
  const intent: Record<string, unknown> = { ...parsed.data };
  for (const key of [
    'description',
    'manufacturer',
    'model',
    'asset_tag',
    'serial_number',
    'reason',
    'reference',
  ])
    if (Object.hasOwn(intent, key) && intent[key] === '') intent[key] = null;
  return intent;
}
export type SummaryRow = {
  label: string;
  value: string;
  source?: string;
  presentation?: 'code';
};
export function creationSummary(input: {
  kind: Kind;
  intent: Record<string, unknown>;
  categories: CategoryRef[];
  locations: LocationRef[];
  definition: MetadataDefinition;
  touched: string[];
  openingSite?: { id: string; name: string };
}) {
  const { kind, intent, definition, openingSite } = input;
  const rows: SummaryRow[] = [
    { label: 'Name', value: String(intent.name) },
    {
      label: 'Tracking',
      value: kind === 'quantity' ? 'Quantity item' : 'Individual asset',
    },
    {
      label: 'Category',
      value:
        input.categories.find((category) => category.id === intent.category_id)
          ?.name ?? 'Category unavailable',
    },
  ];
  if (kind === 'quantity') {
    if (intent.item_code != null)
      rows.push({
        label: 'Item code',
        value: String(intent.item_code),
        presentation: 'code',
      });
    const count = Number(
      openingSite ? intent.quantity : intent.initial_quantity,
    );
    rows.push({
      label: openingSite ? 'Count already at site' : 'Starting count',
      value: String(count),
    });
    if (!openingSite)
      rows.push({
        label: 'Initial storage',
        value:
          count === 0
            ? 'No initial stock · no storage destination'
            : (input.locations.find(
                (location) => location.id === intent.initial_location_id,
              )?.breadcrumb ?? 'Storage destination unavailable'),
      });
  } else {
    rows.push({ label: 'Count', value: '1 individually tracked asset' });
    for (const [key, label] of [
      ['asset_tag', 'Asset tag'],
      ['serial_number', 'Serial number'],
    ])
      if (intent[key] != null)
        rows.push({ label, value: String(intent[key]), presentation: 'code' });
    if (!openingSite)
      rows.push({
        label: 'Current storage',
        value:
          input.locations.find((location) => location.id === intent.location_id)
            ?.breadcrumb ?? 'Storage destination unavailable',
      });
  }
  if (openingSite) rows.push({ label: 'Site', value: openingSite.name });
  const details: SummaryRow[] = [];
  for (const [key, label] of [
    ['description', 'Description'],
    ['manufacturer', 'Manufacturer'],
    ['model', 'Model'],
    ['reorder_threshold', 'Reorder threshold'],
    ['reason', 'Reason'],
    ['reference', 'Reference'],
  ]) {
    if (Object.hasOwn(intent, key))
      details.push({
        label,
        value: intent[key] == null ? 'Not recorded' : String(intent[key]),
      });
  }
  const patch = intent.custom_patch as {
    set: Record<string, unknown>;
    unset: string[];
  };
  const visible = new Set(
    definition.layout.flatMap((section) =>
      section.controls
        .filter(
          (control) =>
            control.kind === 'field' &&
            controlVisible(definition, section, control, kind),
        )
        .map((control) => control.field_id),
    ),
  );
  for (const field of definition.fields.filter(
    (field) => field.applies_to.includes(kind) && visible.has(field.id),
  )) {
    const present = Object.hasOwn(patch.set, field.id);
    const value = patch.set[field.id];
    let displayed = input.touched.includes(field.id)
      ? 'Cleared'
      : 'Not recorded';
    if (present) {
      if (value === '' || value === null)
        displayed = value === '' ? 'Empty value' : 'Cleared';
      else if (Array.isArray(value) && !value.length) displayed = 'No choices';
      else if (field.options.length) {
        const paths = buildOptionIndex(field.options).paths;
        displayed = (Array.isArray(value) ? value : [value])
          .map((choice) => paths.get(String(choice)) ?? 'Unavailable choice')
          .join('; ');
      } else displayed = formatCustomValue(value, []);
    }
    details.push({
      label: field.label,
      value: displayed,
      source:
        present &&
        !input.touched.includes(field.id) &&
        Object.hasOwn(field, 'default')
          ? 'Default applied'
          : undefined,
    });
  }
  return {
    rows,
    details,
    opening: openingSite
      ? 'Records equipment already at this site. No issue from storage is recorded.'
      : null,
  };
}

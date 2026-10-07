import type { Metadata } from '@/features/inventory/contracts-ui';
import type { MetadataDefinition } from './contracts';
import { controlVisible } from './effective-controls';

type Entry = NonNullable<Metadata['customDisplay']>[string];
export function metadataReadGroups(
  values: Metadata['customDisplay'],
  definition?: MetadataDefinition,
  kind?: 'quantity' | 'asset',
) {
  const remaining = new Map(Object.entries(values ?? {}));
  const groups: {
    id: string;
    label: string;
    entries: [string, Entry][];
    secondary: boolean;
  }[] = [];
  if (definition && kind)
    for (const section of definition.layout) {
      const entries: [string, Entry][] = [];
      for (const control of section.controls) {
        if (
          control.kind !== 'field' ||
          !control.field_id ||
          !controlVisible(definition, section, control, kind)
        )
          continue;
        const entry = remaining.get(control.field_id);
        if (
          !entry ||
          !definition.fields.some(
            (field) =>
              field.id === control.field_id && field.applies_to.includes(kind),
          )
        )
          continue;
        entries.push([control.field_id, entry]);
        remaining.delete(control.field_id);
      }
      if (entries.length)
        groups.push({
          id: section.id,
          label: section.label,
          entries,
          secondary: false,
        });
    }
  if (remaining.size)
    groups.push({
      id: 'retained-values',
      label: definition ? 'Other retained values' : 'Recorded values',
      entries: [...remaining],
      secondary: !!definition,
    });
  return groups;
}

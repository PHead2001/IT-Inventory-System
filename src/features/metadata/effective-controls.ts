import type { MetadataDefinition } from './contracts';

export type FormKind = 'quantity' | 'asset';
export const formKinds: FormKind[] = ['quantity', 'asset'];
type Section = MetadataDefinition['layout'][number];
type Control = Section['controls'][number];

export function intrinsicKinds(control: Control): FormKind[] {
  if (control.kind !== 'builtin') return formKinds;
  if (['asset_tag', 'serial_number'].includes(control.builtin ?? ''))
    return ['asset'];
  if (['item_code', 'reorder_threshold'].includes(control.builtin ?? ''))
    return ['quantity'];
  return formKinds;
}

/** Applicability does not imply visibility. An absent scope means both kinds. */
export function controlKinds(
  definition: MetadataDefinition,
  section: Section,
  control: Control,
): FormKind[] {
  const field = definition.fields.find((item) => item.id === control.field_id);
  if (control.kind === 'field' && !field) return [];
  return formKinds.filter(
    (kind) =>
      (section.applies_to ?? formKinds).includes(kind) &&
      (control.applies_to ?? formKinds).includes(kind) &&
      intrinsicKinds(control).includes(kind) &&
      (control.kind !== 'field' || field!.applies_to.includes(kind)),
  );
}

export function controlVisible(
  definition: MetadataDefinition,
  section: Section,
  control: Control,
  kind: FormKind,
): boolean {
  return (
    section.visible !== false &&
    control.visible !== false &&
    controlKinds(definition, section, control).includes(kind)
  );
}

export function compatibleSections(
  definition: MetadataDefinition,
  control: Control,
): Section[] {
  const field = definition.fields.find((item) => item.id === control.field_id);
  const requiredKinds =
    control.kind === 'builtin' &&
    ['name', 'category_id', 'asset_tag'].includes(control.builtin ?? '')
      ? intrinsicKinds(control)
      : field?.required
        ? field.applies_to
        : [];
  return definition.layout.filter(
    (section) =>
      section.visible !== false &&
      controlKinds(definition, section, control).length > 0 &&
      requiredKinds.every((kind) =>
        controlKinds(definition, section, control).includes(kind),
      ),
  );
}

export function kindLabel(kinds: FormKind[]): string {
  return kinds.length === 2
    ? 'Both'
    : kinds[0] === 'quantity'
      ? 'Quantity item'
      : kinds[0] === 'asset'
        ? 'Individual asset'
        : 'No form type';
}

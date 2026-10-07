import type { MetadataDefinition } from './contracts';
import { buildOptionIndex } from './designer-model';
import { placementName, settingRuleLabel } from './field-authoring-model';
import { controlKinds, kindLabel } from './effective-controls';

export type PublicationReviewSnapshot = {
  proposal: MetadataDefinition;
  baseline: MetadataDefinition | null;
  expectedPublishedRevisionId: string;
};
const value = (input: unknown): string =>
  input === undefined
    ? 'Not configured'
    : typeof input === 'string'
      ? input
      : JSON.stringify(input);
const title = (input: string) =>
  input.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Display only authoritative reasons, joined by immutable IDs to frozen revisions. */
export function publicationReasonText(
  reason: unknown,
  snapshot: PublicationReviewSnapshot,
): string {
  const entry = reason as {
    kind?: string;
    id?: string;
    field_id?: string;
    affected_kinds?: string[];
  };
  const before = snapshot.baseline;
  const after = snapshot.proposal;
  const oldField = before?.fields.find(
    (field) => field.id === (entry.field_id ?? entry.id),
  );
  const newField = after.fields.find(
    (field) => field.id === (entry.field_id ?? entry.id),
  );
  const name = newField?.label || oldField?.label || 'Unnamed field';
  const findControl = (document: MetadataDefinition | null) =>
    document?.layout
      .flatMap((section) =>
        section.controls.map((control) => ({ section, control })),
      )
      .find(({ control }) => control.id === entry.id);
  const priorControl = findControl(before),
    nextControl = findControl(after);
  let description: string;
  switch (entry.kind) {
    case 'required_tightened':
      description =
        !oldField && before
          ? `Add required field “${name}”: absent → required`
          : `Require answer for “${name}”: ${oldField ? 'optional' : 'previous requirement unavailable'} → required`;
      break;
    case 'rules_tightened': {
      const changes = new Set([
        ...Object.keys(oldField?.rules ?? {}),
        ...Object.keys(newField?.rules ?? {}),
      ]);
      description =
        `Change rules for “${name}”: ` +
        [...changes]
          .filter(
            (key) =>
              JSON.stringify(oldField?.rules[key]) !==
              JSON.stringify(newField?.rules[key]),
          )
          .map(
            (key) =>
              `${key === 'precision' ? 'Decimal places' : key === 'currencyCode' ? 'Currency' : key === 'booleanPresentation' ? 'Answer presentation' : newField ? settingRuleLabel(newField, key) : title(key)}: ${value(oldField?.rules[key])} → ${value(newField?.rules[key])}`,
          )
          .join('; ');
      break;
    }
    case 'field_retired':
      description = `Retire field “${oldField?.label || name}”: active → retired`;
      break;
    case 'choice_retired': {
      const path =
        oldField && entry.id
          ? buildOptionIndex(oldField.options).paths.get(entry.id)
          : undefined;
      description = `Retire option “${path ?? 'Previous option name unavailable'}” in “${oldField?.label || name}”: active → unavailable for new answers`;
      break;
    }
    case 'section_removed': {
      const section = before?.layout.find((item) => item.id === entry.id);
      description = `Remove section “${section?.label || 'Previous section name unavailable'}”: ${section?.controls.map((control) => placementName(control, before!.fields)).join(', ') || 'previous controls unavailable'} → removed from form`;
      break;
    }
    case 'applicability_narrowed': {
      if (priorControl) {
        const from = kindLabel(
          controlKinds(before!, priorControl.section, priorControl.control),
        );
        const to = nextControl
          ? kindLabel(
              controlKinds(after, nextControl.section, nextControl.control),
            )
          : 'No form type';
        description = `Narrow applicability of “${placementName(priorControl.control, before!.fields)}” in “${priorControl.section.label}”: ${from} → ${to}${nextControl && nextControl.section.id !== priorControl.section.id ? ` in “${nextControl.section.label}”` : ''}`;
      } else
        description = `Narrow applicability of “${name}”: ${oldField ? kindLabel(oldField.applies_to) : 'previous scope unavailable'} → ${newField ? kindLabel(newField.applies_to) : 'No form type'}`;
      break;
    }
    default:
      description = title(entry.kind ?? 'Change');
  }
  return `${description}. Affected types: ${(entry.affected_kinds ?? []).map((kind) => (kind === 'quantity' ? 'Quantity items' : kind === 'asset' ? 'Individual assets' : title(kind))).join(', ') || 'not supplied'}.`;
}

export function designerDragName(
  document: MetadataDefinition,
  rawId: unknown,
): string {
  const id = String(rawId ?? '');
  const section = document.layout.find(
    (item) => `section:${item.id}` === id || `empty:${item.id}` === id,
  );
  if (section)
    return `section “${section.label || 'Untitled section'}”, position ${document.layout.indexOf(section) + 1}`;
  for (const parent of document.layout) {
    const control = parent.controls.find((item) => `control:${item.id}` === id);
    if (control)
      return `“${placementName(control, document.fields)}” in “${parent.label || 'Untitled section'}”, position ${parent.controls.indexOf(control) + 1}`;
  }
  return 'form position';
}

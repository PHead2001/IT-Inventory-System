'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { MetadataDefinition } from './contracts';
import { builtins, newId } from './designer-model';
import { placementName } from './field-authoring-model';
import {
  compatibleSections,
  controlKinds,
  intrinsicKinds,
  kindLabel,
  type FormKind,
} from './effective-controls';

type Control = MetadataDefinition['layout'][number]['controls'][number];
const title = (name: string) =>
  name === 'category_id'
    ? 'Category'
    : name
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function RecoveryLibrary({
  definition,
  previewKind,
  change,
}: {
  definition: MetadataDefinition;
  previewKind: FormKind;
  change: (next: MetadataDefinition) => void;
}) {
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const placed = definition.layout.flatMap((section) => section.controls);
  const hiddenSections = definition.layout.filter(
    (section) => section.visible === false,
  );
  const hiddenControls = definition.layout.flatMap((section) =>
    section.visible === false
      ? []
      : section.controls
          .filter((control) => control.visible === false)
          .map((control) => ({ section, control })),
  );
  const unplaced: { id: string; name: string; control: Control }[] = [
    ...definition.fields
      .filter(
        (field) => !placed.some((control) => control.field_id === field.id),
      )
      .map((field) => ({
        id: field.id,
        name: field.label || 'Untitled field',
        control: {
          id: newId(),
          kind: 'field' as const,
          field_id: field.id,
          width: 12 as const,
        },
      })),
    ...builtins
      .filter(
        (builtin) => !placed.some((control) => control.builtin === builtin),
      )
      .map((builtin) => ({
        id: builtin,
        name: title(builtin),
        control: {
          id: newId(),
          kind: 'builtin' as const,
          builtin,
          width: 12 as const,
          applies_to: intrinsicKinds({
            id: '',
            kind: 'builtin',
            builtin,
            width: 12,
          }),
        },
      })),
  ];
  const excluded = definition.layout.flatMap((section) =>
    section.visible === false
      ? []
      : section.controls
          .filter(
            (control) =>
              control.visible !== false &&
              !controlKinds(definition, section, control).includes(previewKind),
          )
          .map((control) => ({ section, control })),
  );
  const nameOf = (control: Control) =>
    placementName(control, definition.fields);
  const place = (
    key: string,
    control: Control,
    candidates: typeof definition.layout,
  ) => {
    const selected = destinations[key] ?? candidates[0]?.id;
    if (!selected || !candidates.some((section) => section.id === selected))
      return;
    change({
      ...definition,
      layout: definition.layout.map((section) =>
        section.id === selected
          ? { ...section, controls: [...section.controls, control] }
          : section,
      ),
    });
  };
  const choices = (key: string, candidates: typeof definition.layout) => (
    <select
      aria-label={`Destination for ${key}`}
      className="min-h-10 min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-2 text-sm"
      value={destinations[key] ?? candidates[0]?.id ?? ''}
      onChange={(event) =>
        setDestinations((prior) => ({ ...prior, [key]: event.target.value }))
      }
    >
      {candidates.map((section) => (
        <option key={section.id} value={section.id}>
          {section.label || 'Untitled section'}
        </option>
      ))}
    </select>
  );
  return (
    <details className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-sm">
      <summary className="min-h-10 cursor-pointer font-semibold text-cyan-100">
        Hidden fields ·{' '}
        {hiddenSections.length + hiddenControls.length + unplaced.length}
      </summary>
      <div className="space-y-4 pt-3">
        <p className="text-xs text-slate-400">
          Hidden sections count once. Type exclusions are shown separately and
          do not hide fields.
        </p>
        <div>
          <h4 className="font-medium">
            Hidden sections ({hiddenSections.length})
          </h4>
          {hiddenSections.map((section) => (
            <div
              key={section.id}
              className="mt-2 rounded border border-amber-700/50 p-2"
            >
              <p>
                {section.label || 'Untitled section'} ·{' '}
                {section.controls.length} fields
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  change({
                    ...definition,
                    layout: definition.layout.map((item) =>
                      item.id === section.id
                        ? { ...item, visible: true }
                        : item,
                    ),
                  })
                }
              >
                Restore section {section.label || 'Untitled section'}
              </Button>
            </div>
          ))}
        </div>
        <div>
          <h4 className="font-medium">
            Hidden fields ({hiddenControls.length})
          </h4>
          {hiddenControls.length === 0 && (
            <p className="text-slate-400">No hidden fields</p>
          )}
          {hiddenControls.map(({ section, control }) => {
            const kinds = controlKinds(definition, section, control);
            return (
              <div
                key={control.id}
                className="mt-2 rounded border border-amber-700/50 p-2"
              >
                <p>
                  {nameOf(control)} · {kindLabel(kinds)}
                </p>
                {kinds.length === 0 ? (
                  <p className="text-xs text-amber-200">
                    Its scope excludes both form types. Adjust the section,
                    placement, or field restrictions before restoring.
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      change({
                        ...definition,
                        layout: definition.layout.map((item) =>
                          item.id === section.id
                            ? {
                                ...item,
                                controls: item.controls.map((entry) =>
                                  entry.id === control.id
                                    ? { ...entry, visible: true }
                                    : entry,
                                ),
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    Show {nameOf(control)}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <h4 className="font-medium">
            Unplaced fields and standard fields ({unplaced.length})
          </h4>
          {unplaced.length === 0 && (
            <p className="text-slate-400">Everything is placed</p>
          )}
          {unplaced.map(({ id, name, control }) => {
            const candidates = compatibleSections(definition, control);
            return (
              <div
                key={id}
                className="mt-2 rounded border border-slate-700 p-2"
              >
                <p>
                  {name} ·{' '}
                  {control.kind === 'field' ? 'Custom field' : 'Standard field'}
                </p>
                {candidates.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {choices(id, candidates)}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => place(id, control, candidates)}
                    >
                      Add {name} to form
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-200">
                    No visible section has compatible applicability. Restore or
                    add a compatible section first.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <h4 className="font-medium">
            Excluded from {previewKind === 'asset' ? 'Serialized' : 'Quantity'}{' '}
            preview ({excluded.length})
          </h4>
          {excluded.length === 0 && (
            <p className="text-slate-400">No type exclusions</p>
          )}
          {excluded.map(({ control, section }) => (
            <p key={control.id} className="mt-1 text-xs text-slate-400">
              {nameOf(control)} in {section.label || 'Untitled section'} ·{' '}
              {kindLabel(controlKinds(definition, section, control))}
            </p>
          ))}
        </div>
      </div>
    </details>
  );
}

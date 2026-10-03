'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fieldTypes, type MetadataDefinition } from './contracts';
import {
  builtins,
  designerIssues,
  newId,
  type Control,
  type Field,
} from './designer-model';
import {
  additionRestriction,
  fieldTypeInfo,
  placementName,
} from './field-authoring-model';
import { controlKinds, intrinsicKinds } from './effective-controls';
import { FieldSettings, makeField } from './field-settings';
import { MetadataFieldInput } from './field-value-input';
import styles from './designer.module.css';
import type { PendingFieldAddition } from './designer-recovery';
import type { DateTimeDraft } from './field-value-input';

export function AddFieldDialog({
  definition,
  sectionId,
  initialField,
  initialTab = 'new',
  onDraftChange,
  initialDateTimeDraft,
  onCancel,
  onAdd,
  onChange,
  onGo,
  onRestoreFocus,
}: {
  definition: MetadataDefinition;
  sectionId: string;
  initialField?: Field;
  initialTab?: 'new' | 'existing' | 'standard';
  onDraftChange?: (draft: PendingFieldAddition) => void;
  initialDateTimeDraft?: DateTimeDraft;
  onCancel: () => void;
  onAdd: (field: Field, sectionId: string) => void;
  onChange: (definition: MetadataDefinition) => void;
  onGo: (controlId: string, next?: MetadataDefinition) => void;
  onRestoreFocus?: () => void;
}) {
  const [tab, setTab] = useState<'new' | 'existing' | 'standard'>(initialTab);
  const [field, setField] = useState(
    () => initialField ?? makeField('short_text'),
  );
  const [submitted, setSubmitted] = useState(false);
  const [datetimeDraft, setDatetimeDraft] = useState(initialDateTimeDraft);
  const stageDatetime = useCallback((next: DateTimeDraft) => {
    setDatetimeDraft((prior) =>
      prior?.wall === next.wall && prior.zone === next.zone ? prior : next,
    );
  }, []);
  const [inputError, setInputError] = useState('');
  const prefix = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [focusBefore] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const [destination, setDestination] = useState(sectionId);
  const section = definition.layout.find((item) => item.id === destination);
  useEffect(() => {
    onDraftChange?.({
      sectionId: destination,
      field,
      tab,
      ...(datetimeDraft && field.type === 'datetime' ? { datetimeDraft } : {}),
    });
  }, [destination, field, tab, datetimeDraft, onDraftChange]);
  useEffect(() => {
    const element = dialog.current;
    if (element?.showModal) element.showModal();
    else element?.setAttribute('open', '');
    element?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      if (focusBefore?.isConnected) focusBefore.focus();
      else onRestoreFocus?.();
    };
  }, [focusBefore, onRestoreFocus]);
  const restriction = additionRestriction(section, field.applies_to);
  const validation = designerIssues({
    fields: [{ ...field, required: false }],
    layout: [
      {
        id: sectionId,
        label: 'Draft',
        controls: [
          { id: newId(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: newId(), kind: 'builtin', builtin: 'category_id', width: 12 },
          { id: newId(), kind: 'builtin', builtin: 'asset_tag', width: 12 },
          { id: newId(), kind: 'field', field_id: field.id, width: 'Auto' },
        ],
      },
    ],
  });
  const issues = [
    ...validation,
    ...(restriction ? [restriction] : []),
    ...(inputError ? [inputError] : []),
  ];
  const placements = definition.layout.flatMap((parent) =>
    parent.controls.map((control) => ({ section: parent, control })),
  );
  const showOrPlace = (control: Control) => {
    const existing = placements.find(
      (item) =>
        item.control.kind === control.kind &&
        (control.kind === 'field'
          ? item.control.field_id === control.field_id
          : item.control.builtin === control.builtin),
    );
    if (existing) {
      const next = {
        ...definition,
        layout: definition.layout.map((parent) =>
          parent.id === existing.section.id
            ? {
                ...parent,
                visible: true,
                controls: parent.controls.map((item) =>
                  item.id === existing.control.id
                    ? { ...item, visible: true }
                    : item,
                ),
              }
            : parent,
        ),
      };
      onChange(next);
      onGo(existing.control.id, next);
      onCancel();
      return;
    }
    if (!section) return;
    const next = {
      ...definition,
      layout: definition.layout.map((parent) =>
        parent.id === section.id
          ? { ...parent, controls: [...parent.controls, control] }
          : parent,
      ),
    };
    onChange(next);
    onGo(control.id, next);
    onCancel();
  };
  const entry = (control: Control) => {
    const existing = placements.find(
      (item) =>
        item.control.kind === control.kind &&
        (control.kind === 'field'
          ? item.control.field_id === control.field_id
          : item.control.builtin === control.builtin),
    );
    const name = placementName(control, definition.fields);
    const hidden =
      existing &&
      (existing.control.visible === false ||
        existing.section.visible === false);
    const kinds = existing
      ? controlKinds(definition, existing.section, existing.control)
      : section
        ? controlKinds(definition, section, control)
        : [];
    const required =
      control.kind === 'field'
        ? definition.fields.find((item) => item.id === control.field_id)
            ?.applies_to
        : intrinsicKinds(control);
    const reason = existing
      ? !kinds.length
        ? 'Its field and section restrictions exclude both form types. Adjust those restrictions before showing it.'
        : ''
      : additionRestriction(section, required ?? kinds);
    return (
      <div
        key={control.field_id ?? control.builtin}
        className="rounded border border-slate-700 p-3"
      >
        <p className="font-medium">{name}</p>
        <p className="text-xs text-slate-400">
          {existing
            ? `${hidden ? 'Hidden' : 'Already shown'} in ${existing.section.label || 'Untitled section'}`
            : `Not yet placed · ${control.kind === 'builtin' ? 'Uses the existing inventory definition' : 'Existing custom field'}`}
        </p>
        {reason && <p className="text-sm text-amber-200">{reason}</p>}
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(reason)}
          onClick={() =>
            existing && !hidden
              ? (onGo(existing.control.id), onCancel())
              : showOrPlace(control)
          }
        >
          {existing ? (hidden ? 'Show' : 'Go to field') : 'Add to this section'}
        </Button>
      </div>
    );
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${prefix}-title`}
      className={styles.addDialog}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
        if (event.key === 'Tab') {
          const items = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary',
          );
          if (!items?.length) return;
          const visible = [...items].filter(
            (item) =>
              !item.closest('details:not([open])') ||
              item.tagName === 'SUMMARY',
          );
          const first = visible[0],
            last = visible[visible.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className={`${styles.addDialogHeader} flex justify-between gap-3`}>
        <h3 id={`${prefix}-title`} className="text-lg font-semibold">
          Add field
        </h3>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="space-y-4 p-4">
        <label className="block text-sm">
          Add to section
          <select
            className="min-h-10 w-full rounded border border-slate-600 bg-slate-950 px-2"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            {definition.layout.map((parent) => (
              <option
                key={parent.id}
                value={parent.id}
                disabled={parent.visible === false}
              >
                {parent.label || 'Untitled section'}
                {parent.visible === false ? ' (hidden)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Field source"
        >
          {(
            [
              ['new', 'New field'],
              ['existing', 'Use existing field'],
              ['standard', 'Standard fields'],
            ] as const
          ).map(([value, title]) => (
            <Button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              variant={tab === value ? 'default' : 'outline'}
              onClick={() => setTab(value)}
            >
              {title}
            </Button>
          ))}
        </div>
        {tab === 'new' ? (
          <>
            <div className={styles.typePicker}>
              {fieldTypes.map((type) => (
                <button
                  type="button"
                  key={type}
                  aria-label={fieldTypeInfo[type].name}
                  aria-describedby={`${prefix}-${type}-purpose ${prefix}-${type}-example`}
                  aria-pressed={field.type === type}
                  className={styles.typeChoice}
                  onClick={() => {
                    if (type !== field.type) {
                      setInputError('');
                      setDatetimeDraft(undefined);
                      setField({
                        ...makeField(type),
                        id: field.id,
                        label: field.label,
                        help: field.help,
                        applies_to: field.applies_to,
                        required: field.required,
                      });
                    }
                  }}
                >
                  <strong>{fieldTypeInfo[type].name}</strong>
                  <span id={`${prefix}-${type}-purpose`}>
                    {fieldTypeInfo[type].purpose}
                  </span>
                  <small id={`${prefix}-${type}-example`}>
                    {fieldTypeInfo[type].example}
                  </small>
                </button>
              ))}
            </div>
            <div className={styles.addConfiguration}>
              <FieldSettings
                key={field.type}
                field={field}
                showTypeChooser={false}
                change={setField}
                onValidityChange={setInputError}
                initialDateTimeDraft={datetimeDraft}
                onDateTimeDraftChange={stageDatetime}
                basics={
                  <label className="block text-sm">
                    Show on
                    <select
                      className="min-h-10 w-full rounded border border-slate-600 bg-slate-950 px-2"
                      value={field.applies_to.join(',')}
                      onChange={(event) =>
                        setField({
                          ...field,
                          applies_to: event.target.value.split(
                            ',',
                          ) as Field['applies_to'],
                        })
                      }
                    >
                      <option value="quantity,asset">Both</option>
                      <option value="quantity">Quantity items</option>
                      <option value="asset">Serialized assets</option>
                    </select>
                  </label>
                }
              />
              <section
                aria-label="New field preview"
                className="rounded border border-cyan-900 p-3"
              >
                <h4 className="mb-3 font-semibold">Live preview</h4>
                <MetadataFieldInput
                  id={`${prefix}-preview`}
                  field={field}
                  value={field.default}
                  onChange={() => {}}
                  readOnly
                />
              </section>
            </div>
            {submitted && issues.length > 0 && (
              <div role="alert" className="text-sm text-rose-300">
                {issues.map((issue) => (
                  <p key={issue}>
                    {issue.replace('needs a label', 'needs a field name')}
                  </p>
                ))}
              </div>
            )}
            {restriction && (
              <p className="text-sm text-amber-200">{restriction}</p>
            )}
            {definition.fields.length >= 100 && (
              <p role="alert">
                This form already has the maximum 100 custom fields.
              </p>
            )}
          </>
        ) : tab === 'existing' ? (
          <div className="space-y-3">
            {definition.fields.length ? (
              definition.fields.map((item) =>
                entry({
                  id: newId(),
                  kind: 'field',
                  field_id: item.id,
                  width: 'Auto',
                }),
              )
            ) : (
              <p>
                No existing custom fields yet. Choose New field to create one.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {builtins.map((builtin) =>
              entry({
                id: newId(),
                kind: 'builtin',
                builtin,
                width: 'Auto',
                applies_to: intrinsicKinds({
                  id: '',
                  kind: 'builtin',
                  builtin,
                  width: 'Auto',
                }),
              }),
            )}
          </div>
        )}
      </div>
      {tab === 'new' && (
        <div className={`${styles.addDialogFooter} flex justify-end gap-3`}>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel field addition
          </Button>
          <Button
            type="button"
            disabled={definition.fields.length >= 100}
            onClick={() => {
              setSubmitted(true);
              if (!issues.length && definition.fields.length < 100)
                onAdd({ ...field, label: field.label.trim() }, destination);
            }}
          >
            Add to form
          </Button>
        </div>
      )}
    </dialog>
  );
}

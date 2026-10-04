'use client';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { field as fieldClass } from '@/features/inventory/components/read-ui';
import { ChoicePicker } from './choice-picker';
import { optionPath } from './designer-model';
import {
  fieldValueError,
  instantMicros,
  type MetadataField,
} from './field-value-validation';
import {
  browserTimeZone,
  resolveWallTime,
  wallTimeAt,
} from './datetime-adapter';
export type MetadataFieldInputProps = {
  field: MetadataField;
  value: unknown;
  onChange(value: unknown): void;
  id?: string;
  readOnly?: boolean;
  disabled?: boolean;
  previousOptions?: MetadataField['options'];
  onValidityChange?(message: string): void;
  initialDateTimeDraft?: DateTimeDraft;
  onDateTimeDraftChange?(draft: DateTimeDraft, edited?: boolean): void;
};
export type DateTimeDraft = { wall: string; zone: string };
const subscribeTimeZone = () => () => {};
export function DateTimeInput({
  value,
  onChange,
  id,
  describedBy,
  disabled,
  onValidityChange,
  initialDraft,
  onDraftChange,
}: {
  value: unknown;
  onChange(value: unknown): void;
  id: string;
  describedBy?: string;
  disabled?: boolean;
  onValidityChange?(message: string): void;
  initialDraft?: DateTimeDraft;
  onDraftChange?(draft: DateTimeDraft, edited?: boolean): void;
}) {
  const localZone = useSyncExternalStore(
    subscribeTimeZone,
    browserTimeZone,
    () => 'UTC',
  );
  const [chosenZone, setZone] = useState<string | null>(
    initialDraft?.zone ?? null,
  );
  const zone = chosenZone ?? localZone;
  const [draft, setDraft] = useState<{ wall: string; value: unknown } | null>(
    initialDraft ? { wall: initialDraft.wall, value } : null,
  );
  const wall =
    draft && draft.value === value
      ? draft.wall
      : typeof value === 'string'
        ? wallTimeAt(value, zone)
        : '';
  const choices = useMemo(
    () => (wall ? resolveWallTime(wall, zone) : []),
    [wall, zone],
  );
  useEffect(() => {
    onDraftChange?.({ wall, zone });
  }, [wall, zone, onDraftChange]);
  const unresolved =
    wall &&
    !choices.some(
      (choice) =>
        choice.instant === value ||
        (instantMicros(value) !== null &&
          instantMicros(choice.instant) === instantMicros(value)),
    );
  const incomplete = Boolean(
    wall && (!wall.split('T')[0] || !wall.split('T')[1]),
  );
  const error = unresolved
    ? incomplete
      ? 'Choose a date and time.'
      : choices.length > 1
        ? 'This time occurs twice. Choose the intended UTC offset.'
        : 'This time does not exist in this timezone. Choose another time.'
    : '';
  useEffect(() => {
    onValidityChange?.(error);
  }, [error, onValidityChange]);
  const zones = [
    ...new Set([zone, 'UTC', ...Intl.supportedValuesOf('timeZone')]),
  ];
  const changeWall = (next: string) => {
    const resolved = next ? resolveWallTime(next, zone) : [];
    const nextValue =
      resolved.length === 1
        ? resolved[0].instant
        : next === ''
          ? undefined
          : next;
    setDraft({ wall: next, value: nextValue });
    onDraftChange?.({ wall: next, zone }, true);
    onChange(nextValue);
  };
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1 basis-44">
          <label className="text-xs text-slate-400" htmlFor={id + '-date'}>
            Date
          </label>
          <Input
            id={id + '-date'}
            type="date"
            disabled={disabled}
            aria-describedby={describedBy}
            value={wall.split('T')[0] ?? ''}
            onChange={(event) =>
              changeWall(
                event.target.value
                  ? event.target.value + 'T' + (wall.split('T')[1] || '')
                  : wall.split('T')[1]
                    ? 'T' + wall.split('T')[1]
                    : '',
              )
            }
          />
        </div>
        <div className="min-w-0 flex-1 basis-44">
          <label className="text-xs text-slate-400" htmlFor={id + '-time'}>
            Time
          </label>
          <Input
            id={id + '-time'}
            type="time"
            step="0.001"
            disabled={disabled}
            aria-describedby={describedBy}
            value={(wall.split('T')[1] ?? '').replace(/(\.\d{3})\d+$/, '$1')}
            onChange={(event) =>
              changeWall(
                event.target.value || wall.split('T')[0]
                  ? (wall.split('T')[0] || '') + 'T' + event.target.value
                  : '',
              )
            }
          />
        </div>
      </div>
      <label className="block text-xs text-slate-400" htmlFor={id + '-zone'}>
        Display timezone
      </label>
      <select
        id={id + '-zone'}
        className={fieldClass}
        disabled={disabled}
        value={zone}
        onChange={(event) => {
          const nextZone = event.target.value;
          onDraftChange?.(
            {
              wall:
                typeof value === 'string' && instantMicros(value) !== null
                  ? wallTimeAt(value, nextZone)
                  : wall,
              zone: nextZone,
            },
            true,
          );
          setZone(nextZone);
          if (typeof value === 'string' && instantMicros(value) !== null)
            setDraft(null);
          else if (wall) {
            const resolved = resolveWallTime(wall, nextZone);
            const next = resolved.length === 1 ? resolved[0].instant : wall;
            setDraft({ wall, value: next });
            onChange(next);
          }
        }}
      >
        {zones.map((name) => (
          <option key={name} value={name}>
            {name.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
      {typeof value === 'string' && instantMicros(value) !== null && !wall && (
        <p className="text-xs text-amber-200">
          This saved instant falls outside the supported calendar years in this
          display timezone. Choose another display timezone.
        </p>
      )}
      {/\.\d{4,6}$/.test(wall) && (
        <p className="text-xs text-slate-400">
          Retained fractional seconds: {wall.split('.')[1]}. Editing the time
          uses the picker precision.
        </p>
      )}
      {choices.length > 1 && unresolved && (
        <div className="space-y-1">
          <p className="text-sm">Choose the occurrence of this time:</p>
          {choices.map((choice) => (
            <Button
              key={choice.instant}
              disabled={disabled}
              type="button"
              variant="outline"
              onClick={() => {
                setDraft({ wall, value: choice.instant });
                onChange(choice.instant);
              }}
            >
              {choice.offset}
            </Button>
          ))}
        </div>
      )}
      {!unresolved && choices.length > 0 && (
        <p className="text-xs text-slate-400">
          Resolved offset:{' '}
          {
            choices.find(
              (choice) =>
                instantMicros(value) !== null &&
                instantMicros(choice.instant) === instantMicros(value),
            )?.offset
          }
          . Changing display timezone keeps the saved instant.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
    </div>
  );
}
export function MetadataFieldInput({
  field,
  value,
  onChange,
  id: suppliedId,
  readOnly = false,
  disabled = false,
  previousOptions,
  onValidityChange,
  initialDateTimeDraft,
  onDateTimeDraftChange,
}: MetadataFieldInputProps) {
  const generatedId = useId();
  const id = suppliedId ?? `field-${generatedId}`;
  const [datetimeError, setDatetimeError] = useState('');
  const [interacted, setInteracted] = useState(false);
  const error =
    (field.type === 'datetime' ? datetimeError : '') ||
    fieldValueError(field, value);
  useEffect(() => {
    onValidityChange?.(error);
  }, [error, onValidityChange]);
  const describedBy =
    [field.help ? id + '-help' : '', interacted && error ? id + '-error' : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const change = (next: unknown) => {
    setInteracted(true);
    onChange(next);
  };
  const locked = disabled || readOnly;
  const common = {
    id,
    className: fieldClass,
    disabled: locked,
    'aria-describedby': describedBy,
    'aria-invalid': (interacted && !!error) || undefined,
  };
  const label = field.label || 'Untitled field';
  const heading = label + (field.required ? ' (required)' : '');
  let input: React.ReactNode;
  if (field.type === 'boolean')
    input = (
      <label
        htmlFor={id}
        className="flex min-h-11 items-center gap-2 break-words"
      >
        <input
          {...common}
          type="checkbox"
          className="h-6 w-6 shrink-0 accent-cyan-400"
          checked={value === true}
          aria-checked={value === undefined ? 'mixed' : value === true}
          ref={(element) => {
            if (element) element.indeterminate = value === undefined;
          }}
          onChange={(event) => change(event.target.checked)}
        />
        <span>{heading}</span>
      </label>
    );
  else if (
    ['single_select', 'multi_select', 'hierarchical_select'].includes(
      field.type,
    )
  )
    input = (
      <ChoicePicker
        options={field.options}
        type={field.type}
        value={value}
        onChange={change}
        label={heading}
        id={id}
        describedBy={describedBy}
        disabled={locked}
        historicalLabel={
          typeof value === 'string'
            ? (optionPath(previousOptions ?? [], value) ?? undefined)
            : undefined
        }
      />
    );
  else if (field.type === 'datetime')
    input = (
      <div role="group" aria-label={heading} aria-describedby={describedBy}>
        <p className="break-words">{heading}</p>
        <DateTimeInput
          id={id}
          value={value}
          onChange={change}
          describedBy={describedBy}
          disabled={locked}
          onValidityChange={setDatetimeError}
          initialDraft={initialDateTimeDraft}
          onDraftChange={onDateTimeDraftChange}
        />
      </div>
    );
  else {
    const text =
      field.type === 'currency'
        ? value && typeof value === 'object' && 'amount' in value
          ? String(value.amount)
          : ''
        : value === undefined
          ? ''
          : String(value);
    input = (
      <>
        <label htmlFor={id} className="break-words">
          {heading}
        </label>
        {field.type === 'long_text' ? (
          <textarea
            {...common}
            rows={4}
            placeholder="Enter a detailed note"
            value={text}
            onChange={(event) => change(event.target.value)}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Input
              {...common}
              type={field.type === 'date' ? 'date' : 'text'}
              inputMode={
                field.type === 'integer'
                  ? 'numeric'
                  : field.type === 'decimal' || field.type === 'currency'
                    ? 'decimal'
                    : undefined
              }
              placeholder={
                field.type === 'url'
                  ? 'https://example.com/manual'
                  : field.type === 'integer'
                    ? '24'
                    : field.type === 'decimal'
                      ? '1.5'
                      : field.type === 'currency'
                        ? '125.00'
                        : 'Enter text'
              }
              value={text}
              onChange={(event) => {
                const next = event.target.value;
                change(
                  field.type === 'currency'
                    ? next === ''
                      ? undefined
                      : { amount: next, currency: field.rules.currencyCode }
                    : field.type === 'date'
                      ? next || undefined
                      : field.type === 'integer' &&
                          /^-?(0|[1-9]\d*)$/.test(next) &&
                          Number.isSafeInteger(Number(next))
                        ? Number(next)
                        : next,
                );
              }}
            />
            {field.type === 'currency' && (
              <span className="text-sm">
                {String(field.rules.currencyCode ?? '')}
              </span>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="min-w-0 space-y-2">
      {input}
      {field.type === 'boolean' && value === undefined && (
        <p className="text-xs text-slate-400">Not recorded</p>
      )}
      {field.help && (
        <p
          id={id + '-help'}
          className="break-words whitespace-pre-wrap text-xs text-slate-400"
        >
          {field.help}
        </p>
      )}
      {interacted && error && (
        <p id={id + '-error'} role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      {!readOnly &&
        !['single_select', 'multi_select', 'hierarchical_select'].includes(
          field.type,
        ) &&
        value !== undefined && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setDatetimeError('');
              change(undefined);
            }}
          >
            Clear answer
          </Button>
        )}
    </div>
  );
}

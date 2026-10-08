'use client';
import { useId, useRef, useState, type ReactNode } from 'react';
import { fieldTypes, type FieldType } from './contracts';
import {
  newId,
  selectTypes,
  supportedCurrencyCodes,
  type Field,
} from './designer-model';
import {
  fieldTypeInfo,
  fieldSettingErrors,
  settingRuleLabel,
} from './field-authoring-model';
import { requiredFieldHelp } from './field-guidance';
import { MetadataFieldInput } from './field-value-input';
import type { DateTimeDraft } from './field-value-input';
import { ChoiceDefaultEditor, OptionTreeEditor } from './option-tree-editor';

const input =
  'min-h-10 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm';
export function makeField(type: FieldType, name = ''): Field {
  return {
    id: newId(),
    type,
    label: name,
    applies_to: ['quantity', 'asset'],
    required: false,
    rules: type === 'currency' ? { currencyCode: 'USD', precision: 2 } : {},
    options: [],
  };
}
const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
export function FieldSettings({
  field,
  change,
  autoFocus = true,
  published = false,
  basics,
  appearance,
  advanced,
  onValidityChange,
  showTypeChooser = true,
  initialDateTimeDraft,
  onDateTimeDraftChange,
  revisionOptionCount,
}: {
  field: Field;
  autoFocus?: boolean;
  change: (field: Field) => void;
  revisionOptionCount?: number;
  published?: boolean;
  showTypeChooser?: boolean;
  initialDateTimeDraft?: DateTimeDraft;
  onDateTimeDraftChange?: (draft: DateTimeDraft) => void;
  basics?: ReactNode;
  appearance?: ReactNode;
  advanced?: ReactNode;
  onValidityChange?: (message: string) => void;
}) {
  const prefix = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftRules, setDraftRules] = useState<Record<string, string>>({});
  const errorsRef = useRef<Record<string, string>>({});
  const report = (key: string, message: string) => {
    if (errorsRef.current[key] === message) return;
    const next = { ...errorsRef.current, [key]: message };
    errorsRef.current = next;
    setErrors(next);
    onValidityChange?.(Object.values(next).filter(Boolean).join(' '));
  };
  const ruleLabel = (key: string) => settingRuleLabel(field, key);
  const missingRuleMessage = (key: string) =>
    `Enter ${ruleLabel(key).toLowerCase()} or turn off this restriction.`;
  const ruleErrors = fieldSettingErrors(field);
  for (const key of Object.keys(field.rules))
    if (field.rules[key] === '') ruleErrors[key] = missingRuleMessage(key);
  const keys = ['short_text', 'long_text'].includes(field.type)
    ? ['minLength', 'maxLength']
    : ['integer', 'decimal', 'currency', 'date', 'datetime'].includes(
          field.type,
        )
      ? ['min', 'max']
      : field.type === 'multi_select'
        ? ['maxSelections']
        : [];
  const setRule = (key: string, raw: string) => {
    setDraftRules((prior) => ({ ...prior, [key]: raw }));
    const numeric = [
      'minLength',
      'maxLength',
      'maxSelections',
      'precision',
    ].includes(key);
    if (raw && numeric && !/^\d+$/.test(raw)) {
      report(key, `${ruleLabel(key)} needs a whole number.`);
      change({ ...field, rules: { ...field.rules, [key]: raw } });
      return;
    }
    report(key, raw === '' ? missingRuleMessage(key) : '');
    const rules = { ...field.rules };
    // An enabled, empty restriction is an invalid recoverable draft, not absent.
    rules[key] = raw === '' ? '' : numeric ? Number(raw) : raw;
    change({ ...field, rules });
  };
  const starts = selectTypes.includes(field.type);
  return (
    <div className="min-w-0 space-y-4" data-testid={`field-${field.id}`}>
      <section className="space-y-3" aria-label="Basics">
        <h4 className="font-semibold text-cyan-100">Basics</h4>
        <label className="block text-sm">
          Field name
          <input
            autoFocus={autoFocus}
            maxLength={200}
            className={input}
            value={field.label}
            onChange={(event) =>
              change({ ...field, label: event.target.value })
            }
          />
        </label>
        <label className="block text-sm">
          Description shown below this field
          <textarea
            rows={2}
            maxLength={2000}
            className={input}
            value={field.help ?? ''}
            onChange={(event) => change({ ...field, help: event.target.value })}
          />
        </label>
        {basics}
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) =>
              change({ ...field, required: event.target.checked })
            }
          />{' '}
          Required
        </label>
        <p className="text-xs text-slate-400">{requiredFieldHelp(field)}</p>
        {!published && showTypeChooser && (
          <label className="block text-sm">
            Field type
            <select
              className={input}
              value={field.type}
              onChange={(event) => {
                setDraftRules({});
                setErrors({});
                errorsRef.current = {};
                onValidityChange?.('');
                change({
                  ...makeField(event.target.value as FieldType),
                  id: field.id,
                  label: field.label,
                  help: field.help,
                  required: field.required,
                  applies_to: field.applies_to,
                });
              }}
            >
              {fieldTypes.map((type) => (
                <option key={type} value={type}>
                  {fieldTypeInfo[type].name}
                </option>
              ))}
            </select>
          </label>
        )}
        {field.type === 'boolean' && (
          <label className="block text-sm">
            Answer presentation
            <select
              className={input}
              aria-label="Answer presentation"
              aria-describedby={`${prefix}-presentation-help`}
              value={String(field.rules.booleanPresentation ?? 'checkbox')}
              onChange={(event) => {
                const rules = { ...field.rules };
                if (event.target.value === 'checkbox')
                  delete rules.booleanPresentation;
                else rules.booleanPresentation = 'yes_no';
                change({ ...field, rules });
              }}
            >
              <option value="checkbox">Checkbox</option>
              <option value="yes_no">Yes / No question</option>
            </select>
            <span
              id={`${prefix}-presentation-help`}
              className="text-xs text-slate-400"
            >
              Both presentations retain Yes, No and unanswered. Changing
              presentation keeps existing answers.
            </span>
          </label>
        )}
        {field.type === 'currency' && !published && (
          <label className="block text-sm">
            Currency
            <select
              className={input}
              value={String(field.rules.currencyCode ?? 'USD')}
              onChange={(event) =>
                change({
                  ...field,
                  rules: { ...field.rules, currencyCode: event.target.value },
                  default:
                    field.default &&
                    typeof field.default === 'object' &&
                    'amount' in field.default
                      ? { ...field.default, currency: event.target.value }
                      : field.default,
                })
              }
            >
              {[...supportedCurrencyCodes].sort().map((code) => (
                <option key={code} value={code}>
                  {currencyNames.of(code)} ({code})
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      {starts && (
        <section className="space-y-3" aria-label="Choices">
          <h4 className="font-semibold text-cyan-100">Choices</h4>
          {field.type === 'multi_select' && (
            <p className="text-sm text-slate-400">
              {field.required
                ? 'Select any that apply. Record a selection or explicitly choose none.'
                : 'Select any that apply.'}
            </p>
          )}
          <OptionTreeEditor
            field={field}
            change={change}
            revisionOptionCount={revisionOptionCount}
          />
        </section>
      )}
      <details className="rounded border border-slate-700 p-3">
        <summary className="min-h-10 cursor-pointer font-semibold text-cyan-100">
          Optional rules
        </summary>
        <div className="space-y-3 pt-3">
          <p className="text-xs text-slate-400">
            Starts with is an initial answer for new records only. It never
            updates existing records.
          </p>
          {field.type === 'boolean' ? (
            <label className="block text-sm">
              Starts with (optional)
              <select
                className={input}
                value={field.default === undefined ? '' : String(field.default)}
                onChange={(event) =>
                  change({
                    ...field,
                    default:
                      event.target.value === ''
                        ? undefined
                        : event.target.value === 'true',
                  })
                }
              >
                <option value="">No default</option>
                <option value="true">
                  {field.rules.booleanPresentation === 'yes_no'
                    ? 'Yes'
                    : 'Checked'}
                </option>
                <option value="false">
                  {field.rules.booleanPresentation === 'yes_no'
                    ? 'No'
                    : 'Unchecked'}
                </option>
              </select>
            </label>
          ) : starts ? (
            <ChoiceDefaultEditor field={field} change={change} />
          ) : (
            <MetadataFieldInput
              key={field.type}
              field={{
                ...field,
                label: 'Starts with (optional)',
                help: undefined,
                required: false,
              }}
              id={`${prefix}-initial`}
              value={field.default}
              onChange={(value) => change({ ...field, default: value })}
              onValidityChange={(message) => report('default', message)}
              initialDateTimeDraft={initialDateTimeDraft}
              onDateTimeDraftChange={onDateTimeDraftChange}
            />
          )}
          {['decimal', 'currency'].includes(field.type) && (
            <label className="block text-sm">
              Decimal places
              <select
                className={input}
                disabled={published && field.type === 'currency'}
                value={String(field.rules.precision ?? 6)}
                onChange={(event) => setRule('precision', event.target.value)}
              >
                {Array.from(
                  { length: field.type === 'currency' ? 5 : 7 },
                  (_, n) => (
                    <option key={n} value={n}>
                      {n} (
                      {n === 0 ? '12' : `12.${'0'.repeat(Math.max(0, n - 1))}5`}
                      )
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          {field.type === 'currency' && published && (
            <p className="text-xs text-slate-400">
              Currency: {currencyNames.of(String(field.rules.currencyCode))} (
              {String(field.rules.currencyCode)}). Advanced offers a replacement
              if its currency meaning needs to change.
            </p>
          )}
          {keys.length > 0 && (
            <p className="text-xs text-slate-400">
              Restrictions limit allowed answers. They do not set an initial
              value or create reminders.
            </p>
          )}
          {keys.map((key) => (
            <div key={key}>
              <label className="block text-sm">
                <input
                  type="checkbox"
                  checked={
                    field.rules[key] !== undefined ||
                    draftRules[key] !== undefined
                  }
                  onChange={(event) => {
                    if (!event.target.checked) {
                      setDraftRules((prior) => {
                        const next = { ...prior };
                        delete next[key];
                        return next;
                      });
                      report(key, '');
                      const rules = { ...field.rules };
                      delete rules[key];
                      change({ ...field, rules });
                    } else {
                      setDraftRules((prior) => ({ ...prior, [key]: '' }));
                      report(key, missingRuleMessage(key));
                      change({
                        ...field,
                        rules: { ...field.rules, [key]: '' },
                      });
                    }
                  }}
                />{' '}
                Use {ruleLabel(key).toLowerCase()}
              </label>
              {(field.rules[key] !== undefined ||
                draftRules[key] !== undefined) &&
                (field.type === 'datetime' ? (
                  <MetadataFieldInput
                    field={{
                      ...field,
                      label: ruleLabel(key),
                      help: undefined,
                      required: false,
                      rules: {},
                      default: undefined,
                    }}
                    id={`${prefix}-${key}`}
                    value={field.rules[key]}
                    onChange={(value) => {
                      setDraftRules((prior) => ({
                        ...prior,
                        [key]: String(value ?? ''),
                      }));
                      report(
                        key,
                        value === undefined || value === ''
                          ? missingRuleMessage(key)
                          : '',
                      );
                      const rules = { ...field.rules };
                      rules[key] = value ?? '';
                      change({ ...field, rules });
                    }}
                    onValidityChange={(message) =>
                      report(
                        key,
                        field.rules[key] === ''
                          ? missingRuleMessage(key)
                          : message,
                      )
                    }
                  />
                ) : (
                  <label className="block text-sm">
                    {ruleLabel(key)}
                    <input
                      className={input}
                      aria-invalid={
                        Boolean(errors[key] || ruleErrors[key]) || undefined
                      }
                      aria-describedby={
                        errors[key] || ruleErrors[key]
                          ? `${prefix}-rule-error-${key}`
                          : undefined
                      }
                      type={field.type === 'date' ? 'date' : 'text'}
                      inputMode={field.type === 'date' ? undefined : 'decimal'}
                      value={draftRules[key] ?? String(field.rules[key] ?? '')}
                      onChange={(event) => setRule(key, event.target.value)}
                    />
                  </label>
                ))}
              {(errors[key] || ruleErrors[key]) && (
                <p
                  id={`${prefix}-rule-error-${key}`}
                  role="alert"
                  className="text-sm text-rose-300"
                >
                  {errors[key] || ruleErrors[key]}
                </p>
              )}
            </div>
          ))}
        </div>
      </details>
      {appearance && (
        <section aria-label="Appearance" className="space-y-3">
          <h4 className="font-semibold text-cyan-100">Appearance</h4>
          {appearance}
        </section>
      )}
      {advanced && (
        <details className="rounded border border-slate-700 p-3">
          <summary className="min-h-10 cursor-pointer font-semibold">
            Advanced
          </summary>
          <div className="space-y-3 pt-3">
            <p className="break-all text-xs text-slate-400">
              Stable ID: {field.id}
            </p>
            {advanced}
          </div>
        </details>
      )}
    </div>
  );
}

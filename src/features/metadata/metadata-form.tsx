'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import {
  submitInventory,
  findDuplicateSerials,
} from '@/features/inventory/actions';
import type { MutationState } from '@/features/inventory/contracts';
import type {
  AssetItem,
  CategoryRef,
  LocationRef,
  QuantityItem,
} from '@/features/inventory/contracts-ui';
import { field as fieldClass } from '@/features/inventory/components/read-ui';
import type {
  MetadataDefinition,
  MetadataForm,
  StoredCustomValues,
} from './contracts';
import { controlLayoutStyle } from './control-layout';

type Kind = 'quantity' | 'asset';
type Props = {
  kind: Kind;
  categories: CategoryRef[];
  locations: LocationRef[];
  forms: Record<string, MetadataForm>;
  item?: QuantityItem;
  asset?: AssetItem;
  preview?: boolean;
};
const labels: Record<string, string> = {
  name: 'Name',
  category_id: 'Category',
  description: 'Description',
  manufacturer: 'Manufacturer',
  model: 'Model',
  reorder_threshold: 'Reorder threshold (optional)',
  asset_tag: 'Asset tag',
  serial_number: 'Serial number',
};
const initialCore = (
  entity: QuantityItem | AssetItem | undefined,
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
  asset_tag: entity && 'assetTag' in entity ? (entity.assetTag ?? '') : '',
  serial_number:
    entity && 'serialNumber' in entity ? (entity.serialNumber ?? '') : '',
  initial_quantity: '0',
  initial_location_id: '',
  location_id: '',
});
function initialCustom(values: StoredCustomValues | undefined) {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([id, entry]) => [id, entry.value]),
  );
}
export function buildCustomPatch(
  definition: MetadataDefinition,
  kind: Kind,
  current: Record<string, unknown>,
  touched: string[],
  creating: boolean,
) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const touchedIds = new Set(touched);
  for (const field of definition.fields.filter((value) =>
    value.applies_to.includes(kind),
  )) {
    if (!creating && !touchedIds.has(field.id)) continue;
    const hasValue = Object.hasOwn(current, field.id);
    const value = hasValue
      ? current[field.id]
      : creating
        ? field.default
        : undefined;
    if (value === undefined) {
      if (!creating && touchedIds.has(field.id)) unset.push(field.id);
    } else set[field.id] = value;
  }
  return { set, unset };
}
function optionRows(options: MetadataDefinition['fields'][number]['options']) {
  const byId = new Map(options.map((option) => [option.id, option]));
  return options.map((option) => {
    const path = [option.label];
    const visited = new Set([option.id]);
    let parent = option.parent_id ? byId.get(option.parent_id) : undefined;
    while (parent && !visited.has(parent.id) && path.length < 64) {
      path.unshift(parent.label);
      visited.add(parent.id);
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
    }
    return { ...option, path: path.join(' / ') };
  });
}
function formChanges(
  previous: MetadataDefinition,
  next: MetadataDefinition,
  kind: Kind,
) {
  const changes: string[] = [];
  const before = new Map(previous.fields.map((field) => [field.id, field]));
  const after = new Map(next.fields.map((field) => [field.id, field]));
  for (const field of previous.fields.filter((value) =>
    value.applies_to.includes(kind),
  )) {
    const current = after.get(field.id);
    if (!current || !current.applies_to.includes(kind)) {
      changes.push(
        `${field.label}: no longer on this form; entered values remain retained.`,
      );
      continue;
    }
    if (field.label !== current.label)
      changes.push(`${field.label}: label changed to ${current.label}.`);
    if (field.required !== current.required)
      changes.push(
        `${current.label}: ${current.required ? 'now required' : 'no longer required'}.`,
      );
    if (JSON.stringify(field.rules) !== JSON.stringify(current.rules))
      changes.push(`${current.label}: validation rules changed.`);
    if (JSON.stringify(field.options) !== JSON.stringify(current.options))
      changes.push(
        `${current.label}: available choices or choice labels changed.`,
      );
  }
  for (const field of next.fields.filter((value) =>
    value.applies_to.includes(kind),
  ))
    if (!before.get(field.id)?.applies_to.includes(kind))
      changes.push(
        `${field.label}: new ${field.required ? 'required' : 'optional'} field.`,
      );
  if (JSON.stringify(previous.layout) !== JSON.stringify(next.layout))
    changes.push('The section or control layout changed.');
  return changes;
}
function displayComparisonValue(value: unknown) {
  if (value === undefined) return '(missing)';
  const rendered = JSON.stringify(value) ?? String(value);
  return rendered.length > 160 ? `${rendered.slice(0, 160)}…` : rendered;
}
function itemChanges(
  previous: QuantityItem | AssetItem,
  next: QuantityItem | AssetItem,
) {
  const changes: { label: string; before: unknown; after: unknown }[] = [];
  const oldCore = initialCore(previous, []);
  const newCore = initialCore(next, []);
  for (const name of Object.keys(oldCore) as (keyof typeof oldCore)[])
    if (oldCore[name] !== newCore[name])
      changes.push({
        label: labels[name] ?? name,
        before: oldCore[name],
        after: newCore[name],
      });
  const ids = new Set([
    ...Object.keys(previous.customValues ?? {}),
    ...Object.keys(next.customValues ?? {}),
  ]);
  for (const id of ids) {
    const before = previous.customValues?.[id]?.value;
    const after = next.customValues?.[id]?.value;
    if (JSON.stringify(before) !== JSON.stringify(after))
      changes.push({ label: `Custom field ${id}`, before, after });
  }
  return changes;
}
export function MetadataForm({
  kind,
  categories,
  locations,
  forms,
  item,
  asset,
  preview = false,
}: Props) {
  const router = useRouter();
  const latest = item ?? asset;
  const creating = !latest;
  const [baseline, setBaseline] = useState(latest);
  const [core, setCore] = useState(() => initialCore(latest, categories));
  const [custom, setCustom] = useState<Record<string, unknown>>(() =>
    initialCustom(latest?.customValues),
  );
  const [touched, setTouched] = useState<string[]>([]);
  const [thresholdTouched, setThresholdTouched] = useState(false);
  const [reviewedForms, setReviewedForms] = useState(() => forms);
  const [priorForms, setPriorForms] = useState<Record<string, MetadataForm>>(
    {},
  );
  const [review, setReview] = useState(false);
  const [ackLegacy, setAckLegacy] = useState(false);
  const [state, setState] = useState<MutationState | null>(null);
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const currentForm = forms[core.category_id];
  const form = reviewedForms[core.category_id] ?? currentForm;
  const definition = form?.published_definition;
  const schemaStale =
    !!currentForm &&
    !!form &&
    form.published_revision_id !== currentForm.published_revision_id;
  const itemStale =
    !!latest && !!baseline && latest.version !== baseline.version;
  const legacyMigration =
    !!baseline &&
    core.category_id !== baseline.categoryId &&
    Object.keys(baseline.customValues ?? {}).length > 0;
  const updateCore = (name: keyof typeof core, value: string) => {
    setCore((prior) => ({ ...prior, [name]: value }));
    if (name === 'reorder_threshold') setThresholdTouched(true);
    if (name === 'category_id' && forms[value])
      setReviewedForms((prior) => ({ ...prior, [value]: forms[value] }));
    setReview(false);
    setAckLegacy(false);
    setState(null);
  };
  const updateCustom = (id: string, value: unknown) => {
    setCustom((prior) =>
      value === undefined
        ? Object.fromEntries(
            Object.entries(prior).filter(([key]) => key !== id),
          )
        : { ...prior, [id]: value },
    );
    setTouched((prior) => (prior.includes(id) ? prior : [...prior, id]));
    setReview(false);
    setAckLegacy(false);
    setState(null);
  };
  const applicable =
    definition?.fields.filter((value) => value.applies_to.includes(kind)) ?? [];
  const priorDefinition = priorForms[core.category_id]?.published_definition;
  const schemaChanges =
    schemaStale && currentForm && definition
      ? formChanges(definition, currentForm.published_definition, kind)
      : [];
  const changedItemValues =
    itemStale && baseline && latest ? itemChanges(baseline, latest) : [];
  const customControl = (id: string) => {
    const config = applicable.find((candidate) => candidate.id === id);
    if (!config) return null;
    const value = Object.hasOwn(custom, id)
      ? custom[id]
      : creating
        ? config.default
        : undefined;
    const inputId = 'metadata-' + id;
    const help = config.help ? (
      <p className="text-xs text-slate-400">{config.help}</p>
    ) : null;
    const type = config.type;
    const rules = config.rules;
    const common = {
      id: inputId,
      className: fieldClass,
      'aria-describedby': config.help ? inputId + '-help' : undefined,
    };
    const clear = !config.required && value !== undefined && (
      <Button
        type="button"
        variant="outline"
        onClick={() => updateCustom(id, undefined)}
      >
        Unset
      </Button>
    );
    let control: React.ReactNode;
    if (type === 'boolean') {
      control = (
        <select
          {...common}
          value={value === undefined ? '' : String(value)}
          onChange={(event) =>
            updateCustom(
              id,
              event.target.value === ''
                ? undefined
                : event.target.value === 'true',
            )
          }
        >
          <option value="">Choose</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    } else if (type === 'single_select' || type === 'hierarchical_select') {
      const rows = optionRows(config.options);
      const historicalValue =
        typeof value === 'string' &&
        value !== '' &&
        !rows.some((option) => option.id === value)
          ? value
          : null;
      const priorOption = historicalValue
        ? optionRows(
            priorDefinition?.fields.find((field) => field.id === id)?.options ??
              [],
          ).find((option) => option.id === historicalValue)
        : undefined;
      control = (
        <select
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) =>
            updateCustom(id, event.target.value || undefined)
          }
        >
          <option value="">Choose</option>
          {historicalValue && (
            <option value={historicalValue} disabled>
              Retained historical choice: {priorOption?.path ?? historicalValue}
            </option>
          )}
          {rows.map((option) => (
            <option key={option.id} value={option.id} disabled={!option.active}>
              {option.path}
              {!option.active ? ' (retired)' : ''}
            </option>
          ))}
        </select>
      );
    } else if (type === 'multi_select') {
      const selected = Array.isArray(value) ? value.map(String) : [];
      control = (
        <div className="space-y-1">
          {optionRows(config.options).map((option) => (
            <label key={option.id} className="flex min-h-9 items-center gap-2">
              <input
                type="checkbox"
                disabled={!option.active}
                checked={selected.includes(option.id)}
                onChange={(event) =>
                  updateCustom(
                    id,
                    event.target.checked
                      ? [...selected, option.id]
                      : selected.filter((choice) => choice !== option.id),
                  )
                }
              />
              {option.path}
              {!option.active ? ' (retired)' : ''}
            </label>
          ))}
        </div>
      );
    } else if (type === 'currency') {
      const amount =
        value && typeof value === 'object' && 'amount' in value
          ? String((value as { amount: unknown }).amount)
          : '';
      const currency =
        typeof rules.currencyCode === 'string' ? rules.currencyCode : '';
      control = (
        <div className="flex items-center gap-2">
          <Input
            {...common}
            inputMode="decimal"
            value={amount}
            onChange={(event) =>
              updateCustom(
                id,
                event.target.value === ''
                  ? undefined
                  : { amount: event.target.value, currency },
              )
            }
          />
          <span>{currency}</span>
        </div>
      );
    } else if (type === 'long_text') {
      control = (
        <textarea
          {...common}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => updateCustom(id, event.target.value)}
        />
      );
    } else {
      const inputType =
        type === 'date' ? 'date' : type === 'url' ? 'url' : 'text';
      const text = value === undefined ? '' : String(value);
      control = (
        <Input
          {...common}
          type={inputType}
          value={text}
          inputMode={
            type === 'integer' || type === 'decimal' ? 'decimal' : undefined
          }
          placeholder={
            type === 'datetime' ? '2026-09-24T12:30:00-05:00' : undefined
          }
          onChange={(event) => {
            const next = event.target.value;
            updateCustom(
              id,
              type === 'integer' &&
                /^(0|-[1-9]\d*|[1-9]\d*)$/.test(next) &&
                Number.isSafeInteger(Number(next))
                ? Number(next)
                : next,
            );
          }}
        />
      );
    }
    return (
      <div className="space-y-2" key={id}>
        <label htmlFor={inputId}>
          {config.label}
          {config.required ? ' (required)' : ''}
        </label>
        {control}
        {config.help && <div id={inputId + '-help'}>{help}</div>}
        {clear}
      </div>
    );
  };
  const builtin = (name: string) => {
    if (
      (kind === 'quantity' && ['asset_tag', 'serial_number'].includes(name)) ||
      (kind === 'asset' && name === 'reorder_threshold')
    )
      return null;
    if (name === 'category_id')
      return (
        <div className="space-y-2" key={name}>
          <label htmlFor="metadata-category">Category</label>
          <select
            id="metadata-category"
            className={fieldClass}
            value={core.category_id}
            onChange={(event) => updateCore('category_id', event.target.value)}
            required
          >
            {categories
              .filter(
                (value) => value.active || value.id === baseline?.categoryId,
              )
              .map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
          </select>
        </div>
      );
    if (name === 'description')
      return (
        <div className="space-y-2" key={name}>
          <label htmlFor="metadata-description">Description</label>
          <textarea
            id="metadata-description"
            className={fieldClass}
            rows={3}
            maxLength={4000}
            value={core.description}
            onChange={(event) => updateCore('description', event.target.value)}
          />
        </div>
      );
    return (
      <div className="space-y-2" key={name}>
        <label htmlFor={'metadata-' + name}>{labels[name] ?? name}</label>
        <Input
          id={'metadata-' + name}
          type={name === 'reorder_threshold' ? 'number' : 'text'}
          min={name === 'reorder_threshold' ? 0 : undefined}
          max={name === 'reorder_threshold' ? 2147483647 : undefined}
          maxLength={
            name === 'name' || name === 'manufacturer' || name === 'model'
              ? 200
              : 200
          }
          required={name === 'name'}
          value={core[name as keyof typeof core] ?? ''}
          onChange={(event) =>
            updateCore(name as keyof typeof core, event.target.value)
          }
        />
        {name === 'reorder_threshold' && (
          <p className="text-xs text-slate-400">
            Blank disables monitoring; zero alerts only at zero stock.
          </p>
        )}
      </div>
    );
  };
  const payload = () => {
    if (!definition || !form) return null;
    const result: Record<string, unknown> = {
      name: core.name,
      description: core.description || null,
      category_id: core.category_id,
      manufacturer: core.manufacturer || null,
      model: core.model || null,
      expected_published_revision_id: form.published_revision_id,
      custom_patch: buildCustomPatch(
        definition,
        kind,
        custom,
        touched,
        creating,
      ),
    };
    if (kind === 'quantity') {
      if (creating || thresholdTouched)
        result.reorder_threshold =
          core.reorder_threshold === '' ? null : Number(core.reorder_threshold);
      if (creating) {
        result.initial_quantity = Number(core.initial_quantity);
        result.initial_location_id =
          Number(core.initial_quantity) > 0 ? core.initial_location_id : null;
      } else {
        result.item_id = baseline?.id;
        result.expected_version = baseline?.version;
      }
    } else {
      result.asset_tag = core.asset_tag || null;
      result.serial_number = core.serial_number || null;
      if (creating) result.location_id = core.location_id;
      else {
        result.asset_id = baseline?.id;
        result.expected_version = baseline?.version;
      }
    }
    if (legacyMigration) result.acknowledge_legacy_values = ackLegacy;
    return result;
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || schemaStale || itemStale || pending) return;
    if (!review) {
      setReview(true);
      if (kind === 'asset' && core.serial_number.trim()) {
        startTransition(async () => {
          try {
            const matches = await findDuplicateSerials(
              core.serial_number,
              asset?.id,
            );
            setDuplicates(
              matches.map(
                (match) => `${match.name} (${match.assetTag ?? 'untagged'})`,
              ),
            );
          } catch {
            setDuplicates([]);
          }
        });
      }
      return;
    }
    if (legacyMigration && !ackLegacy) return;
    const commandPayload = payload();
    if (!commandPayload) return;
    const operation = `${kind}_${creating ? 'create' : 'update'}_v2` as const;
    const key = JSON.stringify([operation, commandPayload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    startTransition(async () => {
      const result = await submitInventory({
        operation,
        requestId,
        payload: commandPayload,
      });
      setState(result);
      if (result.ok) {
        setReview(false);
        setReceipt(null);
        if (creating)
          router.push(
            '/inventory/' +
              (kind === 'asset' ? 'assets' : 'quantity') +
              '/' +
              result.entityId,
          );
        router.refresh();
      } else if (
        result.code === 'stale_schema' ||
        result.code === 'stale_version'
      ) {
        router.refresh();
      }
    });
  };
  return (
    <form
      className="space-y-5"
      aria-label={
        preview
          ? `Preview ${kind} metadata`
          : creating
            ? `Create ${kind} inventory`
            : `Edit ${kind} metadata`
      }
      onSubmit={preview ? (event) => event.preventDefault() : submit}
    >
      {schemaStale && (
        <div
          className="rounded border border-amber-600 p-3 text-amber-100"
          role="alert"
        >
          The published form changed from revision {form.published_number} to{' '}
          {currentForm.published_number}. Your entered values and original form
          remain visible until you review the new revision.
          {schemaChanges.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {schemaChanges.map((change, index) => (
                <li key={`${index}-${change}`}>{change}</li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            className="ml-2"
            onClick={() => {
              setPriorForms((prior) => ({
                ...prior,
                [core.category_id]: form,
              }));
              setReviewedForms((prior) => ({
                ...prior,
                [core.category_id]: currentForm,
              }));
              setReview(false);
              setAckLegacy(false);
              setState(null);
            }}
          >
            Use reviewed form revision
          </Button>
        </div>
      )}
      {itemStale && (
        <div
          className="rounded border border-amber-600 p-3 text-amber-100"
          role="alert"
        >
          This record changed from version {baseline?.version} to{' '}
          {latest?.version}. Your entered values are still here. Review the
          latest record before using its new version. Saving your entered values
          may replace these newer values.
          {changedItemValues.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {changedItemValues.map((change) => (
                <li key={change.label}>
                  {change.label}: previous{' '}
                  {displayComparisonValue(change.before)}; latest{' '}
                  {displayComparisonValue(change.after)}.
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            className="ml-2"
            onClick={() => {
              setBaseline(latest);
              setReview(false);
              setAckLegacy(false);
              setState(null);
            }}
          >
            Use reviewed record version
          </Button>
        </div>
      )}
      {baseline?.needsMetadata && (
        <p className="rounded border border-amber-700 p-3 text-amber-100">
          This record has historical values that need metadata review. Unchanged
          values remain visible.
        </p>
      )}
      {!form && (
        <p role="alert">The selected category has no published form.</p>
      )}
      <fieldset
        disabled={pending || schemaStale || itemStale}
        className="space-y-5"
      >
        {definition?.layout.map((section) => (
          <section key={section.id} className="space-y-3">
            <h3 className="text-lg font-semibold">{section.label}</h3>
            <div className="flex flex-wrap gap-3">
              {section.controls.map((control) => {
                const content =
                  control.kind === 'field' ? (
                    customControl(control.field_id ?? '')
                  ) : control.kind === 'builtin' ? (
                    builtin(control.builtin ?? '')
                  ) : (
                    <p className="whitespace-pre-wrap text-sm text-slate-400">
                      {control.help}
                    </p>
                  );
                if (!content) return null;
                const booleanShort =
                  control.kind === 'field' &&
                  applicable.some(
                    (value) =>
                      value.id === control.field_id && value.type === 'boolean',
                  ) &&
                  (control.width === 'Auto' ||
                    control.width === 3 ||
                    control.width === 4);
                return (
                  <div
                    key={control.id}
                    style={controlLayoutStyle(control.width, booleanShort)}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {creating && !preview && kind === 'quantity' && (
          <div className="space-y-3">
            <label htmlFor="metadata-initial-quantity">Initial quantity</label>
            <Input
              id="metadata-initial-quantity"
              type="number"
              min={0}
              max={2147483647}
              required
              value={core.initial_quantity}
              onChange={(event) =>
                updateCore('initial_quantity', event.target.value)
              }
            />
            {Number(core.initial_quantity) > 0 && (
              <LocationPicker
                id="metadata-initial-location"
                label="Initial location"
                locations={locations}
                mode="destination"
                value={core.initial_location_id}
                required
                onValueChange={(value) =>
                  updateCore('initial_location_id', value)
                }
              />
            )}
          </div>
        )}
        {creating && !preview && kind === 'asset' && (
          <LocationPicker
            id="metadata-location"
            label="Current location"
            locations={locations}
            mode="destination"
            value={core.location_id}
            required
            onValueChange={(value) => updateCore('location_id', value)}
          />
        )}
      </fieldset>
      {!preview && review && (
        <div
          className="rounded border border-cyan-700 p-3"
          role="region"
          aria-label="Metadata review"
        >
          <p>
            Review {core.name || 'this record'} in{' '}
            {categories.find((value) => value.id === core.category_id)?.name}.
            Published form revision {form?.published_number}.
          </p>
          {legacyMigration && (
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={ackLegacy}
                onChange={(event) => setAckLegacy(event.target.checked)}
              />
              I understand that existing custom values from the previous
              category will remain visible as legacy values.
            </label>
          )}
          {duplicates.length > 0 && (
            <p className="text-amber-200">
              Serial also recorded on: {duplicates.join('; ')}. Duplicate
              serials are allowed.
            </p>
          )}
          <p className="text-sm text-slate-400">
            Custom values and core details save together as one record version
            and history event.
          </p>
        </div>
      )}
      {!preview && state && !state.ok && (
        <p
          role="alert"
          className="rounded border border-amber-700 p-3 text-amber-100"
        >
          {state.message}
        </p>
      )}
      {!preview && state?.ok && <p role="status">Metadata saved.</p>}
      {!preview && (
        <div className="flex gap-2">
          <Button
            disabled={
              pending ||
              !form ||
              schemaStale ||
              itemStale ||
              (review && legacyMigration && !ackLegacy)
            }
          >
            {review ? 'Confirm save' : 'Review metadata'}
          </Button>
          {review && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setReview(false)}
            >
              Edit values
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

/** Designer preview of the same controls used by inventory create/edit. */
export function MetadataFormPreview({
  kind,
  definition,
  categoryId,
  categoryName,
}: {
  kind: Kind;
  definition: MetadataDefinition;
  categoryId: string;
  categoryName: string;
}) {
  return (
    <MetadataForm
      key={categoryId}
      kind={kind}
      categories={[{ id: categoryId, name: categoryName, active: true }]}
      locations={[]}
      forms={{
        [categoryId]: {
          category_id: categoryId,
          published_revision_id: '00000000-0000-4000-8000-000000000001',
          published_number: '1',
          published_definition: definition,
          draft_id: null,
          draft_version: null,
          draft_definition: null,
        },
      }}
      preview
    />
  );
}

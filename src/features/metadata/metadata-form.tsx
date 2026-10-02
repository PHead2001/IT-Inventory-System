'use client';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { fetchCategoryForm } from './form-fetch.actions';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import {
  submitInventory,
  findDuplicateSerials,
} from '@/features/inventory/actions';
import type { MutationState } from '@/features/inventory/contracts';
import { submitCustody } from '@/features/custody/actions';
import type { CustodyState } from '@/features/custody/contracts';
import type {
  AssetItem,
  CategoryRef,
  LocationRef,
  QuantityItem,
} from '@/features/inventory/contracts-ui';
import { field as fieldClass } from '@/features/inventory/components/read-ui';
import {
  normalizeItemCode,
  itemCodeValid,
} from '@/features/inventory/contracts';
import type {
  MetadataDefinition,
  MetadataForm,
  StoredCustomValues,
} from './contracts';
import { controlLayoutStyle } from './control-layout';
import { controlVisible } from './effective-controls';
import { MetadataFieldInput } from './field-value-input';
import { fieldValueError } from './field-value-validation';
import { inventoryReturnPath } from '@/features/inventory/create-return';

type Kind = 'quantity' | 'asset';
type Props = {
  kind: Kind;
  categories: CategoryRef[];
  locations: LocationRef[];
  forms: Record<string, MetadataForm>;
  item?: QuantityItem;
  asset?: AssetItem;
  preview?: boolean;
  returnTo?: string;
  actorId?: string;
  openingSite?: { id: string; code: string; name: string };
};
const labels: Record<string, string> = {
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
  item_code:
    entity && 'itemCode' in entity ? String(entity.itemCode ?? '') : '',
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
  const visibleFields = new Set(
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
    (value) => value.applies_to.includes(kind) && visibleFields.has(value.id),
  )) {
    if (!creating && !touchedIds.has(field.id)) continue;
    const hasValue = Object.hasOwn(current, field.id);
    const value = hasValue
      ? current[field.id]
      : creating && !touchedIds.has(field.id)
        ? field.default
        : undefined;
    if (value === undefined) {
      if (!creating && touchedIds.has(field.id)) unset.push(field.id);
    } else set[field.id] = value;
  }
  return { set, unset };
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
  openingSite,
  returnTo,
  actorId,
}: Props) {
  const router = useRouter();
  const latest = item ?? asset;
  const creating = !latest;
  const scopeId = useId();
  const [formActor] = useState(actorId);
  const actorStale = formActor !== actorId;
  const [cleanCore, setCleanCore] = useState(() =>
    initialCore(latest, categories),
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [uncertain, setUncertain] = useState(false);
  const dispatched = useRef(false);
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState(latest);
  const [core, setCore] = useState(() => initialCore(latest, categories));
  const [custom, setCustom] = useState<Record<string, unknown>>(() =>
    initialCustom(latest?.customValues),
  );
  const [touched, setTouched] = useState<string[]>([]);
  const [thresholdTouched, setThresholdTouched] = useState(false);
  const [reviewedForms, setReviewedForms] = useState(() => forms);
  const [loadedForms, setLoadedForms] = useState<Record<string, MetadataForm>>(
    {},
  );
  const [formLoadError, setFormLoadError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [loadRetry, setLoadRetry] = useState(0);
  const loadGeneration = useRef(0);
  const conflictGeneration = useRef(0);
  const [schemaConflictPending, setSchemaConflictPending] = useState(false);
  const [schemaRefreshError, setSchemaRefreshError] = useState('');
  const [priorForms, setPriorForms] = useState<Record<string, MetadataForm>>(
    {},
  );
  const [review, setReview] = useState(false);
  const [ackLegacy, setAckLegacy] = useState(false);
  const [state, setState] = useState<MutationState | CustodyState | null>(null);
  const [openingQuantity, setOpeningQuantity] = useState('1');
  const [openingReason, setOpeningReason] = useState('');
  const [openingReference, setOpeningReference] = useState('');
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const routeForm = forms[core.category_id];
  const fetchedForm = loadedForms[core.category_id];
  const currentForm =
    routeForm && fetchedForm
      ? BigInt(routeForm.published_number) >
        BigInt(fetchedForm.published_number)
        ? routeForm
        : fetchedForm
      : (routeForm ?? fetchedForm);
  const form = reviewedForms[core.category_id] ?? currentForm;
  const refreshConflict = async (categoryId: string) => {
    const generation = ++conflictGeneration.current;
    setSchemaConflictPending(true);
    setSchemaRefreshError('');
    try {
      const result = await fetchCategoryForm(categoryId);
      if (generation !== conflictGeneration.current) return;
      if (!result.ok || !result.form) {
        setSchemaRefreshError(
          result.ok
            ? 'The current form is unavailable. Retry.'
            : result.message,
        );
        return;
      }
      setLoadedForms((prior) => ({ ...prior, [categoryId]: result.form! }));
    } catch {
      if (generation === conflictGeneration.current)
        setSchemaRefreshError('The current form could not be loaded. Retry.');
    } finally {
      if (generation === conflictGeneration.current)
        setSchemaConflictPending(false);
    }
  };
  useEffect(() => {
    const categoryId = core.category_id;
    if (!categoryId || forms[categoryId] || loadedForms[categoryId] || preview)
      return;
    const generation = ++loadGeneration.current;
    queueMicrotask(() => {
      if (generation === loadGeneration.current) {
        setFormLoading(true);
        setFormLoadError('');
      }
    });
    void fetchCategoryForm(categoryId)
      .then((result) => {
        if (generation !== loadGeneration.current) return;
        setFormLoading(false);
        if (!result.ok) {
          setFormLoadError(result.message);
          return;
        }
        if (!result.form) {
          setFormLoadError('This category has no published form.');
          return;
        }
        setLoadedForms((prior) => ({ ...prior, [categoryId]: result.form! }));
        setReviewedForms((prior) =>
          prior[categoryId] ? prior : { ...prior, [categoryId]: result.form! },
        );
      })
      .catch(() => {
        if (generation === loadGeneration.current) {
          setFormLoading(false);
          setFormLoadError('The form could not be loaded. Retry.');
        }
      });
    return () => {
      loadGeneration.current += 1;
    };
  }, [core.category_id, forms, loadedForms, preview, loadRetry]);
  useEffect(
    () => () => {
      conflictGeneration.current += 1;
    },
    [core.category_id],
  );
  const definition = form?.published_definition;
  const invalidItemCode =
    kind === 'quantity' && !itemCodeValid(normalizeItemCode(core.item_code));
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
    if (uncertain || dispatched.current || actorStale) return;
    setCore((prior) => ({ ...prior, [name]: value }));
    if (name === 'reorder_threshold') setThresholdTouched(true);
    if (name === 'category_id' && forms[value])
      setReviewedForms((prior) => ({ ...prior, [value]: forms[value] }));
    setReview(false);
    setAckLegacy(false);
    setState(null);
  };
  const updateCustom = (id: string, value: unknown) => {
    if (uncertain || dispatched.current || actorStale) return;
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
      : creating && !touched.includes(id)
        ? config.default
        : undefined;
    return (
      <MetadataFieldInput
        key={id}
        id={`${scopeId}-metadata-${id}`}
        field={config}
        value={value}
        onChange={(next) => updateCustom(id, next)}
        previousOptions={
          priorDefinition?.fields.find((field) => field.id === id)?.options
        }
        onValidityChange={(message) =>
          setAnswerErrors((prior) =>
            prior[id] === message ? prior : { ...prior, [id]: message },
          )
        }
      />
    );
  };
  const builtin = (name: string) => {
    if (name === 'category_id')
      return (
        <div className="space-y-2" key={name}>
          <label htmlFor={`${scopeId}-metadata-category`}>Category</label>
          <select
            id={`${scopeId}-metadata-category`}
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
          <label htmlFor={`${scopeId}-metadata-description`}>Description</label>
          <textarea
            id={`${scopeId}-metadata-description`}
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
        <label htmlFor={scopeId + '-metadata-' + name}>
          {labels[name] ?? name}
        </label>
        <Input
          id={scopeId + '-metadata-' + name}
          type={name === 'reorder_threshold' ? 'number' : 'text'}
          min={name === 'reorder_threshold' ? 0 : undefined}
          max={name === 'reorder_threshold' ? 2147483647 : undefined}
          maxLength={name === 'item_code' ? undefined : 200}
          aria-invalid={
            name === 'item_code' && invalidItemCode ? true : undefined
          }
          required={name === 'name'}
          value={core[name as keyof typeof core] ?? ''}
          onChange={(event) =>
            updateCore(name as keyof typeof core, event.target.value)
          }
        />
        {name === 'item_code' && invalidItemCode && (
          <p role="alert" className="text-sm text-amber-200">
            Use at most 100 characters without control characters.
          </p>
        )}
        {name === 'reorder_threshold' && (
          <p className="text-xs text-slate-400">
            Blank disables monitoring; zero alerts only at zero stock.
          </p>
        )}
      </div>
    );
  };
  const visibleFields = applicable.filter((field) =>
    definition?.layout.some((section) =>
      section.controls.some(
        (control) =>
          control.kind === 'field' &&
          control.field_id === field.id &&
          controlVisible(definition, section, control, kind),
      ),
    ),
  );
  const invalidAnswers = visibleFields.some((field) => {
    if (!creating && !touched.includes(field.id)) return false;
    const value = Object.hasOwn(custom, field.id)
      ? custom[field.id]
      : creating && !touched.includes(field.id)
        ? field.default
        : undefined;
    if (
      !creating &&
      core.category_id === baseline?.categoryId &&
      Object.hasOwn(baseline?.customValues ?? {}, field.id) &&
      JSON.stringify(value) ===
        JSON.stringify(baseline?.customValues?.[field.id]?.value)
    )
      return false;
    return !!fieldValueError(field, value) || !!answerErrors[field.id];
  });
  const dirty =
    JSON.stringify(core) !== JSON.stringify(cleanCore) ||
    openingQuantity !== '1' ||
    openingReason !== '' ||
    openingReference !== '' ||
    touched.some((id) => {
      const field = definition?.fields.find((field) => field.id === id);
      const original = creating
        ? field?.default
        : baseline?.customValues?.[id]?.value;
      return JSON.stringify(custom[id]) !== JSON.stringify(original);
    });
  const cancelPath = creating
    ? inventoryReturnPath(
        returnTo,
        openingSite
          ? `/sites/${encodeURIComponent(openingSite.code)}`
          : '/inventory',
      )
    : `/inventory/${kind === 'asset' ? 'assets' : 'quantity'}/${baseline?.id}`;
  const cancel = () => {
    if (pending || uncertain || dispatched.current) return;
    if (dirty) setDiscardOpen(true);
    else router.push(cancelPath);
  };
  useEffect(() => {
    if (discardOpen) keepRef.current?.focus();
  }, [discardOpen]);
  useEffect(() => {
    if (preview || !(dirty || uncertain || pending)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, uncertain, pending, preview]);
  const keepEditing = () => {
    setDiscardOpen(false);
    cancelRef.current?.focus();
  };
  const payload = () => {
    if (!definition || !form || invalidItemCode) return null;
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
      result.item_code = normalizeItemCode(core.item_code);
      if (creating || thresholdTouched)
        result.reorder_threshold =
          core.reorder_threshold === '' ? null : Number(core.reorder_threshold);
      if (creating && !openingSite) {
        result.initial_quantity = Number(core.initial_quantity);
        result.initial_location_id =
          Number(core.initial_quantity) > 0 ? core.initial_location_id : null;
      } else if (!creating) {
        result.item_id = baseline?.id;
        result.expected_version = baseline?.version;
      }
    } else {
      result.asset_tag = core.asset_tag || null;
      result.serial_number = core.serial_number || null;
      if (creating && !openingSite) result.location_id = core.location_id;
      else if (!creating) {
        result.asset_id = baseline?.id;
        result.expected_version = baseline?.version;
      }
    }
    if (legacyMigration) result.acknowledge_legacy_values = ackLegacy;
    if (creating && openingSite) {
      result.site_id = openingSite.id;
      result.reason = openingReason.trim() || null;
      result.reference = openingReference.trim() || null;
      if (kind === 'quantity') result.quantity = Number(openingQuantity);
    }
    return result;
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      actorStale ||
      (!uncertain &&
        (!form ||
          schemaStale ||
          itemStale ||
          invalidItemCode ||
          invalidAnswers)) ||
      pending ||
      dispatched.current
    )
      return;
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
    let commandPayload = payload();
    let operation =
      openingSite && creating
        ? (`${kind}_site_open` as const)
        : (`${kind}_${creating ? 'create' : 'update'}_v2` as const);
    if (uncertain && receipt)
      [operation, commandPayload] = JSON.parse(receipt.key) as [
        typeof operation,
        Record<string, unknown>,
      ];
    if (!commandPayload) return;
    const key = JSON.stringify([operation, commandPayload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    dispatched.current = true;
    startTransition(async () => {
      let result: MutationState | CustodyState;
      try {
        result =
          openingSite && creating
            ? await submitCustody({
                operation,
                requestId,
                expectedActorId: formActor,
                payload: commandPayload,
              })
            : await submitInventory({
                operation,
                requestId,
                expectedActorId: formActor,
                payload: commandPayload,
              });
      } catch {
        result = {
          ok: false,
          code: 'unexpected',
          message:
            'The result could not be confirmed. Retry the same submission to safely check it.',
        };
      }
      dispatched.current = false;
      setUncertain(
        !result.ok &&
          (result.code === 'unexpected' ||
            (uncertain &&
              [
                'forbidden',
                'P1001',
                'idempotency_conflict',
                'P1009',
                'actor_changed',
              ].includes(result.code))),
      );
      setState(result);
      if (result.ok) {
        setReview(false);
        setReceipt(null);
        setCleanCore(core);
        setTouched([]);
        if (creating)
          router.push(
            '/inventory/' +
              (kind === 'asset' ? 'assets' : 'quantity') +
              '/' +
              result.entityId,
          );
        router.refresh();
      } else if (
        result.code === 'P1024' ||
        result.code === 'stale_schema' ||
        result.code === 'stale_version' ||
        result.code === 'actor_changed'
      ) {
        if (result.code === 'P1024' || result.code === 'stale_schema')
          void refreshConflict(core.category_id);
        router.refresh();
      }
    });
  };
  return (
    <form
      className="min-w-0 space-y-5"
      aria-label={
        preview
          ? `Preview ${kind} metadata`
          : creating
            ? openingSite
              ? `Record opening ${kind} at site`
              : `Create ${kind} inventory`
            : `Edit ${kind} metadata`
      }
      onSubmit={preview ? (event) => event.preventDefault() : submit}
    >
      {actorStale && (
        <p
          role="alert"
          className="rounded border border-amber-700 p-3 text-amber-100"
        >
          The signed-in staff member changed. Your entries and original save
          request are retained. Return to the original account to continue.
        </p>
      )}
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
            disabled={pending || uncertain}
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
      {schemaConflictPending && (
        <p role="status">
          Loading the newly published category form. Your values remain
          available for review.
        </p>
      )}
      {schemaRefreshError && (
        <div role="alert">
          {schemaRefreshError}{' '}
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshConflict(core.category_id)}
          >
            Retry current form
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
            disabled={pending || uncertain}
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
      {formLoading && <p role="status">Loading category form…</p>}
      {formLoadError && !form && (
        <div role="alert">
          {formLoadError}{' '}
          <Button
            type="button"
            variant="outline"
            onClick={() => setLoadRetry((value) => value + 1)}
          >
            Retry form load
          </Button>
        </div>
      )}
      {!form && !formLoading && !formLoadError && (
        <p role="alert">The selected category has no published form.</p>
      )}
      <fieldset
        disabled={
          pending ||
          uncertain ||
          actorStale ||
          schemaStale ||
          schemaConflictPending ||
          !!schemaRefreshError ||
          itemStale
        }
        className="min-w-0 w-full max-w-full space-y-5"
      >
        {definition?.layout
          .filter((section) =>
            section.controls.some((control) =>
              controlVisible(definition, section, control, kind),
            ),
          )
          .map((section) => (
            <section
              key={section.id}
              className="min-w-0 space-y-3 border-t border-cyan-100/15 pt-4 first:border-0 first:pt-0"
            >
              <h3 className="break-words text-lg font-semibold">
                {section.label}
              </h3>
              <div className="flex flex-wrap gap-3">
                {section.controls
                  .filter((control) =>
                    controlVisible(definition, section, control, kind),
                  )
                  .map((control) => {
                    const content =
                      control.kind === 'field' ? (
                        customControl(control.field_id ?? '')
                      ) : control.kind === 'builtin' ? (
                        builtin(control.builtin ?? '')
                      ) : (
                        <p className="break-words whitespace-pre-wrap text-sm text-slate-400">
                          {control.help}
                        </p>
                      );
                    if (!content) return null;
                    const booleanShort =
                      control.kind === 'field' &&
                      applicable.some(
                        (value) =>
                          value.id === control.field_id &&
                          value.type === 'boolean',
                      ) &&
                      (control.width === 'Auto' ||
                        control.width === 3 ||
                        control.width === 4);
                    return (
                      <div
                        key={control.id}
                        style={controlLayoutStyle(control.width, booleanShort)}
                        className="min-w-0 break-words"
                      >
                        {content}
                      </div>
                    );
                  })}
              </div>
            </section>
          ))}
        {creating && !preview && !openingSite && kind === 'quantity' && (
          <div className="space-y-3">
            <label htmlFor={`${scopeId}-metadata-initial-quantity`}>
              Initial quantity
            </label>
            <Input
              id={`${scopeId}-metadata-initial-quantity`}
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
                id={`${scopeId}-metadata-initial-location`}
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
        {creating && !preview && !openingSite && kind === 'asset' && (
          <LocationPicker
            id={`${scopeId}-metadata-location`}
            label="Current location"
            locations={locations}
            mode="destination"
            value={core.location_id}
            required
            onValueChange={(value) => updateCore('location_id', value)}
          />
        )}
        {creating && !preview && openingSite && (
          <div className="space-y-3 rounded border border-slate-700 p-4">
            <p className="font-medium">
              Opening holding at {openingSite.name} ({openingSite.code})
            </p>
            <p className="text-sm text-slate-400">
              This creates a current assignment without inventing a past closet
              issue or historical date.
            </p>
            {kind === 'quantity' && (
              <label className="block space-y-2">
                Units already at this site
                <Input
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  required
                  value={openingQuantity}
                  onChange={(event) => {
                    setOpeningQuantity(event.target.value);
                    setReview(false);
                  }}
                />
              </label>
            )}
            <label className="block space-y-2">
              Reason (optional)
              <textarea
                className={fieldClass}
                maxLength={2000}
                value={openingReason}
                onChange={(event) => {
                  setOpeningReason(event.target.value);
                  setReview(false);
                }}
              />
            </label>
            <label className="block space-y-2">
              Reference (optional)
              <Input
                maxLength={200}
                value={openingReference}
                onChange={(event) => {
                  setOpeningReference(event.target.value);
                  setReview(false);
                }}
              />
            </label>
          </div>
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
                disabled={pending || uncertain}
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
            {openingSite
              ? 'Opening details, custom values and site custody save together as one version and event.'
              : 'Custom values and core details save together as one record version and history event.'}
          </p>
        </div>
      )}
      {!preview && state && !state.ok && (
        <p
          role="alert"
          className="break-words rounded border border-amber-700 p-3 text-amber-100"
        >
          {state.message}
        </p>
      )}
      {!preview && state?.ok && <p role="status">Metadata saved.</p>}
      {!preview && !uncertain && invalidAnswers && (
        <p className="text-sm text-amber-200">
          Complete the required fields and correct highlighted answers before
          reviewing.
        </p>
      )}
      {!preview && (
        <div className="sticky bottom-0 z-10 flex flex-wrap gap-2 rounded bg-slate-950/95 py-3">
          <Button
            disabled={
              pending ||
              actorStale ||
              (!uncertain &&
                (!form ||
                  schemaStale ||
                  schemaConflictPending ||
                  !!schemaRefreshError ||
                  invalidItemCode ||
                  invalidAnswers ||
                  itemStale)) ||
              (review && legacyMigration && !ackLegacy)
            }
          >
            {uncertain
              ? 'Retry same save'
              : review
                ? 'Confirm save'
                : 'Review metadata'}
          </Button>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={pending || uncertain}
            onClick={cancel}
          >
            Cancel
          </Button>
          {review && (
            <Button
              type="button"
              variant="outline"
              disabled={pending || uncertain}
              onClick={() => setReview(false)}
            >
              Edit values
            </Button>
          )}
        </div>
      )}
      {uncertain && (
        <p role="status">
          This save may have completed. Editing and Cancel are paused until
          retry confirms the outcome.
        </p>
      )}
      {discardOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Discard changes?"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              keepEditing();
            }
            if (event.key === 'Tab') {
              event.preventDefault();
              if (document.activeElement === keepRef.current)
                event.currentTarget
                  .querySelector<HTMLButtonElement>('[data-discard]')
                  ?.focus();
              else keepRef.current?.focus();
            }
          }}
        >
          <div className="max-w-md space-y-4 rounded border border-cyan-100/20 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">Discard changes?</h2>
            <p>Your entries have not been saved.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                ref={keepRef}
                onClick={keepEditing}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                data-discard
                onClick={() => {
                  setDiscardOpen(false);
                  router.push(cancelPath);
                }}
              >
                Discard changes
              </Button>
            </div>
          </div>
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

'use client';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { fetchCategoryForm } from './form-fetch.actions';
import { refreshMetadataRecord } from './record-refresh.actions';
import {
  initialCore,
  initialCustom,
  metadataLabels as labels,
  reconcileMetadata,
  compatibleSchema,
  sameAnswer,
  equalValue,
  type CoreValues,
  type RecordMetadata,
} from './reconciliation';
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
import type { MetadataDefinition, MetadataForm } from './contracts';
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
    (value) =>
      value.applies_to.includes(kind) &&
      (visibleFields.has(value.id) || (!creating && touchedIds.has(value.id))),
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
    if (field.type !== current.type)
      changes.push(`${current.label}: answer type changed.`);
    if (JSON.stringify(field.applies_to) !== JSON.stringify(current.applies_to))
      changes.push(`${current.label}: applicable inventory types changed.`);
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
function displayComparisonValue(
  value: unknown,
  definition: MetadataDefinition | undefined,
  categories: CategoryRef[],
  key: string,
  display?: RecordMetadata['customDisplay'],
  previousDefinition?: MetadataDefinition,
) {
  if (value === undefined) return 'Not recorded';
  if (key === 'category_id')
    return (
      categories.find((category) => category.id === value)?.name ??
      'Current category'
    );
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const displayed = display?.[key.replace(/^custom:/, '')];
  if (
    displayed &&
    equalValue(displayed.value, value) &&
    displayed.option_paths.length
  )
    return displayed.option_paths.map((path) => path.join(' / ')).join('; ');
  const field = definition?.fields.find(
    (candidate) => `custom:${candidate.id}` === key,
  );
  const readable = (entry: unknown) =>
    field?.options.find((option) => option.id === entry)?.label ??
    previousDefinition?.fields
      .find((field) => `custom:${field.id}` === key)
      ?.options.find((option) => option.id === entry)?.label ??
    (typeof entry === 'string' && /^[0-9a-f-]{36}$/.test(entry)
      ? 'Unavailable choice'
      : String(entry));
  if (Array.isArray(value))
    return value.map(readable).join(', ') || 'No choices';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return readable(value) || '(empty)';
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
  const incoming = item ?? asset;
  const [observed, setObserved] = useState<RecordMetadata | undefined>(
    incoming,
  );
  const latest =
    incoming && (!observed || incoming.version >= observed.version)
      ? incoming
      : observed;
  const [choices, setChoices] = useState<Record<string, 'latest' | 'mine'>>({});
  const [choiceSnapshot, setChoiceSnapshot] = useState<string | null>(null);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [recordRefreshError, setRecordRefreshError] = useState('');
  const mountedActor = useRef(actorId);
  useLayoutEffect(() => {
    mountedActor.current = actorId;
  }, [actorId]);
  const creating = !latest;
  const scopeId = useId();
  const [formActor] = useState(actorId);
  const actorStale = formActor !== actorId;
  const [cleanCore, setCleanCore] = useState(() =>
    initialCore(latest, categories),
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [inputGeneration, setInputGeneration] = useState(0);
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
  const rebaseUsed = useRef(false);
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
  const latestRouteForm = latest && forms[latest.categoryId];
  const latestLoadedForm = latest && loadedForms[latest.categoryId];
  const latestCategoryForm =
    latestRouteForm && latestLoadedForm
      ? BigInt(latestRouteForm.published_number) >
        BigInt(latestLoadedForm.published_number)
        ? latestRouteForm
        : latestLoadedForm
      : (latestRouteForm ?? latestLoadedForm);
  const snapshotKey = latest
    ? `${latest.id}:${latest.version}:${latest.categoryId}:${currentForm?.published_revision_id}:${latestCategoryForm?.published_revision_id}`
    : '';
  const reconciliation =
    latest && baseline && definition
      ? reconcileMetadata(
          baseline,
          core,
          custom,
          latest,
          definition,
          snapshotKey === choiceSnapshot ? choices : {},
        )
      : null;
  const recordBlocked =
    itemStale &&
    (!!reconciliation?.conflicts.length || !!reconciliation?.lifecycleChanged);
  const lifecycleBlocked = !!reconciliation?.lifecycleChanged;
  const untouched =
    !!baseline &&
    equalValue(core, initialCore(baseline, categories)) &&
    equalValue(custom, initialCustom(baseline.customValues));
  const schemaCompatible =
    !!definition &&
    !!currentForm &&
    compatibleSchema(definition, currentForm.published_definition);
  const adopt = (
    record: RecordMetadata,
    values: CoreValues,
    answers: Record<string, unknown>,
    dirtyIds: string[],
    resetInputs = false,
  ) => {
    setBaseline(record);
    setObserved(record);
    setCleanCore(initialCore(record, categories));
    setCore(values);
    setCustom(answers);
    setTouched(dirtyIds);

    setChoices({});
    if (resetInputs) {
      setAnswerErrors({});
      setInputGeneration((value) => value + 1);
    }
    setReview(false);
    setAckLegacy(false);
    setReceipt(null);
  };
  useEffect(() => {
    if (
      pending ||
      uncertain ||
      dispatched.current ||
      actorStale ||
      refreshNeeded
    )
      return;
    // Adopt complete untouched snapshots and proven independent edits together.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (schemaStale && (schemaCompatible || untouched) && currentForm)
        setReviewedForms((prior) => ({
          ...prior,
          [core.category_id]: currentForm,
        }));
      if (
        itemStale &&
        latest &&
        reconciliation &&
        !recordBlocked &&
        (!schemaStale || schemaCompatible)
      )
        adopt(
          latest,
          reconciliation.core,
          reconciliation.custom,
          reconciliation.touched,
        );
    });
    return () => {
      cancelled = true;
    };
  });
  const legacyMigration =
    !!baseline &&
    core.category_id !== baseline.categoryId &&
    Object.keys(baseline.customValues ?? {}).length > 0;
  const updateCore = (name: keyof typeof core, value: string) => {
    if (uncertain || dispatched.current || actorStale || refreshNeeded) return;
    setCore((prior) => ({ ...prior, [name]: value }));
    rebaseUsed.current = false;
    if (name === 'category_id' && forms[value])
      setReviewedForms((prior) => ({ ...prior, [value]: forms[value] }));
    setReview(false);
    setAckLegacy(false);
    setState(null);
  };
  const updateCustom = (id: string, value: unknown) => {
    if (uncertain || dispatched.current || actorStale || refreshNeeded) return;
    setCustom((prior) =>
      value === undefined
        ? Object.fromEntries(
            Object.entries(prior).filter(([key]) => key !== id),
          )
        : { ...prior, [id]: value },
    );
    setTouched((prior) => (prior.includes(id) ? prior : [...prior, id]));
    rebaseUsed.current = false;
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

  const comparison = (value: unknown, key: string, side: 'latest' | 'mine') =>
    displayComparisonValue(
      value,
      definition,
      [
        ...categories,
        ...(latest
          ? [{ id: latest.categoryId, name: latest.categoryName, active: true }]
          : []),
        ...(baseline
          ? [
              {
                id: baseline.categoryId,
                name: baseline.categoryName,
                active: true,
              },
            ]
          : []),
      ],
      key,
      side === 'latest' ? latest?.customDisplay : baseline?.customDisplay,
      priorDefinition,
    );
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
        key={`${id}-${inputGeneration}`}
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
  const discard = () => {
    if (pending || uncertain || dispatched.current) return;
    if (refreshNeeded) {
      const details = formRef.current?.closest('details');
      if (details) {
        details.open = false;
        details.querySelector('summary')?.focus();
      }
      return;
    }
    setDiscardOpen(false);
    if (creating) {
      router.push(cancelPath);
      return;
    }
    // Same-route navigation can preserve this mounted form. Discard explicitly,
    // including local drafts in the shared inputs, before closing the editor.
    const originalCore = initialCore(latest, categories);
    setCore(originalCore);
    setCleanCore(originalCore);
    setBaseline(latest);
    setCustom(initialCustom(latest?.customValues));
    setTouched([]);
    rebaseUsed.current = false;
    setAnswerErrors({});
    setInputGeneration((generation) => generation + 1);
    setReviewedForms({});
    setPriorForms({});
    loadGeneration.current += 1;
    conflictGeneration.current += 1;
    setFormLoading(false);
    setFormLoadError('');
    setLoadRetry((retry) => retry + 1);
    setSchemaConflictPending(false);
    setSchemaRefreshError('');
    setReview(false);
    setAckLegacy(false);
    setState(null);
    setReceipt(null);
    setChoices({});
    setRefreshNeeded(false);
    setRecordRefreshError('');
    setDuplicates([]);
    const details = formRef.current?.closest('details');
    if (details) {
      details.open = false;
      details.querySelector('summary')?.focus();
    }
  };
  const cancel = () => {
    if (pending || uncertain || dispatched.current) return;
    if (dirty && !refreshNeeded) setDiscardOpen(true);
    else discard();
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
  const payload = (
    values = core,
    answers = custom,
    dirtyIds = touched,
    record = baseline,
    selectedForm = form,
  ) => {
    if (!definition || !selectedForm || invalidItemCode) return null;
    const result: Record<string, unknown> = {
      name: values.name,
      description: values.description || null,
      category_id: values.category_id,
      manufacturer: values.manufacturer || null,
      model: values.model || null,
      expected_published_revision_id: selectedForm.published_revision_id,
      custom_patch: buildCustomPatch(
        selectedForm.published_definition,
        kind,
        answers,
        creating
          ? dirtyIds
          : dirtyIds.filter(
              (id) =>
                !sameAnswer(answers, initialCustom(record?.customValues), id),
            ),
        creating,
      ),
    };
    if (kind === 'quantity') {
      result.item_code = normalizeItemCode(values.item_code);
      if (
        creating ||
        values.reorder_threshold !==
          initialCore(record, categories).reorder_threshold
      )
        result.reorder_threshold =
          values.reorder_threshold === ''
            ? null
            : Number(values.reorder_threshold);
      if (creating && !openingSite) {
        result.initial_quantity = Number(values.initial_quantity);
        result.initial_location_id =
          Number(values.initial_quantity) > 0
            ? values.initial_location_id
            : null;
      } else if (!creating) {
        result.item_id = record?.id;
        result.expected_version = record?.version;
      }
    } else {
      result.asset_tag = values.asset_tag || null;
      result.serial_number = values.serial_number || null;
      if (creating && !openingSite) result.location_id = values.location_id;
      else if (!creating) {
        result.asset_id = record?.id;
        result.expected_version = record?.version;
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
  const reloadSaved = async () => {
    if (!baseline || mountedActor.current !== formActor) return;
    setRecordRefreshError('');
    try {
      const fresh = await refreshMetadataRecord(kind, baseline.id, formActor);
      if (mountedActor.current !== formActor) return;
      if (!fresh.ok) {
        setRecordRefreshError(fresh.message);
        return;
      }
      adopt(
        fresh.record,
        initialCore(fresh.record, categories),
        initialCustom(fresh.record.customValues),
        [],
        true,
      );
      setLoadedForms((prior) => ({
        ...prior,
        [fresh.record.categoryId]: fresh.form,
      }));
      setReviewedForms((prior) => ({
        ...prior,
        [fresh.record.categoryId]: fresh.form,
      }));
      setRefreshNeeded(false);
    } catch {
      setRecordRefreshError(
        'The saved record could not be refreshed. Retry loading it.',
      );
    }
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      actorStale ||
      (!uncertain &&
        (!form ||
          schemaStale ||
          recordBlocked ||
          refreshNeeded ||
          invalidItemCode ||
          invalidAnswers)) ||
      pending ||
      dispatched.current
    )
      return;
    if (!review && !uncertain) {
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
    let requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
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
        if (
          !creating &&
          baseline &&
          !result.ok &&
          ['stale_version', 'stale_schema', 'P1024'].includes(result.code)
        ) {
          // A definitive CAS rejection permits ONE revised operation. Unknown outcomes replay first.
          const fresh = await refreshMetadataRecord(
            kind,
            baseline.id,
            formActor,
            core.category_id,
          ).catch(() => ({
            ok: false as const,
            message:
              'The current record could not be loaded. Retry reviewing your save.',
          }));
          if (mountedActor.current === formActor && fresh.ok) {
            setObserved(fresh.record);
            setLoadedForms((prior) => ({
              ...prior,
              [fresh.record.categoryId]: fresh.form,
              [core.category_id]: fresh.draftForm,
            }));
            const merged = reconcileMetadata(
              baseline,
              core,
              custom,
              fresh.record,
              definition!,
            );
            const revisedForm =
              merged.core.category_id === fresh.record.categoryId
                ? fresh.form
                : fresh.draftForm;
            if (
              !rebaseUsed.current &&
              !merged.conflicts.length &&
              !merged.lifecycleChanged &&
              compatibleSchema(definition!, revisedForm.published_definition)
            ) {
              const revised = payload(
                merged.core,
                merged.custom,
                merged.touched,
                fresh.record,
                revisedForm,
              );
              if (revised) {
                adopt(fresh.record, merged.core, merged.custom, merged.touched);
                setReviewedForms((prior) => ({
                  ...prior,
                  [merged.core.category_id]: revisedForm,
                }));
                rebaseUsed.current = true;
                commandPayload = revised;
                requestId = crypto.randomUUID();
                setReceipt({
                  key: JSON.stringify([operation, revised]),
                  id: requestId,
                });
                result = await submitInventory({
                  operation,
                  requestId,
                  expectedActorId: formActor,
                  payload: revised,
                });
              }
            } else setReview(false);
          } else if (!fresh.ok) setRecordRefreshError(fresh.message);
        }
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
        if (!creating) {
          setRefreshNeeded(true);
          // Commit is already confirmed. A failed read is a saved/refresh state, never uncertainty.
          try {
            const fresh = await refreshMetadataRecord(
              kind,
              result.entityId,
              formActor,
            );
            if (mountedActor.current === formActor && fresh.ok) {
              adopt(
                fresh.record,
                initialCore(fresh.record, categories),
                initialCustom(fresh.record.customValues),
                [],
                true,
              );
              setLoadedForms((prior) => ({
                ...prior,
                [fresh.record.categoryId]: fresh.form,
              }));
              setReviewedForms((prior) => ({
                ...prior,
                [fresh.record.categoryId]: fresh.form,
              }));
              setRefreshNeeded(false);
            } else if (!fresh.ok) setRecordRefreshError(fresh.message);
          } catch {
            setRecordRefreshError(
              'The saved record could not be refreshed. Retry loading it.',
            );
          }
        } else {
          setCleanCore(core);
          setTouched([]);
        }
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
      ref={formRef}
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
          The category form changed. Review its requirements and retained
          answers before continuing.
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
            Review updated fields
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
      {itemStale &&
        reconciliation?.conflicts.map((conflict) => (
          <div
            key={conflict.key}
            role="alert"
            className="rounded border border-amber-600 p-3 text-amber-100"
          >
            <p>
              {conflict.label} was changed elsewhere. Latest:{' '}
              {comparison(conflict.latest, conflict.key, 'latest')}. My edit:{' '}
              {comparison(conflict.mine, conflict.key, 'mine')}.
            </p>
            {conflict.dependency && (
              <p>
                Category and custom answers must be reviewed together. Retained
                values remain available; untouched answers keep the latest
                value. The selected form still validates required answers.
              </p>
            )}
            {!!conflict.details?.length && (
              <ul className="list-disc pl-5">
                {conflict.details.map((detail) => (
                  <li key={detail.key}>
                    {detail.label}: latest{' '}
                    {comparison(detail.latest, detail.key, 'latest')}; my answer{' '}
                    {comparison(detail.mine, detail.key, 'mine')}.
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending || uncertain || actorStale}
              onClick={() => {
                setChoiceSnapshot(snapshotKey);
                setChoices((prior) => ({
                  ...(choiceSnapshot === snapshotKey ? prior : {}),
                  [conflict.key]: 'latest',
                }));
              }}
            >
              Keep latest {conflict.label}
            </Button>{' '}
            <Button
              type="button"
              variant="outline"
              disabled={pending || uncertain || actorStale}
              onClick={() => {
                setChoiceSnapshot(snapshotKey);
                setChoices((prior) => ({
                  ...(choiceSnapshot === snapshotKey ? prior : {}),
                  [conflict.key]: 'mine',
                }));
              }}
            >
              Use my {conflict.label} edit
            </Button>
          </div>
        ))}
      {lifecycleBlocked && (
        <p role="alert">
          The record&apos;s archive or retirement state changed. Cancel this
          edit and review its current status before making another change.
        </p>
      )}
      {refreshNeeded && (
        <div role="status">
          Metadata saved. {recordRefreshError || 'Loading the saved record...'}{' '}
          <Button
            type="button"
            variant="outline"
            disabled={pending || actorStale}
            onClick={() => void reloadSaved()}
          >
            Retry saved record refresh
          </Button>
        </div>
      )}
      {!refreshNeeded && recordRefreshError && (
        <p role="alert">{recordRefreshError}</p>
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
          recordBlocked ||
          refreshNeeded
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
              : 'Custom values and core details save together with history.'}
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
                  recordBlocked ||
                  refreshNeeded)) ||
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
              <Button type="button" data-discard onClick={discard}>
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

'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { countLabel } from '@/lib/count';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RequiredMark,
  useFormValidation,
  ValidationSummary,
} from '@/components/forms/validation';
import { LocationPicker } from '@/features/locations/location-picker';
import { pickerLocations } from '@/features/locations/picker-model';
import {
  submitInventory,
  findDuplicateSerials,
  reloadMoveReceipt,
  loadMoveSnapshot,
} from '../actions';
import type { MutationCommand, MutationState } from '../contracts';
import type {
  AssetItem,
  CategoryRef,
  DuplicateSerial,
  LocationRef,
  QuantityItem,
} from '../contracts-ui';
import {
  useReportTaskState,
  useTaskReset,
  useTaskDiscard,
  useTaskWarning,
} from './task-state';
import { field, panel } from './read-ui';
import { moveCompletionKey, parseMoveCompletion } from '../move-completion';
import { OperationalTimestamp } from '@/components/operational-time';

type Operation = MutationCommand['operation'];
const labels: Record<string, string> = {
  quantity_create: 'Create quantity inventory',
  quantity_receive: 'Receive stock',
  quantity_move: 'Move stock',
  quantity_adjust: 'Correct physical count',
  quantity_update: 'Edit quantity metadata',
  quantity_archive: 'Archive quantity item',
  quantity_restore: 'Restore quantity item',
  asset_create: 'Add individual asset',
  asset_move: 'Move asset',
  asset_correct_location: 'Correct recorded location',
  asset_update: 'Edit asset metadata',
  asset_retire: 'Retire asset',
  asset_restore: 'Restore asset',
};
type Props = {
  actorId?: string;
  backendScope?: string;
  operation: Operation;
  categories: CategoryRef[];
  locations: LocationRef[];
  item?: QuantityItem;
  asset?: AssetItem;
  currentLocation?: LocationRef;
  balances?: { location: LocationRef; quantity: number }[];
};
export function MutationForm(props: Props) {
  if (props.operation === 'quantity_move' && props.actorId && props.item)
    return (
      <MoveRecovery
        key={[props.backendScope, props.actorId, props.item.id].join(':')}
        {...props}
      />
    );
  return (
    <MutationFormFields
      key={[
        props.actorId,
        props.item?.id ?? props.asset?.id,
        props.operation,
      ].join(':')}
      {...props}
    />
  );
}
function MoveRecovery(props: Props) {
  const itemId = props.item!.id;
  const itemVersion = props.item!.version;
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState<Extract<
    MutationState,
    { ok: true }
  > | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [invalidPointer, setInvalidPointer] = useState(false);
  const [freshStart, setFreshStart] = useState<Awaited<
    ReturnType<typeof loadMoveSnapshot>
  > | null>(null);
  const [recoveryPending, startRecovery] = useTransition();
  const router = useRouter();
  useReportTaskState(
    {
      dirty: false,
      pending: false,
      uncertain: false,
      completed: false,
    },
    !loaded,
  );
  useEffect(() => {
    let current = true;
    queueMicrotask(async () => {
      if (!current) return;
      let raw: string | null = null;
      try {
        if (!props.backendScope) throw new Error('Backend scope unavailable');
        const key = moveCompletionKey(
          window.location.origin,
          props.backendScope,
          props.actorId!,
          itemId,
        );
        raw = sessionStorage.getItem(key);
        if (current) setStorageKey(key);
      } catch {
        if (current) {
          setStorageWarning(
            'Browser storage is unavailable. This move receipt cannot be retained through a page reload.',
          );
          setLoaded(true);
        }
        return;
      }
      if (!raw) {
        if (current) setLoaded(true);
        return;
      }
      let pointer: ReturnType<typeof parseMoveCompletion>;
      try {
        pointer = parseMoveCompletion(raw, itemId);
      } catch {
        if (current) {
          setInvalidPointer(true);
          setError(
            'The saved reference for a completed move is invalid. Discarding this reference does not undo inventory or history.',
          );
        }
        return;
      }
      try {
        const movement = await reloadMoveReceipt({
          ...pointer,
          expectedActorId: props.actorId,
        });
        if (current) {
          setRestored({
            ok: true,
            entityId: pointer.entityId,
            eventId: pointer.eventId,
            version: String(itemVersion),
            changed: true,
            movement,
          });
          setError('');
          setInvalidPointer(false);
          setLoaded(true);
        }
      } catch {
        if (current)
          setError(
            'The previous move receipt could not be verified. Retry loading it before starting another move.',
          );
      }
    });
    return () => {
      current = false;
    };
  }, [attempt, props.actorId, props.backendScope, itemId, itemVersion]);
  const discardInvalidPointer = () => {
    if (!invalidPointer || !storageKey || recoveryPending) return;
    startRecovery(async () => {
      try {
        const snapshot = await loadMoveSnapshot({
          entityId: itemId,
          expectedActorId: props.actorId,
        });
        sessionStorage.removeItem(storageKey);
        setFreshStart(snapshot);
        setRestored(null);
        setError('');
        setInvalidPointer(false);
        setLoaded(true);
        try {
          router.refresh();
        } catch {
          setStorageWarning(
            'The invalid receipt reference was discarded and current balances were verified. The page could not refresh.',
          );
        }
      } catch {
        setError(
          'The invalid reference is retained. Current balances or browser storage could not be verified. Try discarding the reference again.',
        );
      }
    });
  };
  if (!loaded)
    return (
      <div className="space-y-3">
        {error ? (
          <>
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
            <Button
              type="button"
              disabled={recoveryPending}
              onClick={() => {
                if (invalidPointer) {
                  discardInvalidPointer();
                  return;
                }
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              {invalidPointer
                ? 'Discard invalid receipt reference'
                : 'Retry loading move receipt'}
            </Button>
          </>
        ) : (
          <p role="status">Checking the previous move receipt…</p>
        )}
      </div>
    );
  return (
    <MutationFormFields
      {...props}
      initialCompletion={restored}
      completionStorageKey={storageKey}
      initialStorageWarning={storageWarning}
      freshStart={freshStart}
    />
  );
}
function MutationFormFields({
  actorId,
  operation,
  categories,
  locations: latestLocations,
  item: latestItem,
  asset: latestAsset,
  currentLocation: latestLocation,
  balances: latestBalances,
  initialCompletion = null,
  completionStorageKey = null,
  initialStorageWarning = '',
  freshStart = null,
}: Props & {
  initialCompletion?: Extract<MutationState, { ok: true }> | null;
  completionStorageKey?: string | null;
  initialStorageWarning?: string;
  freshStart?: Awaited<ReturnType<typeof loadMoveSnapshot>> | null;
}) {
  const resetTask = useTaskReset();
  const reportTaskWarning = useTaskWarning();
  const router = useRouter();
  // The editable values and their optimistic-concurrency baseline travel together.
  const [baseline, setBaseline] = useState(() => ({
    item: freshStart?.item ?? latestItem,
    asset: latestAsset,
    currentLocation: latestLocation,
    balances: freshStart?.balances ?? latestBalances ?? [],
    locations: freshStart?.locations ?? latestLocations,
  }));
  const { item, asset, currentLocation, balances } = baseline;
  const latestStockKey = JSON.stringify(latestBalances);
  const [displayStock, setDisplayStock] = useState(() => ({
    key: latestStockKey,
    balances: freshStart?.balances ?? latestBalances,
  }));
  // Availability follows observed reads; editing/review still owns its original
  // version. An explicit verified refresh may precede unchanged route props.
  if (displayStock.key !== latestStockKey)
    setDisplayStock({ key: latestStockKey, balances: latestBalances });
  const sourceHoldings =
    operation === 'quantity_move' ? (displayStock.balances ?? []) : balances;
  const locations =
    operation === 'quantity_move' ? baseline.locations : latestLocations;
  const latestCatalogKey = JSON.stringify(latestLocations);
  const [observedCatalogKey, setObservedCatalogKey] =
    useState(latestCatalogKey);
  const entity = item ?? asset;
  const latestEntity = latestItem ?? latestAsset;
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [thresholdTouched, setThresholdTouched] = useState(false);
  const [refreshedVersion, setRefreshedVersion] = useState<number | null>(null);
  const eligibleDefaultLocations = new Set(
    pickerLocations(latestLocations, 'destination').map((row) => row.id),
  );
  const positiveDefaultHoldings = balances.filter(
    (row) => row.quantity > 0 && eligibleDefaultLocations.has(row.location.id),
  );
  const [values, setValues] = useState<Record<string, string>>({
    name: entity?.name ?? '',
    description: entity?.description ?? '',
    category_id:
      entity?.categoryId ?? categories.find((c) => c.active)?.id ?? '',
    manufacturer: entity?.manufacturer ?? '',
    model: entity?.model ?? '',
    reorder_threshold:
      item?.reorderThreshold === null || item === undefined
        ? ''
        : String(item.reorderThreshold),
    asset_tag: asset?.assetTag ?? '',
    serial_number: asset?.serialNumber ?? '',
    initial_quantity: '0',
    quantity: freshStart ? '' : '1',
    observed_quantity: '0',
    source_location_id:
      balances.filter((b) => b.quantity > 0).length === 1
        ? balances.find((b) => b.quantity > 0)!.location.id
        : '',
    location_id:
      operation === 'asset_restore' &&
      currentLocation &&
      eligibleDefaultLocations.has(currentLocation.id)
        ? currentLocation.id
        : operation === 'quantity_receive' &&
            positiveDefaultHoldings.length === 1
          ? positiveDefaultHoldings[0].location.id
          : '',
    destination_location_id: '',
    initial_location_id: '',
    reason: '',
    move_all: 'false',
  });
  const [state, setState] = useState<MutationState | null>(initialCompletion);
  const [previousReceipt, setPreviousReceipt] = useState(
    Boolean(initialCompletion),
  );
  const [storageWarning, setStorageWarning] = useState(initialStorageWarning);
  const [locationError, setLocationError] = useState('');
  const [review, setReview] = useState(false);
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [duplicates, setDuplicates] = useState<DuplicateSerial[]>([]);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const submitted = useRef<MutationCommand | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [completedError, setCompletedError] = useState('');
  const [closed, setClosed] = useState(false);
  const [reviewKey, setReviewKey] = useState('');
  const completionRef = useRef<HTMLDivElement>(null);
  const completed = state?.ok === true;
  const clearCompletionPointer = () => {
    if (!completed || !completionStorageKey || !state.eventId) return true;
    try {
      const raw = sessionStorage.getItem(completionStorageKey);
      if (raw) {
        let pointer;
        try {
          pointer = parseMoveCompletion(raw, state.entityId);
        } catch {
          return true;
        }
        if (pointer.eventId === state.eventId)
          sessionStorage.removeItem(completionStorageKey);
      }
      return true;
    } catch {
      const warning =
        'The move is saved. Browser storage could not clear its receipt, so this completed move may appear again after a reload.';
      if (reportTaskWarning) reportTaskWarning(warning);
      else setStorageWarning(warning);
      return true;
    }
  };
  useTaskDiscard(() => {
    if (uncertain || (!completed && (pending || inFlight.current)))
      return false;
    return clearCompletionPointer();
  });
  const [initialValues, setInitialValues] = useState(values);
  const reportTask = useReportTaskState({
    dirty: JSON.stringify(values) !== JSON.stringify(initialValues),
    pending: pending && !completed,
    uncertain,
    completed,
  });
  useEffect(() => {
    if (completed) completionRef.current?.focus();
  }, [completed]);
  // A verified action snapshot may be newer than unchanged route props. Only
  // a newly observed prop catalog supersedes it; any changed review stays invalid.
  if (
    operation === 'quantity_move' &&
    latestCatalogKey !== observedCatalogKey &&
    !pending &&
    !uncertain
  ) {
    setObservedCatalogKey(latestCatalogKey);
    if (latestCatalogKey !== JSON.stringify(baseline.locations)) {
      setBaseline({ ...baseline, locations: latestLocations });
      setReview(false);
    }
  }
  if (
    refreshRequested &&
    !uncertain &&
    !pending &&
    !completed &&
    latestEntity &&
    latestEntity.version !== entity?.version
  ) {
    setBaseline({
      item: latestItem,
      asset: latestAsset,
      currentLocation: latestLocation,
      balances: latestBalances ?? [],
      locations: latestLocations,
    });
    setRefreshRequested(false);
    if (!thresholdTouched && latestItem)
      setValues((current) => ({
        ...current,
        reorder_threshold:
          latestItem.reorderThreshold === null
            ? ''
            : String(latestItem.reorderThreshold),
      }));
    setRefreshedVersion(state?.ok ? null : latestEntity.version);
    setReview(false);
    if (!state?.ok) setState(null);
  }
  const metadata = [
    'quantity_create',
    'quantity_update',
    'asset_create',
    'asset_update',
  ].includes(operation);
  const serialized = operation.startsWith('asset_');
  const creating = operation.endsWith('_create');
  const moving = operation === 'quantity_move';
  const sourceBalance = balances.find(
    (b) => b.location.id === values.source_location_id,
  );
  const availableSources = sourceHoldings.filter((row) => row.quantity > 0);
  const displayedSource = availableSources.find(
    (row) =>
      row.location.id === values.source_location_id &&
      locations.some((location) => location.id === row.location.id),
  );
  const snapshotKey = (
    record: QuantityItem | undefined,
    rows: Props['balances'],
  ) =>
    JSON.stringify({
      id: record?.id,
      version: record?.version,
      archived: record?.archived,
      locationCatalog: locations,
      source: rows?.find((b) => b.location.id === values.source_location_id)
        ?.quantity,
      destination:
        rows === undefined
          ? undefined
          : (rows.find((b) => b.location.id === values.destination_location_id)
              ?.quantity ?? 0),
      eligible:
        locations.find((l) => l.id === values.destination_location_id)
          ?.active &&
        locations.find((l) => l.id === values.destination_location_id)
          ?.can_hold_inventory,
    });
  const baselineKey = snapshotKey(item, balances);
  const moveSnapshotChanged =
    moving &&
    (latestBalances === undefined ||
      baselineKey !== snapshotKey(latestItem, latestBalances));
  const currentReviewKey = JSON.stringify({
    operation,
    values,
    snapshot: baselineKey,
  });
  const validReview =
    review &&
    (!moving || (!moveSnapshotChanged && reviewKey === currentReviewKey));
  if (moving && review && moveSnapshotChanged && !uncertain && !completed)
    setReview(false);
  const requiresReason = [
    'quantity_receive',
    'quantity_adjust',
    'quantity_archive',
    'quantity_restore',
    'asset_correct_location',
    'asset_retire',
    'asset_restore',
  ].includes(operation);
  function collectIssues() {
    if (uncertain || completed || pending) return [];
    const amountIssues = [];
    if (
      operation === 'quantity_receive' &&
      Number(values.quantity) +
        (balances.find((row) => row.location.id === values.location_id)
          ?.quantity ?? 0) >
        2147483647
    )
      amountIssues.push({
        id: operation + '-quantity',
        label: 'Quantity to receive',
        message:
          'This receipt would exceed the location quantity limit. Enter a smaller amount.',
      });
    if (moving) {
      const amount =
        values.move_all === 'true'
          ? sourceBalance?.quantity
          : Number(values.quantity);
      const invalid =
        !sourceBalance || sourceBalance.quantity <= 0
          ? 'Choose a source with recorded stock before reviewing.'
          : values.move_all !== 'true' &&
              (!values.quantity.trim() ||
                !Number.isSafeInteger(amount) ||
                amount! <= 0 ||
                amount! > 2147483647)
            ? 'Enter a whole number of units between 1 and 2,147,483,647.'
            : amount! > sourceBalance.quantity
              ? `This source has only ${countLabel(sourceBalance.quantity, 'unit')} available. Enter no more than ${sourceBalance.quantity}.`
              : amount! +
                    (balances.find(
                      (b) => b.location.id === values.destination_location_id,
                    )?.quantity ?? 0) >
                  2147483647
                ? 'This move would exceed the destination quantity limit. Enter a smaller amount.'
                : '';
      if (invalid) {
        amountIssues.push({
          id:
            operation +
            (values.move_all === 'true' ? '-source_location_id' : '-quantity'),
          label:
            values.move_all === 'true' ? 'Source location' : 'Quantity to move',
          message: invalid,
        });
      }
    }
    const needed =
      operation === 'quantity_create'
        ? Number(values.initial_quantity) > 0
          ? ['initial_location_id']
          : []
        : operation === 'quantity_move'
          ? ['source_location_id', 'destination_location_id']
          : [
                'quantity_receive',
                'quantity_adjust',
                'asset_create',
                'asset_move',
                'asset_correct_location',
                'asset_restore',
              ].includes(operation)
            ? ['location_id']
            : [];
    const locationIssues = [...amountIssues];
    for (const name of uncertain ? [] : needed) {
      const source = name === 'source_location_id';
      const valid = pickerLocations(
        locations,
        source ? 'source' : 'destination',
        {
          sourceIds: source
            ? availableSources.map((b) => b.location.id)
            : undefined,
          excludeIds: !source
            ? [
                ...(moving ? [values.source_location_id] : []),
                ...(['asset_move', 'asset_correct_location'].includes(
                  operation,
                ) && currentLocation
                  ? [currentLocation.id]
                  : []),
              ]
            : undefined,
        },
      ).some((location) => location.id === values[name]);
      if (!valid) {
        locationIssues.push({
          id: operation + '-' + name,
          label:
            name === 'source_location_id'
              ? 'Source location'
              : name === 'destination_location_id'
                ? 'Destination location'
                : name === 'initial_location_id'
                  ? 'Initial location'
                  : 'Location',
          message: values[name]
            ? 'Selected location is unavailable. Choose another location.'
            : 'Choose a location.',
        });
      }
    }
    return locationIssues;
  }
  const validation = useFormValidation(collectIssues);
  const amountError =
    validation.issues.find((issue) => issue.id === operation + '-quantity')
      ?.message ?? '';
  const update = useCallback(
    (name: string, value: string) => {
      if (pending || inFlight.current || uncertain || completed) return;
      setValues((v) => ({ ...v, [name]: value }));
      if (name === 'reorder_threshold') setThresholdTouched(true);
      setReview(false);
      setState(null);
      setLocationError('');
      if (name === 'serial_number') setDuplicates([]);
    },
    [pending, uncertain, completed],
  );
  const input = (
    name: string,
    label: string,
    options: {
      required?: boolean;
      max?: number;
      numeric?: boolean;
      min?: number;
    } = {},
  ) => (
    <div className="space-y-2" key={name}>
      <label htmlFor={operation + '-' + name}>
        {label}
        {options.required && <RequiredMark />}
      </label>
      <Input
        id={operation + '-' + name}
        aria-label={label}
        name={name}
        value={values[name] ?? ''}
        onChange={(event) => update(name, event.target.value)}
        required={options.required}
        maxLength={options.numeric ? undefined : options.max}
        type={options.numeric ? 'number' : 'text'}
        min={options.numeric ? (options.min ?? 0) : undefined}
        max={options.numeric ? 2147483647 : undefined}
        step={options.numeric ? 1 : undefined}
        aria-invalid={
          (moving && name === 'quantity' && !!amountError) ||
          validation.issues.some((issue) => issue.id === operation + '-' + name)
            ? true
            : undefined
        }
        aria-describedby={
          validation.props(
            operation + '-' + name,
            moving && name === 'quantity'
              ? operation + '-availability'
              : undefined,
          )['aria-describedby']
        }
      />
      {validation.error(operation + '-' + name)}
    </div>
  );
  const selectLocation = (
    name: string,
    label: string,
    source = false,
    required = true,
  ) => (
    <LocationPicker
      key={name}
      id={operation + '-' + name}
      label={label}
      locations={locations}
      mode={source ? 'source' : 'destination'}
      value={values[name] ?? ''}
      onValueChange={(next) => update(name, next)}
      sourceIds={
        source ? availableSources.map((b) => b.location.id) : undefined
      }
      availability={
        source
          ? Object.fromEntries(
              sourceHoldings.map((row) => [row.location.id, row.quantity]),
            )
          : undefined
      }
      excludeIds={
        !source
          ? [
              ...(moving ? [values.source_location_id] : []),
              ...(['asset_move', 'asset_correct_location'].includes(
                operation,
              ) && currentLocation
                ? [currentLocation.id]
                : []),
            ]
          : undefined
      }
      required={required}
      error={
        validation.issues.find((issue) => issue.id === operation + '-' + name)
          ?.message ||
        locationError ||
        (state && !state.ok ? state.fieldErrors?.[name] : undefined)
      }
      description={
        source ? 'Only locations with stock are available.' : undefined
      }
    />
  );
  const payload = (): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    if (entity) {
      result[serialized ? 'asset_id' : 'item_id'] = entity.id;
      result.expected_version = entity.version;
    }
    if (metadata) {
      for (const key of [
        'name',
        'description',
        'category_id',
        'manufacturer',
        'model',
      ])
        result[key] = values[key].trim() || null;
      if (serialized) {
        result.asset_tag = values.asset_tag.trim() || null;
        result.serial_number = values.serial_number.trim() || null;
      }
      if (!serialized && (creating || thresholdTouched))
        result.reorder_threshold =
          values.reorder_threshold === ''
            ? null
            : Number(values.reorder_threshold);
    }
    if (operation === 'quantity_create') {
      result.initial_quantity = Number(values.initial_quantity);
      result.initial_location_id =
        Number(values.initial_quantity) > 0 ? values.initial_location_id : null;
    }
    if (operation === 'quantity_receive') {
      result.location_id = values.location_id;
      result.quantity = Number(values.quantity);
    }
    if (moving) {
      result.source_location_id = values.source_location_id;
      result.destination_location_id = values.destination_location_id;
      result.move_all = values.move_all === 'true';
      if (!result.move_all) result.quantity = Number(values.quantity);
    }
    if (operation === 'quantity_adjust') {
      result.location_id = values.location_id;
      result.observed_quantity = Number(values.observed_quantity);
    }
    if (
      [
        'asset_create',
        'asset_move',
        'asset_correct_location',
        'asset_restore',
      ].includes(operation)
    )
      result.location_id = values.location_id;
    if (!metadata || operation === 'quantity_create') {
      if (values.reason.trim()) result.reason = values.reason.trim();
    }
    return result;
  };
  const locationName = (id: string) =>
    locations.find((l) => l.id === id)?.breadcrumb ?? 'No location';
  const summary = () => {
    if (moving) {
      const source =
        balances.find((b) => b.location.id === values.source_location_id)
          ?.quantity ?? 0;
      const amount =
        values.move_all === 'true' ? source : Number(values.quantity);
      const destination =
        balances.find((b) => b.location.id === values.destination_location_id)
          ?.quantity ?? 0;
      return [
        locationName(values.source_location_id) +
          ': ' +
          source +
          ' → ' +
          (source - amount) +
          ' units',
        locationName(values.destination_location_id) +
          ': ' +
          destination +
          ' → ' +
          (destination + amount) +
          ' units',
        'Physical transfer of ' + amount + ' units.',
      ];
    }
    if (operation === 'quantity_receive') {
      const count =
        balances.find((b) => b.location.id === values.location_id)?.quantity ??
        0;
      return [
        locationName(values.location_id) +
          ': ' +
          count +
          ' → ' +
          (count + Number(values.quantity)) +
          ' units',
      ];
    }
    if (operation === 'quantity_adjust') {
      const count =
        balances.find((b) => b.location.id === values.location_id)?.quantity ??
        0;
      return [
        locationName(values.location_id) +
          ': recorded ' +
          count +
          ' → observed ' +
          values.observed_quantity +
          ' units',
        'This corrects the record; it does not claim a physical transfer.',
      ];
    }
    if (operation === 'quantity_create')
      return [
        values.name + ': ' + values.initial_quantity + ' initial units',
        'Reorder threshold: ' +
          (values.reorder_threshold === ''
            ? 'Monitoring disabled'
            : values.reorder_threshold + ' units'),
        Number(values.initial_quantity) > 0
          ? locationName(values.initial_location_id)
          : 'No initial stock',
      ];
    if (operation === 'asset_create')
      return [
        values.name + ' will be active at ' + locationName(values.location_id),
      ];
    if (operation === 'asset_move' || operation === 'asset_correct_location')
      return [
        (currentLocation?.breadcrumb ?? 'Unknown') +
          ' → ' +
          locationName(values.location_id),
        operation === 'asset_move'
          ? 'Records physical movement.'
          : 'Corrects the recorded location; no physical move is claimed.',
      ];
    if (operation === 'asset_restore')
      return ['Retired → active at ' + locationName(values.location_id)];
    if (operation === 'asset_retire')
      return [
        'Active → retired. Last known location retained: ' +
          currentLocation?.breadcrumb,
      ];
    if (operation === 'quantity_archive')
      return ['Active → archived. All location balances must be zero.'];
    if (operation === 'quantity_restore')
      return ['Archived → active. No stock is created.'];
    return [
      'name',
      'description',
      'category_id',
      'manufacturer',
      'model',
      ...(serialized ? ['asset_tag', 'serial_number'] : ['reorder_threshold']),
    ].map((key) => {
      const old: Record<string, string | null | undefined> = {
        name: entity?.name,
        description: entity?.description,
        category_id: entity?.categoryName,
        manufacturer: entity?.manufacturer,
        model: entity?.model,
        asset_tag: asset?.assetTag,
        serial_number: asset?.serialNumber,
        reorder_threshold:
          item?.reorderThreshold === null || item === undefined
            ? null
            : String(item.reorderThreshold),
      };
      return (
        key.replaceAll('_', ' ') +
        ': ' +
        (old[key] || 'Not set') +
        ' → ' +
        (key === 'category_id'
          ? categories.find((c) => c.id === values[key])?.name
          : key === 'reorder_threshold' && !thresholdTouched
            ? old[key] || 'Monitoring disabled'
            : values[key] ||
              (key === 'reorder_threshold' ? 'Monitoring disabled' : 'Not set'))
      );
    });
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || inFlight.current || refreshRequested || completed) return;
    if (
      !uncertain &&
      moving &&
      (moveSnapshotChanged ||
        (state &&
          !state.ok &&
          ['stale_version', 'insufficient_stock'].includes(state.code)))
    ) {
      setReview(false);
      setState({
        ok: false,
        kind: 'domain',
        code: 'stale_version',
        message:
          'Stock changed. Refresh balances and review your entered move again.',
      });
      return;
    }
    if (!uncertain && !validation.validate(event.currentTarget)) {
      setReview(false);
      return;
    }
    if (!uncertain && !validReview) {
      setReviewKey(currentReviewKey);
      if (serialized && metadata && values.serial_number.trim()) {
        startTransition(async () => {
          try {
            setDuplicates(
              await findDuplicateSerials(values.serial_number, asset?.id),
            );
          } catch {
            setState({
              ok: false,
              kind: 'unexpected',
              code: 'unexpected',
              message:
                'Serial matches could not be checked. You may still review and save.',
            });
          }
          setReview(true);
        });
      } else setReview(true);
      return;
    }
    const commandPayload =
      uncertain && submitted.current ? submitted.current.payload : payload();
    const key = JSON.stringify({ operation, payload: commandPayload });
    const requestId =
      uncertain && submitted.current
        ? submitted.current.requestId
        : receipt?.key === key
          ? receipt.id
          : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    const command =
      uncertain && submitted.current
        ? submitted.current
        : ({
            operation,
            requestId,
            ...(actorId ? { expectedActorId: actorId } : {}),
            payload: commandPayload,
          } as MutationCommand);
    submitted.current = command;
    inFlight.current = true;
    reportTask({ pending: true });
    startTransition(async () => {
      try {
        const result = await submitInventory(command);
        setState(result);
        {
          const unresolved =
            !result.ok &&
            (result.kind === 'unexpected' ||
              (uncertain &&
                ['forbidden', 'actor_changed', 'idempotency_conflict'].includes(
                  result.code,
                )));
          setUncertain(unresolved);
          if (!result.ok && !unresolved) {
            setReview(false);
            submitted.current = null;
            setReceipt(null);
          }
        }
        if (result.ok) {
          validation.clear();
          setReview(false);
          if (moving && completionStorageKey && result.eventId) {
            try {
              sessionStorage.setItem(
                completionStorageKey,
                JSON.stringify({
                  entityId: result.entityId,
                  eventId: result.eventId,
                }),
              );
            } catch {
              setStorageWarning(
                'The move is saved. Browser storage is unavailable, so its receipt cannot be retained through a page reload.',
              );
            }
          }
          try {
            router.refresh();
          } catch {
            if (moving)
              setCompletedError(
                'The move is saved. Current balances could not be refreshed.',
              );
          }
          if (creating)
            router.push(
              '/inventory/' +
                (serialized ? 'assets' : 'quantity') +
                '/' +
                result.entityId,
            );
        }
      } catch {
        setUncertain(true);
        setState({
          ok: false,
          kind: 'unexpected',
          code: 'unexpected',
          message:
            'The result could not be confirmed. Keep these values and retry safely.',
        });
      } finally {
        inFlight.current = false;
      }
    });
  };
  const refreshMove = (startNew: boolean) => {
    if (pending || inFlight.current || !item || !actorId) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const fresh = await loadMoveSnapshot({
          entityId: item.id,
          expectedActorId: submitted.current?.expectedActorId ?? actorId,
        });
        if (state?.ok && Number(state.version) > fresh.item.version)
          throw new Error('Stale read');
        setBaseline({
          item: fresh.item,
          asset: latestAsset,
          currentLocation: latestLocation,
          balances: fresh.balances,
          locations: fresh.locations,
        });
        setDisplayStock({ key: latestStockKey, balances: fresh.balances });
        setRefreshRequested(false);
        setRefreshedVersion(null);
        setCompletedError('');
        setReview(false);
        if (startNew) {
          if (!clearCompletionPointer()) return;
          const newValues = {
            ...values,
            quantity: '',
            move_all: 'false',
            reason: '',
          };
          setValues(newValues);
          setInitialValues(newValues);
          setState(null);
          setPreviousReceipt(false);
          setReceipt(null);
          submitted.current = null;
          setUncertain(false);
          validation.clear();
        } else if (!state?.ok) setState(null);
        router.refresh();
      } catch {
        setCompletedError(
          'Current balances could not be loaded. Keep this move and try Refresh balances again.',
        );
      } finally {
        inFlight.current = false;
      }
    });
  };
  const refreshReceipt = () => {
    if (!state?.ok || !state.eventId || !actorId || pending) return;
    const saved = state;
    startTransition(async () => {
      try {
        const movement = await reloadMoveReceipt({
          entityId: saved.entityId,
          eventId: saved.eventId,
          expectedActorId: submitted.current?.expectedActorId ?? actorId,
        });
        setState({ ...saved, movement });
        setCompletedError('');
      } catch {
        setCompletedError(
          'The move is saved. Its receipt could not be loaded; try again.',
        );
      }
    });
  };
  if (closed)
    return (
      <div className="space-y-2">
        <p role="status">Done.</p>
        {storageWarning && (
          <p role="alert" className="text-sm text-amber-200">
            {storageWarning}
          </p>
        )}
      </div>
    );
  const destructive = ['asset_retire', 'quantity_archive'].includes(operation);
  const reviewContextId = operation + '-review-context';
  return (
    <form
      {...validation.formProps}
      onSubmit={submit}
      aria-label={labels[operation]}
      className="space-y-4"
      noValidate
    >
      {['asset_move', 'asset_correct_location'].includes(operation) && (
        <p className="text-sm text-slate-300">
          Move physically relocates this asset. Correct updates its recorded
          location without moving equipment.
        </p>
      )}
      {operation === 'asset_retire' && (
        <p className="text-sm text-slate-300">
          Write off removes missing or consumed quantity from recorded stock.
          Retire ends tracking of an individual asset.
        </p>
      )}
      <fieldset
        disabled={pending || uncertain}
        className="space-y-4"
        hidden={completed}
      >
        {metadata && (
          <>
            {input('name', 'Name', { required: true, max: 200 })}
            <div className="space-y-2">
              <label htmlFor={operation + '-category'}>
                Category
                <RequiredMark />
              </label>
              <select
                id={operation + '-category'}
                aria-label="Category"
                {...validation.props(operation + '-category')}
                className={field}
                value={values.category_id}
                onChange={(event) => update('category_id', event.target.value)}
                required
              >
                {categories
                  .filter((c) => c.active || c.id === entity?.categoryId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {!category.active ? ' (inactive)' : ''}
                    </option>
                  ))}
              </select>
              {validation.error(operation + '-category')}
            </div>
            {input('manufacturer', 'Manufacturer (optional)', { max: 200 })}
            {input('model', 'Model (optional)', { max: 200 })}
            {!serialized && (
              <div>
                {input('reorder_threshold', 'Reorder threshold (optional)', {
                  numeric: true,
                })}
                <p className="mt-1 text-xs text-slate-400">
                  Leave blank to disable monitoring. A threshold of 0 alerts
                  only when the item-wide recorded total is zero. All recorded
                  locations count, including inactive ones.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor={operation + '-description'}>
                Description (optional)
              </label>
              <textarea
                className={field}
                id={operation + '-description'}
                {...validation.props(operation + '-description')}
                rows={3}
                maxLength={4000}
                value={values.description}
                onChange={(event) => update('description', event.target.value)}
              />
              {validation.error(operation + '-description')}
            </div>
            {serialized && (
              <>
                {input('asset_tag', 'Asset tag (optional)', { max: 100 })}
                {input('serial_number', 'Serial number (optional)', {
                  max: 200,
                })}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        setDuplicates(
                          await findDuplicateSerials(
                            values.serial_number,
                            asset?.id,
                          ),
                        );
                      } catch {
                        setState({
                          ok: false,
                          kind: 'unexpected',
                          code: 'unexpected',
                          message:
                            'Unable to check serial matches. Saving is still allowed.',
                        });
                      }
                    })
                  }
                >
                  Check serial matches
                </Button>
                <p className="text-xs text-slate-400">
                  Duplicate serials are allowed. Asset tags must be unique,
                  including retired assets.
                </p>
                {duplicates.length > 0 && (
                  <div
                    role="status"
                    className="rounded border border-amber-700 p-3 text-sm text-amber-200"
                  >
                    Serial also recorded on:{' '}
                    {duplicates
                      .map(
                        (d) =>
                          d.name +
                          ' (' +
                          (d.assetTag || 'untagged') +
                          ', ' +
                          d.status +
                          ')',
                      )
                      .join('; ')}
                    . You can still save.
                  </div>
                )}
              </>
            )}
          </>
        )}
        {operation === 'quantity_create' && (
          <>
            {input('initial_quantity', 'Initial quantity', {
              required: true,
              numeric: true,
            })}
            {Number(values.initial_quantity) > 0 &&
              selectLocation('initial_location_id', 'Initial location')}
          </>
        )}
        {operation === 'quantity_receive' && (
          <>
            {selectLocation('location_id', 'Receive at')}
            {input('quantity', 'Quantity to receive', {
              required: true,
              numeric: true,
              min: 1,
            })}
          </>
        )}
        {moving && (
          <>
            {selectLocation('source_location_id', 'Source location', true)}
            {selectLocation('destination_location_id', 'Destination location')}
            <p
              id={operation + '-availability'}
              className="text-sm text-slate-400"
            >
              Recorded source availability:{' '}
              {displayStock.balances === undefined
                ? 'unavailable'
                : displayedSource
                  ? countLabel(displayedSource.quantity, 'unit')
                  : values.source_location_id
                    ? 'unavailable'
                    : 'choose a source'}
              .
            </p>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={values.move_all === 'true'}
                onChange={(event) =>
                  update('move_all', String(event.target.checked))
                }
              />
              Move All from this source location
            </label>
            {values.move_all !== 'true' &&
              input('quantity', 'Quantity to move', {
                required: true,
                numeric: true,
                min: 1,
              })}
          </>
        )}
        {operation === 'quantity_adjust' && (
          <>
            {selectLocation('location_id', 'Counted location')}
            {input('observed_quantity', 'Observed physical count', {
              required: true,
              numeric: true,
            })}
          </>
        )}
        {[
          'asset_create',
          'asset_move',
          'asset_correct_location',
          'asset_restore',
        ].includes(operation) &&
          selectLocation(
            'location_id',
            operation === 'asset_restore'
              ? 'Confirmed current location'
              : 'Destination location',
          )}
        {operation === 'asset_restore' &&
          currentLocation?.id === values.location_id &&
          values.location_id && (
            <p className="text-sm text-slate-400">
              Last recorded storage location. Confirm it or choose another
              location.
            </p>
          )}
        {!metadata && (
          <div className="space-y-2">
            <label htmlFor={operation + '-reason'}>
              Reason{requiresReason ? ' (required)' : ' (optional)'}
            </label>
            <textarea
              className={field}
              id={operation + '-reason'}
              {...validation.props(operation + '-reason')}
              rows={2}
              maxLength={2000}
              required={requiresReason}
              value={values.reason}
              onChange={(event) => update('reason', event.target.value)}
            />
            {validation.error(operation + '-reason')}
          </div>
        )}
      </fieldset>
      <ValidationSummary issues={validation.issues} />
      {refreshRequested && (
        <p role="status" className="text-sm text-cyan-200">
          Loading the latest record before another submission…
        </p>
      )}
      {refreshedVersion !== null && !completed && (
        <p className="text-sm text-amber-200">
          Baseline refreshed to version {refreshedVersion}. Your entries are
          preserved; review them against the updated record before confirming.
        </p>
      )}
      {validReview && !completed && (
        <section aria-label="Review changes" className={panel}>
          <h3 id={reviewContextId} className="font-semibold">
            Review {labels[operation].toLowerCase()} for{' '}
            {item?.name ?? asset?.name ?? values.name ?? 'this record'}
          </h3>
          {destructive && (
            <p className="text-sm text-[var(--warning)]">
              Warning: confirm this lifecycle change for the named record before
              saving.
            </p>
          )}
          <ul className="mt-2 space-y-2 text-sm">
            {summary().map((line, index) => (
              <li className="break-words" key={index}>
                {line}
              </li>
            ))}
          </ul>
          {values.reason && (
            <p className="mt-2 break-words text-sm">Reason: {values.reason}</p>
          )}
        </section>
      )}
      {state && !state.ok && (
        <div role="alert" className="space-y-2 text-sm text-red-300">
          <p>{state.message}</p>
          {state.fieldErrors &&
            Object.entries(state.fieldErrors).map(([key, value]) => (
              <p key={key}>
                {key}: {value}
              </p>
            ))}
          {(state.code === 'stale_version' ||
            (moving && state.code === 'insufficient_stock')) && (
            <>
              <p>
                Another change was saved. Refresh the latest record, review the
                updated quantities, and submit again. Your input stays in this
                form.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (moving && actorId) {
                    refreshMove(false);
                    return;
                  }
                  setReview(false);
                  setRefreshRequested(true);
                  router.refresh();
                }}
              >
                Refresh latest record
              </Button>
            </>
          )}
        </div>
      )}
      {state?.ok && (
        <div
          ref={completionRef}
          tabIndex={-1}
          role="status"
          className="space-y-2 text-sm text-cyan-200"
        >
          {moving ? (
            <>
              {previousReceipt && <p>Previous move receipt</p>}
              <p className="font-semibold">
                {state.movement?.itemName ?? item?.name}: move completed.
              </p>
              {state.movement ? (
                <>
                  <p>
                    Moved {state.movement.quantity}{' '}
                    {state.movement.quantity === 1 ? 'unit' : 'units'} from{' '}
                    {state.movement.source.name} to{' '}
                    {state.movement.destination.name}.
                  </p>
                  <p>
                    After this move: {state.movement.source.name}{' '}
                    {state.movement.source.after}{' '}
                    {state.movement.source.after === 1 ? 'unit' : 'units'};{' '}
                    {state.movement.destination.name}{' '}
                    {state.movement.destination.after}{' '}
                    {state.movement.destination.after === 1 ? 'unit' : 'units'}.
                  </p>
                  <p>Later transactions may change current balances.</p>
                  {state.movement.createdAt && (
                    <p>
                      <OperationalTimestamp value={state.movement.createdAt} />
                    </p>
                  )}
                </>
              ) : (
                <p>
                  The move is saved. Its committed receipt is currently
                  unavailable.
                </p>
              )}
            </>
          ) : (
            <>
              {state.changed
                ? 'Saved successfully.'
                : 'No change: the recorded state already matches.'}
            </>
          )}
        </div>
      )}
      {completedError && (
        <p role="alert" className="text-sm text-red-300">
          {completedError}
        </p>
      )}
      {storageWarning && (
        <p role="alert" className="text-sm text-amber-200">
          {storageWarning}
        </p>
      )}
      {completed && !moving ? (
        <Button
          type="button"
          className="hover:translate-y-0 active:scale-100"
          onClick={() => {
            if (resetTask) {
              resetTask();
              return;
            }
            setClosed(true);
          }}
        >
          Done
        </Button>
      ) : completed ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="hover:translate-y-0 active:scale-100"
            onClick={() => {
              if (!clearCompletionPointer()) return;
              if (resetTask) resetTask();
              else setClosed(true);
            }}
          >
            Done
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => refreshMove(true)}
            className="hover:translate-y-0 active:scale-100"
          >
            Move more
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => refreshMove(false)}
          >
            Refresh balances
          </Button>
          {!state.movement && state.eventId && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={refreshReceipt}
            >
              Load move receipt
            </Button>
          )}
        </div>
      ) : (
        <>
          {moving && moveSnapshotChanged && !uncertain && (
            <p role="status" className="text-sm text-amber-200">
              Recorded stock changed. Refresh the latest record before
              reviewing.
            </p>
          )}
          <Button
            type="submit"
            aria-describedby={validReview ? reviewContextId : undefined}
            className={destructive ? 'experience-danger-action' : undefined}
            disabled={pending || refreshRequested}
          >
            {pending
              ? 'Saving…'
              : uncertain
                ? moving
                  ? 'Retry this move safely'
                  : 'Retry same transaction'
                : validReview
                  ? 'Confirm ' + labels[operation].toLowerCase()
                  : 'Review ' + labels[operation].toLowerCase()}
          </Button>
        </>
      )}
    </form>
  );
}
export function OperationPanel(props: Props) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={panel}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="min-h-11 cursor-pointer font-medium">
        {labels[props.operation]}
      </summary>
      <div className="mt-4">{opened && <MutationForm {...props} />}</div>
    </details>
  );
}

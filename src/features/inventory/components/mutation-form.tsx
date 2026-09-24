'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import { pickerLocations } from '@/features/locations/picker-model';
import { submitInventory, findDuplicateSerials } from '../actions';
import type { MutationCommand, MutationState } from '../contracts';
import type {
  AssetItem,
  CategoryRef,
  DuplicateSerial,
  LocationRef,
  QuantityItem,
} from '../contracts-ui';
import { field, panel } from './read-ui';

type Operation = MutationCommand['operation'];
const labels: Record<string, string> = {
  quantity_create: 'Create quantity inventory',
  quantity_receive: 'Receive stock',
  quantity_move: 'Move stock',
  quantity_adjust: 'Correct physical count',
  quantity_update: 'Edit quantity metadata',
  quantity_archive: 'Archive quantity definition',
  quantity_restore: 'Restore quantity definition',
  asset_create: 'Create serialized asset',
  asset_move: 'Move asset',
  asset_correct_location: 'Correct recorded location',
  asset_update: 'Edit asset metadata',
  asset_retire: 'Retire asset',
  asset_restore: 'Restore asset',
};
type Props = {
  operation: Operation;
  categories: CategoryRef[];
  locations: LocationRef[];
  item?: QuantityItem;
  asset?: AssetItem;
  currentLocation?: LocationRef;
  balances?: { location: LocationRef; quantity: number }[];
};
export function MutationForm({
  operation,
  categories,
  locations,
  item: latestItem,
  asset: latestAsset,
  currentLocation: latestLocation,
  balances: latestBalances = [],
}: Props) {
  const router = useRouter();
  // The editable values and their optimistic-concurrency baseline travel together.
  const [baseline, setBaseline] = useState(() => ({
    item: latestItem,
    asset: latestAsset,
    currentLocation: latestLocation,
    balances: latestBalances,
  }));
  const { item, asset, currentLocation, balances } = baseline;
  const entity = item ?? asset;
  const latestEntity = latestItem ?? latestAsset;
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [thresholdTouched, setThresholdTouched] = useState(false);
  const [refreshedVersion, setRefreshedVersion] = useState<number | null>(null);
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
    quantity: '1',
    observed_quantity: '0',
    source_location_id:
      balances.filter((b) => b.quantity > 0).length === 1
        ? balances.find((b) => b.quantity > 0)!.location.id
        : '',
    location_id: '',
    destination_location_id: '',
    initial_location_id: '',
    reason: '',
    move_all: 'false',
  });
  const [state, setState] = useState<MutationState | null>(null);
  const [locationError, setLocationError] = useState('');
  const [review, setReview] = useState(false);
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [duplicates, setDuplicates] = useState<DuplicateSerial[]>([]);
  const [pending, startTransition] = useTransition();
  if (
    refreshRequested &&
    latestEntity &&
    latestEntity.version !== entity?.version
  ) {
    setBaseline({
      item: latestItem,
      asset: latestAsset,
      currentLocation: latestLocation,
      balances: latestBalances,
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
    setRefreshedVersion(latestEntity.version);
    setReview(false);
    setState(null);
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
  const requiresReason = [
    'quantity_receive',
    'quantity_adjust',
    'quantity_archive',
    'quantity_restore',
    'asset_correct_location',
    'asset_retire',
    'asset_restore',
  ].includes(operation);
  const update = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (name === 'reorder_threshold') setThresholdTouched(true);
    setReview(false);
    setState(null);
    setLocationError('');
    if (name === 'serial_number') setDuplicates([]);
  };
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
      <label htmlFor={operation + '-' + name}>{label}</label>
      <Input
        id={operation + '-' + name}
        name={name}
        value={values[name] ?? ''}
        onChange={(event) => update(name, event.target.value)}
        required={options.required}
        maxLength={options.numeric ? undefined : options.max}
        type={options.numeric ? 'number' : 'text'}
        min={options.numeric ? (options.min ?? 0) : undefined}
        max={options.numeric ? 2147483647 : undefined}
        step={options.numeric ? 1 : undefined}
      />
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
        source
          ? balances.filter((b) => b.quantity > 0).map((b) => b.location.id)
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
        locationError && !values[name]
          ? locationError
          : state && !state.ok
            ? state.fieldErrors?.[name]
            : undefined
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
    if (pending || refreshRequested) return;
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
    for (const name of needed) {
      const source = name === 'source_location_id';
      const valid = pickerLocations(
        locations,
        source ? 'source' : 'destination',
        {
          sourceIds: source
            ? balances.filter((b) => b.quantity > 0).map((b) => b.location.id)
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
        setLocationError(
          values[name]
            ? 'Selected location is unavailable. Choose another location.'
            : 'Choose a location.',
        );
        return;
      }
    }
    if (!review) {
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
    const commandPayload = payload();
    const key = JSON.stringify({ operation, payload: commandPayload });
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    startTransition(async () => {
      try {
        const result = await submitInventory({
          operation,
          requestId,
          payload: commandPayload,
        } as MutationCommand);
        setState(result);
        if (result.ok) {
          setReview(false);
          if (entity && result.changed) setRefreshRequested(true);
          router.refresh();
          if (creating)
            router.push(
              '/inventory/' +
                (serialized ? 'assets' : 'quantity') +
                '/' +
                result.entityId,
            );
        }
      } catch {
        setState({
          ok: false,
          kind: 'unexpected',
          code: 'unexpected',
          message:
            'The result could not be confirmed. Keep these values and retry safely.',
        });
      }
    });
  };
  return (
    <form
      onSubmit={submit}
      aria-label={labels[operation]}
      className="space-y-4"
    >
      <fieldset disabled={pending} className="space-y-4">
        {metadata && (
          <>
            {input('name', 'Name', { required: true, max: 200 })}
            <div className="space-y-2">
              <label htmlFor={operation + '-category'}>Category</label>
              <select
                id={operation + '-category'}
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
            </div>
            {input('manufacturer', 'Manufacturer', { max: 200 })}
            {input('model', 'Model', { max: 200 })}
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
              <label htmlFor={operation + '-description'}>Description</label>
              <textarea
                className={field}
                id={operation + '-description'}
                rows={3}
                maxLength={4000}
                value={values.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </div>
            {serialized && (
              <>
                {input('asset_tag', 'Asset tag', { max: 100 })}
                {input('serial_number', 'Serial number', { max: 200 })}
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
        {!metadata && (
          <div className="space-y-2">
            <label htmlFor={operation + '-reason'}>
              Reason{requiresReason ? ' (required)' : ' (optional)'}
            </label>
            <textarea
              className={field}
              id={operation + '-reason'}
              rows={2}
              maxLength={2000}
              required={requiresReason}
              value={values.reason}
              onChange={(event) => update('reason', event.target.value)}
            />
          </div>
        )}
      </fieldset>
      {refreshRequested && (
        <p role="status" className="text-sm text-cyan-200">
          Loading the latest record before another submission…
        </p>
      )}
      {refreshedVersion !== null && (
        <p className="text-sm text-amber-200">
          Baseline refreshed to version {refreshedVersion}. Your entries are
          preserved; review them against the updated record before confirming.
        </p>
      )}
      {review && (
        <section aria-label="Review changes" className={panel}>
          <h3 className="font-semibold">Review before saving</h3>
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
          {state.code === 'stale_version' && (
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
        <p role="status" className="text-sm text-cyan-200">
          {state.changed
            ? 'Saved successfully.'
            : 'No change: the recorded state already matches.'}
        </p>
      )}
      <Button type="submit" disabled={pending || refreshRequested}>
        {pending
          ? 'Saving…'
          : review
            ? 'Confirm ' + labels[operation].toLowerCase()
            : 'Review ' + labels[operation].toLowerCase()}
      </Button>
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

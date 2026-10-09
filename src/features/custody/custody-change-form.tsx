'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import { pickerLocations } from '@/features/locations/picker-model';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import { field, panel } from '@/features/inventory/components/read-ui';
import { submitCustody, loadCustodyReceipt } from './actions';
import { CustodyReceiptView } from './custody-receipt';
import {
  useReportTaskState,
  useTaskReset,
} from '@/features/inventory/components/task-state';
import type { Site, SiteHolding } from './queries.server';
import type { CustodyState } from './contracts';
import type { AssetReturnSuggestion } from './return-suggestion';
import {
  RequiredMark,
  useFormValidation,
  ValidationSummary,
} from '@/components/forms/validation';

type QuantityAction =
  'issue' | 'return' | 'transfer' | 'opening' | 'correct' | 'write_off';
type AssetAction =
  'assign' | 'return' | 'transfer' | 'correct' | 'write_off' | 'retire';
type Props = {
  actorId?: string;
  kind: 'quantity' | 'asset';
  action: QuantityAction | AssetAction;
  entityId: string;
  entityName?: string;
  version: string;
  locations: LocationRef[];
  sites: Site[];
  canManageConfiguration?: boolean;
  storageBalances?: { location: LocationRef; quantity: number }[];
  siteHoldings?: SiteHolding[];
  currentLocation?: LocationRef | null;
  currentSite?: Site | null;
  returnSuggestion?: AssetReturnSuggestion;
  returnSuggestionError?: boolean;
};
const titles: Record<string, string> = {
  issue: 'Issue stock to a site',
  assign: 'Assign asset to a site',
  return: 'Return to storage',
  transfer: 'Transfer between sites',
  opening: 'Record existing site holding',
  correct: 'Correct recorded site holding',
  write_off: 'Write off at site',
  retire: 'Retire asset at site',
};
const storageLabel = (location: LocationRef | undefined, fallback: string) =>
  location ? `${location.breadcrumb} (${location.code})` : fallback;
const siteLabel = (site: Site | undefined, fallback: string) =>
  site ? `${site.name} (${site.code})` : fallback;

function resolveReturnOrigin(snapshot: Props) {
  const { kind, action, entityId, version, locations } = snapshot;
  const suggestion = snapshot.returnSuggestion;
  const unavailable = {
    status: 'unavailable' as const,
    locationId: null,
    loadError: Boolean(snapshot.returnSuggestionError),
  };
  if (
    kind !== 'asset' ||
    action !== 'return' ||
    suggestion?.assetId !== entityId ||
    suggestion.assetVersion !== version
  )
    return unavailable;
  if (suggestion.status !== 'suggested')
    return { ...unavailable, status: suggestion.status };
  if (!suggestion.locationId) return unavailable;
  const eligible = pickerLocations(locations, 'destination').some(
    (row) => row.id === suggestion.locationId,
  );
  return {
    status: eligible ? ('suggested' as const) : ('ineligible' as const),
    locationId: eligible ? suggestion.locationId : null,
    loadError: false,
  };
}

export function CustodyChangeForm(latest: Props) {
  const [iteration, setIteration] = useState(0);
  return (
    <CustodyFields
      key={[iteration, latest.kind, latest.entityId, latest.action].join(':')}
      {...latest}
      startAnother={() => setIteration((value) => value + 1)}
    />
  );
}
function CustodyFields(latest: Props & { startAnother: () => void }) {
  const [baseline, setBaseline] = useState(latest);
  const { kind, action, entityId, version } = baseline;
  const {
    locations,
    sites,
    actorId,
    canManageConfiguration = false,
    storageBalances = [],
    siteHoldings = [],
    currentLocation,
    currentSite,
  } = latest;
  const resetTask = useTaskReset();
  const router = useRouter();
  const scope = `${kind}-${action}`;
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CustodyState | null>(null);
  const [closed, setClosed] = useState(false);
  const [reviewed, setReviewed] = useState<{
    key: string;
    name?: string;
    source: string;
    destination: string;
    quantity: string;
    reference: string;
  } | null>(null);
  const [returnOrigin, setReturnOrigin] = useState(() =>
    resolveReturnOrigin(latest),
  );
  const [destinationTouched, setDestinationTouched] = useState(false);
  const [values, setValues] = useState({
    source_location_id:
      currentLocation?.id ??
      storageBalances.find((row) => row.quantity > 0)?.location.id ??
      '',
    destination_location_id: returnOrigin.locationId ?? '',
    source_site_id:
      currentSite?.id ??
      siteHoldings.find((row) => row.quantity > 0)?.site_id ??
      '',
    destination_site_id: '',
    quantity: '1',
    observed_quantity: '0',
    reason: '',
    reference: '',
  });
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [initial] = useState(values);
  const [uncertain, setUncertain] = useState(false);
  const [rejectedVersion, setRejectedVersion] = useState<string | null>(null);
  const inFlight = useRef(false);
  const submitted = useRef<Parameters<typeof submitCustody>[0] | null>(null);
  const completed = state?.ok === true;
  const actorMismatch = baseline.actorId !== latest.actorId;
  const reportTask = useReportTaskState({
    dirty: JSON.stringify(values) !== JSON.stringify(initial),
    pending: pending && !completed,
    uncertain,
    completed,
  });
  const newerSnapshot = latest.version !== version;
  // A definitive stale rejection remains blocking even when input edits clear
  // its message or a failed refresh leaves the old props in place.
  const stale = newerSnapshot || rejectedVersion === version;
  const nextReturnOrigin = resolveReturnOrigin(latest);
  // Same-version reads can recover a failed lookup. Crossing versions still
  // requires explicit baseline adoption, and unresolved commands stay frozen.
  if (
    kind === 'asset' &&
    action === 'return' &&
    !stale &&
    !actorMismatch &&
    !pending &&
    !uncertain &&
    !completed &&
    (returnOrigin.status !== nextReturnOrigin.status ||
      returnOrigin.locationId !== nextReturnOrigin.locationId ||
      returnOrigin.loadError !== nextReturnOrigin.loadError)
  ) {
    setReturnOrigin(nextReturnOrigin);
    if (!destinationTouched)
      setValues((old) => ({
        ...old,
        destination_location_id: nextReturnOrigin.locationId ?? '',
      }));
    setReviewed(null);
  }
  const refreshHoldings = () => {
    try {
      router.refresh();
    } catch {
      // Keep the rejected baseline blocked and let the user retry this read.
    }
  };
  const update = (key: keyof typeof values, value: string) => {
    if (
      pending ||
      uncertain ||
      completed ||
      stale ||
      actorMismatch ||
      inFlight.current
    )
      return;
    if (key === 'destination_location_id') setDestinationTouched(true);
    setValues((old) => ({ ...old, [key]: value }));
    setReviewed(null);
    setState(null);
  };
  const fromStorage = action === 'issue' || action === 'assign';
  const toStorage = action === 'return';
  const fromSite = [
    'return',
    'transfer',
    'correct',
    'write_off',
    'retire',
  ].includes(action);
  const toSite = ['issue', 'assign', 'transfer', 'opening', 'correct'].includes(
    action,
  );
  const quantity = kind === 'quantity';
  const correction = action === 'correct';
  const reviewedRoute = reviewed
    ? quantity && correction
      ? `At ${reviewed.source}`
      : `${reviewed.source} → ${reviewed.destination}`
    : '';
  const requiresReason =
    correction || action === 'write_off' || action === 'retire';
  const positiveSites = new Set(
    siteHoldings.filter((row) => row.quantity > 0).map((row) => row.site_id),
  );
  const sourceSites = sites.filter((site) =>
    quantity ? positiveSites.has(site.id) : site.id === currentSite?.id,
  );
  const destinationSites = sites.filter(
    (site) => site.active && site.id !== values.source_site_id,
  );
  const requiresDestination = toSite && !(quantity && correction);
  const noDestination = requiresDestination && destinationSites.length === 0;
  const noSource = fromSite && sourceSites.length === 0;
  const unavailable = noDestination || noSource;
  const reviewKey = JSON.stringify({
    values,
    version: latest.version,
    locations,
    sites,
    storageBalances,
    siteHoldings,
    currentLocation,
    currentSite,
  });
  if (
    reviewed &&
    reviewed.key !== reviewKey &&
    !uncertain &&
    !pending &&
    !completed
  )
    setReviewed(null);
  function collectIssues() {
    if (uncertain || pending || completed) return [];
    const issues = [];
    if (
      fromStorage &&
      !(quantity
        ? storageBalances.some(
            (row) =>
              row.location.id === values.source_location_id && row.quantity > 0,
          )
        : currentLocation?.id === values.source_location_id &&
          !!values.source_location_id)
    )
      issues.push({
        id: scope + '-source',
        label: 'Storage source',
        message: 'Choose a storage source with recorded stock.',
      });
    if (
      toStorage &&
      !pickerLocations(locations, 'destination').some(
        (row) => row.id === values.destination_location_id,
      )
    )
      issues.push({
        id: scope + '-destination',
        label: 'Return to storage',
        message: 'Choose an available return destination.',
      });
    if (
      fromSite &&
      !sourceSites.some((row) => row.id === values.source_site_id)
    )
      issues.push({
        id: scope + '-source-site',
        label: 'Source site',
        message: 'Choose a site with recorded stock.',
      });
    if (
      requiresDestination &&
      !destinationSites.some((row) => row.id === values.destination_site_id)
    )
      issues.push({
        id: scope + '-destination-site',
        label: 'Destination site',
        message: 'Choose an available destination site.',
      });
    if (quantity && !correction && (fromStorage || fromSite)) {
      const available = fromStorage
        ? storageBalances.find(
            (row) => row.location.id === values.source_location_id,
          )?.quantity
        : siteHoldings.find((row) => row.site_id === values.source_site_id)
            ?.quantity;
      if (available !== undefined && Number(values.quantity) > available)
        issues.push({
          id: scope + '-quantity',
          label: 'Units',
          message: `This source has only ${available} units available. Enter no more than ${available}.`,
        });
    }
    if (quantity && !correction && (toStorage || toSite)) {
      const destinationCount = toStorage
        ? (storageBalances.find(
            (row) => row.location.id === values.destination_location_id,
          )?.quantity ?? 0)
        : (siteHoldings.find(
            (row) => row.site_id === values.destination_site_id,
          )?.quantity ?? 0);
      if (destinationCount + Number(values.quantity) > 2147483647)
        issues.push({
          id: scope + '-quantity',
          label: 'Units',
          message:
            'This change would exceed the destination quantity limit. Enter a smaller amount.',
        });
    }
    return issues;
  }
  const validation = useFormValidation(collectIssues);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      pending ||
      inFlight.current ||
      completed ||
      actorMismatch ||
      (!uncertain &&
        (unavailable || stale || !validation.validate(event.currentTarget)))
    )
      return;
    const payload: Record<string, unknown> = {
      action,
      [quantity ? 'item_id' : 'asset_id']: entityId,
      expected_version: version,
      reason: values.reason.trim() || null,
      reference: values.reference.trim() || null,
    };
    if (fromStorage) payload.source_location_id = values.source_location_id;
    if (toStorage)
      payload.destination_location_id = values.destination_location_id;
    if (fromSite) payload.source_site_id = values.source_site_id;
    if (toSite && !(quantity && correction))
      payload.destination_site_id = values.destination_site_id;
    if (quantity) {
      if (correction)
        payload.observed_quantity = Number(values.observed_quantity);
      else payload.quantity = Number(values.quantity);
    }
    if (!uncertain && !reviewed) {
      setReviewed({
        key: reviewKey,
        name: latest.entityName,
        source: fromStorage
          ? storageLabel(
              locations.find((row) => row.id === values.source_location_id),
              'Recorded storage source',
            )
          : fromSite
            ? siteLabel(
                sites.find((row) => row.id === values.source_site_id),
                'Recorded source site',
              )
            : 'Opening / no source',
        destination: toStorage
          ? storageLabel(
              locations.find(
                (row) => row.id === values.destination_location_id,
              ),
              'Recorded storage destination',
            )
          : quantity && correction
            ? siteLabel(
                sites.find((row) => row.id === values.source_site_id),
                'Recorded source site',
              )
            : requiresDestination
              ? siteLabel(
                  sites.find((row) => row.id === values.destination_site_id),
                  'Recorded destination site',
                )
              : 'No destination',
        quantity: correction ? values.observed_quantity : values.quantity,
        reference: values.reference.trim(),
      });
      return;
    }
    const operation = quantity ? 'quantity_site_change' : 'asset_site_change';
    const key = JSON.stringify([operation, payload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    const command =
      uncertain && submitted.current
        ? submitted.current
        : {
            operation,
            requestId,
            payload,
            ...(actorId ? { expectedActorId: actorId } : {}),
          };
    submitted.current = command;
    inFlight.current = true;
    reportTask({ pending: true });
    startTransition(async () => {
      try {
        const result = await submitCustody(command);
        setState(result);
        const unresolved =
          !result.ok &&
          (result.code === 'unexpected' ||
            (uncertain &&
              [
                'P1001',
                'P1009',
                'forbidden',
                'actor_changed',
                'idempotency_conflict',
              ].includes(result.code)));
        setUncertain(unresolved);
        if (result.ok) {
          validation.clear();
          try {
            router.refresh();
          } catch {
            /* The confirmed receipt remains authoritative. */
          }
        } else if (!unresolved) {
          setReviewed(null);
          submitted.current = null;
          setReceipt(null);
          if (result.code === 'P1002') {
            setRejectedVersion(version);
            refreshHoldings();
          }
        }
      } catch {
        setUncertain(true);
        setState({
          ok: false,
          code: 'unexpected',
          message:
            'The result could not be confirmed. Retry the same custody transaction safely.',
        });
      } finally {
        inFlight.current = false;
      }
    });
  };
  if (completed)
    return (
      <section
        className={panel + ' max-w-4xl space-y-4'}
        aria-label="Custody completion"
      >
        {state.custody ? (
          <>
            <CustodyReceiptView
              receipt={state.custody}
              reviewedName={reviewed?.name}
            />
            {reviewed && (
              <p className="break-words text-sm">
                Reviewed route: {reviewedRoute}{' '}
                <span className="text-slate-400">
                  (endpoints reviewed for this operation)
                </span>
              </p>
            )}
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Custody saved</h3>
            {reviewed?.name && (
              <p className="break-words">
                {reviewed.name} (name reviewed for this operation)
              </p>
            )}
            <p>
              {quantity && correction
                ? `Count correction at ${reviewed?.source}`
                : `${titles[action]} · ${reviewed?.source} → ${reviewed?.destination}`}
            </p>
            <p>
              {quantity
                ? correction
                  ? `Reviewed observed count: ${reviewed?.quantity} units (submitted for this operation)`
                  : `${reviewed?.quantity} units`
                : '1 individual asset'}
            </p>
            {reviewed?.reference && (
              <p>Ticket number reference: {reviewed.reference}</p>
            )}
            <p className="text-sm text-slate-300">
              {state.changed
                ? 'The transaction is confirmed. The event receipt is not available yet; current holdings are not its receipt balances.'
                : 'No balance change was needed.'}
            </p>
            {state.eventId && actorId && (
              <Button
                type="button"
                disabled={pending || actorMismatch}
                onClick={() =>
                  startTransition(async () => {
                    const detail = await loadCustodyReceipt({
                      kind,
                      entityId,
                      eventId: state.eventId,
                      expectedActorId: actorId,
                    });
                    if (detail) setState({ ...state, custody: detail });
                  })
                }
              >
                Load confirmed receipt
              </Button>
            )}
          </>
        )}
        {state.refreshFailed && (
          <p role="status" className="text-sm text-amber-200">
            Saved successfully. Receipt details or page refresh could not be
            loaded. Refresh to check current holdings; do not submit this
            operation again.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {!closed && (
            <Button
              type="button"
              onClick={() => {
                if (resetTask) resetTask();
                else setClosed(true);
              }}
            >
              Done
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={actorMismatch || latest.version !== state.version}
            onClick={latest.startAnother}
          >
            {action === 'issue' || action === 'assign'
              ? 'Issue another'
              : 'Start another operation'}
          </Button>
          <Link
            className="inline-flex min-h-11 items-center text-cyan-300 underline"
            href={`/inventory/${kind === 'quantity' ? 'quantity' : 'assets'}/${entityId}`}
          >
            View record
          </Link>
        </div>
        {closed && (
          <p role="status">Done. The completed operation is retained above.</p>
        )}
        {latest.version !== state.version && (
          <p className="text-sm text-slate-300">
            Refresh and review current holdings before starting another
            operation.
          </p>
        )}
      </section>
    );
  return (
    <form
      {...validation.formProps}
      aria-label={titles[action]}
      className={panel + ' max-w-4xl space-y-4'}
      onSubmit={submit}
      noValidate
    >
      <h3 className="text-lg font-semibold">{titles[action]}</h3>
      {['write_off', 'retire'].includes(action) && (
        <p className="text-sm text-slate-300">
          Write off removes missing or consumed quantity from recorded stock.
          Retire ends tracking of an individual asset.
        </p>
      )}
      {actorMismatch && (
        <p role="alert">
          Return to the original signed-in account to continue or resolve this
          operation.
        </p>
      )}
      {unavailable && (
        <div role="note" className="experience-feedback text-sm">
          <p>
            {noDestination
              ? sites.length === 0
                ? 'No sites are configured. This operation needs a destination site.'
                : !sites.some((site) => site.active)
                  ? 'No active sites are available for this operation.'
                  : 'No other active site is available as a destination.'
              : 'There is no recorded holding at a site to use as the source for this operation.'}
          </p>
          {noDestination &&
            (canManageConfiguration ? (
              <Link href="/settings/sites" className="text-cyan-300 underline">
                Open site settings
              </Link>
            ) : (
              <p>
                Ask a configuration maintainer to add or restore a suitable
                site.
              </p>
            ))}
        </div>
      )}
      <fieldset
        disabled={
          pending ||
          uncertain ||
          completed ||
          unavailable ||
          stale ||
          actorMismatch
        }
        className="space-y-4"
      >
        {action === 'opening' && (
          <p className="text-sm text-slate-300">
            Opening holdings describe equipment already at a site. No past
            closet issue or date is invented.
          </p>
        )}
        {fromStorage && (
          <LocationPicker
            id={`${kind}-${action}-source`}
            label="Storage source"
            locations={locations}
            mode="source"
            sourceIds={
              quantity
                ? storageBalances
                    .filter((row) => row.quantity > 0)
                    .map((row) => row.location.id)
                : currentLocation
                  ? [currentLocation.id]
                  : []
            }
            availability={
              quantity
                ? Object.fromEntries(
                    storageBalances.map((row) => [
                      row.location.id,
                      row.quantity,
                    ]),
                  )
                : undefined
            }
            value={values.source_location_id}
            onValueChange={(value) => update('source_location_id', value)}
            required
            error={
              validation.issues.find((issue) => issue.id === scope + '-source')
                ?.message
            }
          />
        )}
        {toStorage && (
          <>
            <LocationPicker
              id={`${kind}-${action}-destination`}
              label="Return to storage"
              locations={locations}
              mode="destination"
              value={values.destination_location_id}
              onValueChange={(value) =>
                update('destination_location_id', value)
              }
              required
              error={
                validation.issues.find(
                  (issue) => issue.id === scope + '-destination',
                )?.message
              }
            />
            {!quantity && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => update('destination_location_id', '')}
                  disabled={pending || uncertain || completed}
                >
                  Clear destination
                </Button>
                <p className="text-sm text-slate-400">
                  {returnOrigin.loadError
                    ? 'The previous storage location could not be checked. Choose a destination, or refresh to retry.'
                    : returnOrigin.status === 'suggested'
                      ? 'Initially suggested from this asset’s site assignment. You can choose another destination.'
                      : returnOrigin.status === 'no_storage_origin'
                        ? 'This assignment began at a site, with no recorded storage origin. Choose a destination.'
                        : returnOrigin.status === 'ineligible'
                          ? 'The previous storage location is no longer available. Choose a destination.'
                          : 'The storage origin for this assignment is unavailable. Choose a destination.'}
                </p>
              </>
            )}
          </>
        )}
        {fromSite && (
          <label className="block space-y-2">
            Source site
            <RequiredMark />
            <select
              id={scope + '-source-site'}
              aria-label="Source site"
              {...validation.props(scope + '-source-site')}
              className={field}
              required
              value={values.source_site_id}
              onChange={(event) => update('source_site_id', event.target.value)}
            >
              <option value="">Choose site</option>
              {sourceSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.code})
                </option>
              ))}
            </select>
            {validation.error(scope + '-source-site')}
          </label>
        )}
        {toSite && !(quantity && correction) && (
          <label className="block space-y-2">
            Destination site
            <RequiredMark />
            <select
              id={scope + '-destination-site'}
              aria-label="Destination site"
              {...validation.props(scope + '-destination-site')}
              className={field}
              required
              value={values.destination_site_id}
              onChange={(event) =>
                update('destination_site_id', event.target.value)
              }
            >
              <option value="">Choose site</option>
              {destinationSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.code})
                </option>
              ))}
            </select>
            {validation.error(scope + '-destination-site')}
          </label>
        )}
        {quantity &&
          (correction ? (
            <label className="block space-y-2">
              Observed units at site
              <RequiredMark />
              <Input
                id={scope + '-observed'}
                aria-label="Observed units at site"
                {...validation.props(scope + '-observed')}
                type="number"
                min={0}
                max={2147483647}
                step={1}
                required
                value={values.observed_quantity}
                onChange={(e) => update('observed_quantity', e.target.value)}
              />
              {validation.error(scope + '-observed')}
            </label>
          ) : (
            <label className="block space-y-2">
              Units
              <RequiredMark />
              <Input
                id={scope + '-quantity'}
                aria-label="Units"
                {...validation.props(scope + '-quantity')}
                type="number"
                min={1}
                max={2147483647}
                step={1}
                required
                value={values.quantity}
                onChange={(e) => update('quantity', e.target.value)}
              />
              {validation.error(scope + '-quantity')}
            </label>
          ))}
        <label className="block space-y-2">
          Reason {requiresReason ? '(required)' : '(optional)'}
          <textarea
            id={scope + '-reason'}
            aria-label={
              requiresReason ? 'Reason (required)' : 'Reason (optional)'
            }
            {...validation.props(scope + '-reason')}
            className={field}
            required={requiresReason}
            maxLength={2000}
            value={values.reason}
            onChange={(e) => update('reason', e.target.value)}
          />
          {validation.error(scope + '-reason')}
        </label>
        <label className="block space-y-2">
          Ticket number reference (optional)
          <Input
            id={scope + '-reference'}
            {...validation.props(scope + '-reference')}
            maxLength={200}
            value={values.reference}
            onChange={(e) => update('reference', e.target.value)}
          />
          {validation.error(scope + '-reference')}
        </label>
      </fieldset>
      <ValidationSummary issues={validation.issues} />
      {reviewed && !uncertain && (
        <section aria-label="Review changes" className={panel}>
          <h3 id={scope + '-review-context'} className="font-semibold">
            Review {titles[action].toLowerCase()} for{' '}
            {reviewed.name ?? latest.entityName ?? 'this record'}
          </h3>
          {['write_off', 'retire'].includes(action) && (
            <p className="text-sm text-[var(--warning)]">
              Warning: confirm this removal for the named record before saving.
            </p>
          )}
          <p>
            {reviewed.name ?? 'This record'} ·{' '}
            {quantity ? `${reviewed.quantity} units` : '1 individual asset'}
          </p>
          <p>{reviewedRoute}</p>
          {reviewed.reference && (
            <p>Ticket number reference: {reviewed.reference}</p>
          )}
          {values.reason && <p>Reason: {values.reason}</p>}
        </section>
      )}
      {state && (
        <p
          role="status"
          className="experience-feedback"
          data-tone={state.ok ? 'success' : 'error'}
        >
          {state.ok
            ? 'Custody saved. Current holdings and history will refresh.'
            : state.message}
        </p>
      )}
      {stale && !uncertain && !completed && (
        <div role="alert">
          <p>
            {newerSnapshot
              ? 'This record changed. Review the latest holdings before submitting; your entries are retained.'
              : 'The latest holdings have not loaded. Refresh to try again; your entries are retained.'}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending || actorMismatch}
            onClick={() => {
              if (!newerSnapshot) {
                refreshHoldings();
                return;
              }
              setBaseline(latest);
              setRejectedVersion(null);
              setReviewed(null);
              setState(null);
            }}
          >
            {newerSnapshot
              ? 'Review latest holdings'
              : 'Refresh latest holdings'}
          </Button>
        </div>
      )}
      <Button
        aria-describedby={
          reviewed && !uncertain ? scope + '-review-context' : undefined
        }
        className={
          ['write_off', 'retire'].includes(action)
            ? 'experience-danger-action'
            : undefined
        }
        disabled={
          pending || actorMismatch || (!uncertain && (unavailable || stale))
        }
        type="submit"
      >
        {pending
          ? 'Saving…'
          : uncertain
            ? 'Retry same custody transaction'
            : `${reviewed ? 'Confirm' : 'Review'} ${titles[action].toLowerCase()}`}
      </Button>
    </form>
  );
}

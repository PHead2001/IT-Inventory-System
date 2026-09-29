'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import { field, panel } from '@/features/inventory/components/read-ui';
import { submitCustody } from './actions';
import type { Site, SiteHolding } from './queries.server';
import type { CustodyState } from './contracts';

type QuantityAction =
  'issue' | 'return' | 'transfer' | 'opening' | 'correct' | 'write_off';
type AssetAction =
  'assign' | 'return' | 'transfer' | 'correct' | 'write_off' | 'retire';
type Props = {
  kind: 'quantity' | 'asset';
  action: QuantityAction | AssetAction;
  entityId: string;
  version: string;
  locations: LocationRef[];
  sites: Site[];
  storageBalances?: { location: LocationRef; quantity: number }[];
  siteHoldings?: SiteHolding[];
  currentLocation?: LocationRef | null;
  currentSite?: Site | null;
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

export function CustodyChangeForm({
  kind,
  action,
  entityId,
  version,
  locations,
  sites,
  storageBalances = [],
  siteHoldings = [],
  currentLocation,
  currentSite,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CustodyState | null>(null);
  const [values, setValues] = useState({
    source_location_id:
      currentLocation?.id ??
      storageBalances.find((row) => row.quantity > 0)?.location.id ??
      '',
    destination_location_id: '',
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
  const update = (key: keyof typeof values, value: string) => {
    setValues((old) => ({ ...old, [key]: value }));
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
  const requiresReason =
    correction || action === 'write_off' || action === 'retire';
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
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
    const operation = quantity ? 'quantity_site_change' : 'asset_site_change';
    const key = JSON.stringify([operation, payload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    startTransition(async () => {
      const result = await submitCustody({ operation, requestId, payload });
      setState(result);
      if (result.ok) {
        setReceipt(null);
        router.refresh();
      }
    });
  };
  const positiveSites = new Set(
    siteHoldings.filter((row) => row.quantity > 0).map((row) => row.site_id),
  );
  return (
    <form className={panel + ' max-w-4xl space-y-4'} onSubmit={submit}>
      <h3 className="text-lg font-semibold">{titles[action]}</h3>
      {action === 'opening' && (
        <p className="text-sm text-slate-300">
          Opening holdings describe equipment already at a site. No past closet
          issue or date is invented.
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
          value={values.source_location_id}
          onValueChange={(value) => update('source_location_id', value)}
          required
        />
      )}
      {toStorage && (
        <LocationPicker
          id={`${kind}-${action}-destination`}
          label="Return to storage"
          locations={locations}
          mode="destination"
          value={values.destination_location_id}
          onValueChange={(value) => update('destination_location_id', value)}
          required
        />
      )}
      {fromSite && (
        <label className="block space-y-2">
          Source site
          <select
            className={field}
            required
            value={values.source_site_id}
            onChange={(event) => update('source_site_id', event.target.value)}
          >
            <option value="">Choose site</option>
            {sites
              .filter((site) =>
                quantity
                  ? positiveSites.has(site.id)
                  : site.id === currentSite?.id,
              )
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.code})
                </option>
              ))}
          </select>
        </label>
      )}
      {toSite && !(quantity && correction) && (
        <label className="block space-y-2">
          Destination site
          <select
            className={field}
            required
            value={values.destination_site_id}
            onChange={(event) =>
              update('destination_site_id', event.target.value)
            }
          >
            <option value="">Choose site</option>
            {sites
              .filter(
                (site) => site.active && site.id !== values.source_site_id,
              )
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.code})
                </option>
              ))}
          </select>
        </label>
      )}
      {quantity &&
        (correction ? (
          <label className="block space-y-2">
            Observed units at site
            <Input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              required
              value={values.observed_quantity}
              onChange={(e) => update('observed_quantity', e.target.value)}
            />
          </label>
        ) : (
          <label className="block space-y-2">
            Units
            <Input
              type="number"
              min={1}
              max={2147483647}
              step={1}
              required
              value={values.quantity}
              onChange={(e) => update('quantity', e.target.value)}
            />
          </label>
        ))}
      <label className="block space-y-2">
        Reason {requiresReason ? '(required)' : '(optional)'}
        <textarea
          className={field}
          required={requiresReason}
          maxLength={2000}
          value={values.reason}
          onChange={(e) => update('reason', e.target.value)}
        />
      </label>
      <label className="block space-y-2">
        Work-order reference (optional)
        <Input
          maxLength={200}
          value={values.reference}
          onChange={(e) => update('reference', e.target.value)}
        />
      </label>
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
      <Button disabled={pending} type="submit">
        {pending ? 'Saving…' : titles[action]}
      </Button>
    </form>
  );
}

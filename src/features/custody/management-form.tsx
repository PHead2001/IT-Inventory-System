'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { field, panel } from '@/features/inventory/components/read-ui';
import { submitCustody } from './actions';
import { suggestSiteCode } from './site-code';
import type { ManagedLocation, Site } from './queries.server';
import type { CustodyOperation, CustodyState } from './contracts';

function useSubmission() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CustodyState | null>(null);
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const submit = (
    operation: CustodyOperation,
    payload: Record<string, unknown>,
    onSuccess?: (id: string) => void,
  ) => {
    const key = JSON.stringify([operation, payload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    startTransition(async () => {
      const result = await submitCustody({ operation, requestId, payload });
      setState(result);
      if (result.ok) {
        setReceipt(null);
        onSuccess?.(result.entityId);
        router.refresh();
      }
    });
  };
  return { pending, state, setState, submit };
}

export function SiteManagementForm({ site }: { site?: Site }) {
  const { pending, state, setState, submit } = useSubmission();
  const [values, setValues] = useState({
    code: '',
    name: site?.name ?? '',
    notes: site?.notes ?? '',
    active: site?.active ?? true,
  });
  const [confirmArchive, setConfirmArchive] = useState(false);
  const suggestedCode = site ? '' : suggestSiteCode(values.name);
  const code = values.code || suggestedCode;
  const update = (key: keyof typeof values, value: string | boolean) => {
    setValues((old) => ({ ...old, [key]: value }));
    setState(null);
  };
  return (
    <form
      className={panel + ' space-y-4'}
      onSubmit={(event) => {
        event.preventDefault();
        if (site && !values.active && !confirmArchive) return;
        submit(
          site ? 'site_update' : 'site_create',
          site
            ? {
                site_id: site.id,
                expected_version: site.version,
                name: values.name,
                notes: values.notes || null,
                active: values.active,
              }
            : {
                code,
                name: values.name,
                notes: values.notes || null,
              },
        );
      }}
    >
      <h2 className="text-lg font-semibold">
        {site ? `Manage ${site.name}` : 'Add property / site'}
      </h2>
      <label className="block space-y-2">
        Name
        <Input
          value={values.name}
          maxLength={200}
          required
          onChange={(e) => update('name', e.target.value)}
        />
      </label>
      {!site && (
        <div className="space-y-2">
          <label className="block space-y-2">
            Permanent code
            <Input
              value={code}
              maxLength={100}
              required
              pattern="[A-Z][A-Z0-9]*(-[A-Z0-9]+)*"
              aria-describedby="site-code-guidance"
              onChange={(e) => update('code', e.target.value.toUpperCase())}
            />
          </label>
          <p id="site-code-guidance" className="text-sm text-slate-400">
            Suggested from the name when possible; edit to override or enter a
            code manually if no suggestion appears.
          </p>
        </div>
      )}
      <label className="block space-y-2">
        Notes
        <textarea
          className={field}
          value={values.notes}
          maxLength={2000}
          onChange={(e) => update('notes', e.target.value)}
        />
      </label>
      {site && (
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(e) => {
              update('active', e.target.checked);
              setConfirmArchive(false);
            }}
          />{' '}
          Active site
        </label>
      )}
      {site && !values.active && (
        <label className="flex min-h-11 items-center gap-3 text-amber-200">
          <input
            type="checkbox"
            required
            checked={confirmArchive}
            onChange={(e) => setConfirmArchive(e.target.checked)}
          />{' '}
          I have resolved every assigned holding. Archiving is blocked while any
          remain.
        </label>
      )}
      {state && (
        <p
          role="status"
          className={state.ok ? 'text-emerald-200' : 'text-amber-200'}
        >
          {state.ok
            ? 'Site saved. Code and history remain unchanged.'
            : state.message}
        </p>
      )}
      <Button disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Save site'}
      </Button>
      {site && (
        <p className="text-xs text-slate-400">
          Permanent code: {site.code}. Concurrent edits require a fresh review
          before retry.
        </p>
      )}
    </form>
  );
}

const kinds = [
  ['room', 'Room'],
  ['storage_group', 'Storage group'],
  ['storage_area', 'Storage area'],
  ['shelf', 'Shelf'],
  ['shelf_section', 'Shelf section'],
  ['drawer', 'Drawer'],
  ['rack', 'Rack'],
  ['container', 'Container'],
] as const;
export function LocationManagementForm({
  location,
  locations,
}: {
  location?: ManagedLocation;
  locations: ManagedLocation[];
}) {
  const { pending, state, setState, submit } = useSubmission();
  const modeled =
    !!location && (location.code === 'ITC' || location.code.startsWith('ITC-'));
  const [values, setValues] = useState({
    code: '',
    name: location?.name ?? '',
    parent_id: location?.parent_id ?? '',
    kind: location?.kind ?? 'storage_area',
    can_hold_inventory: location?.can_hold_inventory ?? true,
    active: location?.active ?? true,
    sort_order: String(location?.sort_order ?? 0),
  });
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const update = (key: keyof typeof values, value: string | boolean) => {
    setValues((old) => ({ ...old, [key]: value }));
    setState(null);
  };
  const descendants = new Set<string>();
  if (location) {
    const byParent = new Map<string, string[]>();
    for (const row of locations)
      if (row.parent_id)
        byParent.set(row.parent_id, [
          ...(byParent.get(row.parent_id) ?? []),
          row.id,
        ]);
    const stack = [location.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (descendants.has(id)) continue;
      descendants.add(id);
      stack.push(...(byParent.get(id) ?? []));
    }
  }
  return (
    <form
      className={panel + ' space-y-4'}
      onSubmit={(event) => {
        event.preventDefault();
        if (location && !values.active && !confirmDeactivate) return;
        const shape = {
          name: values.name,
          parent_id: values.parent_id || null,
          kind: values.kind,
          can_hold_inventory: values.can_hold_inventory,
          active: values.active,
          sort_order: Number(values.sort_order),
        };
        submit(
          location ? 'location_update' : 'location_create',
          location
            ? {
                location_id: location.id,
                expected_version: location.version,
                ...shape,
              }
            : { code: values.code, ...shape },
        );
      }}
    >
      <h2 className="text-lg font-semibold">
        {location ? `Manage ${location.name}` : 'Add logical storage location'}
      </h2>
      {!location && (
        <label className="block space-y-2">
          Permanent code
          <Input
            required
            value={values.code}
            pattern="[A-Z][A-Z0-9]*(-[A-Z0-9]+)*"
            maxLength={100}
            onChange={(e) => update('code', e.target.value.toUpperCase())}
          />
        </label>
      )}
      <label className="block space-y-2">
        Name
        <Input
          required
          maxLength={200}
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
        />
      </label>
      <label className="block space-y-2">
        Parent location
        <select
          className={field}
          value={values.parent_id}
          disabled={modeled}
          required={values.kind !== 'room'}
          onChange={(e) => update('parent_id', e.target.value)}
        >
          <option value="">No parent (room only)</option>
          {locations
            .filter(
              (candidate) => !descendants.has(candidate.id) && candidate.active,
            )
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.code})
              </option>
            ))}
        </select>
      </label>
      <label className="block space-y-2">
        Kind
        <select
          className={field}
          value={values.kind}
          disabled={modeled}
          onChange={(e) => {
            update('kind', e.target.value);
            if (e.target.value === 'room')
              setValues((old) => ({
                ...old,
                kind: 'room',
                parent_id: '',
                can_hold_inventory: false,
              }));
          }}
        >
          {kinds.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-2">
        Sort order
        <Input
          type="number"
          min={0}
          max={2147483647}
          step={1}
          required
          value={values.sort_order}
          onChange={(e) => update('sort_order', e.target.value)}
        />
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          disabled={modeled}
          checked={values.can_hold_inventory}
          onChange={(e) => update('can_hold_inventory', e.target.checked)}
        />{' '}
        Can hold inventory
      </label>
      {location && (
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            disabled={modeled}
            checked={values.active}
            onChange={(e) => {
              update('active', e.target.checked);
              setConfirmDeactivate(false);
            }}
          />{' '}
          Active location
        </label>
      )}
      {location && !values.active && (
        <label className="flex min-h-11 items-center gap-3 text-amber-200">
          <input
            type="checkbox"
            checked={confirmDeactivate}
            required
            onChange={(e) => setConfirmDeactivate(e.target.checked)}
          />{' '}
          All stock and assets have been moved from this subtree. Deactivation
          is blocked until resolved.
        </label>
      )}
      {modeled && (
        <p className="text-sm text-slate-400">
          This closet location is bound to Git room geometry. Its parent, kind,
          active state, and destination capability are fixed here; its name and
          order can be edited.
        </p>
      )}
      {state && (
        <p
          role="status"
          className={state.ok ? 'text-emerald-200' : 'text-amber-200'}
        >
          {state.ok
            ? 'Location saved. Inventory history and permanent code remain intact.'
            : state.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save location'}
      </Button>
      {location && (
        <p className="text-xs text-slate-400">
          Permanent code: {location.code}. Refresh and review after a stale
          edit.
        </p>
      )}
    </form>
  );
}

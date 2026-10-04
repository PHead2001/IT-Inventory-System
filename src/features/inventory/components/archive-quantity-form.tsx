'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useReportTaskState, useTaskReset } from './task-state';
import { Button } from '@/components/ui/button';
import { submitInventory } from '../actions';
import type { MutationState } from '../contracts';
import type { QuantityArchiveReview } from '../queries.server';
import { field, panel } from './read-ui';

function displayCount(value: string) {
  return BigInt(value).toLocaleString('en-US');
}

export function ArchiveQuantityForm({
  latestReview,
  actorId,
}: {
  latestReview: QuantityArchiveReview;
  actorId?: string;
}) {
  const resetTask = useTaskReset();
  const router = useRouter();
  const [baseline, setBaseline] = useState(latestReview);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [done, setDone] = useState(false);
  const [state, setState] = useState<MutationState | null>(null);
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const submitted = useRef<Parameters<typeof submitInventory>[0] | null>(null);
  const reportTask = useReportTaskState({
    dirty: reason !== '' || acknowledged,
    pending,
    uncertain,
    completed: done,
  });
  const newerVersion = latestReview.version !== baseline.version;

  if (refreshRequested && newerVersion && !uncertain && !pending && !done) {
    setBaseline(latestReview);
    setAcknowledged(false);
    setReviewing(false);
    setState(null);
    setRefreshRequested(false);
    setReceipt(null);
  }

  const refresh = () => {
    if (uncertain || pending || done) return;
    setReviewing(false);
    setAcknowledged(false);
    setRefreshRequested(true);
    router.refresh();
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      pending ||
      inFlight.current ||
      done ||
      (!uncertain && (refreshRequested || newerVersion || !acknowledged))
    )
      return;
    if (!reviewing && !uncertain) {
      setReviewing(true);
      setState(null);
      return;
    }
    const payload = {
      item_id: baseline.item_id,
      expected_version: baseline.version,
      confirm_clear_stock: true as const,
      reason: reason.trim(),
    };
    const key = JSON.stringify(payload);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    const command =
      uncertain && submitted.current
        ? submitted.current
        : {
            operation: 'quantity_archive_and_clear' as const,
            requestId,
            payload,
            ...(actorId ? { expectedActorId: actorId } : {}),
          };
    submitted.current = command;
    inFlight.current = true;
    reportTask({ pending: true });
    startTransition(async () => {
      try {
        const result = await submitInventory(command);
        const unresolved =
          !result.ok &&
          (result.kind === 'unexpected' ||
            (uncertain &&
              ['forbidden', 'actor_changed', 'idempotency_conflict'].includes(
                result.code,
              )));
        setUncertain(unresolved);
        setState(result);
        if (result.ok) {
          setDone(true);
          setReviewing(false);
          try {
            router.refresh();
          } catch {
            /* Preserve acknowledged completion. */
          }
        } else if (result.code === 'stale_version') {
          setReviewing(false);
          setAcknowledged(false);
        }
      } catch {
        setUncertain(true);
        setState({
          ok: false,
          kind: 'unexpected',
          code: 'unexpected',
          message:
            'The result could not be confirmed. Keep this request and retry safely.',
        });
      } finally {
        inFlight.current = false;
      }
    });
  };
  return (
    <form
      aria-label="Archive quantity item and clear stock"
      className="space-y-4"
      onSubmit={submit}
    >
      <p className="text-sm text-amber-100">
        Archiving removes every recorded balance, including stock at inactive
        locations. Restoring this quantity item will return it with zero stock;
        its reorder threshold is retained.
      </p>
      <section className={panel} aria-label="Stock to remove">
        <h3 className="font-semibold">
          {displayCount(baseline.removed_total)} units to remove
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Reviewed at item version {baseline.version}
        </p>
        {baseline.locations.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {baseline.locations.map((location) => (
              <li className="break-words" key={location.location_id}>
                {location.breadcrumb} ({location.code})
                {!location.active ? ' — inactive location' : ''}:{' '}
                {location.quantity} → 0 units
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm">No positive balances remain.</p>
        )}
      </section>
      {newerVersion && !uncertain && !done && (
        <div role="alert" className="space-y-2 text-sm text-amber-200">
          <p>
            This quantity item changed. Load and review the latest per-location
            counts before archiving.
          </p>
          <Button type="button" variant="outline" onClick={refresh}>
            Review latest stock
          </Button>
        </div>
      )}
      <fieldset
        disabled={
          pending || uncertain || done || refreshRequested || newerVersion
        }
      >
        <label className="mb-2 block" htmlFor="archive-clear-reason">
          Reason (required)
        </label>
        <textarea
          id="archive-clear-reason"
          className={field}
          rows={2}
          maxLength={2000}
          required
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setReviewing(false);
            setState(null);
          }}
        />
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            required
            onChange={(event) => {
              setAcknowledged(event.target.checked);
              setReviewing(false);
              setState(null);
            }}
          />
          I understand that all {displayCount(baseline.removed_total)} recorded
          units will be removed and restore will not recreate them.
        </label>
      </fieldset>
      {refreshRequested && (
        <p role="status">Loading the latest stock review…</p>
      )}
      {reviewing && (
        <section aria-label="Review changes" className={panel}>
          <h3 className="font-semibold">Confirm stock removal</h3>
          <p className="mt-2 text-sm">
            Archive this quantity item and remove{' '}
            {displayCount(baseline.removed_total)} units from{' '}
            {baseline.locations.length} locations in one recorded operation.
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            Reason: {reason.trim()}
          </p>
        </section>
      )}
      {state && !state.ok && (
        <div role="alert" className="space-y-2 text-sm text-red-300">
          <p>{state.message}</p>
          {state.code === 'stale_version' && !uncertain && (
            <Button type="button" variant="outline" onClick={refresh}>
              Refresh latest stock review
            </Button>
          )}
        </div>
      )}
      {state?.ok && (
        <>
          <p role="status">Stock removed and quantity item archived.</p>
          {resetTask && (
            <Button type="button" onClick={resetTask}>
              New transaction
            </Button>
          )}
        </>
      )}
      <Button
        type="submit"
        disabled={
          pending || done || (!uncertain && (refreshRequested || newerVersion))
        }
      >
        {pending
          ? 'Saving…'
          : uncertain
            ? 'Retry same archive transaction'
            : reviewing
              ? 'Confirm archive and clear stock'
              : 'Review archive and clear stock'}
      </Button>
    </form>
  );
}

export function ArchiveQuantityPanel({
  review,
}: {
  review: QuantityArchiveReview;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={panel}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="min-h-11 cursor-pointer font-medium">
        Archive quantity item and clear stock
      </summary>
      <div className="mt-4">
        {opened && <ArchiveQuantityForm latestReview={review} />}
      </div>
    </details>
  );
}

'use client';
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { field, panel } from '@/features/inventory/components/read-ui';
import { submitCustody, loadCustodyReceipt } from '@/features/custody/actions';
import { custodyOutcomeUnresolved } from '@/features/custody/contracts';
import { CustodyReceiptView } from '@/features/custody/custody-receipt';
import type { Site } from '@/features/custody/queries.server';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import type { ScanMatch } from './resolve.server';
import {
  findAssignmentRecords,
  inspectAssignmentRecord,
} from './assign-actions';
import {
  assignmentCommand,
  assignmentProblem,
  selectedAssignmentSource,
  type AssignmentContext,
} from './assign-contracts';
import {
  assignReducer,
  createDetectionGate,
  initialAssignState,
} from './assign-state';
import {
  clearAssignmentRecovery,
  readAssignmentRecovery,
  storeAssignmentRecovery,
  type AssignmentRecovery,
  type AssignmentScope,
} from './assign-recovery';
import { AssignCamera } from './assign-camera';

type Props = {
  actorId: string;
  backend: string;
  sites: Site[];
  locations: LocationRef[];
  initialSiteId?: string;
  siteIssue?: string;
};
export function AssignmentWorkspace(props: Props) {
  return (
    <AssignmentFields key={props.actorId + ':' + props.backend} {...props} />
  );
}
function AssignmentFields({
  actorId,
  backend,
  sites,
  locations,
  initialSiteId,
  siteIssue,
}: Props) {
  const initialSite = sites.find(
    (site) => site.id === initialSiteId && site.active,
  );
  const [state, dispatch] = useReducer(
    assignReducer,
    initialAssignState(
      initialSite
        ? {
            siteId: initialSite.id,
            siteName: initialSite.name,
            reference: '',
            sourceId: '',
          }
        : null,
    ),
  );
  const stateRef = useRef(state);
  const generation = useRef(0);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'identifier' | 'item_code' | 'search'>(
    'identifier',
  );
  const resolving = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [gate] = useState(createDetectionGate);
  const scope = useRef<AssignmentScope | null>(null);
  const recovered = useRef<AssignmentRecovery | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptIssue, setReceiptIssue] = useState('');
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  useLayoutEffect(() => {
    if (state.phase === 'ready' && state.receipt) inputRef.current?.focus();
  }, [state.phase, state.receipt]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    let environment: string;
    try {
      environment = new URL(backend).origin;
    } catch {
      setStorageError(
        'Assignment environment is unavailable. Reopen this workspace from inventory.',
      );
      return;
    }
    const identity = {
      actor: actorId,
      origin: window.location.origin,
      backend: environment,
    };
    scope.current = identity;
    const stored = readAssignmentRecovery(identity);
    if (stored.blocked) {
      setStorageError(
        'An earlier assignment recovery record is unavailable or incompatible. Keep it intact and restore access before submitting another assignment.',
      );
      return;
    }
    if (stored.value) {
      recovered.current = stored.value;
      dispatch({
        type: 'restore',
        context: stored.value.context,
        candidate: stored.value.candidate,
        command: stored.value.command,
        sourceId: stored.value.sourceId,
        units: stored.value.units,
      });
    }
    setReady(true);
  }, [actorId, backend]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const unresolved = state.phase === 'pending' || state.phase === 'unknown';
  useEffect(() => {
    if (!unresolved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  const changeContext = (context: AssignmentContext | null) => {
    if (submitting.current || stateRef.current.phase === 'unknown') return;
    resolving.current = false;
    dispatch({ type: 'context', context, generation: ++generation.current });
  };
  const inspect = async (match: ScanMatch, token: number) => {
    const context = stateRef.current.context;
    if (!context) return;
    try {
      const result = await inspectAssignmentRecord({
        path: match.path,
        actorId,
        siteId: context.siteId,
      });
      if (!mounted.current || generation.current !== token) return;
      if (!result.ok)
        dispatch({ type: 'error', generation: token, message: result.message });
      else
        dispatch({
          type: 'candidate',
          generation: token,
          candidate: result.candidate,
          sourceId:
            selectedAssignmentSource(result.candidate, context.sourceId)?.id ??
            '',
        });
    } catch {
      if (mounted.current && generation.current === token)
        dispatch({
          type: 'error',
          generation: token,
          message:
            'Inspection could not complete. Retry the lookup; nothing was assigned.',
        });
    }
  };
  const lookup = async (
    text: string,
    lookupMode = mode,
    page = 1,
    paging = false,
  ) => {
    const current = stateRef.current;
    if (
      !ready ||
      !current.context ||
      resolving.current ||
      submitting.current ||
      ['pending', 'unknown', 'lookup', 'review'].includes(current.phase) ||
      (current.phase === 'choose' && !paging)
    )
      return;
    resolving.current = true;
    const token = ++generation.current;
    dispatch({ type: 'lookup', generation: token });
    try {
      const resolution = await findAssignmentRecords({
        actorId,
        text,
        mode: lookupMode,
        ...(lookupMode === 'search' ? { page } : {}),
      });
      if (!mounted.current || generation.current !== token) return;
      if (!resolution.ok)
        dispatch({
          type: 'error',
          generation: token,
          message: resolution.message,
        });
      else if (resolution.status === 'found' && resolution.matches.length === 1)
        await inspect(resolution.matches[0], token);
      else
        dispatch({
          type: 'matches',
          generation: token,
          matches: resolution.matches,
          searchPage: resolution.searchPage,
          message:
            resolution.status === 'invalid'
              ? 'This is not a supported inventory label or identifier.'
              : resolution.searchPage &&
                  !resolution.matches.length &&
                  resolution.searchPage.total > 0
                ? 'No records remain on this candidate page. Choose Previous candidates or refine your search.'
                : resolution.status === 'unknown'
                  ? 'No existing inventory matches. Check the identifier or use search; nothing was created.'
                  : 'Choose the intended record. Search and ambiguous identifiers never choose automatically.',
        });
    } catch {
      if (mounted.current && generation.current === token)
        dispatch({
          type: 'error',
          generation: token,
          message:
            'Lookup could not complete. Retry when your staff session is available.',
        });
    } finally {
      if (generation.current === token) resolving.current = false;
    }
  };
  const confirm = async () => {
    const current = stateRef.current;
    if (
      submitting.current ||
      !ready ||
      !current.candidate ||
      !current.context ||
      !scope.current ||
      !['review', 'unknown'].includes(current.phase)
    )
      return;
    let command = current.command;
    if (current.phase !== 'unknown') {
      if (assignmentProblem(current.candidate, current.sourceId, current.units))
        return;
      command = assignmentCommand(
        current.candidate,
        current.context,
        current.sourceId,
        current.units,
        actorId,
        crypto.randomUUID(),
      );
    }
    if (!command) return;
    const durable: AssignmentRecovery = {
      version: 1,
      scope: scope.current,
      context: current.context,
      candidate: current.candidate,
      sourceId: current.sourceId,
      units: current.units,
      command,
    };
    if (!recovered.current && !storeAssignmentRecovery(durable, null)) {
      setStorageError(
        'This assignment could not be retained safely. Keep the review open and retry when session storage is available. Nothing was submitted.',
      );
      return;
    }
    if (
      recovered.current &&
      recovered.current.command.requestId !== command.requestId
    ) {
      setStorageError(
        'Resolve the earlier request before starting another assignment.',
      );
      return;
    }
    recovered.current = durable;
    submitting.current = true;
    dispatch({ type: 'pending', command });
    try {
      const result = await submitCustody(command);
      if (!mounted.current) return;
      if (result.ok) {
        const cleared = clearAssignmentRecovery(
          scope.current,
          command.requestId,
        );
        if (cleared) {
          recovered.current = null;
          setStorageError('');
        } else {
          setStorageError(
            'Assignment confirmed, but its recovery marker could not be cleared. Reload and retry the same request to reconcile before issuing more.',
          );
          setReady(false);
        }
        dispatch({ type: 'committed', result });
        setInput('');
        inputRef.current?.focus();
      } else if (custodyOutcomeUnresolved(result, current.phase === 'unknown'))
        dispatch({ type: 'unknown', message: result.message });
      else {
        if (!clearAssignmentRecovery(scope.current, command.requestId)) {
          dispatch({
            type: 'unknown',
            message:
              'The rejection was received, but recovery could not be updated. Retry the same request before continuing.',
          });
          return;
        }
        recovered.current = null;
        dispatch({
          type: 'rejected',
          message:
            result.message + ' Inspect current availability and confirm again.',
        });
      }
    } catch {
      if (mounted.current)
        dispatch({
          type: 'unknown',
          message:
            'The assignment result could not be confirmed. Retry the same assignment; do not start a new request.',
        });
    } finally {
      submitting.current = false;
    }
  };
  const next = () => {
    if (submitting.current || unresolved) return;
    resolving.current = false;
    dispatch({ type: 'next', generation: ++generation.current });
    setInput('');
    gate.rescan();
    inputRef.current?.focus();
  };
  const candidate = state.candidate;
  const problem = candidate
    ? assignmentProblem(candidate, state.sourceId, state.units)
    : null;
  const busy = unresolved || state.phase === 'lookup';
  return (
    <div className="space-y-5">
      <section
        aria-label="Assignment batch context"
        className={panel + ' space-y-3'}
      >
        <h2 className="text-lg font-semibold">Assign existing equipment</h2>
        <p className="text-sm text-slate-300">
          Choose a destination and inspect each existing record. Nothing is
          assigned until you confirm.
        </p>
        {siteIssue && <p role="note">{siteIssue}</p>}
        <fieldset
          disabled={unresolved || !ready}
          className="grid gap-3 sm:grid-cols-3"
        >
          <label className="space-y-2">
            Destination site
            <select
              aria-label="Destination site"
              className={field}
              value={state.context?.siteId ?? ''}
              onChange={(e) => {
                const site = sites.find(
                  (row) => row.id === e.target.value && row.active,
                );
                changeContext(
                  site
                    ? {
                        siteId: site.id,
                        siteName: site.name,
                        reference: state.context?.reference ?? '',
                        sourceId: state.context?.sourceId ?? '',
                      }
                    : null,
                );
              }}
            >
              <option value="">Choose active site</option>
              {sites
                .filter((site) => site.active)
                .map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} ({site.code})
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-2">
            Ticket number reference (optional)
            <Input
              aria-label="Ticket number reference (optional)"
              maxLength={200}
              value={state.context?.reference ?? ''}
              disabled={!state.context}
              onChange={(e) =>
                state.context &&
                changeContext({ ...state.context, reference: e.target.value })
              }
            />
          </label>
          <label className="space-y-2">
            Preferred storage source (optional)
            <select
              aria-label="Preferred storage source (optional)"
              className={field}
              value={state.context?.sourceId ?? ''}
              disabled={!state.context}
              onChange={(e) =>
                state.context &&
                changeContext({ ...state.context, sourceId: e.target.value })
              }
            >
              <option value="">Choose for each item</option>
              {locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.breadcrumb}
                  {!row.active ? ' (inactive; existing stock can leave)' : ''}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {state.context && (
          <p className="break-words text-sm text-cyan-200">
            Assigning to {state.context.siteName}
            {state.context.reference
              ? ` · Ticket ${state.context.reference}`
              : ''}
          </p>
        )}
        {!sites.some((site) => site.active) && (
          <p>
            No active destination sites are available. Ask a configuration
            maintainer to add or restore one.
          </p>
        )}
      </section>
      {storageError && (
        <p role="alert" className="experience-feedback">
          {storageError}
        </p>
      )}
      <AssignCamera
        scope={actorId + ':' + backend}
        onDetection={(value) => {
          if (
            gate.observe(
              value,
              ready &&
                stateRef.current.phase === 'ready' &&
                !!stateRef.current.context,
            )
          )
            void lookup(value!, 'identifier');
        }}
      />
      <form
        className={panel + ' space-y-3'}
        aria-label="Inspect equipment"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(input);
        }}
      >
        <label className="space-y-2">
          Lookup method
          <select
            aria-label="Lookup method"
            className={field}
            disabled={busy}
            value={mode}
            onChange={(e) => {
              next();
              setMode(e.target.value as typeof mode);
            }}
          >
            <option value="identifier">Label or exact identifier</option>
            <option value="item_code">Exact quantity Item code (SKU)</option>
            <option value="search">Search inventory</option>
          </select>
        </label>
        <label className="space-y-2">
          Scan, paste, or search inventory
          <Input
            ref={inputRef}
            aria-label="Scan, paste, or search inventory"
            autoComplete="off"
            maxLength={1024}
            value={input}
            disabled={
              busy ||
              !ready ||
              ['review', 'choose', 'conflict'].includes(state.phase)
            }
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={
              !ready ||
              busy ||
              !state.context ||
              ['review', 'choose'].includes(state.phase)
            }
          >
            Inspect equipment
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={busy || !ready}
            onClick={next}
          >
            Rescan / choose another
          </Button>
        </div>
      </form>
      {state.message && (
        <p role="status" className="experience-feedback">
          {state.message}
        </p>
      )}
      {state.matches.length > 0 && (
        <ul
          className={panel + ' space-y-2'}
          aria-label="Choose inventory record"
        >
          {state.matches.map((match) => (
            <li key={match.path}>
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  const token = ++generation.current;
                  dispatch({ type: 'lookup', generation: token });
                  void inspect(match, token).catch(() => {
                    if (mounted.current && token === generation.current)
                      dispatch({
                        type: 'error',
                        generation: token,
                        message: 'Inspection failed. Try again.',
                      });
                  });
                }}
              >
                {match.label} · {match.kind} · {match.state}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state.search && (
        <nav
          aria-label="Assignment candidate pages"
          className={panel + ' flex flex-wrap items-center gap-3'}
        >
          <p className="text-sm">
            Page {state.search.page} · {state.search.total} matching inventory
            records · {state.search.pageSize} per page
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !ready || state.search.page <= 1}
            onClick={() => {
              if (state.search)
                void lookup(
                  state.search.query,
                  'search',
                  state.search.page - 1,
                  true,
                );
            }}
          >
            Previous candidates
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              !ready ||
              state.search.page >= 100000 ||
              state.search.page * state.search.pageSize >= state.search.total
            }
            onClick={() => {
              if (state.search)
                void lookup(
                  state.search.query,
                  'search',
                  state.search.page + 1,
                  true,
                );
            }}
          >
            Next candidates
          </Button>
          {state.search.page >= 100000 &&
            state.search.total > state.search.page * state.search.pageSize && (
              <p>
                Refine the search to reach the remaining records within the
                candidate page limit.
              </p>
            )}
        </nav>
      )}
      {candidate && (
        <section
          aria-label="Review assignment"
          className={panel + ' space-y-3'}
        >
          <h2 className="break-words text-lg font-semibold">
            {candidate.name}
          </h2>
          <p className="break-words text-sm">
            {candidate.kind === 'quantity'
              ? 'Quantity item'
              : 'Individual asset'}{' '}
            · {candidate.identifier || 'No display identifier'} · Version{' '}
            {candidate.version} · {candidate.status}
          </p>
          <p>
            Destination: {state.context?.siteName}
            {state.context?.reference
              ? ` · Ticket ${state.context.reference}`
              : ''}
          </p>
          <fieldset
            disabled={unresolved || state.phase === 'conflict'}
            className="space-y-3"
          >
            <label className="block space-y-2">
              Storage source
              <select
                aria-label="Storage source"
                className={field}
                value={state.sourceId}
                onChange={(e) =>
                  dispatch({ type: 'edit', sourceId: e.target.value })
                }
              >
                <option value="">Choose source</option>
                {candidate.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {source.quantity} available
                    {!source.active ? ' · inactive source' : ''}
                  </option>
                ))}
              </select>
            </label>
            {candidate.kind === 'quantity' && (
              <label className="block space-y-2">
                Units to assign
                <Input
                  aria-label="Units to assign"
                  type="number"
                  min={1}
                  max={
                    candidate.sources.find((row) => row.id === state.sourceId)
                      ?.quantity ?? 2147483647
                  }
                  step={1}
                  value={state.units}
                  onChange={(e) =>
                    dispatch({ type: 'edit', units: e.target.value })
                  }
                />
              </label>
            )}
          </fieldset>
          {problem && (
            <p role="note" className="text-sm text-amber-200">
              {problem}
            </p>
          )}
          {candidate.currentSite && (
            <p>Current custody: {candidate.currentSite}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={
                !ready ||
                state.phase === 'pending' ||
                (state.phase !== 'unknown' &&
                  (!!problem || state.phase !== 'review'))
              }
              onClick={() => void confirm()}
            >
              {state.phase === 'pending'
                ? 'Assigning…'
                : state.phase === 'unknown'
                  ? 'Retry same assignment'
                  : 'Confirm assign'}
            </Button>
            {state.phase === 'conflict' && (
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  const token = ++generation.current;
                  dispatch({ type: 'lookup', generation: token });
                  void inspect(
                    {
                      kind: candidate.kind,
                      path: candidate.path,
                      label: candidate.name,
                      state: candidate.status,
                    },
                    token,
                  );
                }}
              >
                Inspect current state
              </Button>
            )}
            <Link
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
              href={candidate.path}
            >
              Open inventory record
            </Link>
          </div>
        </section>
      )}
      {state.receipt && (
        <section
          aria-label="Latest assignment receipt"
          className={panel + ' space-y-3'}
        >
          {state.receipt.result.custody ? (
            <CustodyReceiptView
              receipt={state.receipt.result.custody}
              reviewedName={state.receipt.name}
            />
          ) : (
            <>
              <h2 className="font-semibold">
                Assignment confirmed · {state.receipt.name}
              </h2>
              <p>
                Reviewed operation: {state.receipt.units}{' '}
                {state.receipt.kind === 'quantity'
                  ? 'units'
                  : 'individual asset'}{' '}
                · {state.receipt.sourceName} → {state.receipt.siteName}
                {state.receipt.reference
                  ? ` · Ticket ${state.receipt.reference}`
                  : ''}
                .
              </p>
              <p>
                Saved successfully. Event receipt details could not be loaded;
                current holdings are not receipt balances.
              </p>
              <p className="break-all text-xs">
                {state.receipt.result.eventId}
              </p>
              {state.receipt.result.eventId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={receiptLoading}
                  onClick={async () => {
                    const receipt = state.receipt;
                    if (!receipt?.result.eventId || receiptLoading) return;
                    setReceiptLoading(true);
                    setReceiptIssue('');
                    try {
                      const detail = await loadCustodyReceipt({
                        kind: receipt.kind,
                        entityId: receipt.entityId,
                        eventId: receipt.result.eventId,
                        expectedActorId: actorId,
                      });
                      if (!mounted.current) return;
                      if (detail)
                        dispatch({
                          type: 'receipt',
                          eventId: receipt.result.eventId,
                          custody: detail,
                        });
                      else
                        setReceiptIssue(
                          'Receipt details are unavailable. The assignment remains confirmed; retry under the original account.',
                        );
                    } catch {
                      if (mounted.current)
                        setReceiptIssue(
                          'Receipt details could not be loaded. The assignment remains confirmed.',
                        );
                    } finally {
                      if (mounted.current) setReceiptLoading(false);
                    }
                  }}
                >
                  Reload committed receipt
                </Button>
              )}
            </>
          )}
          {receiptIssue && <p role="status">{receiptIssue}</p>}
        </section>
      )}
    </div>
  );
}

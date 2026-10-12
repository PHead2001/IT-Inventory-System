'use client';
import { ScanMatchLabel, ScanMatchContext } from './scan-match-label';
import { RecordStatus } from '@/components/record-status';
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  PrivateRestorationGate,
  usePrivacyReadiness,
  useAuthoritativeCleanupRevision,
  usePrivacyRevocationRevision,
} from '@/components/auth/privacy-readiness';
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
  parseAssignmentRecovery,
  storeAssignmentRecovery,
  type AssignmentRecovery,
  type AssignmentScope,
} from './assign-recovery';
import { AssignCamera } from './assign-camera';
import { LocationPicker } from '@/features/locations/location-picker';
import { countLabel } from '@/lib/count';
import {
  adoptAssignmentScope,
  assignmentEpoch,
  batchTotals,
  BATCH_LIMIT,
  clearBatch,
  emptyBatch,
  historicalInspection,
  matchesRecoveryEntry,
  readBatch,
  recoveryEntry,
  reconcileInterruptedLookups,
  storeBatch,
  terminalFits,
  type AssignmentBatch,
  type BatchEntry,
} from './assign-batch';

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
    <PrivateRestorationGate scope={props.actorId + ':' + props.backend}>
      <AssignmentFields key={props.actorId + ':' + props.backend} {...props} />
    </PrivateRestorationGate>
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
  const privacy = usePrivacyReadiness();
  const cleanupRevision = useAuthoritativeCleanupRevision();
  const revocationRevision = usePrivacyRevocationRevision();
  const originalRevocation = useRef(revocationRevision);
  const [privateMasked, setPrivateMasked] = useState(false);
  const cleaned = useRef(cleanupRevision);
  const requiresReadmission = useRef(false);
  const bootstrapped = useRef(false);
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
  // A batch-wide preference does not know the next item's holdings. Include
  // inventory-bearing evacuation sources; the inspection proves actual stock.
  const preferredSourceIds = useMemo(
    () =>
      locations
        .filter((location) => location.can_hold_inventory)
        .map((location) => location.id),
    [locations],
  );
  const [mode, setMode] = useState<
    'identifier' | 'item_code' | 'serial' | 'search'
  >('identifier');
  const resolving = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = useRef(false);
  const focusDestination = useRef(false);
  const previousReceiptId = useRef<string | undefined>(undefined);
  const destinationRef = useRef<HTMLSelectElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [gate] = useState(createDetectionGate);
  const scope = useRef<AssignmentScope | null>(null);
  const recovered = useRef<AssignmentRecovery | null>(null);
  const recoveryRaw = useRef<string | null>(null);
  const batchRef = useRef<AssignmentBatch | null>(null);
  const batchRaw = useRef<string | null>(null);
  const epoch = useRef(assignmentEpoch());
  const entryId = useRef<string | null>(null);
  const [batch, setBatch] = useState<AssignmentBatch | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelPress = useRef<number | null>(null);
  const abortedCancelClick = useRef<number | null>(null);
  const deferredReviewFocus = useRef<number | null>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const chooserRef = useRef<HTMLUListElement>(null);
  const resumeReviewFocus = useCallback(() => {
    if (cancelPress.current !== null) return;
    const token = deferredReviewFocus.current;
    deferredReviewFocus.current = null;
    if (
      token === null ||
      !mounted.current ||
      epoch.current !== assignmentEpoch() ||
      generation.current !== token ||
      stateRef.current.generation !== token ||
      document.activeElement !== cancelRef.current
    )
      return;
    if (stateRef.current.phase === 'review') reviewRef.current?.focus();
    else if (stateRef.current.phase === 'choose') chooserRef.current?.focus();
    else if (stateRef.current.phase === 'ready' && stateRef.current.message)
      inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (cancelPress.current !== event.pointerId) return;
      cancelPress.current = null;
      // An inside pointerup must leave the target stationary for the native click.
      // Aborted/outside gestures have no Cancel click to finish the focus transfer.
      // Touch/pen implicit capture retargets an outside release to the button;
      // only the actual release coordinates establish the current hit target.
      const hit =
        Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
          ? document.elementFromPoint(event.clientX, event.clientY)
          : null;
      const aborted =
        event.type === 'pointercancel' ||
        !hit ||
        !cancelRef.current?.contains(hit);
      abortedCancelClick.current = aborted ? event.pointerId : null;
      if (aborted) resumeReviewFocus();
    };
    const leaveWindow = () => {
      cancelPress.current = null;
    };
    // Capture release anywhere, including a nonfocusable sibling after a drag.
    // Do not capture the pointer: releasing outside must not accept Cancel.
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', leaveWindow);
    window.addEventListener('focus', resumeReviewFocus);
    return () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('blur', leaveWindow);
      window.removeEventListener('focus', resumeReviewFocus);
      cancelPress.current = null;
      abortedCancelClick.current = null;
      deferredReviewFocus.current = null;
    };
  }, [resumeReviewFocus]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageIssue] = useState('');
  const [fatalStorageError, setFatalStorageError] = useState(false);
  const setStorageError = useCallback((message: string, fatal = true) => {
    setStorageIssue(message);
    setFatalStorageError(!!message && fatal);
  }, []);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptIssue, setReceiptIssue] = useState('');
  const [restoring, setRestoring] = useState(false);
  useLayoutEffect(() => {
    if (restoring) cancelRef.current?.focus();
  }, [restoring]);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  useLayoutEffect(() => {
    if (focusDestination.current) {
      focusDestination.current = false;
      destinationRef.current?.focus();
    }
    if (focusInput.current && state.phase === 'ready') {
      focusInput.current = false;
      inputRef.current?.focus();
    }
  }, [state.phase, state.generation, state.context]);
  useLayoutEffect(() => {
    const eventId = state.receipt?.result.eventId;
    if (
      state.phase === 'ready' &&
      !batch?.finished &&
      eventId &&
      eventId !== previousReceiptId.current
    )
      inputRef.current?.focus();
    previousReceiptId.current = eventId;
  }, [state.phase, state.receipt?.result.eventId, batch?.finished]);
  useLayoutEffect(() => {
    if (batch?.finished) summaryRef.current?.focus();
  }, [batch?.finished]);
  useLayoutEffect(() => {
    // Keep the pressed Cancel target in place until release. Review focus can
    // scroll the form away between pointerdown and the accepted click.
    deferredReviewFocus.current = null;
    if (cancelPress.current !== null) {
      deferredReviewFocus.current = state.generation;
      return;
    }
    if (state.phase === 'review') reviewRef.current?.focus();
    else if (state.phase === 'choose') chooserRef.current?.focus();
    else if (state.phase === 'ready' && state.message)
      inputRef.current?.focus();
  }, [state.phase, state.message, state.generation]);
  const alive = () => mounted.current && epoch.current === assignmentEpoch();
  const resetReceiptRead = () => {
    setReceiptLoading(false);
    setReceiptIssue('');
  };
  const saveBatch = (value: AssignmentBatch) => {
    if (!alive()) return false;
    const raw = storeBatch(value, batchRaw.current);
    if (!raw) {
      setStorageError(
        'This batch could not be saved. Keep it open, restore browser storage access and check the earlier assignment before continuing.',
      );
      return false;
    }
    batchRaw.current = raw;
    batchRef.current = value;
    setBatch(value);
    setStorageError('');
    return true;
  };
  const updateEntry = (
    patch: Partial<BatchEntry>,
    extra: Partial<AssignmentBatch> = {},
  ) => {
    const saved = batchRef.current;
    if (!saved || !entryId.current) return false;
    return saveBatch({
      ...saved,
      ...extra,
      entries: saved.entries.map((row) =>
        row.id === entryId.current ? { ...row, ...patch } : row,
      ),
    });
  };
  const retainInspection = (
    inspection: NonNullable<AssignmentBatch['historical']>,
  ) => {
    const row = batchRef.current?.entries.find(
      (entry) => entry.id === entryId.current,
    );
    // Reads may revive an unsubmitted lookup failure. Submitted outcomes keep
    // their immutable row; manual refresh allocates a new inspection for them.
    if (
      !row ||
      row.requestId !== null ||
      !['pending', 'failed'].includes(row.status)
    )
      return false;
    return updateEntry(
      {
        status: 'pending',
        message: '',
        name: inspection.candidate.name,
        kind: inspection.candidate.kind,
        entityId: inspection.candidate.id,
        identifier: inspection.candidate.identifier,
      },
      { historical: inspection },
    );
  };
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!privacy.ready) return;
    if (bootstrapped.current && requiresReadmission.current) {
      if (privacy.verifiedEpoch !== assignmentEpoch()) return;
      bootstrapped.current = false;
      requiresReadmission.current = false;
      setPrivateMasked(false);
    }
    if (bootstrapped.current) return;
    bootstrapped.current = true;
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
    try {
      epoch.current = adoptAssignmentScope(identity);
    } catch {
      setStorageError(
        'Session storage is unavailable. Restore storage access and reload before submitting an assignment.',
      );
      return;
    }
    const savedBatch = readBatch(identity);
    const stored = readAssignmentRecovery(identity);
    if (stored.blocked || savedBatch.blocked) {
      setStorageError(
        'Your earlier assignment cannot be opened. Keep its saved data intact and contact IT support before assigning more.',
      );
      return;
    }
    if (
      recovered.current &&
      (stored.raw !== recoveryRaw.current ||
        JSON.stringify(stored.value) !==
          JSON.stringify(
            parseAssignmentRecovery(
              JSON.stringify(recovered.current),
              identity,
            ),
          ))
    ) {
      setStorageError(
        'The original assignment recovery changed or is unavailable. Keep this page open and restore its original saved request before retrying.',
      );
      return;
    }
    let restored = savedBatch.value ?? {
      ...emptyBatch(identity),
      context: stateRef.current.context,
    };
    batchRaw.current = savedBatch.raw;
    batchRef.current = restored;
    const reconciled = reconcileInterruptedLookups(restored);
    if (reconciled !== restored) {
      // Reconcile only abandoned reads, before exposing a usable hydrated batch.
      // Submitted recovery and its exact command/receipt remain untouched.
      if (!saveBatch(reconciled)) return;
      restored = reconciled;
    }
    if (stored.value) {
      recovered.current = stored.value;
      recoveryRaw.current = stored.raw;
      const existing = restored.entries.find(
        (row) => row.requestId === stored.value!.command.requestId,
      );
      if (existing && !matchesRecoveryEntry(existing, stored.value)) {
        setStorageError(
          'The saved assignment details do not match. Keep this batch intact and contact IT support before continuing.',
        );
        return;
      }
      if (
        existing &&
        (existing.status === 'success' || existing.status === 'failed')
      ) {
        if (
          !clearAssignmentRecovery(
            identity,
            stored.value.command.requestId,
            stored.raw,
          )
        ) {
          setStorageError(
            'The assignment result is saved. Reload to finish updating this batch before assigning more.',
          );
          setBatch(restored);
          return;
        }
        recovered.current = null;
      } else {
        if (
          restored.entries.some(
            (row) =>
              row.status === 'uncertain' &&
              row.requestId !== stored.value!.command.requestId,
          ) ||
          (restored.entries.length >= BATCH_LIMIT && !existing)
        ) {
          setStorageError(
            'The saved assignment details do not match. Keep this batch intact and contact IT support before continuing.',
          );
          return;
        }
        entryId.current = existing?.id ?? crypto.randomUUID();
        const uncertain = recoveryEntry(stored.value, entryId.current);
        restored = {
          ...restored,
          context: stored.value.context,
          finished: false,
          historical: null,
          entries: existing
            ? restored.entries.map((row) =>
                row.id === existing.id ? uncertain : row,
              )
            : [...restored.entries, uncertain],
        };
        if (!saveBatch(restored)) return;
        dispatch({
          type: 'restore',
          context: stored.value.context,
          candidate: stored.value.candidate,
          command: stored.value.command,
          sourceId: stored.value.sourceId,
          units: stored.value.units,
        });
        setReady(true);
        return;
      }
    }
    if (restored.entries.some((row) => row.status === 'uncertain')) {
      setStorageError(
        'The result of an earlier assignment is still unknown, and its saved details cannot be opened. Keep this batch intact and contact IT support before continuing.',
      );
      setBatch(restored);
      return;
    }
    // A persisted inspection is historical, never a renewed confirmation.
    const last = restored.entries.findLast((row) => row.status === 'success');
    const snapshot = initialAssignState(restored.context);
    if (last?.kind && last.entityId)
      snapshot.receipt = {
        detailsUnrequested: true,
        result: {
          ok: true,
          changed: true,
          entityId: last.entityId,
          version: '1',
          eventId: last.eventId ?? undefined,
        },
        name: last.name,
        kind: last.kind,
        entityId: last.entityId,
        units: String(last.units),
        sourceName: last.source,
        siteName: last.context.siteName,
        reference: last.context.reference,
      };
    if (restored.historical && !restored.finished) {
      entryId.current = restored.historical.entryId;
      snapshot.candidate = restored.historical.candidate;
      snapshot.sourceId = restored.historical.sourceId;
      snapshot.units = restored.historical.units;
      snapshot.phase = 'conflict';
      snapshot.message =
        'Previous inspection retained for reference. Inspect current state before confirming.';
    }
    dispatch({ type: 'hydrate', snapshot });
    setBatch(restored);
    batchRef.current = restored;
    setReady(true);
    const historical = restored.historical;
    const context = restored.context;
    if (
      historical &&
      context &&
      !restored.finished &&
      sites.some((site) => site.id === context.siteId && site.active)
    ) {
      const token = ++generation.current;
      resolving.current = true;
      cancelRef.current?.focus();
      // This read never refreshes or substitutes an uncertain command.
      snapshot.generation = token;
      snapshot.message =
        'Inspecting equipment… Previous inspection is historical until availability refresh completes.';
      dispatch({ type: 'hydrate', snapshot });
      setRestoring(true);
      void (async () => {
        try {
          const result = await inspectAssignmentRecord({
            path: historical.candidate.path,
            actorId,
            siteId: context.siteId,
          });
          if (!alive() || generation.current !== token) return;
          if (!result.ok) {
            dispatch({
              type: 'hydrate',
              snapshot: {
                ...snapshot,
                message:
                  result.message +
                  ' Previous inspection remains historical. Retry inspection before confirming.',
              },
            });
            return;
          }
          // Preserve the chosen source/units; a missing holding needs an explicit choice.
          if (!retainInspection({ ...historical, candidate: result.candidate }))
            return;
          dispatch({ type: 'lookup', generation: token });
          dispatch({
            type: 'candidate',
            generation: token,
            candidate: result.candidate,
            sourceId: historical.sourceId,
            units: historical.units,
            message:
              'Availability refreshed. Review the source and units before confirming.',
          });
        } catch {
          if (alive() && generation.current === token)
            dispatch({
              type: 'hydrate',
              snapshot: {
                ...snapshot,
                message:
                  'Availability could not be refreshed. Previous inspection remains historical; retry inspection before confirming.',
              },
            });
        } finally {
          if (alive() && generation.current === token) {
            resolving.current = false;
            setRestoring(false);
          }
        }
      })();
    }
    // Bootstrap exactly once per keyed actor/backend. Fresh catalog props are
    // checked before each new confirmation; they must not restart recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, backend, privacy.ready, privacy.verifiedEpoch]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      requiresReadmission.current = true;
      submitting.current = false;
      resolving.current = false;
      setInput('');
      setRestoring(false);
      setReady(false);
      const original = recovered.current;
      if (original) {
        dispatch({
          type: 'restore',
          context: original.context,
          candidate: original.candidate,
          command: original.command,
          sourceId: original.sourceId,
          units: original.units,
        });
      } else {
        setBatch(null);
        batchRef.current = null;
        dispatch({ type: 'hydrate', snapshot: initialAssignState(null) });
      }
      setStorageError(
        'Your account or assignment environment changed. Reopen Scan and assign under the current staff session.',
      );
    };
    window.addEventListener('assignment-scope-invalidated', invalidate);
    // Earlier shell siblings may invalidate after bootstrap but before this
    // passive subscription. The same handler must clear that stale private UI.
    if (epoch.current !== assignmentEpoch()) invalidate();
    return () =>
      window.removeEventListener('assignment-scope-invalidated', invalidate);
  }, [setStorageError]);
  useLayoutEffect(() => {
    if (cleaned.current === cleanupRevision) return;
    cleaned.current = cleanupRevision;
    // Only a completed authoritative all-wipe permits deleting the retained
    // original command. Attempted logout and identity errors do not.
    recovered.current = null;
    recoveryRaw.current = null;
    batchRef.current = null;
    batchRaw.current = null;
    setBatch(null);
    dispatch({ type: 'hydrate', snapshot: initialAssignState(null) });
  }, [cleanupRevision]);
  useLayoutEffect(() => {
    if (originalRevocation.current === revocationRevision) return;
    originalRevocation.current = revocationRevision;
    requiresReadmission.current = true;
    setReady(false);
    setPrivateMasked(true);
  }, [revocationRevision]);
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
    if (
      !alive() ||
      submitting.current ||
      stateRef.current.phase === 'unknown' ||
      batchRef.current?.finished
    )
      return;
    const saved = batchRef.current;
    if (
      saved &&
      !saveBatch({
        ...saved,
        context,
        historical: null,
        entries: saved.entries.map((row) =>
          row.id === entryId.current && row.status === 'pending'
            ? {
                ...row,
                status: 'skipped',
                message: 'Batch context changed before confirmation.',
              }
            : row,
        ),
      })
    )
      return;
    entryId.current = null;
    resetReceiptRead();
    resolving.current = false;
    setRestoring(false);
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
      if (!alive() || generation.current !== token) return;
      if (!result.ok) {
        updateEntry(
          { status: 'failed', message: result.message.slice(0, 500) },
          { historical: null },
        );
        dispatch({ type: 'error', generation: token, message: result.message });
      } else {
        const sourceId =
          selectedAssignmentSource(result.candidate, context.sourceId)?.id ??
          '';
        const inspection = {
          candidate: result.candidate,
          sourceId,
          units: '1',
          entryId: entryId.current!,
        };
        if (!retainInspection(inspection)) {
          dispatch({
            type: 'error',
            generation: token,
            message:
              'The inspection could not be saved. Restore browser storage access before retrying.',
          });
          return;
        }
        dispatch({
          type: 'candidate',
          generation: token,
          candidate: result.candidate,
          sourceId,
        });
      }
    } catch {
      if (alive() && generation.current === token) {
        updateEntry(
          { status: 'failed', message: 'Inspection could not complete.' },
          { historical: null },
        );
        dispatch({
          type: 'error',
          generation: token,
          message:
            'Inspection could not complete. Retry the lookup; nothing was assigned.',
        });
      }
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
      !alive() ||
      batchRef.current?.finished ||
      !current.context ||
      resolving.current ||
      submitting.current ||
      ['pending', 'unknown', 'lookup', 'review'].includes(current.phase) ||
      (current.phase === 'choose' && !paging)
    )
      return;
    const saved = batchRef.current;
    if (!saved) return;
    if (!paging) {
      if (saved.entries.length >= BATCH_LIMIT || !terminalFits(saved)) {
        setStorageError(
          'This batch is full. Finish and End batch before starting another; all existing entries are retained.',
        );
        return;
      }
      entryId.current = crypto.randomUUID();
      const row: BatchEntry = {
        id: entryId.current,
        status: 'pending',
        name: 'Equipment inspection',
        kind: null,
        entityId: null,
        identifier: null,
        units: 0,
        source: '',
        context: { ...current.context },
        requestId: null,
        eventId: null,
        message: '',
      };
      if (
        !saveBatch({
          ...saved,
          entries: [...saved.entries, row],
          historical: null,
        })
      )
        return;
    }
    // Cancel is mounted and focused before disabling the input/submit control.
    cancelRef.current?.focus();
    resetReceiptRead();
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
      if (!alive() || generation.current !== token) return;
      if (!resolution.ok) {
        updateEntry({
          status: 'failed',
          message: resolution.message.slice(0, 500),
        });
        dispatch({
          type: 'error',
          generation: token,
          message: resolution.message,
        });
      } else if (
        resolution.status === 'found' &&
        !resolution.truncated &&
        resolution.matches.length === 1
      )
        await inspect(resolution.matches[0], token);
      else {
        if (!resolution.matches.length)
          updateEntry({
            status: 'failed',
            message: 'No matching inventory record.',
          });
        dispatch({
          type: 'matches',
          generation: token,
          matches: resolution.matches,
          searchPage: resolution.searchPage,
          truncated: resolution.truncated,
          message: resolution.truncated
            ? 'Additional matches exist. Showing up to 20 records; use an asset tag or record QR to identify the intended equipment.'
            : resolution.status === 'invalid'
              ? 'This is not a supported inventory label or identifier.'
              : resolution.searchPage &&
                  !resolution.matches.length &&
                  resolution.searchPage.total > 0
                ? 'No records remain on this candidate page. Choose Previous candidates or refine your search.'
                : resolution.status === 'unknown'
                  ? 'No existing inventory matches. Check the identifier or use search; nothing was created.'
                  : 'Choose the intended record. Search and ambiguous identifiers never choose automatically.',
        });
      }
    } catch {
      if (alive() && generation.current === token) {
        updateEntry({
          status: 'failed',
          message: 'Lookup could not complete.',
        });
        dispatch({
          type: 'error',
          generation: token,
          message:
            'Lookup could not complete. Retry when your staff session is available.',
        });
      }
    } finally {
      if (alive() && generation.current === token) resolving.current = false;
    }
  };
  const confirm = async () => {
    const current = stateRef.current;
    const identity = scope.current;
    const saved = batchRef.current;
    if (
      !alive() ||
      submitting.current ||
      !ready ||
      !current.candidate ||
      !current.context ||
      !identity ||
      !saved ||
      saved.finished ||
      !['review', 'unknown'].includes(current.phase)
    )
      return;
    if (
      current.phase === 'review' &&
      !sites.some((site) => site.id === current.context?.siteId && site.active)
    ) {
      setStorageError(
        'The saved destination is unavailable. Choose an active site and inspect again.',
        false,
      );
      return;
    }
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
    if (!command || !entryId.current) return;
    const durable: AssignmentRecovery = {
      version: 1,
      scope: identity,
      context: current.context,
      candidate: current.candidate,
      sourceId: current.sourceId,
      units: current.units,
      command,
    };
    const pending = {
      ...recoveryEntry(durable, entryId.current),
      status: 'pending' as const,
    };
    const projection = {
      ...saved,
      entries: saved.entries.map((row) =>
        row.id === pending.id ? pending : row,
      ),
      historical: historicalInspection(current, pending.id),
    };
    if (!terminalFits(projection)) {
      setStorageError(
        'This batch has reached its storage limit. Finish and End batch before another assignment. Nothing was submitted.',
      );
      return;
    }
    // Every retry rereads exact recovery bytes, not merely request identity.
    const recovery = readAssignmentRecovery(identity);
    if (
      recovery.blocked ||
      (recovered.current &&
        (recovery.raw !== recoveryRaw.current ||
          JSON.stringify(recovery.value) !==
            JSON.stringify(
              parseAssignmentRecovery(JSON.stringify(durable), identity),
            ))) ||
      (!recovered.current && recovery.value)
    ) {
      setStorageError(
        'The saved assignment changed or cannot be opened. Keep its original details intact and reload before continuing.',
      );
      return;
    }
    if (!recovered.current) {
      if (!saveBatch(projection)) {
        setStorageError(
          'This assignment could not be saved. Keep the review open and restore browser storage access. Nothing was submitted.',
        );
        return;
      } // write ahead: pending, provably not sent
      if (!storeAssignmentRecovery(durable, null)) {
        setStorageError(
          'This assignment could not be saved. Keep the review open and retry when browser storage is available. Nothing was submitted.',
        );
        return;
      }
      recovered.current = durable;
      recoveryRaw.current = readAssignmentRecovery(identity).raw;
    }
    if (
      !storeAssignmentRecovery(durable, durable, recoveryRaw.current) ||
      !updateEntry({ ...pending, status: 'uncertain' })
    ) {
      dispatch({
        type: 'restore',
        context: durable.context,
        candidate: durable.candidate,
        command: durable.command,
        sourceId: durable.sourceId,
        units: durable.units,
      });
      setStorageError(
        'The saved assignment could not be checked. Keep its original details intact and reload before continuing. Nothing was submitted by this attempt.',
      );
      return;
    }
    submitting.current = true;
    reviewRef.current?.focus();
    recoveryRaw.current = readAssignmentRecovery(identity).raw;
    dispatch({ type: 'pending', command });
    const mutationEpoch = epoch.current;
    const mutationActive = () => alive() && epoch.current === mutationEpoch;
    try {
      const result = await submitCustody(command);
      if (!mutationActive()) return; // old outcomes stay fenced after readmission
      if (result.ok) {
        if (!result.eventId || result.entityId !== current.candidate.id) {
          dispatch({
            type: 'unknown',
            message:
              'The saved assignment result could not be checked. Retry the same assignment before continuing.',
          });
          return;
        }
        const duplicate = batchRef.current?.entries.find(
          (row) => row.eventId === result.eventId && row.id !== entryId.current,
        );
        const retained =
          !duplicate &&
          updateEntry(
            { status: 'success', eventId: result.eventId, message: '' },
            { historical: null },
          );
        if (!retained) {
          dispatch({
            type: 'unknown',
            message:
              'Assignment confirmed, but its checklist could not be saved. Retry the same assignment to check its result; do not start another assignment.',
          });
          return;
        }
        if (
          !clearAssignmentRecovery(
            identity,
            command.requestId,
            recoveryRaw.current,
          )
        ) {
          setStorageError(
            'Assignment confirmed. Reload to finish updating this batch before assigning more.',
          );
          setReady(false);
        } else recovered.current = null;
        dispatch({ type: 'committed', result });
        setInput('');
      } else if (
        custodyOutcomeUnresolved(result, current.phase === 'unknown')
      ) {
        updateEntry({
          status: 'uncertain',
          message: result.message.slice(0, 500),
        });
        dispatch({ type: 'unknown', message: result.message });
      } else {
        if (
          !updateEntry(
            { status: 'failed', message: result.message.slice(0, 500) },
            { historical: null },
          ) ||
          !clearAssignmentRecovery(
            identity,
            command.requestId,
            recoveryRaw.current,
          )
        ) {
          dispatch({
            type: 'unknown',
            message:
              'The assignment was rejected, but this browser could not save that result. Reload to check this batch before continuing.',
          });
          setReady(false);
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
      if (mutationActive())
        dispatch({
          type: 'unknown',
          message:
            'The assignment result could not be confirmed. Retry the same assignment; do not start another assignment.',
        });
    } finally {
      if (mutationActive()) submitting.current = false;
    }
  };
  const next = () => {
    if (!alive() || submitting.current || unresolved) return false;
    const saved = batchRef.current;
    if (
      saved &&
      !saveBatch({
        ...saved,
        historical: null,
        entries: saved.entries.map((row) =>
          row.id === entryId.current && row.status === 'pending'
            ? {
                ...row,
                status: 'skipped',
                message: 'Skipped before confirmation.',
              }
            : row,
        ),
      })
    )
      return false;
    entryId.current = null;
    focusInput.current = true;
    resetReceiptRead();
    resolving.current = false;
    setRestoring(false);
    dispatch({ type: 'next', generation: ++generation.current });
    setInput('');
    gate.rescan();
    inputRef.current?.focus();
    return true;
  };
  const candidate = state.candidate;
  const problem = candidate
    ? assignmentProblem(candidate, state.sourceId, state.units)
    : null;
  const busy = unresolved || state.phase === 'lookup' || restoring;
  const totals = batchTotals(batch?.entries ?? []);
  const destinationValid =
    !!state.context &&
    sites.some((site) => site.id === state.context?.siteId && site.active);
  const freshReady = ready && !batch?.finished;
  const cancelInspection = () => {
    cancelPress.current = null;
    deferredReviewFocus.current = null;
    if (submitting.current || unresolved) return;
    next();
    inputRef.current?.focus();
  };
  const editReview = (edit: { sourceId?: string; units?: string }) => {
    if (!alive() || unresolved || !entryId.current || !batchRef.current) return;
    const snapshot = assignReducer(stateRef.current, { type: 'edit', ...edit });
    if (
      saveBatch({
        ...batchRef.current,
        context: snapshot.context,
        historical: historicalInspection(snapshot, entryId.current),
      })
    )
      dispatch({ type: 'edit', ...edit });
  };
  const refreshInspection = () => {
    if (
      !candidate ||
      !freshReady ||
      !destinationValid ||
      resolving.current ||
      submitting.current
    )
      return;
    const saved = batchRef.current;
    if (!saved) return;
    const existing = saved.entries.find(
      (row) => row.id === entryId.current && row.status === 'pending',
    );
    if (!existing && saved.entries.length >= BATCH_LIMIT) {
      setStorageError(
        'This batch is full. Finish and End batch before another inspection.',
      );
      return;
    }
    // Retrying an unfinished historical inspection reuses that row. A failed
    // submitted operation stays immutable and a deliberate new inspection is new.
    entryId.current = existing?.id ?? crypto.randomUUID();
    const replacement: BatchEntry = {
      id: entryId.current,
      status: 'pending',
      name: candidate.name,
      kind: candidate.kind,
      entityId: candidate.id,
      identifier: candidate.identifier,
      units: 0,
      source: '',
      context: { ...state.context! },
      requestId: null,
      eventId: null,
      message: '',
    };
    if (
      !saveBatch({
        ...saved,
        entries: existing
          ? saved.entries.map((row) =>
              row.id === existing.id ? replacement : row,
            )
          : [...saved.entries, replacement],
        historical: null,
      })
    )
      return;
    cancelRef.current?.focus();
    resetReceiptRead();
    resolving.current = true;
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
    ).finally(() => {
      if (alive() && generation.current === token) resolving.current = false;
    });
  };
  if (privateMasked)
    return (
      <p role="status">
        Assignment access changed. The original request remains locked until
        this workspace’s original account access is verified.
      </p>
    );
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
          disabled={unresolved || !freshReady}
          className="grid gap-3 sm:grid-cols-3"
        >
          <label className="space-y-2">
            Destination site
            <select
              ref={destinationRef}
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
          <LocationPicker
            locations={locations}
            mode="source"
            sourceIds={preferredSourceIds}
            label="Preferred storage source (optional)"
            value={state.context?.sourceId ?? ''}
            allowAll
            emptyLabel="Choose for each item"
            disabled={!state.context || !freshReady || unresolved}
            onValueChange={(sourceId) =>
              state.context && changeContext({ ...state.context, sourceId })
            }
          />
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
      {!destinationValid && state.context && (
        <p role="alert">
          The saved destination is unavailable. Choose an active site and
          inspect again.
        </p>
      )}
      <section
        aria-label={batch?.finished ? 'Batch summary' : 'Batch checklist'}
        ref={summaryRef}
        tabIndex={-1}
        className={panel + ' space-y-3'}
      >
        <h2 className="text-lg font-semibold">
          {batch?.finished ? 'Batch finished' : 'Assignment checklist'}
        </h2>
        <p role="status">
          {countLabel(totals.assetAssignments, 'asset assignment')}
          {totals.assets !== totals.assetAssignments
            ? ` (${countLabel(totals.assets, 'individual asset')})`
            : ''}{' '}
          · {countLabel(totals.quantityAssignments, 'quantity assignment')} (
          {countLabel(totals.units, 'unit')}) confirmed · {totals.failed} failed
          · {totals.skipped} skipped · {totals.pending} pending ·{' '}
          {totals.uncertain} uncertain
        </p>
        <ol className="max-h-64 space-y-3 overflow-y-auto overscroll-contain">
          {batch?.entries.map((row) => (
            <li
              key={row.id}
              className="break-words border-b border-slate-700 pb-3"
            >
              <p className="font-medium">
                {row.name}
                {row.identifier ? ` · ${row.identifier}` : ''} ·{' '}
                {row.status === 'pending'
                  ? 'Pending inspection / review'
                  : row.status === 'uncertain'
                    ? 'Result unknown — retry the same assignment'
                    : row.status === 'success'
                      ? 'Confirmed'
                      : row.status === 'failed'
                        ? 'Failed'
                        : 'Skipped'}
              </p>
              <p className="text-sm">
                {row.kind === 'asset'
                  ? 'Individual asset'
                  : row.kind === 'quantity' && row.units
                    ? countLabel(row.units, 'unit')
                    : 'Equipment inspection'}
                {row.source ? ` · ${row.source} → ` : ' · Destination: '}
                {row.context.siteName}
                {row.context.reference
                  ? ` · Ticket ${row.context.reference}`
                  : ''}
              </p>
              {row.message && <p className="text-sm">{row.message}</p>}
              {row.status === 'success' && (
                <Link
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                  href={`/history/events/${row.kind}/${row.eventId}`}
                >
                  View committed history for {row.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!ready || batch?.finished || busy}
            onClick={() => {
              if (!batchRef.current || !alive() || recovered.current) return;
              const saved = batchRef.current;
              if (
                !saveBatch({
                  ...saved,
                  finished: true,
                  historical: null,
                  entries: saved.entries.map((row) =>
                    row.status === 'pending'
                      ? {
                          ...row,
                          status: 'skipped',
                          message: 'Finished without assigning.',
                        }
                      : row,
                  ),
                })
              )
                return;
              generation.current++;
              resetReceiptRead();
              dispatch({
                type: 'hydrate',
                snapshot: {
                  ...initialAssignState(state.context),
                  receipt: state.receipt,
                },
              });
            }}
          >
            Finish batch
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!ready || !batch?.finished || busy}
            onClick={() => {
              if (
                !scope.current ||
                !alive() ||
                !batchRef.current?.finished ||
                recovered.current
              )
                return;
              const pending = readAssignmentRecovery(scope.current);
              if (
                pending.blocked ||
                pending.value ||
                !clearBatch(scope.current, batchRaw.current)
              ) {
                setStorageError(
                  'Batch could not be cleared safely. Restore session storage and reload before starting another batch.',
                );
                setReady(false);
                return;
              }
              generation.current++;
              resetReceiptRead();
              focusDestination.current = true;
              entryId.current = null;
              batchRaw.current = null;
              batchRef.current = emptyBatch(scope.current);
              setBatch(batchRef.current);
              dispatch({ type: 'hydrate', snapshot: initialAssignState(null) });
              setStorageError('');
              setInput('');
            }}
          >
            End batch
          </Button>
        </div>
        {totals.uncertain > 0 && (
          <p>
            Resolve the original assignment before finishing or ending this
            batch.
          </p>
        )}
      </section>
      {ready && !fatalStorageError && !batch?.finished && (
        <AssignCamera
          scope={actorId + ':' + backend + ':' + mode}
          onDetection={(value) => {
            if (
              gate.observe(
                value,
                freshReady &&
                  stateRef.current.phase === 'ready' &&
                  !!stateRef.current.context,
              )
            )
              void lookup(value!, mode === 'serial' ? 'serial' : 'identifier');
          }}
        />
      )}
      <form
        className={panel + ' space-y-3'}
        aria-label="Inspect equipment"
        aria-busy={state.phase === 'lookup' || restoring}
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(input);
        }}
      >
        {/* Restoration can complete during a press; keep its hit target fixed. */}
        <Button
          ref={cancelRef}
          variant="outline"
          className="hover:translate-y-0 active:scale-100"
          type="button"
          disabled={unresolved || !freshReady}
          onPointerDown={(event) => {
            if (
              event.button === 0 &&
              Number.isInteger(event.pointerId) &&
              event.pointerId >= 0 &&
              cancelPress.current === null
            ) {
              abortedCancelClick.current = null;
              cancelPress.current = event.pointerId;
            }
          }}
          onBlur={() => {
            cancelPress.current = null;
            // Deliberate focus navigation must not be stolen by a later release.
            if (document.activeElement !== cancelRef.current)
              deferredReviewFocus.current = null;
          }}
          onClick={(event) => {
            const aborted = abortedCancelClick.current;
            abortedCancelClick.current = null;
            if (
              aborted !== null &&
              (('pointerId' in event.nativeEvent &&
                event.nativeEvent.pointerId === aborted) ||
                (!('pointerId' in event.nativeEvent) && event.detail > 0))
            )
              return;
            cancelInspection();
          }}
        >
          {state.phase === 'lookup' || restoring
            ? 'Cancel inspection'
            : 'Skip inspection / review'}
        </Button>
        {(state.phase === 'lookup' || restoring) && (
          <div role="status" className="space-y-3">
            <p>Inspecting equipment…</p>
            <div aria-hidden="true" className="space-y-3">
              <div className="h-6 w-2/3 rounded bg-slate-700" />
              <div className="h-12 rounded bg-slate-800" />
              <div className="h-12 rounded bg-slate-800" />
            </div>
          </div>
        )}
        <label className="space-y-2">
          Lookup method
          <select
            aria-label="Lookup method"
            className={field}
            disabled={busy}
            value={mode}
            onChange={(e) => {
              if (next()) setMode(e.target.value as typeof mode);
            }}
          >
            <option value="identifier">Label or exact identifier</option>
            <option value="item_code">Exact quantity item code (SKU)</option>
            <option value="serial">Exact serial number</option>
            <option value="search">Search inventory</option>
          </select>
        </label>
        {mode === 'serial' && (
          <p className="text-sm text-[var(--muted)]">
            Camera and manual text match only stored serial numbers, including
            colons and LOC: or AST: prefixes. QR URLs are treated as serial
            text; duplicate matches need a choice.
          </p>
        )}
        <label className="space-y-2">
          Scan, paste, or search inventory
          <Input
            ref={inputRef}
            className={mode !== 'search' ? 'experience-code' : undefined}
            aria-label="Scan, paste, or search inventory"
            autoComplete="off"
            maxLength={1024}
            value={input}
            disabled={
              busy ||
              !freshReady ||
              ['review', 'choose', 'conflict'].includes(state.phase)
            }
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={
              !freshReady ||
              busy ||
              !destinationValid ||
              ['review', 'choose', 'conflict'].includes(state.phase)
            }
          >
            Inspect equipment
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={busy || !freshReady}
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
          ref={chooserRef}
          tabIndex={-1}
        >
          {state.matches.map((match, index) => (
            <li key={match.path}>
              <Button
                variant="outline"
                type="button"
                aria-describedby={
                  match.context ? `assign-match-context-${index}` : undefined
                }
                onClick={() => {
                  if (!alive() || resolving.current || submitting.current)
                    return;
                  cancelRef.current?.focus();
                  resetReceiptRead();
                  resolving.current = true;
                  const token = ++generation.current;
                  dispatch({ type: 'lookup', generation: token });
                  void inspect(match, token).finally(() => {
                    if (alive() && token === generation.current)
                      resolving.current = false;
                  });
                }}
              >
                <ScanMatchLabel match={match} /> ·{' '}
                {match.kind === 'quantity'
                  ? 'Quantity item'
                  : match.kind === 'location'
                    ? 'Location'
                    : 'Individual asset'}{' '}
                · <RecordStatus status={match.state} />
              </Button>
              {match.context && (
                <p
                  id={`assign-match-context-${index}`}
                  className="break-words text-sm text-[var(--muted)]"
                >
                  <ScanMatchContext match={match} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.truncated && (
        <Link href="/inventory" className="underline">
          Search inventory
        </Link>
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
              !freshReady ||
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
          ref={reviewRef}
          tabIndex={-1}
          className={panel + ' space-y-3'}
        >
          <h2 className="break-words text-lg font-semibold">
            {candidate.name}
          </h2>
          <p className="break-words text-sm">
            {candidate.kind === 'quantity'
              ? 'Quantity item'
              : 'Individual asset'}{' '}
            ·{' '}
            <span className="experience-code">
              {candidate.identifier || 'No display identifier'}
            </span>{' '}
            · <RecordStatus status={candidate.status} />
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
                onChange={(e) => editReview({ sourceId: e.target.value })}
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
                  onChange={(e) => editReview({ units: e.target.value })}
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
                !freshReady ||
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
                onClick={refreshInspection}
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
                {receiptLoading
                  ? 'Saved successfully. Loading receipt details…'
                  : receiptIssue
                    ? 'Saved successfully.'
                    : state.receipt.detailsUnrequested
                      ? 'Saved successfully. Receipt details have not been loaded.'
                      : 'Saved successfully. Event receipt details could not be loaded.'}{' '}
                Current holdings are not receipt balances.
              </p>

              {state.receipt.result.eventId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={receiptLoading}
                  onClick={async () => {
                    const receipt = state.receipt;
                    if (!alive() || !receipt?.result.eventId || receiptLoading)
                      return;
                    const receiptToken = generation.current;
                    setReceiptLoading(true);
                    setReceiptIssue('');
                    try {
                      const detail = await loadCustodyReceipt({
                        kind: receipt.kind,
                        entityId: receipt.entityId,
                        eventId: receipt.result.eventId,
                        expectedActorId: actorId,
                      });
                      if (!alive() || generation.current !== receiptToken)
                        return;
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
                      if (alive() && generation.current === receiptToken)
                        setReceiptIssue(
                          'Receipt details could not be loaded. The assignment remains confirmed.',
                        );
                    } finally {
                      if (alive() && generation.current === receiptToken) {
                        dispatch({
                          type: 'receipt-read-completed',
                          eventId: receipt.result.eventId,
                        });
                        setReceiptLoading(false);
                      }
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

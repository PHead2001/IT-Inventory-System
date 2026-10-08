'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type SetStateAction,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { flushSync } from 'react-dom';
import { waitForSheetReadiness } from './sheet-readiness';
import type {
  CategoryRef,
  LocationRef,
} from '@/features/inventory/contracts-ui';
import { LocationPicker } from '@/features/locations/location-picker';
import { barcodeCompatibleTag } from '@/features/scan/targets';
import {
  getQueueRecords,
  searchLabelRecords,
  type LabelCandidate,
  type LiveLabel,
} from './queue.server';
import { LabelSheet, type LabelRecord } from './label-sheet';
import styles from './label-workspace.module.css';
import { countLabel } from '@/lib/count';
import { consumedLabelUrl } from './add-intent';
import {
  labelQueueEntry as entryFor,
  selectLabelRows,
  projectLabelSelection,
  labelSelectionSummary,
  type SelectedLabel,
} from './label-selection';
import {
  labelSettingText,
  labelSizeOptions,
  paperSizeOptions,
  barcodeTypeOptions,
  barcodeTypeHelp,
} from './setting-options';
import {
  addEntry,
  defaultFilters,
  defaultJob,
  MAX_COPIES,
  MAX_DISTINCT,
  MAX_LABELS,
  parseStoredQueue,
  queueIdentity,
  queueStorageKey,
  totalCopies,
  updateCopies,
  type JobSettings,
  type LabelSearchFilters,
  type QueueEntry,
  type QueueKey,
} from './queue-model';

/** Every authorized observation retains review debt, even beside missing or acknowledged rows. */
function latchObservedChanges(
  entries: QueueEntry[],
  rows: LiveLabel[],
): QueueEntry[] {
  const byId = new Map(rows.map((row) => [queueIdentity(row), row]));
  let changed = false;
  const next = entries.map((entry) => {
    const row = byId.get(queueIdentity(entry));
    if (
      row &&
      entry.lifecycleAcknowledged &&
      (entry.baselineTag !== row.tag || entry.baselineState !== row.state)
    ) {
      changed = true;
      return { ...entry, lifecycleAcknowledged: false };
    }
    return entry;
  });
  return changed ? next : entries;
}

function recordKind(kind: QueueKey['kind']) {
  return kind === 'quantity'
    ? 'Quantity item'
    : kind === 'asset'
      ? 'Individual asset'
      : 'Location';
}
function reviewSnapshot(record: LiveLabel): string {
  return JSON.stringify([
    queueIdentity(record),
    record.tag,
    record.state,
    record.barcode,
    signature(record),
  ]);
}

function signature(record: LabelRecord): string {
  return JSON.stringify([
    record.kind,
    record.key,
    record.name,
    record.path,
    record.barcode,
    record.humanId,
    record.categoryName,
    record.manufacturer,
    record.model,
    record.serialNumber,
    record.locationHierarchy,
  ]);
}
function printableRecord(record: LiveLabel): LabelRecord {
  return {
    kind: record.kind,
    key: record.key,
    name: record.name,
    path: record.path,
    barcode: record.barcode,
    humanId: record.humanId,
    categoryName: record.categoryName,
    manufacturer: record.manufacturer,
    model: record.model,
    serialNumber: record.serialNumber,
    locationHierarchy: record.locationHierarchy,
  };
}
function expandLabels(entries: QueueEntry[], rows: LiveLabel[]): LabelRecord[] {
  const byId = new Map(rows.map((record) => [queueIdentity(record), record]));
  return entries.flatMap((entry) =>
    Array.from({ length: entry.copies }, () =>
      printableRecord(byId.get(queueIdentity(entry))!),
    ),
  );
}
const emptyInitial: LiveLabel[] = [];
const emptyIntent: QueueKey[] = [];

type ItemReview = { snapshot: string; generation: number; historical: boolean };

type LabelDesignerProps = {
  locations: LocationRef[];
  categories: CategoryRef[];
  origin: string;
  memberId: string;
  preview: boolean;
  initial?: LiveLabel[];
  addIntent?: QueueKey[];
  defaults?: JobSettings;
};

export function LabelDesigner(props: LabelDesignerProps) {
  return (
    <LabelDesignerWorkspace
      key={queueStorageKey(props.origin, props.memberId)}
      {...props}
    />
  );
}

function LabelDesignerWorkspace({
  locations,
  categories,
  origin,
  memberId,
  preview,
  initial = emptyInitial,
  addIntent = emptyIntent,
  defaults = defaultJob,
}: LabelDesignerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const intentSignature = JSON.stringify(addIntent);
  const [intentRetry, setIntentRetry] = useState(0);
  const [intentPending, setIntentPending] = useState(false);
  const [intentOutstanding, setIntentOutstanding] = useState(
    addIntent.length > 0,
  );
  const [intentError, setIntentError] = useState('');
  const [pendingIntentKeys, setPendingIntentKeys] = useState<QueueKey[]>([]);
  const handledIntent = useRef(new Set<string>());
  const cancelledIntent = useRef(new Set<string>());
  const manualClearEpoch = useRef(0);
  const cancelledManualAdds = useRef(new Set<string>());
  const initialHydration = useRef({ initial, defaults });
  const storageKey = queueStorageKey(origin, memberId);
  const [entries, setEntriesState] = useState<QueueEntry[]>(
    initial.map(entryFor),
  );
  const currentEntries = useRef(initial.map(entryFor));
  const setEntries = useCallback((update: SetStateAction<QueueEntry[]>) => {
    const next =
      typeof update === 'function' ? update(currentEntries.current) : update;
    currentEntries.current = next;
    setEntriesState(next);
  }, []);
  const [live, setLiveState] = useState<LiveLabel[]>(initial);
  const currentLive = useRef(initial);
  const setLive = useCallback((update: SetStateAction<LiveLabel[]>) => {
    const next =
      typeof update === 'function' ? update(currentLive.current) : update;
    currentLive.current = next;
    setLiveState(next);
  }, []);
  const [filters, setFilters] = useState<LabelSearchFilters>(defaultFilters);
  const [draft, setDraftState] = useState<LabelSearchFilters>(defaultFilters);
  const [selected, setSelected] = useState<SelectedLabel[]>([]);
  const [queueFeedback, setQueueFeedback] = useState('');
  const selectionEpoch = useRef(0);
  const manualAddPending = useRef(false);
  const setDraft = (next: LabelSearchFilters) => {
    selectionEpoch.current++;
    setSelected([]);
    setQueueFeedback(
      selected.length || manualAddPending.current
        ? 'Unsubmitted label selection cleared because search or filters changed.'
        : '',
    );
    setDraftState(next);
  };
  const [job, setJob] = useState<JobSettings>(defaults);
  const [locationCode, setLocationCode] = useState('');
  const [search, setSearch] = useState<{
    rows: LabelCandidate[];
    total: number;
    page: number;
    pageSize: number;
  } | null>(null);
  const [printRows, setPrintRows] = useState<LabelRecord[] | null>(null);
  const [prepared, setPrepared] = useState<LiveLabel[] | null>(null);
  const [validatedKey, setValidatedKey] = useState('');
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [readySheetKey, setReadySheetKey] = useState('');
  const [retry, setRetry] = useState(0);
  const [pendingChanges, setPendingChanges] = useState<LiveLabel[]>([]);
  const [reviewed, setReviewed] = useState<Record<string, ItemReview>>({});
  const removalReviews = useRef<Record<string, ItemReview>>({});
  const [fallbackPending, setFallbackPending] = useState(false);
  const [formatAcknowledged, setFormatAcknowledged] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const queueEpoch = useRef(0);
  const selectionKey = entries.map(queueIdentity).join('|');
  const clearPrintAuthorization = useRef<(() => void) | null>(null);
  const activePrintAbort = useRef<AbortController | null>(null);
  const byId = useMemo(
    () => new Map(live.map((record) => [queueIdentity(record), record])),
    [live],
  );

  useEffect(
    () => () => {
      queueEpoch.current++;
      manualClearEpoch.current++;
      selectionEpoch.current++;
      activePrintAbort.current?.abort();
      clearPrintAuthorization.current?.();
    },
    [],
  );

  useEffect(() => {
    let current = true;
    // Hydration is asynchronous so React does not render a second, synchronous
    // state cascade while mounting. The cleanup also ignores a late RPC reply.
    queueMicrotask(() => {
      if (!current) return;
      let stored: ReturnType<typeof parseStoredQueue> = null;
      try {
        stored = parseStoredQueue(
          sessionStorage.getItem(storageKey),
          initialHydration.current.defaults,
        );
      } catch {
        setStorageUnavailable(true);
      }
      if (stored) {
        const merged = [...stored.entries];
        for (const record of initialHydration.current.initial) {
          if (
            !merged.some(
              (entry) => queueIdentity(entry) === queueIdentity(record),
            )
          )
            merged.push(entryFor(record));
        }
        if (merged.length <= MAX_DISTINCT && totalCopies(merged) <= MAX_LABELS)
          setEntries(merged);
        setFilters(stored.filters);
        setDraftState(stored.filters);
        setJob(stored.job);
      }
      setHydrated(true);
    });
    return () => {
      current = false;
    };
  }, [storageKey, setEntries]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ entries, filters, job }),
      );
    } catch {
      // Search and printing remain available with an in-memory queue.
      queueMicrotask(() => setStorageUnavailable(true));
    }
  }, [storageKey, hydrated, entries, filters, job]);
  useEffect(() => {
    // Restore the caller's filters before issuing a search. Otherwise revisits
    // query defaults and then immediately query the restored filters again.
    if (!hydrated) return;
    let current = true;
    void searchLabelRecords(filters)
      .then((result) => {
        if (current) setSearch(result);
      })
      .catch(() => {
        if (current) setMessage('Label search could not be loaded. Try again.');
      });
    return () => {
      current = false;
    };
  }, [filters, hydrated]);

  const invalidate = useCallback(
    (preserveRemovalReviews = false) => {
      queueEpoch.current++;
      activePrintAbort.current?.abort();
      clearPrintAuthorization.current?.();
      if (!preserveRemovalReviews) {
        removalReviews.current = {};
        setReviewed({});
      }
      setRefreshPending(true);
      setRefreshFailed(false);
      setFallbackPending(false);
      setFormatAcknowledged(false);
    },
    [setFallbackPending, setFormatAcknowledged, setReviewed],
  );
  // A second observed snapshot invalidates a decision even when its review debt
  // is already latched. Keep the latest rows available to delayed add responses.
  const observeRows = useCallback(
    (rows: LiveLabel[]) => {
      const observed = latchObservedChanges(currentEntries.current, rows);
      const previous = new Map(
        currentLive.current.map((row) => [queueIdentity(row), row]),
      );
      const snapshotChanged = rows.some((row) => {
        const prior = previous.get(queueIdentity(row));
        return prior && reviewSnapshot(prior) !== reviewSnapshot(row);
      });
      const debtChanged = observed !== currentEntries.current;
      if (debtChanged) setEntries(observed);
      return debtChanged || snapshotChanged;
    },
    [setEntries],
  );
  useEffect(() => {
    const refresh = () => {
      invalidate();
      setReviewed({});
      setRetry((value) => value + 1);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [invalidate]);
  const consumeIntent = useCallback(() => {
    const next = consumedLabelUrl(
      pathname,
      query,
      handledIntent.current,
      window.location.hash,
    );
    if (next === pathname + (query ? '?' + query : '') + window.location.hash)
      return;
    try {
      router.replace(next, { scroll: false });
    } catch {
      setIntentError(
        'The addition was handled, but its link could not be cleared. Reloading this URL may repeat the addition.',
      );
    }
  }, [pathname, query, router]);
  useEffect(() => {
    handledIntent.current.clear();
    cancelledIntent.current.clear();
  }, [intentSignature]);
  useEffect(() => {
    if (!hydrated) return;
    const requested = (JSON.parse(intentSignature) as QueueKey[]).filter(
      (key) => !handledIntent.current.has(queueIdentity(key)),
    );
    if (!requested.length) {
      queueMicrotask(() => {
        setIntentPending(false);
        setIntentOutstanding(false);
        setIntentError('');
        setPendingIntentKeys([]);
      });
      return;
    }
    let current = true;
    queueMicrotask(() => {
      if (current) {
        setIntentPending(true);
        setIntentOutstanding(true);
        setIntentError('');
        setPendingIntentKeys(
          requested.filter(
            (key) =>
              !handledIntent.current.has(queueIdentity(key)) &&
              !currentEntries.current.some(
                (entry) => queueIdentity(entry) === queueIdentity(key),
              ),
          ),
        );
      }
    });
    void getQueueRecords(requested)
      .then((rows) => {
        if (!current) return;
        const requestedIds = new Set(requested.map(queueIdentity));
        if (
          new Set(rows.map(queueIdentity)).size !== rows.length ||
          rows.some((row) => !requestedIds.has(queueIdentity(row)))
        )
          throw new Error('Unexpected records');
        if (observeRows(rows)) {
          invalidate();
          setRetry((value) => value + 1);
        }
        const next = [...currentEntries.current];
        const added: LiveLabel[] = [];
        const notices: string[] = [];
        for (const key of requested) {
          const id = queueIdentity(key);
          if (cancelledIntent.current.has(id) || handledIntent.current.has(id))
            continue;
          const record = rows.find((row) => queueIdentity(row) === id);
          if (!record)
            notices.push('That record is unavailable to this account.');
          else if (next.some((entry) => queueIdentity(entry) === id))
            notices.push(
              'Already in the queue. Existing copy counts are preserved.',
            );
          else {
            const merged = addEntry(next, entryFor(record));
            if (merged) {
              next.push(entryFor(record));
              added.push(record);
            } else
              notices.push(
                `Queue limit: ${MAX_DISTINCT} distinct records, ${MAX_COPIES} copies each, ${MAX_LABELS} labels total.`,
              );
          }
          handledIntent.current.add(id);
        }
        if (added.length) {
          setEntries(next);
          setLive((list) => [
            ...list.filter(
              (record) =>
                !added.some(
                  (row) => queueIdentity(row) === queueIdentity(record),
                ),
            ),
            ...added,
          ]);
          invalidate();
          notices.unshift(
            `${added.map((record) => record.name).join(', ')} added. Names and context refresh before printing.`,
          );
        }
        if (notices.length) setMessage(notices.join(' '));
        setIntentOutstanding(false);
        setPendingIntentKeys([]);
        consumeIntent();
      })
      .catch(() => {
        if (current)
          setIntentError(
            'Linked records could not be added. Retry the pending additions.',
          );
      })
      .finally(() => {
        if (current) setIntentPending(false);
      });
    return () => {
      current = false;
    };
  }, [
    hydrated,
    intentSignature,
    intentRetry,
    observeRows,
    consumeIntent,
    invalidate,
    setEntries,
    setLive,
  ]);
  const removeEntries = (ids: Set<string>, clear = false) => {
    removalReviews.current = Object.fromEntries(
      Object.entries(reviewed).filter(([id]) => !clear && !ids.has(id)),
    );
    if (clear) manualClearEpoch.current++;
    selectionEpoch.current++;
    for (const id of ids) cancelledManualAdds.current.add(id);
    for (const key of addIntent) {
      const id = queueIdentity(key);
      if (clear || ids.has(id)) {
        cancelledIntent.current.add(id);
        handledIntent.current.add(id);
      }
    }
    setEntries((list) =>
      clear ? [] : list.filter((entry) => !ids.has(queueIdentity(entry))),
    );
    setPendingChanges((rows) =>
      clear ? [] : rows.filter((row) => !ids.has(queueIdentity(row))),
    );
    setReviewed((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !clear && !ids.has(id)),
      ),
    );
    setLive((rows) =>
      clear ? [] : rows.filter((row) => !ids.has(queueIdentity(row))),
    );
    setUnavailable((list) => (clear ? [] : list.filter((id) => !ids.has(id))));
    setPendingIntentKeys((keys) =>
      clear ? [] : keys.filter((key) => !ids.has(queueIdentity(key))),
    );
    invalidate(true);
    setQueueFeedback(
      clear ? 'Label queue cleared.' : 'Record removed from the label queue.',
    );
    setMessage('');
    if (
      addIntent.every((key) => handledIntent.current.has(queueIdentity(key)))
    ) {
      setIntentPending(false);
      setIntentOutstanding(false);
      setIntentError('');
    }
    consumeIntent();
  };
  const addSelected = async (requested: SelectedLabel[], batch: boolean) => {
    if (manualAddPending.current || !requested.length) return;
    const unique = selectLabelRows([], requested);
    if (
      !batch &&
      currentEntries.current.some(
        (entry) => queueIdentity(entry) === queueIdentity(unique[0]),
      )
    ) {
      setQueueFeedback(
        'Already in the queue. Existing copy counts are preserved.',
      );
      return;
    }
    const epoch = selectionEpoch.current;
    const clearEpoch = manualClearEpoch.current;
    for (const row of unique)
      cancelledManualAdds.current.delete(queueIdentity(row));
    manualAddPending.current = true;
    ++queueEpoch.current;
    activePrintAbort.current?.abort();
    setBusy(true);
    setQueueFeedback('Checking selected records...');
    try {
      const rows: LiveLabel[] = [];
      // The existing caller-authorized read accepts at most 200 exact identities.
      for (let offset = 0; offset < unique.length; offset += MAX_DISTINCT) {
        rows.push(
          ...(await getQueueRecords(
            unique
              .slice(offset, offset + MAX_DISTINCT)
              .map(({ kind, key }) => ({ kind, key })),
          )),
        );
        if (
          epoch !== selectionEpoch.current ||
          clearEpoch !== manualClearEpoch.current
        )
          return;
      }
      if (
        unique.some((row) =>
          cancelledManualAdds.current.has(queueIdentity(row)),
        )
      )
        return;
      const result = projectLabelSelection(
        currentEntries.current,
        unique,
        rows,
      );
      if (!result.next) {
        setQueueFeedback(
          `Nothing added. The selected records exceed the queue limit: ${MAX_DISTINCT} distinct records, ${MAX_COPIES} copies each, ${MAX_LABELS} labels total. Reduce the selection or queue copies and try again.`,
        );
        return;
      }
      if (observeRows(rows)) {
        invalidate();
        setRetry((value) => value + 1);
      }
      // Preserve any review debt latched by observing existing queue records.
      const final = projectLabelSelection(currentEntries.current, unique, rows);
      if (final.added.length) {
        setEntries(final.next!);
        setLive((current) => [
          ...current.filter(
            (row) =>
              !rows.some(
                (fresh) => queueIdentity(fresh) === queueIdentity(row),
              ),
          ),
          ...rows,
        ]);
        invalidate();
      }
      if (batch) setSelected([]);
      setQueueFeedback(labelSelectionSummary(final));
    } catch {
      if (
        epoch === selectionEpoch.current &&
        clearEpoch === manualClearEpoch.current
      )
        setQueueFeedback(
          'Selected records could not be added. Nothing added; try again.',
        );
    } finally {
      manualAddPending.current = false;
      setBusy(false);
      // If a pending addition interrupted preview refresh, resume the existing path.
      setRetry((value) => value + 1);
    }
  };
  const add = (key: QueueKey) =>
    addSelected(
      [
        {
          ...key,
          name:
            search?.rows.find(
              (row) => queueIdentity(row) === queueIdentity(key),
            )?.name ??
            locations.find((location) => location.code === key.key)?.name ??
            key.key,
        },
      ],
      false,
    );
  const prepareFrom = (rows: LiveLabel[], generationKey: string) => {
    const candidates = removalReviews.current;
    removalReviews.current = {};
    setReviewed({});
    const rowMap = new Map(rows.map((row) => [queueIdentity(row), row]));
    const observed = latchObservedChanges(currentEntries.current, rows);
    if (observed !== currentEntries.current) setEntries(observed);
    const missing = entries
      .filter((entry) => !rowMap.has(queueIdentity(entry)))
      .map(queueIdentity);
    setUnavailable(missing);
    if (missing.length) {
      setLive(
        rows.filter((row) =>
          entries.some((entry) => queueIdentity(entry) === queueIdentity(row)),
        ),
      );
      setPrintRows(null);
      setPrepared(null);
      setReviewed({});
      setPendingChanges([]);
      setRefreshPending(false);
      setValidatedKey('');
      setMessage('');
      return;
    }
    if (rows.length !== entries.length || rowMap.size !== entries.length) {
      setPendingChanges([]);
      setRefreshPending(false);
      setRefreshFailed(true);
      setValidatedKey('');
      setMessage(
        'Label refresh returned unexpected records. Printing is blocked; retry.',
      );
      return;
    }
    setLive(rows);
    setReviewed(
      Object.fromEntries(
        Object.entries(candidates).flatMap(([id, decision]) => {
          const row = rowMap.get(id);
          return row && decision.snapshot === reviewSnapshot(row)
            ? [[id, { ...decision, generation: queueEpoch.current }]]
            : [];
        }),
      ),
    );
    const changed = entries.flatMap((entry) => {
      const row = rowMap.get(queueIdentity(entry))!;
      return entry.baselineTag !== row.tag ||
        entry.baselineState !== row.state ||
        !entry.lifecycleAcknowledged
        ? [row]
        : [];
    });
    if (changed.length) {
      setPendingChanges(changed);
      setRefreshPending(false);
      setValidatedKey('');
      setMessage('');
      return;
    }
    setPendingChanges([]);
    setPrepared(rows);
    setPrintRows(expandLabels(entries, rows));
    setValidatedKey(generationKey);
    setRefreshPending(false);
    setRefreshFailed(false);
    setFallbackPending(false);
    setMessage(
      'Print preview refreshed from current inventory. Review every page before printing.',
    );
  };
  useEffect(() => {
    if (!hydrated) return;
    const generation = ++queueEpoch.current;
    activePrintAbort.current?.abort();
    clearPrintAuthorization.current?.();
    if (!entries.length) {
      queueMicrotask(() => {
        if (generation !== queueEpoch.current) return;
        setPrintRows(null);
        setPrepared(null);
        setValidatedKey('');
        setRefreshPending(false);
        setUnavailable([]);
        setPendingChanges([]);
      });
      return;
    }
    queueMicrotask(() => {
      if (generation === queueEpoch.current) setRefreshPending(true);
    });
    const timer = window.setTimeout(() => {
      void getQueueRecords(entries.map(({ kind, key }) => ({ kind, key })))
        .then((rows) => {
          if (generation === queueEpoch.current)
            prepareFrom(rows, selectionKey);
        })
        .catch(() => {
          if (generation !== queueEpoch.current) return;
          setRefreshPending(false);
          setRefreshFailed(true);
          setLive([]);
          setPrintRows(null);
          setPrepared(null);
          setPendingChanges([]);
          removalReviews.current = {};
          setReviewed({});
          setValidatedKey('');
          setMessage('Label refresh failed. Printing is blocked; retry.');
        });
    }, 150);
    return () => window.clearTimeout(timer);
    // Copies and sheet settings only change the local layout, not the validated selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, hydrated, retry]);
  const acknowledge = async (record: LiveLabel) => {
    const id = queueIdentity(record);
    const decision = reviewed[id];
    if (
      busy ||
      refreshPending ||
      refreshFailed ||
      !decision ||
      decision.generation !== queueEpoch.current ||
      decision.snapshot !== reviewSnapshot(record) ||
      (record.state !== 'active' && !decision.historical)
    )
      return;
    invalidate();
    const generation = queueEpoch.current;
    setBusy(true);
    try {
      const rows = await getQueueRecords(
        currentEntries.current.map(({ kind, key }) => ({ kind, key })),
      );
      if (generation !== queueEpoch.current) return;
      const fresh = rows.find((row) => queueIdentity(row) === id);
      const identities = new Set(rows.map(queueIdentity));
      if (
        !fresh ||
        reviewSnapshot(fresh) !== decision.snapshot ||
        rows.length !== currentEntries.current.length ||
        identities.size !== rows.length ||
        currentEntries.current.some(
          (entry) => !identities.has(queueIdentity(entry)),
        )
      ) {
        setReviewed({});
        prepareFrom(rows, selectionKey);
        return;
      }
      setEntries((list) =>
        latchObservedChanges(list, rows).map((entry) =>
          queueIdentity(entry) === id
            ? {
                ...entry,
                baselineTag: fresh.tag,
                baselineState: fresh.state,
                lifecycleAcknowledged: true,
              }
            : entry,
        ),
      );
      setLive(rows);
      setReviewed({});
      setPendingChanges((current) =>
        current.filter((row) => queueIdentity(row) !== id),
      );
      setRetry((value) => value + 1);
      setMessage('');
    } catch {
      if (generation !== queueEpoch.current) return;
      setReviewed({});
      setLive([]);
      setPrintRows(null);
      setPrepared(null);
      setPendingChanges([]);
      setRefreshPending(false);
      setRefreshFailed(true);
      setValidatedKey('');
      setMessage(
        'Current item could not be verified. Printing is blocked; retry label refresh.',
      );
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    if (
      intentPending ||
      !prepared ||
      !printRows ||
      refreshPending ||
      refreshFailed ||
      validatedKey !== selectionKey ||
      unavailable.length ||
      pendingChanges.length
    )
      return;
    const epoch = ++queueEpoch.current;
    activePrintAbort.current?.abort();
    const printAbort = new AbortController();
    activePrintAbort.current = printAbort;
    setBusy(true);
    let currentReadVerified = false;
    try {
      const fresh = await getQueueRecords(
        entries.map(({ kind, key }) => ({ kind, key })),
      );
      if (epoch !== queueEpoch.current) return;
      currentReadVerified = true;
      const observed = latchObservedChanges(currentEntries.current, fresh);
      if (observed !== currentEntries.current) setEntries(observed);
      const rowMap = new Map(fresh.map((row) => [queueIdentity(row), row]));
      const meaningfulChange = entries.some((entry) => {
        const row = rowMap.get(queueIdentity(entry));
        return (
          row &&
          (entry.baselineTag !== row.tag ||
            entry.baselineState !== row.state ||
            !entry.lifecycleAcknowledged)
        );
      });
      if (
        fresh.length !== entries.length ||
        rowMap.size !== entries.length ||
        entries.some((entry) => !rowMap.has(queueIdentity(entry))) ||
        meaningfulChange
      ) {
        prepareFrom(fresh, selectionKey);
        return;
      }
      const descriptiveChange = fresh.some(
        (row, index) => signature(row) !== signature(prepared[index]),
      );
      const refreshedRows = descriptiveChange
        ? expandLabels(entries, fresh)
        : null;
      const printGeneration = refreshedRows
        ? JSON.stringify([
            selectionKey,
            totalCopies(entries),
            job,
            refreshedRows.map(signature),
          ])
        : sheetKey;
      if (descriptiveChange) {
        // Browser print captures the current DOM immediately. Commit the refreshed
        // descriptive text before checking codes or opening the print dialog.
        flushSync(() => {
          setLive(fresh);
          setPrepared(fresh);
          setPrintRows(refreshedRows);
          setMessage('Label information refreshed from current inventory.');
        });
      } else {
        // Holdings can change without changing permanent print content.
        setLive(fresh);
        setPrepared(fresh);
      }
      const sheet = document.querySelector<HTMLElement>('.label-print-root');
      if (!sheet) {
        setMessage('Print preview is unavailable. Prepare it again.');
        return;
      }
      const readiness = await waitForSheetReadiness(
        sheet,
        printGeneration,
        totalCopies(entries),
        printAbort.signal,
        () => epoch === queueEpoch.current,
      );
      if (readiness === 'cancelled' || epoch !== queueEpoch.current) return;
      if (readiness !== 'ready') {
        setMessage(
          'Wait for every code and label text to fit, or choose a larger label.',
        );
        return;
      }
      if (
        job.format === 'code128' &&
        !formatAcknowledged &&
        document.querySelector(
          '.label-print-root .label-card[data-code-fallback="true"]',
        )
      ) {
        setFallbackPending(true);
        setMessage(
          'Some Code 128 labels use QR. Acknowledge the QR fallback before printing.',
        );
        return;
      }
      if (epoch !== queueEpoch.current || printAbort.signal.aborted) return;
      // The final check grants exactly one print lifecycle. A second
      // beforeprint (including Ctrl/Cmd+P) cannot reuse that grant.
      clearPrintAuthorization.current?.();
      let armed = true;
      const beforePrint = () => {
        if (armed) {
          armed = false;
          sheet.dataset.printAuthorized = 'true';
        } else delete sheet.dataset.printAuthorized;
      };
      const clear = () => {
        armed = false;
        window.removeEventListener('beforeprint', beforePrint);
        window.removeEventListener('afterprint', clear);
        delete sheet.dataset.printAuthorized;
        if (clearPrintAuthorization.current === clear)
          clearPrintAuthorization.current = null;
      };
      clearPrintAuthorization.current = clear;
      window.addEventListener('beforeprint', beforePrint);
      window.addEventListener('afterprint', clear, { once: true });
      try {
        window.print();
      } finally {
        clear();
      }
    } catch {
      if (epoch !== queueEpoch.current) return;
      setValidatedKey('');
      setRefreshFailed(true);
      if (!currentReadVerified) {
        setLive([]);
        setPrintRows(null);
        setPrepared(null);
        setPendingChanges([]);
        setReviewed({});
      }
      setMessage('Final label check failed. Printing is blocked; retry.');
    } finally {
      printAbort.abort();
      if (activePrintAbort.current === printAbort)
        activePrintAbort.current = null;
      setBusy(false);
    }
  };
  const setCopies = (identity: string, value: number) => {
    const next = updateCopies(entries, identity, value);
    if (!next) {
      setMessage(
        `Use 1–${MAX_COPIES} copies per record and at most ${MAX_LABELS} labels total.`,
      );
      return;
    }
    setEntries(next);
    activePrintAbort.current?.abort();
    clearPrintAuthorization.current?.();
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    selectionEpoch.current++;
    setSelected([]);
    if (selected.length || manualAddPending.current)
      setQueueFeedback(
        'Unsubmitted label selection cleared because search or filters changed.',
      );
    setSearch(null);
    setFilters({ ...draft, page: 1 });
  };
  const fallbackCount = entries.filter(
    (entry) =>
      entry.kind === 'quantity' ||
      (entry.kind === 'asset' &&
        !barcodeCompatibleTag(byId.get(queueIdentity(entry))?.tag ?? '')),
  ).length;
  const displayRows =
    !refreshPending && validatedKey === selectionKey && prepared
      ? expandLabels(entries, prepared)
      : printRows;
  const sheetKey = JSON.stringify([
    selectionKey,
    totalCopies(entries),
    job,
    displayRows?.map(signature),
  ]);
  useEffect(() => {
    let current = true;
    const sheet = document.querySelector<HTMLElement>('.label-print-root');
    if (!sheet || !displayRows?.length) return;
    const check = () => {
      if (!current) return;
      const cards = Array.from(
        sheet.querySelectorAll<HTMLElement>('.label-card'),
      );
      const ready =
        sheet.dataset.sheetGeneration === sheetKey &&
        cards.length === displayRows.length &&
        cards.every(
          (card) =>
            card.dataset.sheetGeneration === sheetKey &&
            card.dataset.codeReady === 'true' &&
            card.dataset.textMeasured === 'true',
        );
      const imagesReady = Array.from(
        sheet.querySelectorAll<HTMLImageElement>('img'),
      ).every((image) => image.complete && image.naturalWidth > 0);
      const fallback =
        job.format === 'code128' &&
        cards.some((card) => card.dataset.codeFallback === 'true');
      setFallbackPending(fallback && !formatAcknowledged);
      if (
        ready &&
        imagesReady &&
        (!document.fonts || document.fonts.status === 'loaded')
      )
        setReadySheetKey(sheetKey);
      else setReadySheetKey((key) => (key === sheetKey ? '' : key));
    };
    const observer = new MutationObserver(check);
    observer.observe(sheet, {
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-code-ready',
        'data-code-fallback',
        'data-text-measured',
        'data-sheet-generation',
      ],
    });
    sheet.addEventListener('load', check, true);
    sheet.addEventListener('error', check, true);
    check();
    void document.fonts?.ready.then(check);
    return () => {
      current = false;
      observer.disconnect();
      sheet.removeEventListener('load', check, true);
      sheet.removeEventListener('error', check, true);
    };
    // Sheet identity captures rows and layout; readiness follows the rendered DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey, formatAcknowledged]);

  return (
    <div className={styles.workspace}>
      {preview && (
        <p className={styles.previewWarning}>
          Preview labels for {origin}. These are for this isolated environment
          only.
        </p>
      )}
      <p className={styles.intro}>
        Queue up to {MAX_DISTINCT} distinct records, {MAX_COPIES} copies each,
        and {MAX_LABELS} labels total. Quantity item results appear once per
        definition, even with several holdings.
      </p>
      {storageUnavailable && (
        <p role="status" className={styles.warning}>
          Browser storage is unavailable. Queue changes, including removals, may
          not survive reload; previously saved records may return.
        </p>
      )}
      <div className={styles.searchLayout}>
        <div className={styles.searchColumn}>
          <form
            onSubmit={submitSearch}
            aria-label="Search label records"
            className={`${styles.surface} ${styles.surfaceAccent} ${styles.searchForm}`}
          >
            <div>
              <p className={styles.eyebrow}>01 / Find records</p>
              <h2 className={styles.title}>Search inventory</h2>
              <p className={styles.subtle}>
                Find quantity items and individual assets for the sheet.
              </p>
            </div>
            <label className={styles.fieldLabel}>
              Name, serial, tag, category, manufacturer, model, or exact ID
              <input
                value={draft.q}
                onChange={(event) =>
                  setDraft({ ...draft, q: event.target.value })
                }
                maxLength={200}
                className={styles.field}
              />
            </label>
            <div className={styles.filters}>
              <label className={styles.fieldLabel}>
                Type{' '}
                <select
                  value={draft.type}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      type: event.target.value as LabelSearchFilters['type'],
                    })
                  }
                  className={styles.field}
                >
                  <option value="all">All</option>
                  <option value="quantity">Quantity item</option>
                  <option value="asset">Individual asset</option>
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Status{' '}
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target
                        .value as LabelSearchFilters['status'],
                    })
                  }
                  className={styles.field}
                >
                  <option value="active">Active</option>
                  <option value="historical">Archived / retired</option>
                  <option value="all">All</option>
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Category{' '}
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value })
                  }
                  className={styles.field}
                >
                  <option value="">All</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <LocationPicker
              locations={locations}
              mode="browse"
              label="Location filter"
              value={draft.location}
              onValueChange={(value) => setDraft({ ...draft, location: value })}
              allowAll
            />
            <button className={styles.primaryButton}>Search</button>
          </form>
          <section className={styles.surface} aria-label="Label search results">
            <p className={styles.eyebrow}>Search results</p>
            <h2 className={styles.title}>Records</h2>
            <p className={styles.subtle} id="label-results-scroll-hint">
              {search
                ? `${countLabel(search.total, 'matching record')}. Scroll this list to browse the current page.`
                : 'Loading matching records…'}
            </p>
            <div className={styles.queueActions}>
              <span>{countLabel(selected.length, 'selected record')}</span>
              <button
                type="button"
                className={styles.textButton}
                disabled={busy || !search?.rows.length}
                onClick={() =>
                  setSelected((current) =>
                    selectLabelRows(current, search?.rows ?? []),
                  )
                }
              >
                Select current page
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy || !selected.length}
                onClick={() => void addSelected(selected, true)}
              >
                Add selected to queue
              </button>
              <a href="#label-queue" className={styles.resultLink}>
                Review queue: {countLabel(entries.length, 'record')} {'\u00b7'}{' '}
                {countLabel(totalCopies(entries), 'label')}
              </a>
            </div>
            <p role="status" aria-live="polite" className={styles.notice}>
              {queueFeedback}
            </p>
            <div
              className={styles.results}
              role="region"
              aria-label="Search result records"
              aria-describedby="label-results-scroll-hint"
              tabIndex={0}
            >
              {search?.rows.map((record) => (
                <div key={record.kind + record.key} className={styles.result}>
                  <div className={styles.resultMain}>
                    <label className={styles.fieldLabel}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        aria-label={`Select ${record.name}, ${recordKind(record.kind)}, ${record.holdingContext}`}
                        checked={selected.some(
                          (row) => queueIdentity(row) === queueIdentity(record),
                        )}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? selectLabelRows(current, [record])
                              : current.filter(
                                  (row) =>
                                    queueIdentity(row) !==
                                    queueIdentity(record),
                                ),
                          )
                        }
                      />
                      Select record
                    </label>
                    <Link
                      href={
                        record.kind === 'quantity'
                          ? '/inventory/quantity/' + record.key
                          : '/inventory/assets/' + record.key
                      }
                      className={styles.resultLink}
                    >
                      {record.name}
                    </Link>
                    <p className={styles.resultMeta}>
                      {recordKind(record.kind)} · {record.categoryName} ·{' '}
                      {record.status}
                    </p>
                    <p className={styles.resultMeta}>
                      {record.kind === 'quantity' ? 'Holdings: ' : 'Location: '}
                      {record.holdingContext}
                    </p>
                    {(record.itemCode ||
                      record.assetTag ||
                      record.serialNumber ||
                      record.manufacturer ||
                      record.model) && (
                      <p className={styles.resultMeta}>
                        {[
                          record.itemCode && `Item code: ${record.itemCode}`,
                          record.assetTag,
                          record.serialNumber,
                          record.manufacturer,
                          record.model,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {record.customPreview &&
                      record.customPreview.answers.length > 0 && (
                        <div className={styles.resultMeta}>
                          <dl>
                            {record.customPreview.answers.map(
                              (answer, index) => (
                                <div key={index}>
                                  <dt className="inline font-medium">
                                    {answer.label}:{' '}
                                  </dt>
                                  <dd className="inline">
                                    {answer.displayValue}
                                    {answer.truncated ? '…' : ''}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                          <Link
                            href={
                              record.kind === 'quantity'
                                ? '/inventory/quantity/' + record.key
                                : '/inventory/assets/' + record.key
                            }
                            className={styles.resultLink}
                          >
                            {record.customPreview.truncated
                              ? 'View all details'
                              : 'Full details'}
                          </Link>
                        </div>
                      )}
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      entries.some(
                        (entry) =>
                          queueIdentity(entry) === queueIdentity(record),
                      )
                    }
                    onClick={() =>
                      void add({ kind: record.kind, key: record.key })
                    }
                    className={styles.secondaryButton}
                  >
                    {entries.some(
                      (entry) => queueIdentity(entry) === queueIdentity(record),
                    )
                      ? 'In queue'
                      : 'Add to queue'}
                  </button>
                  {entries.some(
                    (entry) => queueIdentity(entry) === queueIdentity(record),
                  ) && (
                    <a
                      href="#label-queue"
                      className={styles.resultLink}
                      aria-label={`Review queue for ${record.name}`}
                    >
                      {countLabel(entries.length, 'record')} /{' '}
                      {countLabel(totalCopies(entries), 'label')}
                    </a>
                  )}
                </div>
              ))}
              {search && search.total === 0 && (
                <p className={styles.empty}>No records match these filters.</p>
              )}
            </div>
            {search && search.total > 0 && (
              <div className={styles.pagination}>
                <span>
                  {countLabel(search.total, 'record')} · page {search.page} of{' '}
                  {Math.max(1, Math.ceil(search.total / search.pageSize))}
                </span>
                <button
                  disabled={filters.page <= 1}
                  onClick={() => (
                    setSearch(null),
                    setFilters({ ...filters, page: filters.page - 1 })
                  )}
                  className={styles.textButton}
                >
                  Previous
                </button>
                <button
                  disabled={filters.page * search.pageSize >= search.total}
                  onClick={() => (
                    setSearch(null),
                    setFilters({ ...filters, page: filters.page + 1 })
                  )}
                  className={styles.textButton}
                >
                  Next
                </button>
              </div>
            )}
          </section>
        </div>
        <div className={styles.queueColumn}>
          <section className={styles.surface}>
            <p className={styles.eyebrow}>02 / Physical locations</p>
            <h2 className={styles.title}>Add a location or group</h2>
            <LocationPicker
              locations={locations}
              mode="browse"
              label="Location"
              value={locationCode}
              onValueChange={setLocationCode}
            />
            <button
              type="button"
              disabled={!locationCode || busy}
              onClick={() => void add({ kind: 'location', key: locationCode })}
              className={styles.secondaryButton}
            >
              Add location label
            </button>
          </section>
          <section
            className={`${styles.surface} ${styles.surfaceAccent}`}
            aria-label="Label queue"
            id="label-queue"
          >
            <p className={styles.eyebrow}>03 / Selected labels</p>
            <div className={styles.queueHeader}>
              <h2 className={styles.title}>Label queue</h2>
              <p className={styles.count}>
                {countLabel(entries.length, 'distinct record')} ·{' '}
                {countLabel(totalCopies(entries), 'label')}
              </p>
              <button
                type="button"
                className={styles.textButton}
                disabled={
                  !hydrated || busy || (!entries.length && !intentOutstanding)
                }
                onClick={() =>
                  removeEntries(new Set(entries.map(queueIdentity)), true)
                }
              >
                Clear queue
              </button>
            </div>
            {unavailable.length > 0 && (
              <div role="alert" className={styles.error}>
                <p>
                  Some queued records are unavailable to this account. Remove
                  them or retry label refresh before printing.
                </p>
                {entries
                  .filter((entry) => unavailable.includes(queueIdentity(entry)))
                  .map((entry) => (
                    <div
                      key={queueIdentity(entry)}
                      className={styles.queueActions}
                    >
                      <span>
                        Unavailable {recordKind(entry.kind).toLowerCase()}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        className={styles.secondaryButton}
                        onClick={() =>
                          removeEntries(new Set([queueIdentity(entry)]))
                        }
                      >
                        Remove unavailable item from queue
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {pendingChanges.length > 0 && (
              <section
                role="alert"
                aria-label="Label item decisions"
                className={styles.warning}
              >
                <h3 className={styles.title}>Review changed label items</h3>
                {pendingChanges
                  .filter((row) =>
                    entries.some(
                      (entry) => queueIdentity(entry) === queueIdentity(row),
                    ),
                  )
                  .map((row) => {
                    const id = queueIdentity(row);
                    const entry = entries.find(
                      (item) => queueIdentity(item) === id,
                    )!;
                    const decision = reviewed[id];
                    const currentReview =
                      decision?.snapshot === reviewSnapshot(row);
                    const stateChanged = entry.baselineState !== row.state;
                    const tagChanged = entry.baselineTag !== row.tag;
                    return (
                      <div key={id} className={styles.queueEntry}>
                        <h4 className={styles.queueName}>
                          {row.name} · {recordKind(row.kind)}
                        </h4>
                        <p className={styles.subtle}>
                          {stateChanged
                            ? `Lifecycle changed from ${entry.baselineState} to ${row.state}.`
                            : `Current state: ${row.state}.`}
                          {tagChanged ? ' Identifier changed.' : ''}
                        </p>
                        <div className={styles.queueActions}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={busy || refreshPending || refreshFailed}
                            aria-expanded={currentReview}
                            aria-controls={`label-review-${row.kind}-${row.key}`}
                            onClick={() =>
                              setReviewed((current) =>
                                currentReview
                                  ? Object.fromEntries(
                                      Object.entries(current).filter(
                                        ([identity]) => identity !== id,
                                      ),
                                    )
                                  : {
                                      ...current,
                                      [id]: {
                                        snapshot: reviewSnapshot(row),
                                        generation: queueEpoch.current,
                                        historical: false,
                                      },
                                    },
                              )
                            }
                          >
                            Review item
                          </button>
                          <button
                            type="button"
                            className={styles.textButton}
                            disabled={busy}
                            onClick={() => removeEntries(new Set([id]))}
                          >
                            Remove from queue
                          </button>
                        </div>
                        {currentReview && (
                          <div
                            id={`label-review-${row.kind}-${row.key}`}
                            role="region"
                            aria-label={`Review ${row.name}`}
                          >
                            <p className={styles.subtle}>
                              Current authorized snapshot: {row.state}
                              {row.tag
                                ? ` · Tag ${row.tag}`
                                : row.kind === 'asset'
                                  ? ' · No asset tag'
                                  : ''}
                              . {row.holdingContext}
                            </p>
                            <Link href={row.path} className={styles.resultLink}>
                              View item details
                            </Link>
                            {row.state !== 'active' && (
                              <label className={styles.settingLabel}>
                                <input
                                  type="checkbox"
                                  checked={decision.historical}
                                  disabled={busy || refreshPending}
                                  onChange={(event) =>
                                    setReviewed((current) => ({
                                      ...current,
                                      [id]: {
                                        ...decision,
                                        historical: event.target.checked,
                                      },
                                    }))
                                  }
                                />
                                I understand this is a historical record and
                                want to print its identification label.
                              </label>
                            )}
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              disabled={
                                busy ||
                                refreshPending ||
                                refreshFailed ||
                                (row.state !== 'active' && !decision.historical)
                              }
                              onClick={() => void acknowledge(row)}
                            >
                              Acknowledge reviewed item
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </section>
            )}
            {pendingIntentKeys.length > 0 && (
              <div
                role="region"
                aria-label="Pending linked additions"
                className={styles.queueList}
              >
                <p className={styles.subtle}>
                  Pending additions are not included in the label count or print
                  sheet.
                </p>
                {pendingIntentKeys.map((key, index) => {
                  const id = queueIdentity(key);
                  const ordinal =
                    addIntent.findIndex(
                      (intent) => queueIdentity(intent) === id,
                    ) + 1 || index + 1;
                  const pendingName = `${recordKind(key.kind).toLowerCase()} ${ordinal}`;
                  return (
                    <div key={id} className={styles.queueEntry}>
                      <span className={styles.queueName}>
                        Pending {pendingName}
                      </span>
                      <button
                        type="button"
                        disabled={busy || !hydrated}
                        aria-label={'Remove pending ' + pendingName}
                        onClick={() => removeEntries(new Set([id]))}
                        className={styles.textButton}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {entries.length === 0 && (
              <p className={styles.empty}>Add a record or location to begin.</p>
            )}
            <div className={styles.queueList}>
              {entries.map((entry) => {
                const id = queueIdentity(entry),
                  record = byId.get(id);
                return (
                  <div key={id} className={styles.queueEntry}>
                    <span className={styles.queueName}>
                      {record
                        ? `${record.name} · ${record.kind === 'location' ? 'Location' : (record.categoryName ?? 'Uncategorized')} · ${record.holdingContext} · ${record.state}`
                        : `${id} · unavailable`}
                    </span>
                    <div className={styles.queueActions}>
                      <label className={styles.copies}>
                        Copies{' '}
                        <input
                          type="number"
                          min={1}
                          max={MAX_COPIES}
                          disabled={busy}
                          value={entry.copies}
                          onChange={(event) =>
                            setCopies(id, Number(event.target.value))
                          }
                          className={styles.copiesInput}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || !hydrated}
                        onClick={() => removeEntries(new Set([id]))}
                        className={styles.textButton}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      <section className={styles.sheetWorkspace}>
        <div className={styles.sheetHeading}>
          <div className={styles.sheetHeadingText}>
            <p className={styles.eyebrow}>04 / Prepare & print</p>
            <h2 className={styles.title}>Print preview</h2>
            <p className={styles.subtle}>
              Label size, paper size and barcode type update this sheet
              automatically. Record details refresh before printing.
            </p>
          </div>
        </div>
        <div className={styles.settings}>
          <label className={styles.settingLabel}>
            {labelSettingText.size}{' '}
            <select
              value={job.size}
              disabled={busy}
              onChange={(event) => {
                setJob({
                  ...job,
                  size: event.target.value as JobSettings['size'],
                });
                clearPrintAuthorization.current?.();
              }}
              className={styles.settingSelect}
            >
              {labelSizeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.settingLabel}>
            {labelSettingText.page}{' '}
            <select
              value={job.page}
              disabled={busy}
              onChange={(event) => {
                setJob({
                  ...job,
                  page: event.target.value as JobSettings['page'],
                });
                clearPrintAuthorization.current?.();
              }}
              className={styles.settingSelect}
            >
              {paperSizeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.settingLabel}>
            {labelSettingText.format}{' '}
            <select
              aria-describedby="job-barcode-help"
              value={job.format}
              disabled={busy}
              onChange={(event) => {
                setJob({
                  ...job,
                  format: event.target.value as JobSettings['format'],
                });
                clearPrintAuthorization.current?.();
                setFormatAcknowledged(false);
                setFallbackPending(false);
              }}
              className={styles.settingSelect}
            >
              {barcodeTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p id="job-barcode-help" className={styles.subtle}>
          {barcodeTypeHelp}
        </p>
        <p className={styles.subtle}>
          New jobs start with the shared choices in Settings. Print at actual
          size / 100%. Code 128 asset tags require reprinting if the tag
          changes.
        </p>
        {job.format === 'code128' && (fallbackCount > 0 || fallbackPending) && (
          <div
            role={fallbackPending ? 'alert' : undefined}
            className={styles.warning}
          >
            <p>
              {fallbackCount > 0
                ? `${fallbackCount} queued record(s) will use stable QR links because quantity items have no Code 128 identity or an asset tag is absent/incompatible. `
                : 'Some labels will use stable QR links because Code 128 is unavailable. '}
              Long barcodes that do not fit at a readable size also use QR.
            </p>
            {fallbackPending && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFormatAcknowledged(true);
                  setFallbackPending(false);
                  setMessage(
                    'QR fallback acknowledged. Print again to run the final inventory check.',
                  );
                }}
                className={styles.secondaryButton}
              >
                Acknowledge QR fallback
              </button>
            )}
          </div>
        )}
        {message && (
          <p role="status" className={styles.notice}>
            {message}
          </p>
        )}
        {intentPending && (
          <p role="status" className={styles.notice}>
            Adding linked records after restoring this queue…
          </p>
        )}
        {intentError && (
          <div role="alert" className={styles.error}>
            <p>{intentError}</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setIntentRetry((n) => n + 1)}
            >
              Retry linked additions
            </button>
          </div>
        )}
        {refreshPending && (
          <p role="status" className={styles.notice}>
            Refreshing labels; previous sheet shown until current records are
            ready.
          </p>
        )}
        <div className={styles.printActions}>
          {refreshFailed && (
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className={styles.secondaryButton}
            >
              Retry label refresh
            </button>
          )}
          <button
            type="button"
            disabled={
              intentPending ||
              !prepared ||
              busy ||
              refreshPending ||
              refreshFailed ||
              validatedKey !== selectionKey ||
              readySheetKey !== sheetKey ||
              unavailable.length > 0 ||
              pendingChanges.length > 0 ||
              (job.format === 'code128' &&
                fallbackPending &&
                !formatAcknowledged)
            }
            onClick={() => void print()}
            className={styles.primaryButton}
          >
            Print selected labels / Save as PDF
          </button>
        </div>
        {entries.length > 0 &&
          pendingChanges.length === 0 &&
          unavailable.length === 0 && (
            <div className={styles.statusLine} role="status">
              <span
                className={styles.statusDot}
                data-ready={
                  !!prepared &&
                  !busy &&
                  !refreshPending &&
                  !refreshFailed &&
                  validatedKey === selectionKey &&
                  readySheetKey === sheetKey &&
                  unavailable.length === 0 &&
                  pendingChanges.length === 0 &&
                  !(
                    job.format === 'code128' &&
                    fallbackPending &&
                    !formatAcknowledged
                  )
                }
              />
              <span className={styles.statusText}>
                {refreshFailed
                  ? 'Refresh failed — retry before printing'
                  : refreshPending
                    ? 'Checking current records — printing paused'
                    : pendingChanges.length ||
                        unavailable.length ||
                        fallbackPending
                      ? 'Review required before printing'
                      : readySheetKey === sheetKey &&
                          validatedKey === selectionKey
                        ? 'Sheet ready for final print check'
                        : 'Preparing codes and layout — printing paused'}
              </span>
            </div>
          )}
        {displayRows && (
          <div className={styles.sheetFrame}>
            <LabelSheet
              records={displayRows}
              origin={origin}
              preview={preview}
              size={job.size}
              page={job.page}
              format={job.format}
              generation={sheetKey}
            />
          </div>
        )}
      </section>
    </div>
  );
}

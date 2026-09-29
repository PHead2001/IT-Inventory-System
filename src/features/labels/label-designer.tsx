'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { flushSync } from 'react-dom';
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

function entryFor(record: LiveLabel): QueueEntry {
  return {
    kind: record.kind,
    key: record.key,
    copies: 1,
    baselineTag: record.tag,
    baselineState: record.state,
    lifecycleAcknowledged: record.state === 'active',
  };
}
function signature(
  record: LabelRecord & { tag?: string | null; categoryName?: string | null },
): string {
  return JSON.stringify([
    record.kind,
    record.key,
    record.name,
    record.context,
    record.state,
    record.tag,
    record.humanId,
    record.categoryName,
  ]);
}
function expandLabels(entries: QueueEntry[], rows: LiveLabel[]): LabelRecord[] {
  const byId = new Map(rows.map((record) => [queueIdentity(record), record]));
  return entries.flatMap((entry) =>
    Array.from({ length: entry.copies }, () => byId.get(queueIdentity(entry))!),
  );
}
const emptyInitial: LiveLabel[] = [];

export function LabelDesigner({
  locations,
  categories,
  origin,
  memberId,
  preview,
  initial = emptyInitial,
  defaults = defaultJob,
}: {
  locations: LocationRef[];
  categories: CategoryRef[];
  origin: string;
  memberId: string;
  preview: boolean;
  initial?: LiveLabel[];
  defaults?: JobSettings;
}) {
  const storageKey = queueStorageKey(origin, memberId);
  const [entries, setEntries] = useState<QueueEntry[]>(initial.map(entryFor));
  const [live, setLive] = useState<LiveLabel[]>(initial);
  const [filters, setFilters] = useState<LabelSearchFilters>(defaultFilters);
  const [draft, setDraft] = useState<LabelSearchFilters>(defaultFilters);
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
  const [fallbackPending, setFallbackPending] = useState(false);
  const [formatAcknowledged, setFormatAcknowledged] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const queueEpoch = useRef(0);
  const selectionKey = entries.map(queueIdentity).join('|');
  const clearPrintAuthorization = useRef<(() => void) | null>(null);
  const byId = useMemo(
    () => new Map(live.map((record) => [queueIdentity(record), record])),
    [live],
  );

  useEffect(
    () => () => {
      queueEpoch.current++;
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
      const stored = parseStoredQueue(
        sessionStorage.getItem(storageKey),
        defaults,
      );
      if (stored) {
        const merged = [...stored.entries];
        for (const record of initial) {
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
        setDraft(stored.filters);
        setJob(stored.job);
      }
      setHydrated(true);
    });
    return () => {
      current = false;
    };
  }, [storageKey, initial, defaults]);
  useEffect(() => {
    if (hydrated)
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ entries, filters, job }),
      );
  }, [storageKey, hydrated, entries, filters, job]);
  useEffect(() => {
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
  }, [filters]);

  const invalidate = () => {
    queueEpoch.current++;
    clearPrintAuthorization.current?.();
    setRefreshPending(true);
    setRefreshFailed(false);
    setFallbackPending(false);
    setFormatAcknowledged(false);
  };
  const add = async (key: QueueKey) => {
    if (entries.some((entry) => queueIdentity(entry) === queueIdentity(key))) {
      setMessage('Already in the queue. Adjust its copy count below.');
      return;
    }
    const epoch = ++queueEpoch.current;
    setBusy(true);
    try {
      const rows = await getQueueRecords([key]);
      if (epoch !== queueEpoch.current) return;
      if (rows.length !== 1 || queueIdentity(rows[0]) !== queueIdentity(key)) {
        setMessage('That record is unavailable to this account.');
        return;
      }
      const next = addEntry(entries, entryFor(rows[0]));
      if (!next) {
        setMessage(
          `Queue limit: ${MAX_DISTINCT} distinct records, ${MAX_COPIES} copies each, ${MAX_LABELS} labels total.`,
        );
        return;
      }
      setEntries(next);
      setLive((current) => [
        ...current.filter(
          (row) => queueIdentity(row) !== queueIdentity(rows[0]),
        ),
        rows[0],
      ]);
      invalidate();
      setMessage(
        `${rows[0].name} added. Names and context refresh before printing.`,
      );
    } catch {
      setMessage('Record could not be added. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const prepareFrom = (rows: LiveLabel[], generationKey: string) => {
    const rowMap = new Map(rows.map((row) => [queueIdentity(row), row]));
    const missing = entries
      .filter((entry) => !rowMap.has(queueIdentity(entry)))
      .map(queueIdentity);
    setUnavailable(missing);
    if (missing.length) {
      setPendingChanges([]);
      setRefreshPending(false);
      setValidatedKey('');
      setMessage(
        'Some queued records are unavailable. Remove them before printing.',
      );
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
    const changed = entries.flatMap((entry) => {
      const row = rowMap.get(queueIdentity(entry))!;
      return entry.baselineTag !== row.tag ||
        entry.baselineState !== row.state ||
        (row.state !== 'active' && !entry.lifecycleAcknowledged)
        ? [row]
        : [];
    });
    if (changed.length) {
      setPendingChanges(changed);
      setRefreshPending(false);
      setValidatedKey('');
      setMessage(
        'A tag or lifecycle state needs review. Acknowledge before printing.',
      );
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
          setValidatedKey('');
          setMessage('Label refresh failed. Printing is blocked; retry.');
        });
    }, 150);
    return () => window.clearTimeout(timer);
    // Copies and sheet settings only change the local layout, not the validated selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, hydrated, retry]);
  const acknowledge = () => {
    invalidate();
    const current = new Map(
      pendingChanges.map((row) => [queueIdentity(row), row]),
    );
    setEntries((list) =>
      list.map((entry) => {
        const row = current.get(queueIdentity(entry));
        return row
          ? {
              ...entry,
              baselineTag: row.tag,
              baselineState: row.state,
              lifecycleAcknowledged: true,
            }
          : entry;
      }),
    );
    setPendingChanges([]);
    setRetry((value) => value + 1);
    setMessage('Changes acknowledged. Refreshing print preview.');
  };
  const print = async () => {
    if (
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
    setBusy(true);
    try {
      const fresh = await getQueueRecords(
        entries.map(({ kind, key }) => ({ kind, key })),
      );
      if (epoch !== queueEpoch.current) return;
      const rowMap = new Map(fresh.map((row) => [queueIdentity(row), row]));
      const meaningfulChange = entries.some((entry) => {
        const row = rowMap.get(queueIdentity(entry));
        return (
          row &&
          (entry.baselineTag !== row.tag ||
            entry.baselineState !== row.state ||
            (row.state !== 'active' && !entry.lifecycleAcknowledged))
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
      if (descriptiveChange) {
        // Browser print captures the current DOM immediately. Commit the refreshed
        // descriptive text before checking codes or opening the print dialog.
        flushSync(() => {
          setLive(fresh);
          setPrepared(fresh);
          setPrintRows(expandLabels(entries, fresh));
          setMessage('Label information refreshed from current inventory.');
        });
      }
      await document.fonts?.ready;
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          '.label-print-root .label-card img',
        ),
      );
      await Promise.all(images.map((image) => image.decode?.()));
      if (epoch !== queueEpoch.current) return;
      if (
        job.format === 'code128' &&
        !formatAcknowledged &&
        document.querySelector(
          '.label-print-root .label-card[data-code-fallback="true"]',
        )
      ) {
        setFallbackPending(true);
        setMessage(
          'Some Code 128 labels use QR. Acknowledge the format change before printing.',
        );
        return;
      }
      const ready = document.querySelectorAll(
        '.label-print-root .label-card[data-code-ready="true"]',
      ).length;
      if (ready !== totalCopies(entries)) {
        setMessage(
          'Wait for every code and label text to fit, or choose a larger label.',
        );
        return;
      }
      const sheet = document.querySelector<HTMLElement>('.label-print-root');
      if (!sheet) {
        setMessage('Print preview is unavailable. Prepare it again.');
        return;
      }
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
      setMessage('Final label check failed. Printing is blocked; retry.');
    } finally {
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
    clearPrintAuthorization.current?.();
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
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
        cards.length === displayRows.length &&
        cards.every((card) => card.dataset.codeReady === 'true');
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
    };
    const observer = new MutationObserver(check);
    observer.observe(sheet, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-code-ready', 'data-code-fallback'],
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
        and {MAX_LABELS} labels total. Quantity results appear once per
        definition, even with several holdings.
      </p>
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
                Find exact assets or quantity definitions for the sheet.
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
                  <option value="quantity">Quantity</option>
                  <option value="asset">Asset</option>
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
                ? `${search.total} matching records. Scroll this list to browse the current page.`
                : 'Loading matching records…'}
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
                      {record.kind} · {record.categoryName} · {record.status}
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
                    <p className={styles.resultId}>ID {record.key}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void add({ kind: record.kind, key: record.key })
                    }
                    className={styles.secondaryButton}
                  >
                    Add to queue
                  </button>
                </div>
              ))}
              {search && search.total === 0 && (
                <p className={styles.empty}>No records match these filters.</p>
              )}
            </div>
            {search && (
              <div className={styles.pagination}>
                <span>
                  {search.total} records · page {search.page} of{' '}
                  {Math.max(1, Math.ceil(search.total / search.pageSize))}
                </span>
                <button
                  disabled={filters.page <= 1}
                  onClick={() =>
                    setFilters({ ...filters, page: filters.page - 1 })
                  }
                  className={styles.textButton}
                >
                  Previous
                </button>
                <button
                  disabled={filters.page * search.pageSize >= search.total}
                  onClick={() =>
                    setFilters({ ...filters, page: filters.page + 1 })
                  }
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
          >
            <p className={styles.eyebrow}>03 / Selected labels</p>
            <div className={styles.queueHeader}>
              <h2 className={styles.title}>Label queue</h2>
              <p className={styles.count}>
                {entries.length} distinct records · {totalCopies(entries)}{' '}
                labels
              </p>
            </div>
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
                        ? `${record.name} · ${record.categoryName ?? record.context} · ${record.state}`
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
                        disabled={busy}
                        onClick={() => {
                          setEntries((list) =>
                            list.filter((item) => queueIdentity(item) !== id),
                          );
                          invalidate();
                        }}
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
              Paper and code choices update this sheet automatically. Record
              details refresh before printing.
            </p>
          </div>
        </div>
        <div className={styles.settings}>
          <label className={styles.settingLabel}>
            Label size{' '}
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
              <option value="90x50">90 × 50 mm</option>
              <option value="70x35">70 × 35 mm</option>
            </select>
          </label>
          <label className={styles.settingLabel}>
            Page{' '}
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
              <option value="letter">US Letter</option>
              <option value="A4">A4</option>
            </select>
          </label>
          <label className={styles.settingLabel}>
            Code{' '}
            <select
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
              <option value="qr">QR URL</option>
              <option value="code128">Code 128 when suitable</option>
            </select>
          </label>
        </div>
        <p className={styles.subtle}>
          New jobs start with the shared choices in Settings. Print at actual
          size / 100%. Code 128 asset tags require reprinting if the tag
          changes.
        </p>
        {job.format === 'code128' && fallbackCount > 0 && (
          <p className={styles.warning}>
            {fallbackCount} queued record(s) will use stable QR links because
            quantity items have no Code 128 identity or an asset tag is
            absent/incompatible. Long barcodes that do not fit also use QR.
          </p>
        )}
        {unavailable.length > 0 && (
          <p role="alert" className={styles.error}>
            Unavailable: {unavailable.join(', ')}. Remove these records before
            printing.
          </p>
        )}
        {pendingChanges.length > 0 && (
          <div role="alert" className={styles.warning}>
            <p>
              Tag or lifecycle state changed for:{' '}
              {pendingChanges
                .map(
                  (row) =>
                    `${row.name} (${row.key}, ${row.state}${row.tag ? ', tag ' + row.tag : ''})`,
                )
                .join('; ')}
              .
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={acknowledge}
              className={styles.secondaryButton}
            >
              Acknowledge changes
            </button>
          </div>
        )}
        {fallbackPending && (
          <div role="alert" className={styles.warning}>
            <p>
              Some labels will use QR because Code 128 is unavailable or will
              not fit at readable size.
            </p>
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
          </div>
        )}
        {message && (
          <p role="status" className={styles.notice}>
            {message}
          </p>
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
        {entries.length > 0 && (
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
            />
          </div>
        )}
      </section>
    </div>
  );
}

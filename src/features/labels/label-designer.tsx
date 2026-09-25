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
function signature(record: LiveLabel): string {
  return JSON.stringify([
    record.kind,
    record.key,
    record.name,
    record.context,
    record.state,
    record.tag,
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
  const [pendingChanges, setPendingChanges] = useState<LiveLabel[]>([]);
  const [fallbackPending, setFallbackPending] = useState(false);
  const [formatAcknowledged, setFormatAcknowledged] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const queueEpoch = useRef(0);
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
        if (merged.length) {
          const epoch = queueEpoch.current;
          void getQueueRecords(merged.map(({ kind, key }) => ({ kind, key })))
            .then((rows) => {
              if (!current || epoch !== queueEpoch.current) return;
              setLive(rows);
              setMessage('Queued labels refreshed from current inventory.');
            })
            .catch(() => {
              if (current && epoch === queueEpoch.current)
                setMessage(
                  'Queued labels could not be refreshed. Printing is unavailable until retry succeeds.',
                );
            });
        }
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
    setPrepared(null);
    setPrintRows(null);
    setPendingChanges([]);
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
      if (rows.length !== 1) {
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
  const prepareFrom = (rows: LiveLabel[]) => {
    const rowMap = new Map(rows.map((row) => [queueIdentity(row), row]));
    setLive(rows);
    const missing = entries
      .filter((entry) => !rowMap.has(queueIdentity(entry)))
      .map(queueIdentity);
    setUnavailable(missing);
    if (missing.length) {
      invalidate();
      setMessage(
        'Some queued records are unavailable. Remove them before printing.',
      );
      return;
    }
    const changed = entries.flatMap((entry) => {
      const row = rowMap.get(queueIdentity(entry))!;
      return entry.baselineTag !== row.tag ||
        entry.baselineState !== row.state ||
        (row.state !== 'active' && !entry.lifecycleAcknowledged)
        ? [row]
        : [];
    });
    if (changed.length) {
      invalidate();
      setPendingChanges(changed);
      setMessage(
        'A tag or lifecycle state needs review. Acknowledge before printing.',
      );
      return;
    }
    setPendingChanges([]);
    setPrepared(rows);
    setPrintRows(expandLabels(entries, rows));
    setFallbackPending(false);
    setMessage(
      'Full print preview refreshed from current inventory. Review every page before printing.',
    );
  };
  const prepare = async () => {
    if (!entries.length) return;
    const epoch = ++queueEpoch.current;
    setBusy(true);
    try {
      const rows = await getQueueRecords(
        entries.map(({ kind, key }) => ({ kind, key })),
      );
      if (epoch !== queueEpoch.current) return;
      prepareFrom(rows);
    } catch {
      if (epoch !== queueEpoch.current) return;
      invalidate();
      setMessage('Label refresh failed. Printing is blocked; retry.');
    } finally {
      setBusy(false);
    }
  };
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
    setMessage('Changes acknowledged. Prepare a fresh print preview.');
  };
  const print = async () => {
    if (!prepared || !printRows) return;
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
      if (fresh.length !== entries.length || meaningfulChange) {
        prepareFrom(fresh);
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
      if (ready !== printRows.length) {
        setMessage(
          'Wait for every code to appear, or choose a larger label for an oversized identifier.',
        );
        return;
      }
      const sheet = document.querySelector<HTMLElement>('.label-print-root');
      if (!sheet) {
        setMessage('Print preview is unavailable. Prepare it again.');
        return;
      }
      // Ctrl/Cmd+P skips the final inventory check. Some browsers return from
      // print() before capture; keep the sheet available until afterprint,
      // with a bounded fallback for browsers that never dispatch it.
      clearPrintAuthorization.current?.();
      const clear = () => {
        window.removeEventListener('afterprint', clear);
        window.clearTimeout(timeout);
        delete sheet.dataset.printAuthorized;
        if (clearPrintAuthorization.current === clear)
          clearPrintAuthorization.current = null;
      };
      clearPrintAuthorization.current = clear;
      window.addEventListener('afterprint', clear, { once: true });
      const timeout = window.setTimeout(clear, 30_000);
      sheet.dataset.printAuthorized = 'true';
      try {
        window.print();
      } catch (error) {
        clear();
        throw error;
      }
    } catch {
      if (epoch !== queueEpoch.current) return;
      invalidate();
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
    invalidate();
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

  return (
    <>
      {preview && (
        <p className="mb-5 rounded border border-amber-600 p-3 font-semibold text-amber-200">
          Preview labels for {origin}. These are for this isolated environment
          only.
        </p>
      )}
      <p className="mb-5 text-sm text-slate-400">
        Queue up to {MAX_DISTINCT} distinct records, {MAX_COPIES} copies each,
        and {MAX_LABELS} labels total. Quantity results appear once per
        definition, even with several holdings.
      </p>
      <form
        onSubmit={submitSearch}
        aria-label="Search label records"
        className="space-y-3 rounded-xl border border-slate-700 p-4"
      >
        <label className="block">
          Search name, serial, tag, category, manufacturer, model, or UUID
          <input
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            maxLength={200}
            className="mt-1 w-full rounded border border-slate-500 bg-slate-950 p-2"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 max-w-full">
            Type{' '}
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  type: event.target.value as LabelSearchFilters['type'],
                })
              }
              className="max-w-full rounded bg-slate-800 p-2"
            >
              <option value="all">All</option>
              <option value="quantity">Quantity</option>
              <option value="asset">Asset</option>
            </select>
          </label>
          <label className="min-w-0 max-w-full">
            Status{' '}
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as LabelSearchFilters['status'],
                })
              }
              className="max-w-full rounded bg-slate-800 p-2"
            >
              <option value="active">Active</option>
              <option value="historical">Archived / retired</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="w-full min-w-0">
            Category{' '}
            <select
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value })
              }
              className="mt-1 block w-full min-w-0 rounded bg-slate-800 p-2"
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
        <button className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950">
          Search
        </button>
      </form>
      <section className="mt-5 space-y-3" aria-label="Label search results">
        <h2 className="text-xl font-semibold">Records</h2>
        {search?.rows.map((record) => (
          <div
            key={record.kind + record.key}
            className="flex max-w-full min-w-0 flex-wrap items-center justify-between gap-3 rounded border border-slate-700 p-3"
          >
            <div className="min-w-0 flex-1 basis-56 [overflow-wrap:anywhere]">
              <Link
                href={
                  record.kind === 'quantity'
                    ? '/inventory/quantity/' + record.key
                    : '/inventory/assets/' + record.key
                }
                className="text-cyan-300 underline [overflow-wrap:anywhere]"
              >
                {record.name}
              </Link>
              <p className="text-sm text-slate-400 [overflow-wrap:anywhere]">
                {record.kind} · {record.categoryName} · {record.status} ·{' '}
                {record.key}
              </p>
              <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">
                {record.kind === 'quantity' ? 'Holdings: ' : 'Location: '}
                {record.holdingContext}
              </p>
              {(record.assetTag ||
                record.serialNumber ||
                record.manufacturer ||
                record.model) && (
                <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">
                  {[
                    record.assetTag,
                    record.serialNumber,
                    record.manufacturer,
                    record.model,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void add({ kind: record.kind, key: record.key })}
              className="rounded border border-cyan-500 px-3 py-2 text-cyan-200"
            >
              Add to queue
            </button>
          </div>
        ))}
        {search && search.total === 0 && <p>No records match these filters.</p>}
        {search && (
          <div className="flex items-center gap-4">
            <span>
              {search.total} records · page {search.page} of{' '}
              {Math.max(1, Math.ceil(search.total / search.pageSize))}
            </span>
            <button
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              className="text-cyan-300 underline"
            >
              Previous
            </button>
            <button
              disabled={filters.page * search.pageSize >= search.total}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              className="text-cyan-300 underline"
            >
              Next
            </button>
          </div>
        )}
      </section>
      <section className="mt-6 space-y-3 rounded-xl border border-slate-700 p-4">
        <h2 className="text-xl font-semibold">Add a location or group</h2>
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
          className="rounded border border-cyan-500 px-3 py-2 text-cyan-200"
        >
          Add location label
        </button>
      </section>
      <section className="mt-6 space-y-3" aria-label="Label queue">
        <h2 className="text-xl font-semibold">Label queue</h2>
        <p>
          {entries.length} distinct records · {totalCopies(entries)} labels
        </p>
        {entries.length === 0 && <p>Add a record or location to begin.</p>}
        {entries.map((entry) => {
          const id = queueIdentity(entry),
            record = byId.get(id);
          return (
            <div
              key={id}
              className="flex flex-wrap items-center gap-3 rounded border border-slate-700 p-3"
            >
              <span className="min-w-0 flex-1 break-words">
                {record
                  ? `${record.name} · ${record.categoryName ?? record.context} · ${record.state}`
                  : `${id} · unavailable`}
              </span>
              <label>
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
                  className="ml-2 w-20 rounded border border-slate-500 bg-slate-950 p-2"
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
                className="text-cyan-300 underline"
              >
                Remove
              </button>
            </div>
          );
        })}
      </section>
      <section className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Print preview</h2>
        <div className="flex flex-wrap gap-4 rounded-xl border border-slate-700 p-4">
          <label>
            Label size{' '}
            <select
              value={job.size}
              disabled={busy}
              onChange={(event) => {
                setJob({
                  ...job,
                  size: event.target.value as JobSettings['size'],
                });
                invalidate();
              }}
              className="ml-2 rounded bg-slate-800 p-2"
            >
              <option value="90x50">90 × 50 mm</option>
              <option value="70x35">70 × 35 mm</option>
            </select>
          </label>
          <label>
            Page{' '}
            <select
              value={job.page}
              disabled={busy}
              onChange={(event) => {
                setJob({
                  ...job,
                  page: event.target.value as JobSettings['page'],
                });
                invalidate();
              }}
              className="ml-2 rounded bg-slate-800 p-2"
            >
              <option value="letter">US Letter</option>
              <option value="A4">A4</option>
            </select>
          </label>
          <label>
            Code{' '}
            <select
              value={job.format}
              disabled={busy}
              onChange={(event) => {
                setJob({
                  ...job,
                  format: event.target.value as JobSettings['format'],
                });
                invalidate();
              }}
              className="ml-2 rounded bg-slate-800 p-2"
            >
              <option value="qr">QR URL</option>
              <option value="code128">Code 128 when suitable</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-400">
          New jobs start with the shared choices in Settings. Print at actual
          size / 100%. Code 128 asset tags require reprinting if the tag
          changes.
        </p>
        {job.format === 'code128' && fallbackCount > 0 && (
          <p className="rounded border border-amber-700 p-3 text-amber-200">
            {fallbackCount} queued record(s) will use stable QR links because
            quantity items have no Code 128 identity or an asset tag is
            absent/incompatible. Long barcodes that do not fit also use QR.
          </p>
        )}
        {unavailable.length > 0 && (
          <p role="alert" className="rounded border border-red-700 p-3">
            Unavailable: {unavailable.join(', ')}. Remove these records before
            printing.
          </p>
        )}
        {pendingChanges.length > 0 && (
          <div role="alert" className="rounded border border-amber-700 p-3">
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
              className="mt-2 rounded bg-amber-400 px-3 py-2 font-semibold text-slate-950"
            >
              Acknowledge changes
            </button>
          </div>
        )}
        {fallbackPending && (
          <div role="alert" className="rounded border border-amber-700 p-3">
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
              className="mt-2 rounded bg-amber-400 px-3 py-2 font-semibold text-slate-950"
            >
              Acknowledge QR fallback
            </button>
          </div>
        )}
        {message && (
          <p role="status" className="text-cyan-200">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!entries.length || busy}
            onClick={() => void prepare()}
            className="rounded border border-cyan-500 px-4 py-2 text-cyan-200"
          >
            Prepare full print preview
          </button>
          <button
            type="button"
            disabled={
              !prepared ||
              busy ||
              unavailable.length > 0 ||
              pendingChanges.length > 0
            }
            onClick={() => void print()}
            className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
          >
            Print selected labels / Save as PDF
          </button>
        </div>
        {printRows && (
          <LabelSheet
            records={printRows}
            origin={origin}
            preview={preview}
            size={job.size}
            page={job.page}
            format={job.format}
          />
        )}
      </section>
    </>
  );
}

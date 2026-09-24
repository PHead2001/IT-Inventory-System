import { ASSET_UUID, LOCATION_CODE } from '@/features/scan/targets';
export type LabelKind = 'location' | 'asset' | 'quantity';
export type QueueKey = { kind: LabelKind; key: string };
export type QueueEntry = QueueKey & {
  copies: number;
  baselineTag: string | null;
  baselineState: string;
  lifecycleAcknowledged: boolean;
};
export type LabelSearchFilters = {
  q: string;
  type: 'all' | 'quantity' | 'asset';
  status: 'active' | 'historical' | 'all';
  category: string;
  location: string;
  page: number;
};
export type JobSettings = {
  size: '90x50' | '70x35';
  page: 'letter' | 'A4';
  format: 'qr' | 'code128';
};
export const defaultFilters: LabelSearchFilters = {
  q: '',
  type: 'all',
  status: 'active',
  category: '',
  location: '',
  page: 1,
};
export const defaultJob: JobSettings = {
  size: '90x50',
  page: 'letter',
  format: 'qr',
};
export const MAX_DISTINCT = 200;
export const MAX_LABELS = 500;
export const MAX_COPIES = 100;

export function queueIdentity(value: QueueKey): string {
  return value.kind + ':' + value.key;
}
export function validQueueKey(value: QueueKey): boolean {
  return value.kind === 'location'
    ? LOCATION_CODE.test(value.key) && value.key.length <= 256
    : (value.kind === 'asset' || value.kind === 'quantity') &&
        ASSET_UUID.test(value.key);
}
export function totalCopies(entries: QueueEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.copies, 0);
}
export function validQueue(entries: QueueEntry[]): boolean {
  return (
    entries.length <= MAX_DISTINCT &&
    totalCopies(entries) <= MAX_LABELS &&
    new Set(entries.map(queueIdentity)).size === entries.length &&
    entries.every(
      (entry) =>
        validQueueKey(entry) &&
        Number.isInteger(entry.copies) &&
        entry.copies >= 1 &&
        entry.copies <= MAX_COPIES,
    )
  );
}
export function addEntry(
  entries: QueueEntry[],
  entry: QueueEntry,
): QueueEntry[] | null {
  if (
    !validQueueKey(entry) ||
    entries.some((item) => queueIdentity(item) === queueIdentity(entry))
  )
    return null;
  const next = [...entries, entry];
  return validQueue(next) ? next : null;
}
export function updateCopies(
  entries: QueueEntry[],
  identity: string,
  copies: number,
): QueueEntry[] | null {
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES)
    return null;
  const next = entries.map((entry) =>
    queueIdentity(entry) === identity ? { ...entry, copies } : entry,
  );
  return validQueue(next) ? next : null;
}
export function queueStorageKey(origin: string, memberId: string): string {
  return `it-inventory-label-queue:v1:${encodeURIComponent(origin)}:${memberId}`;
}
export function clearLabelQueueSession(): void {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key?.startsWith('it-inventory-label-queue:v1:'))
      sessionStorage.removeItem(key);
  }
}

export function parseStoredQueue(raw: string | null, fallbackJob: JobSettings = defaultJob): {
  entries: QueueEntry[];
  filters: LabelSearchFilters;
  job: JobSettings;
} | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const stored = value as Record<string, unknown>;
    if (!Array.isArray(stored.entries)) return null;
    const entries = stored.entries.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      if (
        typeof row.kind !== 'string' ||
        typeof row.key !== 'string' ||
        typeof row.baselineState !== 'string' ||
        !(row.baselineTag === null || typeof row.baselineTag === 'string') ||
        typeof row.copies !== 'number'
      )
        return null;
      return {
        kind: row.kind,
        key: row.key,
        copies: row.copies,
        baselineTag: row.baselineTag,
        baselineState: row.baselineState,
        lifecycleAcknowledged:
          typeof row.lifecycleAcknowledged === 'boolean'
            ? row.lifecycleAcknowledged
            : row.baselineState === 'active',
      } as QueueEntry;
    });
    if (
      entries.some((entry) => entry === null) ||
      !validQueue(entries as QueueEntry[])
    )
      return null;
    const filters = stored.filters as LabelSearchFilters | undefined;
    const job = stored.job as JobSettings | undefined;
    return {
      entries: entries as QueueEntry[],
      filters:
        filters &&
        typeof filters.q === 'string' &&
        filters.q.length <= 200 &&
        ['all', 'quantity', 'asset'].includes(filters.type) &&
        ['active', 'historical', 'all'].includes(filters.status) &&
        typeof filters.category === 'string' &&
        typeof filters.location === 'string' &&
        Number.isInteger(filters.page) &&
        filters.page >= 1
          ? filters
          : defaultFilters,
      job:
        job &&
        ['90x50', '70x35'].includes(job.size) &&
        ['letter', 'A4'].includes(job.page) &&
        ['qr', 'code128'].includes(job.format)
          ? job
          : fallbackJob,
    };
  } catch {
    return null;
  }
}

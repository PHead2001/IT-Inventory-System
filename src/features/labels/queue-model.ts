import { ASSET_UUID, LOCATION_CODE } from '@/features/scan/targets';
import {
  printLayoutSchema,
  mediaDraftSchema,
  parseLayoutDraft,
  type LayoutDraft,
  type PrintLayout,
} from './print-layout';
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
  layout?: PrintLayout | null;
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
export const MAX_COPY_DRAFT_LENGTH = 80;
export const MAX_QUEUE_STORAGE_LENGTH = 100_000;

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
export function clearLabelQueueSession(): boolean {
  try {
    const targets: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('it-inventory-label-queue:v1:')) targets.push(key);
    }
    let absent = true;
    for (const key of targets) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Verify independently. */
      }
      if (sessionStorage.getItem(key) !== null) absent = false;
    }
    return absent;
  } catch {
    return false;
  }
}

export function parseStoredQueue(
  raw: string | null,
  fallbackJob: JobSettings = defaultJob,
): {
  entries: QueueEntry[];
  filters: LabelSearchFilters;
  job: JobSettings;
  layoutRecovery?: { value: unknown };
  mediaDraft?: LayoutDraft;
  mediaDraftRecovery?: { value: unknown };
  copyDrafts?: Record<string, string>;
} | null {
  if (!raw || raw.length > MAX_QUEUE_STORAGE_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const stored = value as Record<string, unknown>;
    if (!Array.isArray(stored.entries) || stored.entries.length > MAX_DISTINCT)
      return null;
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
    const validJob =
      job &&
      ['90x50', '70x35'].includes(job.size) &&
      ['letter', 'A4'].includes(job.page) &&
      ['qr', 'code128'].includes(job.format);
    const hasLayout = Boolean(job && Object.hasOwn(job, 'layout'));
    const layout = hasLayout
      ? printLayoutSchema.nullable().safeParse(job?.layout)
      : null;
    const layoutRecovery =
      hasLayout && !layout?.success ? { value: job?.layout } : undefined;
    const hasMediaDraft = Object.hasOwn(stored, 'mediaDraft');
    const rawMedia = hasMediaDraft
      ? mediaDraftSchema.safeParse(stored.mediaDraft)
      : null;
    const mediaDraft = rawMedia?.success
      ? (rawMedia.data as LayoutDraft)
      : undefined;
    const parsedMedia = mediaDraft ? parseLayoutDraft(mediaDraft) : null;
    // Raw strings never replace effective geometry on hydration. A forged valid
    // draft for another layout remains blocked until an explicit edit or reset.
    const mediaDraftRecovery =
      hasMediaDraft &&
      (!rawMedia?.success ||
        (parsedMedia &&
          (!validJob ||
            !layout?.success ||
            JSON.stringify(parsedMedia) !== JSON.stringify(layout.data))))
        ? { value: stored.mediaDraft }
        : undefined;
    // Optional drafts never replace validated counts or adopt values after another
    // entry changes. Preserve blank distinctly from a missing draft on reload.
    const copyDrafts = Object.fromEntries(
      (entries as QueueEntry[]).flatMap((entry) => {
        const id = queueIdentity(entry);
        const drafts = stored.copyDrafts;
        if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts))
          return [];
        const raw = Object.hasOwn(drafts, id)
          ? (drafts as Record<string, unknown>)[id]
          : undefined;
        return typeof raw === 'string'
          ? [[id, raw.slice(0, MAX_COPY_DRAFT_LENGTH)]]
          : [];
      }),
    );
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
      job: validJob
        ? {
            size: job.size,
            page: job.page,
            format: job.format,
            ...(hasLayout && layout?.success ? { layout: layout.data } : {}),
          }
        : { ...fallbackJob },
      ...(layoutRecovery ? { layoutRecovery } : {}),
      ...(mediaDraft ? { mediaDraft } : {}),
      ...(mediaDraftRecovery ? { mediaDraftRecovery } : {}),
      copyDrafts,
    };
  } catch {
    return null;
  }
}

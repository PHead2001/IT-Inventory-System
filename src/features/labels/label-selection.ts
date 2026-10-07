import {
  queueIdentity,
  validQueue,
  type QueueEntry,
  type QueueKey,
} from './queue-model';
import type { LiveLabel } from './queue.server';

export type SelectedLabel = QueueKey & { name: string };

/** Explicit selection is ordered and deduplicated by typed persistence identity. */
export function selectLabelRows(
  current: SelectedLabel[],
  rows: SelectedLabel[],
): SelectedLabel[] {
  const byId = new Map(current.map((row) => [queueIdentity(row), row]));
  for (const row of rows)
    if (!byId.has(queueIdentity(row))) byId.set(queueIdentity(row), row);
  return [...byId.values()];
}

export function labelQueueEntry(record: LiveLabel): QueueEntry {
  return {
    kind: record.kind,
    key: record.key,
    copies: 1,
    baselineTag: record.tag,
    baselineState: record.state,
    lifecycleAcknowledged: record.state === 'active',
  };
}

/** Resolve first, then check the entire projected queue; never apply a prefix. */
export function projectLabelSelection(
  entries: QueueEntry[],
  selection: SelectedLabel[],
  rows: LiveLabel[],
) {
  const selected = selectLabelRows([], selection);
  const requested = new Set(selected.map(queueIdentity));
  const resolved = new Map(rows.map((row) => [queueIdentity(row), row]));
  if (
    resolved.size !== rows.length ||
    rows.some((row) => !requested.has(queueIdentity(row)))
  )
    throw new Error('Unexpected label records');
  const queued = new Set(entries.map(queueIdentity));
  const added: LiveLabel[] = [];
  const already: SelectedLabel[] = [];
  const unavailable: SelectedLabel[] = [];
  for (const selectedRow of selected) {
    const id = queueIdentity(selectedRow);
    const row = resolved.get(id);
    if (!row) unavailable.push(selectedRow);
    else if (queued.has(id)) already.push({ ...selectedRow, name: row.name });
    else added.push(row);
  }
  const next = [...entries, ...added.map(labelQueueEntry)];
  return { next: validQueue(next) ? next : null, added, already, unavailable };
}

export function labelSelectionSummary(
  result: ReturnType<typeof projectLabelSelection>,
): string {
  const names = (rows: SelectedLabel[]) =>
    rows.length
      ? rows.map((row) => `${row.name} (${row.kind} ${row.key})`).join(', ')
      : 'none';
  return `Added: ${names(result.added)}. Already present: ${names(result.already)}. Unavailable to this account: ${names(result.unavailable)}.`;
}

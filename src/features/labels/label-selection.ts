import {
  queueIdentity,
  validQueue,
  type QueueEntry,
  type QueueKey,
} from './queue-model';
import type { LiveLabel } from './queue.server';

export type SelectedLabel = QueueKey & {
  name: string;
  itemCode?: string | null;
  humanId?: string | null;
  assetTag?: string | null;
  tag?: string | null;
  holdingContext?: string;
};

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
    else if (queued.has(id)) already.push(row);
    else added.push(row);
  }
  const next = [...entries, ...added.map(labelQueueEntry)];
  return {
    next: validQueue(next) ? next : null,
    added,
    already,
    unavailable,
    selection: selected,
  };
}

export function labelSelectionSummary(
  result: ReturnType<typeof projectLabelSelection>,
  options: { includeAdded?: boolean } = {},
): string {
  const kindNames = {
    quantity: 'Quantity item',
    asset: 'Individual asset',
    location: 'Location',
  };
  const outcomes = [...result.added, ...result.already, ...result.unavailable];
  const base = (row: SelectedLabel) => `${row.name} (${kindNames[row.kind]})`;
  const counts = new Map<string, number>();
  for (const row of outcomes)
    counts.set(base(row), (counts.get(base(row)) ?? 0) + 1);
  // Ordinals belong to the original explicit selection, never to an outcome group.
  // Display context is ephemeral; typed keys remain the only queue identity.
  const ordinals = new Map(
    result.selection.map((row, index) => [queueIdentity(row), index + 1]),
  );
  const display = (row: SelectedLabel) => {
    if (counts.get(base(row)) === 1) return base(row);
    const identifier =
      row.kind === 'quantity'
        ? (row.humanId ?? row.itemCode)
        : row.kind === 'asset'
          ? (row.tag ?? row.assetTag)
          : null;
    const context = identifier
      ? `${row.kind === 'quantity' ? 'item code' : 'asset tag'} ${identifier}`
      : [
          row.holdingContext,
          `selected record ${ordinals.get(queueIdentity(row))}`,
        ]
          .filter(Boolean)
          .join('; ');
    return `${row.name} (${kindNames[row.kind]}; ${context})`;
  };
  const names = (rows: SelectedLabel[]) =>
    rows.length ? rows.map(display).join(', ') : 'none';
  if (options.includeAdded === false)
    return [
      result.already.length ? `Already present: ${names(result.already)}.` : '',
      result.unavailable.length
        ? `Unavailable to this account: ${names(result.unavailable)}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  return `Added: ${names(result.added)}. Already present: ${names(result.already)}. Unavailable to this account: ${names(result.unavailable)}.`;
}

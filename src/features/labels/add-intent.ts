import { queueIdentity, validQueueKey, type QueueKey } from './queue-model';
export function consumedLabelUrl(
  pathname: string,
  query: string,
  handled: Iterable<string>,
  hash = '',
) {
  const params = new URLSearchParams(query);
  const identities = new Set(handled);
  for (const kind of ['asset', 'quantity', 'location'] as const) {
    const raw = params.get(kind);
    if (!raw) continue;
    const key = kind === 'location' ? raw : raw.toLowerCase();
    if (identities.has(queueIdentity({ kind, key }))) params.delete(kind);
  }
  const search = params.toString();
  return pathname + (search ? '?' + search : '') + hash;
}
export function labelIntentKeys(values: {
  asset?: string;
  quantity?: string;
  location?: string;
}): QueueKey[] {
  return (['location', 'asset', 'quantity'] as const).flatMap((kind) => {
    const raw = values[kind];
    if (typeof raw !== 'string' || !raw) return [];
    const entry = { kind, key: kind === 'location' ? raw : raw.toLowerCase() };
    return validQueueKey(entry) ? [entry] : [];
  });
}

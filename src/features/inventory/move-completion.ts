import { z } from 'zod';
const pointerSchema = z.strictObject({ entityId: z.uuid(), eventId: z.uuid() });
export function moveCompletionKey(
  origin: string,
  backend: string,
  actor: string,
  entity: string,
) {
  return `it-inventory-move-completion:v1:${encodeURIComponent(origin)}:${encodeURIComponent(backend)}:${actor}:${entity}:quantity_move`;
}
export function parseMoveCompletion(raw: string, entityId: string) {
  if (raw.length > 256) throw new Error('Saved move receipt is invalid.');
  const parsed = pointerSchema.parse(JSON.parse(raw));
  if (parsed.entityId !== entityId)
    throw new Error('Saved move receipt does not match this item.');
  return parsed;
}

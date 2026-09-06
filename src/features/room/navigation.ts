import { locationCodeSchema } from './schema';

export function parseRoomLocation(
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  const parsed = locationCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function roomHref(code: string | null): string {
  return code ? '/room?location=' + encodeURIComponent(code) : '/room';
}

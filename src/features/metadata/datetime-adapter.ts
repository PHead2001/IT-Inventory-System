import { instantMicros } from './field-value-validation';
export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
export function wallTimeAt(instant: string, timeZone: string): string {
  if (instantMicros(instant) === null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    era: 'short',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (name: string) =>
    parts.find((p) => p.type === name)?.value ?? '';
  if (part('era') !== 'AD' || Number(part('year')) > 9999) return '';
  const fraction = /\.(\d{1,6})/.exec(instant)?.[1];
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${fraction ? '.' + fraction : ''}`;
}
export type WallTimeChoice = { instant: string; offset: string };
// Discover timezone offsets around this date, then validate each candidate by
// formatting back. Gaps have no candidate; overlaps require an explicit choice.
export function resolveWallTime(
  wall: string,
  timeZone: string,
): WallTimeChoice[] {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d{1,6})?)?$/.exec(wall);
  if (!match) return [];
  const normalized = match[1] + ':' + (match[2] ?? '00') + (match[3] ?? '');
  if (instantMicros(normalized + 'Z') === null) return [];
  const wallMillis = Date.parse(normalized.split('.')[0] + 'Z');
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 3) {
    const sampled = wallMillis + hour * 3_600_000;
    const sampledWall = wallTimeAt(new Date(sampled).toISOString(), timeZone);
    if (!sampledWall) continue;
    const offset = Date.parse(sampledWall.split('.')[0] + 'Z') - sampled;
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  return [...offsets]
    .flatMap((offsetMillis) => {
      const candidate = new Date(wallMillis - offsetMillis)
        .toISOString()
        .replace(/\.000Z$/, (match[3] ?? '') + 'Z');
      if (
        instantMicros(candidate) === null ||
        wallTimeAt(candidate, timeZone) !== normalized
      )
        return [];
      const seconds = Math.abs(offsetMillis / 1000);
      const hours = Math.floor(seconds / 3600),
        minutes = Math.floor((seconds % 3600) / 60),
        remainder = seconds % 60;
      const offset = `${offsetMillis < 0 ? '-' : '+'}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${remainder ? ':' + String(remainder).padStart(2, '0') : ''}`;
      return [{ instant: candidate, offset: 'UTC' + offset }];
    })
    .sort((a, b) => a.instant.localeCompare(b.instant));
}

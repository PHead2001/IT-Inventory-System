import { z } from 'zod';

export type DisplayTimeZone = { timeZone: string; fallback: boolean };
export const initialDisplayTimeZone: DisplayTimeZone = {
  timeZone: 'UTC',
  fallback: false,
};
export function resolveDisplayTimeZone(candidate: unknown): DisplayTimeZone {
  if (
    typeof candidate === 'string' &&
    candidate.length <= 128 &&
    /^[A-Za-z][A-Za-z0-9_+/-]*$/.test(candidate)
  ) {
    try {
      const timeZone = new Intl.DateTimeFormat('en', {
        timeZone: candidate,
      }).resolvedOptions().timeZone;
      return { timeZone, fallback: false };
    } catch {
      /* Invalid or unsupported zone: explicit UTC fallback. */
    }
  }
  return { timeZone: 'UTC', fallback: true };
}
export function browserDisplayTimeZone(): DisplayTimeZone {
  try {
    return resolveDisplayTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  } catch {
    return { timeZone: 'UTC', fallback: true };
  }
}
export function displayTimeZoneLabel(context: DisplayTimeZone) {
  return context.timeZone + (context.fallback ? ' (UTC fallback)' : '');
}
const instant = z.iso.datetime({ offset: true });
export function formatOperationalTimestamp(
  value: unknown,
  context: DisplayTimeZone = initialDisplayTimeZone,
) {
  // A calendar date or offset-less wall time is not an authoritative instant.
  if (
    typeof value !== 'string' ||
    value.startsWith('0000-') ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !instant.safeParse(value).success
  )
    return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const validated = resolveDisplayTimeZone(context.timeZone);
  const fallback = context.fallback || validated.fallback;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: validated.timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
    era: 'short',
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value ?? '';
  const offset = part('timeZoneName')
    .replace(/^GMT/, 'UTC')
    .replace(/^UTC[+-]00:00(?::00)?$/, 'UTC');
  const zone = validated.timeZone === 'UTC' ? '' : ` (${validated.timeZone})`;
  const era = part('era') === 'AD' ? '' : ` ${part('era')}`;
  return {
    text: `${part('day')} ${part('month')} ${part('year')}${era}, ${part('hour')}:${part('minute')}:${part('second')} ${offset}${zone}${fallback ? ' (UTC fallback)' : ''}`,
    dateTime: value,
    timeZone: validated.timeZone,
    offset,
  };
}
export function exportTimeZoneHref(
  href: string,
  context: DisplayTimeZone | string,
) {
  const base = 'https://inventory.invalid';
  const url = new URL(href, base);
  if (url.origin !== base || url.pathname !== '/api/exports/inventory')
    return href;
  const validated = resolveDisplayTimeZone(
    typeof context === 'string' ? context : context.timeZone,
  );
  if (validated.fallback || (typeof context !== 'string' && context.fallback))
    url.searchParams.delete('displayTimeZone');
  else url.searchParams.set('displayTimeZone', validated.timeZone);
  return url.pathname + url.search + url.hash;
}

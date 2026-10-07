import { z } from 'zod';
import { resolveDisplayTimeZone } from '@/lib/operational-time';

export type ActivityPreset = 'today' | 'yesterday' | 'last7' | 'custom';
export type ActivityErrors = Partial<Record<'from' | 'until', string>>;
export function parseActivityRange(input: { from?: unknown; until?: unknown }) {
  const errors: ActivityErrors = {};
  const parse = (key: 'from' | 'until') => {
    const value = input[key];
    if (value === undefined || value === '') return null;
    if (typeof value !== 'string' || value.length > 64) {
      errors[key] = 'Enter a valid date and time.';
      return null;
    }
    // Existing offset-less datetime-local URLs have always represented UTC.
    const normalized = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)
      ? `${value}:00Z`
      : value;
    if (
      normalized.startsWith('0000-') ||
      !z.iso.datetime({ offset: true }).safeParse(normalized).success ||
      !Number.isFinite(Date.parse(normalized))
    ) {
      errors[key] =
        'Enter a valid date and time, with UTC or an explicit offset.';
      return null;
    }
    return new Date(normalized).toISOString();
  };
  const from = parse('from');
  const until = parse('until');
  if (from && until && Date.parse(from) >= Date.parse(until))
    errors.until =
      'Until must be later than From. From is inclusive; Until is exclusive.';
  return { from, until, errors, valid: Object.keys(errors).length === 0 };
}

const calendarParts = (instant: Date, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);
  return { year: part('year'), month: part('month'), day: part('day') };
};
const dayKey = ({ year, month, day }: ReturnType<typeof calendarParts>) =>
  year * 10000 + month * 100 + day;
const shiftDay = (date: ReturnType<typeof calendarParts>, days: number) => {
  const shifted = new Date(0);
  shifted.setUTCFullYear(date.year, date.month - 1, date.day + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};
// Search for the first instant of the local calendar date, using named-zone
// rules. This handles 23/25-hour days and zones whose midnight is skipped.
function startOfDay(date: ReturnType<typeof calendarParts>, zone: string) {
  const anchor = new Date(0);
  anchor.setUTCFullYear(date.year, date.month - 1, date.day);
  let low = anchor.getTime() - 36 * 60 * 60 * 1000;
  let high = anchor.getTime() + 36 * 60 * 60 * 1000;
  const target = dayKey(date);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayKey(calendarParts(new Date(middle), zone)) < target)
      low = middle + 1;
    else high = middle;
  }
  if (dayKey(calendarParts(new Date(low), zone)) !== target)
    throw new Error(
      'This calendar date does not exist in the selected timezone.',
    );
  return new Date(low).toISOString();
}
export function resolveActivityPreset(
  preset: Exclude<ActivityPreset, 'custom'>,
  timeZone: string,
  now = new Date(),
) {
  const zone = resolveDisplayTimeZone(timeZone);
  if (zone.fallback || !Number.isFinite(now.getTime()))
    throw new Error('Choose a supported named timezone.');
  const today = calendarParts(now, zone.timeZone);
  const fromDay = shiftDay(
    today,
    preset === 'yesterday' ? -1 : preset === 'last7' ? -6 : 0,
  );
  const untilDay = shiftDay(today, preset === 'yesterday' ? 0 : 1);
  return {
    from: startOfDay(fromDay, zone.timeZone),
    until: startOfDay(untilDay, zone.timeZone),
  };
}

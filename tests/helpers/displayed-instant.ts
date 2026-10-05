/** Independent inverse for browser evidence, not the application's formatter. */
export function displayedInstant(text: string) {
  const match =
    /^(\d+) (\w+) (\d{4}), (\d{2}):(\d{2}):(\d{2}) UTC(?:([+-])(\d{2}):(\d{2}))?(?: \([^)]*\))*$/.exec(
      text,
    );
  if (!match) throw new Error('Unrecognized operational timestamp');
  const [
    ,
    day,
    month,
    year,
    hour,
    minute,
    second,
    sign,
    offsetHour,
    offsetMinute,
  ] = match;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthIndex = months.indexOf(month === 'Sept' ? 'Sep' : month);
  if (monthIndex < 0) throw new Error('Unrecognized operational month');
  const offset =
    (Number(offsetHour ?? 0) * 60 + Number(offsetMinute ?? 0)) *
    (sign === '-' ? -1 : 1);
  return Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour),
    Number(minute) - offset,
    Number(second),
  );
}

/** Display a count without conflating its unit with other counts. */
export function countLabel(
  count: number | string | bigint,
  singular: string,
  plural = singular + 's',
) {
  return `${count} ${String(count) === '1' ? singular : plural}`;
}

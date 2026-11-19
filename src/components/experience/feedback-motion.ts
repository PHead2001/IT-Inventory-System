/** Use the existing workspace ease for bounded presentation-only effects. */
export function feedbackEase(): [number, number, number, number] {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--ease-workspace')
    .trim();
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(token);
  const values = match?.[1].split(',').map((value) => Number(value.trim()));
  return values?.length === 4 &&
    values.every(Number.isFinite) &&
    values[0] >= 0 &&
    values[0] <= 1 &&
    values[2] >= 0 &&
    values[2] <= 1
    ? (values as [number, number, number, number])
    : [0.2, 0.8, 0.2, 1];
}

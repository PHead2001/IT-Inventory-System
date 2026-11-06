/** Derive the item-wide storage shortfall without rounding decimal count strings.
 * Missing availability or an unconfigured threshold has no shortfall value.
 * This does not change the inclusive at-threshold attention rule.
 */
export function restockShortfall(
  threshold: number | string | bigint | null | undefined,
  available: number | string | bigint | null | undefined,
): string | null {
  if (threshold == null || available == null) return null;
  const difference = BigInt(threshold) - BigInt(available);
  return (difference > 0n ? difference : 0n).toString();
}

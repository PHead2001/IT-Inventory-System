import { restockShortfall } from '../restock-shortfall';

export function RestockShortfall({
  threshold,
  available,
  variant = 'inline',
}: {
  threshold: number | string | bigint | null | undefined;
  available: number | string | bigint | null | undefined;
  variant?: 'inline' | 'label';
}) {
  const shortfall = restockShortfall(threshold, available);
  if (shortfall === null) return null;
  if (shortfall === '0')
    return (
      <>
        {' '}
        ·{' '}
        {BigInt(threshold!) === BigInt(available!)
          ? 'At threshold'
          : 'Above threshold'}
      </>
    );
  return variant === 'label' ? (
    <>
      {' '}
      · Shortfall <strong>{shortfall}</strong>
    </>
  ) : (
    <> · {shortfall} below threshold</>
  );
}

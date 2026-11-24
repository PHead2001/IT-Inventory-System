import { CountTicker } from '@/components/experience/count-ticker';
import type { InventoryViewResult } from '../views.server';

export function InventoryCsvScope({ className }: { className: string }) {
  return (
    <p className={className}>
      CSV includes all matching holdings, across pages and collapsed items.
      Overall totals appear only on the first CSV row for each quantity item.
    </p>
  );
}

export function InventoryViewCount({
  result,
  includeCsvScope = true,
}: {
  result: InventoryViewResult;
  includeCsvScope?: boolean;
}) {
  return (
    <div className="experience-muted text-sm tabular-nums">
      <p>
        <CountTicker value={result.total} unit={result.unit} /> ·{' '}
        {result.holdingRows} holdings rows on this page
      </p>
      {includeCsvScope && <InventoryCsvScope className="mt-1" />}
    </div>
  );
}

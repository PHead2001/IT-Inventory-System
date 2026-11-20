import { CountTicker } from '@/components/experience/count-ticker';
import type { InventoryViewResult } from '../views.server';
export function InventoryViewCount({
  result,
}: {
  result: InventoryViewResult;
}) {
  return (
    <div className="experience-muted text-sm tabular-nums">
      <p>
        <CountTicker value={result.total} unit={result.unit} /> ·{' '}
        {result.holdingRows} holdings rows on this page
      </p>
      <p className="mt-1">
        CSV includes all matching holdings, across pages and collapsed items.
        Overall totals appear only on the first CSV row for each quantity item.
      </p>
    </div>
  );
}

import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { notFound } from 'next/navigation';
import { getHistoryEvent } from '@/features/inventory/history-event.server';
import { HistoryList } from '@/features/inventory/components/read-ui';

export default async function HistoryEventPage({
  params,
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const event = await getHistoryEvent(kind, id);
  if (!event) notFound();
  return (
    <ProtectedPrivacyContent>
      <RouteReady
        {...await routeReadyProps(
          '/history/events/' +
            encodeURIComponent(kind) +
            '/' +
            encodeURIComponent(id),
          searchParams,
        )}
      >
        <>
          <h1 className="experience-heading">Inventory event</h1>
          <nav
            className="my-4 flex flex-wrap gap-5"
            aria-label="Event navigation"
          >
            <Link
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
              href={`/history?type=${event.kind}&entityId=${event.entityId}`}
            >
              View all record history
            </Link>
            <Link
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
              href={`/inventory/${event.kind === 'quantity' ? 'quantity' : 'assets'}/${event.entityId}`}
            >
              Back to record
            </Link>
          </nav>
          <HistoryList events={[event]} />
        </>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}

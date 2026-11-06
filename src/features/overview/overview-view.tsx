'use client';

import { useEffect, useRef, useState } from 'react';
import { CountTicker } from '@/components/experience/count-ticker';
import { ListEntrance } from '@/components/experience/list-feedback';
import { useOverviewRefreshAuthority } from './refresh-authority';
import Link from '@/components/experience/route-link';
import { useRouteTask } from '@/components/experience/route-pending';
import { ScanLine, Plus, Printer, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MagneticVisual } from '@/components/experience/magnetic-visual';
import {
  OperationalTimestamp,
  ExportLink,
} from '@/components/operational-time';
import { RestockShortfall } from '@/features/inventory/components/restock-shortfall';
import { historyEventTitle } from '@/features/inventory/history-summary';
import { ClosetPreview } from '@/components/experience/closet-preview';
import { AmbientLight } from '@/components/experience/ambient-light';
import type { OverviewSnapshot } from './contracts';
import { refreshOverview } from './refresh.actions';
import { ActivityChart, StockChart } from './charts';
import styles from './overview.module.css';

const recordHref = (kind: 'quantity' | 'asset', id: string) =>
  `/inventory/${kind === 'asset' ? 'assets' : 'quantity'}/${id}`;
const coverageReasons = {
  ledger_budget: 'This item has more history than this chart can safely show.',
  missing_opening: 'An opening balance is missing from the recorded history.',
  event_gap: 'The recorded history has a gap or an inconsistent order.',
  balance_chain: 'The recorded stock changes could not be followed reliably.',
  event_shape: 'Some recorded changes cannot be used to reconstruct stock.',
  current_mismatch:
    'The recorded history does not reconcile with current stock.',
};

type OverviewViewProps = {
  initialSnapshot: OverviewSnapshot | null;
  initialMayEdit: boolean;
  initialForbidden?: boolean;
  serverRevision: string;
};

export function OverviewView({ serverRevision, ...props }: OverviewViewProps) {
  // A new server result atomically remounts the entire retained client state.
  return <OverviewRevisionView key={serverRevision} {...props} />;
}

function OverviewRevisionView({
  initialSnapshot,
  initialMayEdit,
  initialForbidden = false,
}: Omit<OverviewViewProps, 'serverRevision'>) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [mayEdit, setMayEdit] = useState(initialMayEdit);
  const [forbidden, setForbidden] = useState(initialForbidden);
  const [failed, setFailed] = useState(initialSnapshot === null);
  const [message, setMessage] = useState('');
  const [pending, startTask] = useRouteTask();
  const requestGeneration = useRef(0);
  const authority = useOverviewRefreshAuthority();
  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );

  function refresh() {
    const generation = ++requestGeneration.current;
    const completionCurrent = authority.capture();
    startTask(async () => {
      setMessage('');
      try {
        const action = refreshOverview();
        const result = await action;
        // Check the original pending epoch before the result observer can retire
        // it for this request's own denial. Other retirement cannot revive data.
        if (
          generation !== requestGeneration.current ||
          !completionCurrent.current()
        )
          return;
        await authority.observe(action);
        const current =
          !result.ok && result.code === 'forbidden' && result.clearSnapshot
            ? completionCurrent.afterCurrentDenial()
            : completionCurrent.current();
        if (generation !== requestGeneration.current || !current) return;
        if (result.ok) {
          setSnapshot(result.snapshot);
          setMayEdit(result.mayEdit);
          setForbidden(false);
          setFailed(false);
          setMessage('Overview refreshed.');
        } else {
          setFailed(true);
          if (result.mayEdit !== undefined) setMayEdit(result.mayEdit);
          if (result.clearSnapshot) {
            setSnapshot(null);
            setMayEdit(false);
            setForbidden(true);
          }
        }
      } catch {
        if (
          generation !== requestGeneration.current ||
          !completionCurrent.current()
        )
          return;
        setFailed(true);
      }
    });
  }

  return (
    <div className={styles.grid}>
      <header
        className={`experience-surface-bright ${styles.hero}`}
        data-overview-tile="hero"
      >
        <AmbientLight />
        <div className={styles.heroTop}>
          <div className={styles.heroContent}>
            <p className="experience-eyebrow">Daily operations</p>
            <h1 className="experience-heading mt-2">Overview</h1>
            <p className="experience-muted mt-2 text-sm">
              What needs attention and what changed.
            </p>
            <nav aria-label="Overview quick actions" className={styles.actions}>
              <Button asChild>
                <Link href="/scan" data-overview-action="scan">
                  <ScanLine size={18} aria-hidden="true" />
                  Scan
                </Link>
              </Button>
              {mayEdit && !forbidden && (
                <details>
                  <summary
                    className={`experience-magnetic ${styles.link}`}
                    data-overview-action="add"
                  >
                    <MagneticVisual>
                      <Plus size={18} aria-hidden="true" /> Add item
                    </MagneticVisual>
                  </summary>
                  <div className={styles.actions}>
                    <Link
                      className={styles.link}
                      href="/inventory/quantity/new"
                    >
                      Add quantity item
                    </Link>
                    <Link className={styles.link} href="/inventory/assets/new">
                      Add individual asset
                    </Link>
                  </div>
                </details>
              )}
              <Button
                asChild
                variant="outline"
                className="experience-magnetic"
                data-magnetic-face="outline"
              >
                <Link href="/labels" data-overview-action="print">
                  <MagneticVisual>
                    <Printer size={18} aria-hidden="true" /> Print labels
                  </MagneticVisual>
                </Link>
              </Button>
            </nav>
            <div className={styles.actions}>
              <Button
                variant="outline"
                onClick={refresh}
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? 'Refreshing…' : 'Refresh overview'}
              </Button>
              <Link href="/room" className={styles.link}>
                Explore Spaces &amp; maps{' '}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div
            className={`experience-closet-preview experience-tilt ${styles.illustration}`}
            data-overview-visual="hero"
          >
            <MagneticVisual kind="tilt">
              <ClosetPreview />
            </MagneticVisual>
          </div>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="experience-muted mt-2 min-h-6 text-sm"
        >
          {pending ? 'Refreshing overview…' : message}
        </p>
        {failed && (
          <p role="alert" className={styles.notice}>
            {forbidden ? (
              <>
                Your access changed. Private Overview data has been cleared.{' '}
                <Link href="/login?next=%2Fdashboard" className={styles.link}>
                  Sign in again
                </Link>
              </>
            ) : snapshot ? (
              'Refresh failed. Showing stale data from the last successful fetch. Retry Refresh overview.'
            ) : (
              'Overview could not be loaded. Retry Refresh overview.'
            )}
          </p>
        )}
        {snapshot && (
          <>
            <div className="experience-muted text-xs">
              Updated{' '}
              <OperationalTimestamp value={snapshot.fetchedAt} relative /> ·
              Snapshot <time dateTime={snapshot.asOf}>{snapshot.asOf}</time> ·
              Charts: {snapshot.timeZone}
            </div>
            <ListEntrance
              as="div"
              identities={['attention', 'zero', 'monitored', 'unmonitored']}
              pending={pending}
              className={styles.stats}
            >
              <Stat
                label="Needs attention"
                value={
                  snapshot.stock.monitoredItems === '0'
                    ? 'Not configured'
                    : snapshot.stock.needsAttention
                }
              />
              <Stat
                label="Zero available"
                value={
                  snapshot.stock.monitoredItems === '0'
                    ? 'Not configured'
                    : snapshot.stock.zeroAvailable
                }
                note="Included in needs attention"
              />
              <Stat
                label="Monitored items"
                value={snapshot.stock.monitoredItems}
              />
              <Stat
                label="Without thresholds"
                value={snapshot.stock.unmonitoredItems}
              />
            </ListEntrance>
          </>
        )}
      </header>
      {snapshot && (
        <>
          <section
            className={`experience-surface ${styles.panel}`}
            aria-labelledby="overview-attention"
          >
            <h2 className={styles.heading} id="overview-attention">
              Items needing attention
            </h2>
            <p className="experience-muted text-sm">
              Available storage at or below the current threshold.
            </p>
            {snapshot.stock.monitoredItems === '0' ? (
              <p className={styles.notice}>
                No items are monitored yet. Set a threshold on a quantity item
                to start.
              </p>
            ) : snapshot.stock.needsAttention === '0' ? (
              <p className="mt-3 text-sm">
                Monitored items are above their thresholds. Other items may have
                no threshold.
              </p>
            ) : (
              <ListEntrance
                identities={snapshot.stock.attention.map((row) => row.itemId)}
                pending={pending}
                className={styles.list}
              >
                {snapshot.stock.attention.map((row) => (
                  <li className={styles.row} key={row.itemId}>
                    <Link
                      className={styles.link}
                      href={recordHref('quantity', row.itemId)}
                    >
                      {row.name}
                    </Link>
                    <p className={styles.metrics}>
                      Available <strong>{row.available}</strong> · Threshold{' '}
                      <strong>{row.threshold}</strong>
                      <RestockShortfall
                        threshold={row.threshold}
                        available={row.available}
                        variant="label"
                      />
                    </p>
                    <p className="text-sm">
                      {row.available === '0'
                        ? 'Zero available'
                        : row.available === row.threshold
                          ? 'At threshold'
                          : 'Below threshold'}
                    </p>
                  </li>
                ))}
              </ListEntrance>
            )}
            <div className={styles.actions}>
              <Link className={styles.link} href="/inventory?lowStock=true">
                View all low-stock items
              </Link>
              <ExportLink
                className={styles.link}
                href="/api/exports/inventory?export=low_stock"
              >
                Download low-stock CSV
              </ExportLink>
              <Link className={styles.link} href="/dashboard?view=low-stock">
                Detailed stock overview
              </Link>
            </div>
            <details className={styles.disclosure}>
              <summary>About stock attention</summary>
              <p>
                Zero available is included in needs attention. Storage at
                inactive locations is included. Shortfall is the gap to the
                current threshold, not an order recommendation.
              </p>
            </details>
          </section>
          <section
            className={`experience-surface ${styles.panel}`}
            aria-labelledby="overview-recent"
          >
            <h2 className={styles.heading} id="overview-recent">
              Recent changes
            </h2>
            <p className="experience-muted text-sm">
              The last ten recorded inventory events.
            </p>
            {snapshot.recentEvents.length === 0 ? (
              <p className="mt-3 text-sm">No inventory events yet.</p>
            ) : (
              <div
                className={styles.recentScroll}
                role="region"
                aria-label="Last ten inventory events"
                tabIndex={0}
              >
                <ListEntrance
                  as="ol"
                  identities={snapshot.recentEvents.map(
                    (event) => `${event.recordKind}:${event.eventId}`,
                  )}
                  pending={pending}
                  className={styles.list}
                >
                  {snapshot.recentEvents.map((event) => (
                    <li
                      key={`${event.recordKind}:${event.eventId}`}
                      className={`${styles.row} ${styles.recentRow}`}
                    >
                      <div>
                        <Link
                          className={styles.link}
                          href={`/history/events/${event.recordKind}/${event.eventId}`}
                        >
                          {historyEventTitle({
                            eventType: event.kind,
                            kind: event.recordKind,
                          })}{' '}
                          · {event.name || 'Record name unavailable'}
                        </Link>
                        <div className={styles.metrics}>
                          {event.actorName || 'Recorded actor unavailable'} ·{' '}
                          <OperationalTimestamp value={event.at} relative />
                        </div>
                      </div>
                      <Link
                        className={styles.link}
                        href={recordHref(event.recordKind, event.entityId)}
                      >
                        View record
                      </Link>
                    </li>
                  ))}
                </ListEntrance>
              </div>
            )}
            <Link className={styles.link} href="/history">
              View all history
            </Link>
          </section>
          <section
            className={`experience-surface ${styles.panel}`}
            aria-labelledby="overview-monitoring"
          >
            <h2 className={styles.heading} id="overview-monitoring">
              Set up stock monitoring
            </h2>
            {snapshot.stock.unmonitoredItems === '0' ? (
              <p className="experience-muted text-sm">
                {snapshot.stock.monitoredItems === '0'
                  ? 'No active quantity items yet.'
                  : 'All active quantity items have thresholds.'}
              </p>
            ) : (
              <>
                <p className="experience-muted text-sm">
                  {snapshot.stock.unmonitoredItems} active quantity items have
                  no threshold.
                </p>
                <ListEntrance
                  identities={snapshot.stock.unmonitored.map(
                    (row) => row.itemId,
                  )}
                  pending={pending}
                  className={styles.list}
                >
                  {snapshot.stock.unmonitored.map((row) => (
                    <li key={row.itemId} className={styles.row}>
                      <Link
                        className={styles.link}
                        href={recordHref('quantity', row.itemId)}
                      >
                        {row.name}
                      </Link>
                      <p className={styles.metrics}>
                        Available {row.available} · Not monitored
                      </p>
                      <Link
                        className={styles.link}
                        href={recordHref('quantity', row.itemId)}
                      >
                        {mayEdit
                          ? `Set threshold for ${row.name}`
                          : `View ${row.name}`}
                      </Link>
                    </li>
                  ))}
                </ListEntrance>
              </>
            )}
            {!mayEdit && (
              <p className="experience-muted mt-2 text-sm">
                IT staff can set thresholds and add items.
              </p>
            )}
            <Link className={styles.link} href="/inventory?type=quantity">
              Browse quantity items and thresholds
            </Link>
          </section>
          <section
            className={`experience-surface ${styles.panel}`}
            aria-labelledby="overview-sites"
          >
            <h2 className={styles.heading} id="overview-sites">
              Equipment at sites
            </h2>
            <dl className="space-y-2 text-sm tabular-nums">
              <div>
                <dt className="experience-muted">Individual assets</dt>
                <dd>
                  <CountTicker value={snapshot.atSites.assets} initialZero />
                </dd>
              </div>
              <div>
                <dt className="experience-muted">Quantity item types</dt>
                <dd>
                  <CountTicker
                    value={snapshot.atSites.quantityDefinitions}
                    initialZero
                  />
                </dd>
              </div>
              <div>
                <dt className="experience-muted">Sites with equipment</dt>
                <dd>
                  <CountTicker
                    value={snapshot.atSites.occupiedSites}
                    initialZero
                  />
                </dd>
              </div>
            </dl>
            {snapshot.atSites.rows.length === 0 ? (
              <p className="mt-3 text-sm">
                No equipment is currently assigned to sites.
              </p>
            ) : (
              <ListEntrance
                identities={snapshot.atSites.rows.map(
                  (row) => `${row.siteId}:${row.kind}:${row.entityId}`,
                )}
                pending={pending}
                className={styles.list}
              >
                {snapshot.atSites.rows.map((row) => (
                  <li
                    className={styles.row}
                    key={`${row.siteId}:${row.kind}:${row.entityId}`}
                  >
                    <Link
                      className={styles.link}
                      href={recordHref(row.kind, row.entityId)}
                    >
                      {row.name}
                    </Link>
                    <p className={styles.metrics}>
                      {row.siteName}
                      {!row.siteActive ? ' (inactive)' : ''} · {row.quantity}{' '}
                      {row.kind === 'asset' ? 'individual asset' : 'units'}
                    </p>
                  </li>
                ))}
              </ListEntrance>
            )}
            <Link className={styles.link} href="/sites">
              View properties &amp; sites
            </Link>
          </section>
          <section
            className={`experience-surface ${styles.panel} ${styles.wide}`}
            aria-labelledby="overview-stock-history"
          >
            <h2 className={styles.heading} id="overview-stock-history">
              Available stock · 14 days
            </h2>
            <p className="experience-muted text-sm">
              {snapshot.window.startDate} – {snapshot.window.endDate} ·{' '}
              {snapshot.timeZone}. Each chart tracks one item. Today is the
              snapshot so far.
            </p>
            {snapshot.stockTrends.length === 0 ? (
              <p className="mt-3 text-sm">
                Add a quantity item to see its recorded stock history.
              </p>
            ) : (
              <ListEntrance
                as="div"
                identities={snapshot.stockTrends.map((trend) => trend.itemId)}
                pending={pending}
                className={`${styles.trends} mt-4`}
              >
                {snapshot.stockTrends.map((trend) => (
                  <article className={styles.trend} key={trend.itemId}>
                    <h3 className="text-base font-semibold">
                      <Link
                        className={styles.link}
                        href={recordHref('quantity', trend.itemId)}
                      >
                        {trend.name}
                      </Link>
                    </h3>
                    <p className={styles.metrics}>
                      Available now {trend.available} ·{' '}
                      {trend.threshold === null
                        ? 'No current threshold'
                        : `Current threshold ${trend.threshold}`}
                    </p>
                    <p className="mt-2 text-sm">
                      {trend.coverage === 'complete'
                        ? 'Complete recorded history'
                        : trend.coverage === 'partial'
                          ? 'Partial history · earlier dates not yet recorded'
                          : 'Stock history unavailable'}
                    </p>
                    {trend.reason && (
                      <p className={styles.notice}>
                        {coverageReasons[trend.reason]}
                      </p>
                    )}
                    <StockChart trend={trend} today={snapshot.window.endDate} />
                  </article>
                ))}
              </ListEntrance>
            )}
            <details className={styles.disclosure}>
              <summary>How stock history is shown</summary>
              <p>
                Earlier dates show stock at the end of each day; today shows
                stock at the snapshot time. Missing history stays blank. Current
                thresholds do not describe past thresholds or past monitoring.
              </p>
            </details>
          </section>
          <section
            className={`experience-surface ${styles.panel} ${styles.wide}`}
            aria-labelledby="overview-activity"
          >
            <h2 className={styles.heading} id="overview-activity">
              Inventory activity · 14 days
            </h2>
            <p className="experience-muted text-sm">
              {snapshot.window.startDate} – {snapshot.window.endDate} ·{' '}
              {snapshot.timeZone}. Counts include stock, site, details and
              lifecycle changes; today is so far.
            </p>
            {snapshot.activity.coverage === 'unavailable' && (
              <p className={styles.notice}>
                Activity is unavailable: this window has more events than this
                chart can safely count.
              </p>
            )}
            <ActivityChart
              activity={snapshot.activity}
              today={snapshot.window.endDate}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="experience-tilt" data-overview-tile="stat">
      <MagneticVisual
        kind="tilt"
        className={`experience-surface ${styles.stat}`}
      >
        <dl>
          <dt>{label}</dt>
          <dd>
            {/^\d+$/.test(value) ? (
              <CountTicker value={value} initialZero />
            ) : (
              value
            )}
            {note && (
              <span className="experience-muted mt-2 block text-xs font-normal">
                {note}
              </span>
            )}
          </dd>
        </dl>
      </MagneticVisual>
    </div>
  );
}

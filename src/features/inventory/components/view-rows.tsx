import Link from '@/components/experience/route-link';
import { InventoryRecordLink } from '@/components/experience/record-transition';
import { inventoryHolding } from '@/components/experience/route-motion-state';
import { ListEntrance } from '@/components/experience/list-feedback';
import { CountTicker } from '@/components/experience/count-ticker';
import { SpringDisclosure } from '@/components/experience/spring-disclosure';
import {
  HoldingSnapshotList,
  HoldingPulseGraphic,
} from '@/components/experience/holding-feedback';

import type { CSSProperties } from 'react';

import { RecordStatus } from '@/components/record-status';

import { InventoryListThumbnail } from '@/features/files/list-thumbnail';
import { PeekLink } from '@/features/peek/peek-link';

import type { FileListSummary } from '@/features/files/list.server';

import type { InventoryViewResult, InventoryColumn } from '../views.server';

import type { ViewPreferences } from '../view-preferences';

import { inventoryRowAnchor } from '../create-return';
import { detailRecordHref } from '../detail-return';

import { LocationLink } from './read-ui';
import { RestockShortfall } from './restock-shortfall';
import { ShowInRoom } from '@/features/room/show-in-room';

import styles from './view-rows.module.css';

export function InventoryViewRows({
  result,
  preferences,
  fileSummaries = [],
  returnTo,
  columns = [],
  currentLocationId,
  currentLocationCode,
}: {
  result: InventoryViewResult;
  preferences: ViewPreferences;
  fileSummaries?: FileListSummary[];
  returnTo: string;
  columns?: InventoryColumn[];
  currentLocationId?: string;
  currentLocationCode?: string;
}) {
  const compact = preferences.density === 'compact';

  const selected = preferences.columns.map((id, index) => {
    const column = columns.find((entry) => entry.id === id);
    return column
      ? `${column.label} · ${column.category}${column.ordinal ? ` (${column.ordinal})` : ''}`
      : (result.rows[0]?.preview?.answers.find(
          (answer) => answer.fieldId === id,
        )?.label ?? `Selected field ${index + 1}`);
  });
  return (
    <div
      className={styles.viewport}
      role={compact ? 'region' : undefined}
      aria-label={compact ? 'Scrollable inventory table' : undefined}
      tabIndex={compact ? 0 : undefined}
    >
      <div
        role={compact ? 'table' : undefined}
        aria-label={compact ? 'Inventory results' : undefined}

        style={
          {
            '--inventory-grid': `minmax(180px, 1fr) minmax(220px, 1fr) minmax(220px, 1fr)${selected.length ? ` repeat(${selected.length}, minmax(140px, 1fr))` : ''}`,
            '--inventory-width': `${620 + selected.length * 140}px`,
          } as CSSProperties
        }

        className={`experience-surface ${preferences.density === 'compact' ? styles.compact : ''}`}
      >
        {compact && (
          <div role="row" className={styles.header}>
            {[
              'Item',
              'Scoped / overall totals',
              'Storage / custody',
              ...selected,
            ].map((label, index) => (
              <span role="columnheader" key={index}>
                {label}
              </span>
            ))}
          </div>
        )}

        <ListEntrance
          className={styles.list}
          role={compact ? 'rowgroup' : undefined}
          identities={result.rows.map(({ row }) =>
            JSON.stringify([
              row.kind,
              row.id,
              preferences.view === 'holdings'
                ? (row.location?.id ?? row.site?.id ?? null)
                : null,
            ]),
          )}
        >
          {result.rows.map((group, index) => {
            const { row } = group;
            const href = detailRecordHref(
              row.kind,
              row.id,
              `${returnTo}#${inventoryRowAnchor(index)}`,
            );

            const file = fileSummaries.find(
              (entry) => entry.kind === row.kind && entry.id === row.id,
            );

            return (
              <li
                key={`${row.kind}:${row.id}:${preferences.view === 'holdings' ? (row.location?.id ?? row.site?.id ?? 'unlocated') : ''}`}
                id={inventoryRowAnchor(index)}
                className={`experience-spotlight relative ${styles.row}`}
                role={compact ? 'row' : undefined}
              >
                <div
                  className={styles.identity}
                  role={compact ? 'cell' : undefined}
                >
                  {file?.thumbnail_path && (
                    <span className={styles.thumbnail}>
                      <InventoryListThumbnail
                        path={file.thumbnail_path}
                        name={file.photo_name ?? row.name}
                      />
                    </span>
                  )}

                  <div className="min-w-0">
                    <InventoryRecordLink
                      record={{ kind: row.kind, id: row.id }}
                      {...(currentLocationCode
                        ? {
                            source: {
                              kind: 'location-inventory' as const,
                              locationCode: currentLocationCode,
                              occurrence:
                                preferences.view === 'items'
                                  ? { kind: 'aggregate' as const }
                                  : {
                                      kind: 'holding' as const,
                                      holding: inventoryHolding(row)!,
                                    },
                            },
                          }
                        : preferences.view === 'items'
                          ? { source: { kind: 'inventory-aggregate' as const } }
                          : { holding: inventoryHolding(row) })}
                      pairable={
                        preferences.view === 'items' ||
                        inventoryHolding(row) !== null
                      }
                      returnTo={returnTo + '#' + inventoryRowAnchor(index)}
                      href={href}
                      className={styles.name}
                    >
                      {row.name}
                    </InventoryRecordLink>
                    <p className={styles.meta}>
                      {row.categoryName} ·{' '}
                      {row.kind === 'quantity'
                        ? 'Quantity item'
                        : 'Individual asset'}{' '}
                      · <RecordStatus status={row.status} />
                    </p>

                    {row.itemCode && (
                      <p className="text-xs [overflow-wrap:anywhere]">
                        Item code (SKU): {row.itemCode}
                      </p>
                    )}

                    {row.assetTag && (
                      <p className="text-xs [overflow-wrap:anywhere]">
                        Asset tag: {row.assetTag}
                      </p>
                    )}
                    {row.serialNumber && (
                      <p className="text-xs [overflow-wrap:anywhere]">
                        Serial: {row.serialNumber}
                      </p>
                    )}

                    {file &&
                      (file.photo_count > 0 || file.document_count > 0) && (
                        <p className="text-xs">
                          {file.photo_count} photos · {file.document_count} PDFs
                        </p>
                      )}
                  </div>
                </div>

                <div
                  className={styles.totals}
                  role={compact ? 'cell' : undefined}
                >
                  {row.kind === 'quantity' && (
                    <>
                      <p>
                        <strong>Within these filters:</strong>{' '}
                        <CountTicker value={group.scopedStorage} /> available in
                        storage · <CountTicker value={group.scopedSite} />{' '}
                        assigned at sites
                      </p>

                      <p>
                        Stocked locations and sites:{' '}
                        <CountTicker value={group.holdingCount} />
                      </p>

                      <p className={styles.meta}>
                        Overall item totals:{' '}
                        {row.availableQuantity == null ? (
                          'Storage availability unavailable'
                        ) : (
                          <>
                            <CountTicker value={row.availableQuantity} />{' '}
                            available across all storage
                          </>
                        )}{' '}
                        ·{' '}
                        {row.assignedQuantity == null ? (
                          'Site total unavailable'
                        ) : (
                          <>
                            <CountTicker value={row.assignedQuantity} />{' '}
                            assigned across all sites
                          </>
                        )}{' '}
                        ·{' '}
                        {row.ownedQuantity == null ? (
                          'Recorded total unavailable'
                        ) : (
                          <>
                            <CountTicker value={row.ownedQuantity} /> recorded
                          </>
                        )}
                      </p>

                      {row.status === 'active' &&
                        (row.stockState === 'needs_restocking' ||
                          row.stockState === 'out_of_stock') && (
                          <p className={styles.alert}>
                            {row.stockState === 'out_of_stock'
                              ? 'Out of stock'
                              : 'Needs restocking'}{' '}
                            · overall storage threshold{' '}
                            {row.reorderThreshold ?? 'not configured'}
                            <RestockShortfall
                              threshold={row.reorderThreshold}
                              available={row.availableQuantity}
                            />
                          </p>
                        )}
                    </>
                  )}
                </div>

                <div
                  className={styles.holdings}
                  role={compact ? 'cell' : undefined}
                >
                  {preferences.view === 'items' ? (
                    <SpringDisclosure
                      summary={`Storage and sites within these filters (${group.holdingCount})`}
                      summaryProps={{
                        className: 'min-h-11 cursor-pointer py-2',
                      }}
                    >
                      <HoldingRows
                        group={group}
                        scope={returnTo}
                        currentLocationId={currentLocationId}
                      />
                    </SpringDisclosure>
                  ) : (
                    <HoldingRows
                      group={group}
                      scope={returnTo}
                      currentLocationId={currentLocationId}
                    />
                  )}
                </div>

                {group.preview?.answers.map((answer) => (
                  <div
                    role={compact ? 'cell' : undefined}
                    key={answer.fieldId}
                    className={
                      styles.column + ' min-w-0 [overflow-wrap:anywhere]'
                    }
                  >
                    <p className="text-xs text-slate-400">
                      {answer.label}
                      {answer.legacy ? ' · historical field' : ''}
                    </p>

                    <p>
                      {answer.displayValue}
                      {answer.truncated ? '…' : ''}
                      {answer.legacy
                        ? answer.present
                          ? ' (recorded revision)'
                          : ' (historical published label)'
                        : ''}
                    </p>

                    {answer.truncated && (
                      <PeekLink
                        peekTarget={{ kind: row.kind, id: row.id }}
                        href={href}
                        className="text-xs text-cyan-300 underline"
                      >
                        Preview shortened · full details
                      </PeekLink>
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ListEntrance>
      </div>
    </div>
  );
}

function HoldingRows({
  group,
  scope,
  currentLocationId,
}: {
  scope: string;
  currentLocationId?: string;
  group: InventoryViewResult['rows'][number];
}) {
  return (
    <HoldingSnapshotList
      className="grid min-w-0 gap-2"
      scope={scope}
      snapshot={group.holdings.map((row) => ({
        id: JSON.stringify([
          row.kind,
          row.id,
          row.location?.id ?? null,
          row.site?.id ?? null,
        ]),
        value: String(row.quantity ?? 1),
      }))}
    >
      {group.holdings.map((row) => (
        <li
          key={row.location?.id ?? row.site?.id ?? 'unlocated'}
          className="relative min-w-0 [overflow-wrap:anywhere]"
        >
          <HoldingPulseGraphic />
          {row.kind === 'quantity' && (
            <strong>
              <CountTicker value={row.quantity ?? 0} unit="unit" /> ·{' '}
            </strong>
          )}

          {row.site ? (
            <Link
              href={`/sites/${encodeURIComponent(row.site.code)}`}
              className="text-cyan-300 underline"
            >
              Assigned to {row.site.name} ({row.site.code}) · no room model
            </Link>
          ) : row.location ? (
            <>
              {row.status === 'retired' ? 'Last recorded storage: ' : ''}
              {row.location.id === currentLocationId ? (
                <>
                  <span>At this location</span>{' '}
                  <ShowInRoom location={row.location} />
                </>
              ) : (
                <LocationLink location={row.location} />
              )}
            </>
          ) : (
            <span>
              {row.kind === 'quantity'
                ? 'No positive stock or active site holding — unlocated definition'
                : row.status === 'retired'
                  ? 'Retired · no recorded storage'
                  : 'Unlocated asset'}
            </span>
          )}
        </li>
      ))}
    </HoldingSnapshotList>
  );
}

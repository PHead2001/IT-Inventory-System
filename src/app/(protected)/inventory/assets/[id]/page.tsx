import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import {
  getAssetDetail,
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { OperationPanel } from '@/features/inventory/components/mutation-form';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { CustomMetadataList } from '@/features/metadata/custom-metadata-list';
import {
  getSites,
  getEntityAssignments,
} from '@/features/custody/queries.server';
import { CustodyChangeForm } from '@/features/custody/custody-change-form';
import { FilesPanel } from '@/features/files/files-panel';
import {
  HistoryList,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
import styles from '@/features/inventory/components/inventory-visual.module.css';
export default async function AssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { member } = await requireMember();
  const { id } = await params;
  const detail = await getAssetDetail(id);
  if (!detail) notFound();
  const { asset, location, site, history, duplicateSerialMatches } = detail;
  const [categories, locations, sites, assignments, forms] = await Promise.all([
    getCategories(),
    getLocations(),
    getSites(),
    getEntityAssignments('asset', id),
    member.role === 'staff'
      ? getPublishedForms([asset.categoryId])
      : Promise.resolve({}),
  ]);
  return (
    <>
      <section className={`experience-surface-bright ${styles.detailHero}`}>
        <Link href="/inventory" className="text-sm text-cyan-200 underline">
          ← Back to inventory
        </Link>
        <div className={`${styles.detailHead} mt-4`}>
          <div className={styles.detailTitle}>
            <p className="experience-eyebrow">
              {asset.categoryName} · Serialized asset
            </p>
            <h1 className="experience-heading mt-2">{asset.name}</h1>
            <p className="experience-muted mt-2 text-sm capitalize">
              {asset.status} · Version {asset.version}
            </p>
          </div>
          <div className={styles.detailActions}>
            <Link href={'/labels?asset=' + encodeURIComponent(asset.id)}>
              Print asset label
            </Link>
          </div>
        </div>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Asset tag</dt>
            <dd>{asset.assetTag || 'Not set'}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Serial number</dt>
            <dd>{asset.serialNumber || 'Not set'}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Current custody</dt>
            <dd>
              {site ? site.name : location ? location.breadcrumb : 'Unassigned'}
            </dd>
          </div>
        </dl>
      </section>
      <div className={styles.recordGrid}>
        <div className={styles.recordMain}>
          <section className={panel + ' my-5'}>
            <h2 className="font-semibold">Asset details</h2>
            <dl className="mt-3 space-y-2 break-words">
              <div>
                <dt className="text-sm text-slate-400">Asset tag</dt>
                <dd>{asset.assetTag || 'Not set'}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-400">Serial number</dt>
                <dd>{asset.serialNumber || 'Not set'}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-400">Manufacturer / model</dt>
                <dd>
                  {asset.manufacturer || 'Not set'} / {asset.model || 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-400">Description</dt>
                <dd className="whitespace-pre-wrap">
                  {asset.description || 'No description'}
                </dd>
              </div>
            </dl>
          </section>
          <CustomMetadataList
            values={asset.customDisplay}
            needsMetadata={asset.needsMetadata}
          />
          {duplicateSerialMatches.length > 0 && (
            <aside className="my-5 rounded-xl border border-amber-700 p-4 text-amber-200">
              <h2 className="font-semibold">Duplicate serial warning</h2>
              <p className="mt-2 text-sm">
                This serial is also recorded on the following assets. Duplicate
                serials are allowed.
              </p>
              <ul className="mt-2 space-y-2">
                {duplicateSerialMatches.map((match) => (
                  <li key={match.id}>
                    <Link
                      className="underline"
                      href={'/inventory/assets/' + match.id}
                    >
                      {match.name} ({match.assetTag || 'untagged'},{' '}
                      {match.status})
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <section className={panel + ' mb-6'}>
            <h2 className="mb-2 font-semibold">
              {asset.status === 'retired'
                ? 'Last recorded storage / custody'
                : 'Current custody'}
            </h2>
            {site ? (
              <Link
                className="text-cyan-300 underline"
                href={`/sites/${encodeURIComponent(site.code)}`}
              >
                Assigned to {site.name} ({site.code})
              </Link>
            ) : location ? (
              <LocationLink location={location} />
            ) : (
              <span>No current storage or site assignment</span>
            )}
            {site && (
              <p className="mt-2 text-sm text-slate-400">
                This asset is at a site and is not currently in a storage
                drawer. The site has no 3D room model.
              </p>
            )}
          </section>
        </div>
        <aside className={styles.recordAside} aria-label="Record attachments">
          <FilesPanel
            parentType="asset"
            parentId={asset.id}
            active={asset.status === 'active'}
            staff={member.role === 'staff'}
          />
        </aside>
      </div>
      {member.role === 'staff' && (
        <section aria-label="Asset actions" className="mb-8 space-y-3">
          <h2 className="text-xl font-semibold">Manage serialized asset</h2>
          {(asset.status === 'retired'
            ? (['asset_update', 'asset_restore'] as const)
            : site
              ? (['asset_update'] as const)
              : ([
                  'asset_update',
                  'asset_move',
                  'asset_correct_location',
                  'asset_retire',
                ] as const)
          ).map((operation) =>
            operation === 'asset_update' ? (
              <details
                key={operation}
                className={`${panel} ${styles.editDisclosure}`}
              >
                <summary>Edit asset metadata</summary>
                <MetadataForm
                  actorId={member.user_id}
                  kind="asset"
                  asset={asset}
                  categories={categories}
                  locations={locations}
                  forms={forms}
                />
              </details>
            ) : (
              <OperationPanel
                key={operation}
                operation={operation}
                asset={asset}
                currentLocation={location ?? undefined}
                categories={categories}
                locations={locations}
              />
            ),
          )}
          {asset.status === 'active' &&
            (site
              ? ([
                  'return',
                  'transfer',
                  'correct',
                  'write_off',
                  'retire',
                ] as const)
              : (['assign'] as const)
            ).map((action) => (
              <CustodyChangeForm
                canManageConfiguration={member.can_manage_configuration}
                key={action}
                kind="asset"
                action={action}
                entityId={asset.id}
                version={String(asset.version)}
                locations={locations}
                sites={sites}
                currentLocation={location}
                currentSite={
                  site
                    ? sites.find((candidate) => candidate.id === site.id)
                    : null
                }
              />
            ))}
        </section>
      )}
      {assignments.length > 0 && (
        <section className="mb-6 space-y-3" aria-label="Custody history">
          <h2 className="text-xl font-semibold">Custody history</h2>
          {assignments.map((event) => (
            <p className={panel} key={event.id}>
              <span className="font-medium capitalize">
                {event.kind.replaceAll('_', ' ')}
              </span>{' '}
              · {event.from_label || 'Opening'} →{' '}
              {event.to_label || 'No destination'} · {event.actor_name} ·{' '}
              {new Date(event.created_at).toLocaleString('en-US', {
                timeZone: 'UTC',
              })}{' '}
              UTC
              {event.reason && (
                <span className="mt-1 block">Reason: {event.reason}</span>
              )}
            </p>
          ))}
        </section>
      )}
      <h2 className="mb-3 text-xl font-semibold">Recent history</h2>
      <div className={styles.history}>
        <HistoryList events={history} />
      </div>
      <Link
        className="mt-4 inline-block min-h-11 py-3 text-cyan-300 underline"
        href={'/history?type=asset&entityId=' + asset.id}
      >
        View all asset history
      </Link>
    </>
  );
}

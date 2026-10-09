import { RecordStatus } from '@/components/record-status';
import Link from 'next/link';
import { inventoryReturnPath } from '@/features/inventory/create-return';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import {
  getAssetDetail,
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { DetailTasks } from '@/features/inventory/components/detail-tasks';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { CustomMetadataList } from '@/features/metadata/custom-metadata-list';
import { getSites } from '@/features/custody/queries.server';
import { FilesPanel } from '@/features/files/files-panel';
import {
  HistoryList,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
import styles from '@/features/inventory/components/inventory-visual.module.css';
export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { member } = await requireMember();
  const { id } = await params;
  const query = await searchParams;
  const returnTo = inventoryReturnPath(query?.returnTo);
  const detail = await getAssetDetail(id);
  if (!detail) notFound();
  const { asset, location, site, history, duplicateSerialMatches } = detail;
  const [categories, locations, sites, forms] = await Promise.all([
    getCategories(),
    getLocations(),
    getSites(),
    getPublishedForms([asset.categoryId]),
  ]);
  return (
    <>
      <section className={`experience-surface-bright ${styles.detailHero}`}>
        <Link href={returnTo} className="text-sm text-cyan-200 underline">
          ←{' '}
          {returnTo === '/inventory' ? 'Back to inventory' : 'Back to results'}
        </Link>
        <div className={`${styles.detailHead} mt-4`}>
          <div className={styles.detailTitle}>
            <p className="experience-eyebrow">
              {asset.categoryName} · Individual asset
            </p>
            <h1 className="experience-heading mt-2">{asset.name}</h1>
            <p className="experience-muted mt-2 text-sm capitalize">
              <RecordStatus status={asset.status} />
            </p>
            <details className="mt-2 text-xs text-slate-400">
              <summary className="min-h-11 cursor-pointer py-2">
                Technical record details
              </summary>
              <p>Record version: {asset.version}</p>
            </details>
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
            <dd className="experience-code">{asset.assetTag || 'Not set'}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Serial number</dt>
            <dd className="experience-code">
              {asset.serialNumber || 'Not set'}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>
              {asset.status === 'retired'
                ? 'Last recorded custody'
                : 'Current custody'}
            </dt>
            <dd>
              {site ? (
                <Link
                  className="text-cyan-300 underline"
                  href={'/sites/' + encodeURIComponent(site.code)}
                >
                  {site.name} ({site.code})
                </Link>
              ) : location ? (
                <LocationLink location={location} />
              ) : (
                'No recorded storage or site assignment'
              )}
            </dd>
          </div>
        </dl>
      </section>
      {member.role === 'staff' && (
        <DetailTasks
          key={member.user_id + ':' + asset.id}
          actorId={member.user_id}
          backendScope={process.env.NEXT_PUBLIC_SUPABASE_URL}
          canManageConfiguration={member.can_manage_configuration}
          asset={asset}
          currentLocation={location}
          currentSite={
            site
              ? (sites.find((candidate) => candidate.id === site.id) ?? null)
              : null
          }
          categories={categories}
          locations={locations}
          sites={sites}
          forms={forms}
        />
      )}
      <div className={styles.recordGrid}>
        <div className={styles.recordMain}>
          <section className={panel + ' my-5'}>
            <h2 className="font-semibold">Asset details</h2>
            <dl className="mt-3 space-y-2 break-words">
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
            definition={forms[asset.categoryId]?.published_definition}
            kind="asset"
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
        </div>
        <aside className={styles.recordAside} aria-label="Record attachments">
          <FilesPanel
            actorId={member.user_id}
            parentType="asset"
            parentId={asset.id}
            parentName={asset.name}
            active={asset.status === 'active'}
            staff={member.role === 'staff'}
          />
        </aside>
      </div>
      <section className={styles.history} aria-label="Recent history">
        <h2 className="mb-3 text-xl font-semibold">Recent history</h2>
        <HistoryList events={history} compact linkToEvent />
      </section>
      <Link
        className="mt-4 inline-block min-h-11 py-3 text-cyan-300 underline"
        href={'/history?type=asset&entityId=' + asset.id}
      >
        View all asset history
      </Link>
    </>
  );
}

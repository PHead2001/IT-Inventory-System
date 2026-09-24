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
  HistoryList,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
export default async function AssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { member } = await requireMember();
  const { id } = await params;
  const detail = await getAssetDetail(id);
  if (!detail) notFound();
  const { asset, location, history, duplicateSerialMatches } = detail;
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  const forms = await getPublishedForms(
    categories.map((category) => category.id),
  );
  return (
    <>
      <Link href="/inventory" className="text-sm text-cyan-300 underline">
        Back to inventory
      </Link>
      <h1 className="mt-4 break-words text-3xl font-semibold">{asset.name}</h1>
      <Link
        className="mt-3 inline-block min-h-11 py-3 text-sm text-cyan-300 underline"
        href={'/labels?asset=' + encodeURIComponent(asset.id)}
      >
        Print asset label
      </Link>
      <p className="mt-2 text-slate-400">
        {asset.categoryName} · Serialized asset · {asset.status} · Version{' '}
        {asset.version}
      </p>
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
                  {match.name} ({match.assetTag || 'untagged'}, {match.status})
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <section className={panel + ' mb-6'}>
        <h2 className="mb-2 font-semibold">
          {asset.status === 'retired'
            ? 'Last known location'
            : 'Current location'}
        </h2>
        <LocationLink location={location} />
      </section>
      {member.role === 'staff' && (
        <section aria-label="Asset actions" className="mb-8 space-y-3">
          <h2 className="text-xl font-semibold">Manage serialized asset</h2>
          {(asset.status === 'retired'
            ? (['asset_update', 'asset_restore'] as const)
            : ([
                'asset_update',
                'asset_move',
                'asset_correct_location',
                'asset_retire',
              ] as const)
          ).map((operation) =>
            operation === 'asset_update' ? (
              <section key={operation} className={panel}>
                <h3 className="mb-4 text-lg font-semibold">
                  Edit asset metadata
                </h3>
                <MetadataForm
                  kind="asset"
                  asset={asset}
                  categories={categories}
                  locations={locations}
                  forms={forms}
                />
              </section>
            ) : (
              <OperationPanel
                key={operation}
                operation={operation}
                asset={asset}
                currentLocation={location}
                categories={categories}
                locations={locations}
              />
            ),
          )}
        </section>
      )}
      <h2 className="mb-3 text-xl font-semibold">Recent history</h2>
      <HistoryList events={history} />
      <Link
        className="mt-4 inline-block min-h-11 py-3 text-cyan-300 underline"
        href={'/history?type=asset&entityId=' + asset.id}
      >
        View all asset history
      </Link>
    </>
  );
}

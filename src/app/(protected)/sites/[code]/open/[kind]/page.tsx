import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { getSite } from '@/features/custody/queries.server';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function SiteOpeningPage({
  params,
}: {
  params: Promise<{ code: string; kind: string }>;
}) {
  const { member } = await requireMember();
  const { code, kind } = await params;
  const site = await getSite(code);
  if (!site || (kind !== 'quantity' && kind !== 'asset')) notFound();
  if (member.role !== 'staff')
    return (
      <p>
        Read-only access. Staff membership is required to record site holdings.
      </p>
    );
  if (!site.active)
    return (
      <p>This site is archived. Choose an active site for opening holdings.</p>
    );
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  const forms = await getPublishedForms(
    categories.map((category) => category.id),
  );
  return (
    <>
      <Link
        className="text-cyan-300 underline"
        href={`/sites/${encodeURIComponent(code)}`}
      >
        Back to {site.name}
      </Link>
      <h1 className="my-4 text-3xl font-semibold">
        Record existing{' '}
        {kind === 'asset' ? 'serialized asset' : 'quantity holding'} at{' '}
        {site.name}
      </h1>
      <p className="mb-5 text-slate-400">
        Use this only for equipment already at the site before it was recorded
        here. Ordinary future issues start from a real storage holding.
      </p>
      <div className={panel}>
        <MetadataForm
          kind={kind}
          categories={categories}
          locations={locations}
          forms={forms}
          openingSite={site}
        />
      </div>
    </>
  );
}

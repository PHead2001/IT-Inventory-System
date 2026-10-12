import { PrivateDocumentTitle } from '@/components/auth/private-document-title';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readSiteOpeningPage } from './read.server';
import { recordTitle } from '@/app/(protected)/record-title';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { panel } from '@/features/inventory/components/read-ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; kind: string }>;
}) {
  const { kind } = await params;
  return recordTitle(
    kind === 'quantity'
      ? 'Record existing quantity item'
      : kind === 'asset'
        ? 'Record existing individual asset'
        : 'Record existing equipment',
  );
}

export default async function SiteOpeningPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; kind: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const draft = typeof query?.draft === 'string' ? query.draft : undefined;
  const instance = draft ?? crypto.randomUUID();
  const { code, kind } = await params;
  if (kind !== 'quantity' && kind !== 'asset') notFound();
  const { member, site } = await readSiteOpeningPage(code);
  if (!site || (kind !== 'quantity' && kind !== 'asset')) notFound();
  if (member.role !== 'staff')
    return (
      <ProtectedPrivacyContent>
        <p className="experience-feedback" data-tone="error">
          Read-only access. Staff membership is required to record site
          holdings.
        </p>
      </ProtectedPrivacyContent>
    );
  if (!site.active)
    return (
      <ProtectedPrivacyContent>
        <p className="experience-feedback" data-tone="error">
          This site is archived. Choose an active site for opening holdings.
        </p>
      </ProtectedPrivacyContent>
    );
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  const initialCategory = categories.find((category) => category.active);
  const forms = initialCategory
    ? await getPublishedForms([initialCategory.id])
    : {};
  return (
    <ProtectedPrivacyContent>
      <PrivateDocumentTitle
        routePath={`/sites/${encodeURIComponent(code)}/open/${kind}`}
        title={
          recordTitle(
            `Record existing ${kind === 'asset' ? 'individual asset' : 'quantity item'} at ${site.name}`,
          ).title.absolute
        }
      />
      <>
        <Link
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
          href={`/sites/${encodeURIComponent(code)}`}
        >
          Back to {site.name}
        </Link>
        <p className="experience-eyebrow mt-3">Site / Opening record</p>
        <h1 className="experience-heading my-3 break-words">
          Record existing{' '}
          {kind === 'asset' ? 'individual asset' : 'quantity item'} at{' '}
          {site.name}
        </h1>
        <p className="mb-5 max-w-3xl text-sm leading-6 text-slate-300">
          Use this only for equipment already at the site before it was recorded
          here. Ordinary future issues start from a real storage holding.
        </p>
        <div className={panel + ' max-w-5xl'}>
          <MetadataForm
            key={`${member.user_id}:${site.id}:${kind}:${instance}`}
            creationInstanceId={instance}
            creationDraftId={draft}
            recoveryBackend={process.env.NEXT_PUBLIC_SUPABASE_URL}
            actorId={member.user_id}
            kind={kind}
            categories={categories}
            locations={locations}
            forms={forms}
            openingSite={site}
          />
        </div>
      </>
    </ProtectedPrivacyContent>
  );
}

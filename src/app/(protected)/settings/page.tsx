import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { redirect } from 'next/navigation';
import { MotionToggle } from '@/components/experience/motion-preference';
import { BuildInfo } from '@/features/build-info/build-info';
import { readBuildProvenance } from '@/features/build-info/read.server';

const sections = [
  {
    href: '/settings/categories',
    title: 'Categories',
    description: 'Add, rename, remove, and edit a category form.',
  },
  {
    href: '/settings/forms',
    title: 'Forms & fields',
    description: 'Choose a category to design its inventory form.',
  },
  {
    href: '/settings/locations',
    title: 'Storage locations',
    description: 'Manage logical inventory destinations.',
  },
  {
    href: '/settings/sites',
    title: 'Properties & sites',
    description: 'Configure properties and site codes.',
  },
  {
    href: '/settings/labels',
    title: 'Labels & printing',
    description: 'Set shared print defaults.',
  },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    category?: string | string[];
    categoryId?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const legacyCategory = params?.categoryId ?? params?.category;
  if (
    typeof legacyCategory === 'string' &&
    /^[0-9a-f-]{36}$/i.test(legacyCategory)
  ) {
    redirect(`/settings/forms/${encodeURIComponent(legacyCategory)}`);
  }
  return (
    <ProtectedPrivacyContent>
      <RouteReady {...await routeReadyProps('/settings', searchParams)}>
        <div className="space-y-6">
          <div>
            <p className="experience-eyebrow">Workspace · Configuration</p>
            <h1 className="experience-heading mt-3">Settings</h1>
            <p className="experience-muted mt-2 text-sm">
              Choose the configuration area you need.
            </p>
          </div>
          <section
            aria-labelledby="appearance-heading"
            className="experience-surface p-5 space-y-3"
          >
            <h2 id="appearance-heading" className="text-lg font-semibold">
              Appearance & preferences
            </h2>
            <p className="experience-muted text-sm">
              Motion is your personal preference for this browser. Your
              system&apos;s reduced-motion preference always applies.
            </p>
            <MotionToggle />
          </section>
          <ul className="grid gap-3 md:grid-cols-2">
            {sections.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="experience-surface block h-full min-w-0 p-5 transition-colors hover:border-cyan-400/60 hover:bg-slate-800/70 focus-visible:outline-2 focus-visible:outline-cyan-300"
                >
                  <span className="block text-lg font-semibold text-cyan-200">
                    {section.title}
                  </span>
                  <span className="experience-muted mt-1 block text-sm">
                    {section.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <BuildInfo provenance={readBuildProvenance()} />
        </div>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}

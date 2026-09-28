import Link from 'next/link';
import { redirect } from 'next/navigation';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="mt-2 text-slate-400">
          Choose the configuration area you need.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-lg border border-slate-700 p-5 hover:border-cyan-500 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-cyan-300"
            >
              <span className="block text-lg font-semibold text-cyan-200">
                {section.title}
              </span>
              <span className="mt-1 block text-sm text-slate-300">
                {section.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

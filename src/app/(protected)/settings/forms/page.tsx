import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { getConfigurationCategories } from '@/features/configuration/queries.server';

export default async function FormsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const { categories, canManage } = await getConfigurationCategories();
  const active = categories.filter(
    (category) => category.active && !category.removed_at,
  );
  return (
    <RouteReady {...await routeReadyProps('/settings/forms', searchParams)}>
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Forms & fields</h1>
        {!canManage && (
          <p
            role="note"
            className="rounded border border-slate-700 p-4 text-sm text-slate-300"
          >
            Form editing requires an active staff membership with configuration
            access. Ask the application owner if you need that access.
          </p>
        )}
        <p className="text-slate-400">
          Select a category to open its form designer.
        </p>
        {active.length === 0 && (
          <p>No active category is available. Add one in Categories first.</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((category) => (
            <li key={category.id}>
              <Link
                href={`/settings/forms/${encodeURIComponent(category.id)}`}
                className="block rounded border border-slate-700 p-4 text-cyan-200 hover:border-cyan-500 focus-visible:outline-2 focus-visible:outline-cyan-300"
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </RouteReady>
  );
}

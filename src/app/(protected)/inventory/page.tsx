import { requireMember } from '@/lib/auth/session.server';
export default async function InventoryPage() {
  const { supabase } = await requireMember();
  const [categories, locations] = await Promise.all([
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase
      .from('locations')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .eq('can_hold_inventory', true),
  ]);
  if (categories.error || locations.error)
    throw new Error('Reference data unavailable');
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        Foundation · PR 1
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Inventory workspace</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-400">
        The secure application foundation is ready. Inventory records, search,
        and movement workflows will be added in the next implementation phase.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="text-sm text-slate-400">
            Configured storage destinations
          </h2>
          <p className="mt-3 text-4xl font-semibold">{locations.count}</p>
          <p className="mt-2 text-sm text-slate-500">
            Logical locations in the IT Closet
          </p>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="text-sm text-slate-400">Reference categories</h2>
          <p className="mt-3 text-4xl font-semibold">{categories.count}</p>
          <p className="mt-2 text-sm text-slate-500">
            Shared classification for future inventory
          </p>
        </section>
      </div>
      <section className="mt-6 rounded-xl border border-dashed border-slate-700 p-6">
        <h2 className="font-semibold">Inventory workflows are coming next</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Quantity stock and individually tracked assets are not implemented in
          this foundation release.
        </p>
      </section>
    </>
  );
}

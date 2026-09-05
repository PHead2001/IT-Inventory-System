import { requireMember } from '@/lib/auth/session.server';
import { loadItCloset } from '@/features/room/load';
export default async function RoomPage() {
  await requireMember();
  const room = loadItCloset();
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        IT Closet
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Room navigation</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-400">
        The measured room definition and logical location bindings are in place.
        The interactive 2.5D viewer will be implemented in a later phase.
      </p>
      <section className="mt-8 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-6">
        <h2 className="font-semibold">Room viewer not yet available</h2>
        <p className="mt-3 text-sm text-slate-400">
          Room dimensions: {room.dimensions.join(' × ')} inches. Inventory
          relationships use stable location codes and remain independent of
          visual layout.
        </p>
      </section>
    </>
  );
}

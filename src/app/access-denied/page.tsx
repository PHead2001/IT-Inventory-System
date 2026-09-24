import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
export const dynamic = 'force-dynamic';
export default function AccessDeniedPage() {
  return (
    <main className="mx-auto max-w-lg p-6 pt-20">
      <p className="text-sm font-semibold text-cyan-300">IT INVENTORY</p>
      <h1 className="mt-4 text-3xl font-semibold">Access is not enabled</h1>
      <p className="my-6 leading-7 text-slate-400">
        Your account does not have an active application membership. Contact the
        application owner to request access.
      </p>
      <QueueLogoutForm />
    </main>
  );
}

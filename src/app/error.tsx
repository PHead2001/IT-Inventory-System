'use client';
import { Button } from '@/components/ui/button';
import { RoutePendingTerminal } from '@/components/experience/route-pending';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg p-8">
      <RoutePendingTerminal />
      <h1 className="text-2xl font-semibold">Unable to load this page</h1>
      <p className="my-4 text-slate-400">
        The service may be unavailable. Your access has not changed.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}

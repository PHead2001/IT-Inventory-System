'use client';
import { useRouteTransition } from '@/components/experience/route-pending';
import { useRouteRouter as useRouter } from '@/components/experience/route-pending';

import { Button } from '@/components/ui/button';

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useRouteTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'Refreshing…' : 'Refresh overview'}
    </Button>
  );
}

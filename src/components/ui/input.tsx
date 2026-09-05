import * as React from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30',
        className,
      )}
      {...props}
    />
  );
}

import * as React from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-[9px] border border-slate-600 bg-[#0a1725] px-3 py-2 text-base text-[#e8f4ff] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/25',
        className,
      )}
      {...props}
    />
  );
}

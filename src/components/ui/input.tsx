import * as React from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-[9px] border border-[color:var(--input-border)] bg-[var(--workspace-field-background)] px-3 py-2 text-base text-[color:var(--foreground)] outline-none transition-[border-color,box-shadow] duration-[var(--motion-feedback)] ease-[var(--ease-workspace)] placeholder:text-[color:var(--input-placeholder)] focus-visible:border-[color:var(--input-focus-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--input-focus-ring)]',
        className,
      )}
      {...props}
    />
  );
}

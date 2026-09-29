import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-4 py-2 text-sm font-semibold transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:pointer-events-none disabled:opacity-50 disabled:transform-none',
  {
    variants: {
      variant: {
        default:
          'border border-cyan-200/60 bg-cyan-300 text-slate-950 shadow-[0_0_24px_#50def224] hover:bg-cyan-200',
        outline:
          'border border-slate-600 bg-[#172b40] text-slate-100 hover:border-cyan-300/60 hover:bg-[#203a51]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp className={cn(buttonVariants({ variant, className }))} {...props} />
  );
}

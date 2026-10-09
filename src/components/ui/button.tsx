import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-4 py-2 text-sm font-semibold experience-interactive hover:-translate-y-px active:translate-y-0 active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--control-focus-outline)] disabled:pointer-events-none disabled:opacity-50 disabled:transform-none',
  {
    variants: {
      variant: {
        default:
          'border border-[color:var(--button-primary-border)] bg-[var(--button-primary-background)] text-[color:var(--button-primary-text)] shadow-[0_0_24px_var(--button-primary-shadow)] hover:bg-[var(--button-primary-hover-background)]',
        outline:
          'border border-[color:var(--button-outline-border)] bg-[var(--workspace-feedback-background)] text-[color:var(--button-outline-text)] hover:border-[color:var(--button-outline-hover-border)] hover:bg-[var(--button-outline-hover-background)]',
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

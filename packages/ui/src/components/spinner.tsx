import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** Accessible loading indicator; pass a translated label for screen readers. */
function Spinner({ className, label, ...props }: ComponentProps<'svg'> & { label?: string }) {
  return (
    <svg
      className={cn('size-5 animate-spin text-muted-foreground', className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export { Spinner };

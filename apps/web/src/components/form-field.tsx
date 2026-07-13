'use client';

import { Input, Label } from '@businessos/ui';
import type { ComponentProps } from 'react';

interface TextFieldProps extends ComponentProps<typeof Input> {
  id: string;
  label: string;
  error?: string;
}

/** Label + input + inline error with the aria wiring done once. */
export function TextField({ id, label, error, ...props }: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

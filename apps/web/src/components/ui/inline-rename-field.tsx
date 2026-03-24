import * as React from 'react';

import { cn } from '@/lib/utils';

type InlineRenameFieldProps = Omit<React.ComponentProps<'input'>, 'className'> & {
  invalid?: boolean;
  className?: string;
  inputClassName?: string;
};

const InlineRenameField = React.forwardRef<HTMLInputElement, InlineRenameFieldProps>(
  ({ invalid = false, className, inputClassName, ...props }, ref) => (
    <div className={cn('group relative flex min-w-0 items-center', className)}>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-[-6px] inset-y-[-3px] rounded-md border bg-background/95 shadow-xs transition-colors',
          invalid ? 'border-red-500' : 'border-border/80 group-focus-within:border-ring',
        )}
      />
      <input
        ref={ref}
        {...props}
        className={cn(
          'relative z-10 block w-full min-w-0 border-0 bg-transparent p-0 text-xs leading-4 text-foreground outline-none',
          inputClassName,
        )}
      />
    </div>
  ),
);

InlineRenameField.displayName = 'InlineRenameField';

export { InlineRenameField };

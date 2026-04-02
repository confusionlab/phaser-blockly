import * as React from 'react';

import { cn } from '@/lib/utils';

type InlineRenameFieldFocusBehavior = 'none' | 'select-all' | 'caret-end';

type InlineRenameFieldProps = Omit<React.ComponentProps<'input'>, 'className'> & {
  editing?: boolean;
  invalid?: boolean;
  className?: string;
  textClassName?: string;
  inputClassName?: string;
  outlineClassName?: string;
  displayValue?: React.ReactNode;
  displayAs?: 'div' | 'span';
  displayProps?: React.HTMLAttributes<HTMLElement>;
  focusBehavior?: InlineRenameFieldFocusBehavior;
};

const InlineRenameField = React.forwardRef<HTMLInputElement, InlineRenameFieldProps>(
  ({
    editing = true,
    invalid = false,
    className,
    textClassName,
    inputClassName,
    outlineClassName,
    displayValue,
    displayAs = 'span',
    displayProps,
    focusBehavior = 'select-all',
    autoFocus,
    value,
    ...props
  }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => inputRef.current!, []);

    React.useLayoutEffect(() => {
      if (!editing || !autoFocus) {
        return;
      }

      const input = inputRef.current;
      if (!input) {
        return;
      }

      const applyFocusBehavior = () => {
        input.focus({ preventScroll: true });
        if (focusBehavior === 'select-all') {
          input.select();
          return;
        }
        if (focusBehavior === 'caret-end') {
          const caretIndex = input.value.length;
          input.setSelectionRange(caretIndex, caretIndex);
        }
      };

      applyFocusBehavior();
      queueMicrotask(applyFocusBehavior);
    }, [autoFocus, editing, focusBehavior]);

    const displayClassName = cn(
      'relative z-10 block min-w-0 flex-1',
      textClassName,
      displayProps?.className,
    );

    return (
      <div className={cn('group/rename relative flex min-w-0 items-center', className)}>
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-[-6px] inset-y-[-3px] rounded-md border bg-surface-floating shadow-xs transition-[border-color,opacity]',
            outlineClassName,
            editing
              ? (invalid ? 'border-destructive opacity-100' : 'border-border/80 opacity-100 group-focus-within/rename:border-ring')
              : 'border-border/70 opacity-0',
          )}
        />
        {editing ? (
          <input
            ref={inputRef}
            {...props}
            value={value}
            autoFocus={autoFocus}
            className={cn(
              'relative z-10 block w-full min-w-0 border-0 bg-transparent p-0 text-xs leading-4 text-foreground outline-none',
              textClassName,
              inputClassName,
            )}
          />
        ) : React.createElement(
          displayAs,
          {
            ...displayProps,
            className: displayClassName,
          },
          displayValue ?? value,
        )}
      </div>
    );
  },
);

InlineRenameField.displayName = 'InlineRenameField';

export { InlineRenameField };

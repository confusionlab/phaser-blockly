'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
};

type SegmentedControlProps<T extends string> = Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  ariaLabel: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  optionClassName?: string;
};

export function SegmentedControl<T extends string>({
  ariaLabel,
  className,
  onValueChange,
  optionClassName,
  options,
  style,
  value,
  ...props
}: SegmentedControlProps<T>) {
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndices = React.useMemo(
    () => options.reduce<number[]>((indices, option, index) => {
      if (!option.disabled) {
        indices.push(index);
      }
      return indices;
    }, []),
    [options],
  );

  if (options.length === 0) {
    return null;
  }

  const matchedIndex = options.findIndex((option) => option.value === value);
  const activeIndex = matchedIndex >= 0 && !options[matchedIndex]?.disabled
    ? matchedIndex
    : (enabledIndices[0] ?? 0);

  const thumbStyle: React.CSSProperties = {
    width: `calc((100% - 0.25rem) / ${options.length})`,
    transform: `translateX(calc(${activeIndex} * 100%))`,
  };

  const moveSelection = React.useCallback((targetIndex: number) => {
    const nextOption = options[targetIndex];
    if (!nextOption || nextOption.disabled) {
      return;
    }

    onValueChange(nextOption.value);
    optionRefs.current[targetIndex]?.focus();
  }, [onValueChange, options]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (enabledIndices.length === 0) {
      return;
    }

    const currentEnabledIndex = Math.max(
      enabledIndices.findIndex((index) => index === activeIndex),
      0,
    );

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        const nextEnabledIndex = (currentEnabledIndex + 1) % enabledIndices.length;
        moveSelection(enabledIndices[nextEnabledIndex]!);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        const nextEnabledIndex = (currentEnabledIndex - 1 + enabledIndices.length) % enabledIndices.length;
        moveSelection(enabledIndices[nextEnabledIndex]!);
        break;
      }
      case 'Home':
        event.preventDefault();
        moveSelection(enabledIndices[0]!);
        break;
      case 'End':
        event.preventDefault();
        moveSelection(enabledIndices[enabledIndices.length - 1]!);
        break;
      default:
        break;
    }
  }, [activeIndex, enabledIndices, moveSelection]);

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-grid w-full items-center rounded-[12px] bg-zinc-100 p-[2px] dark:bg-zinc-950',
        className,
      )}
      style={{
        ...style,
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[2px] left-[2px] rounded-[10px] border border-transparent bg-white shadow-[0_6px_14px_-14px_rgba(15,23,42,0.7),0_1px_3px_rgba(15,23,42,0.1)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-white/14 dark:bg-zinc-700 dark:shadow-[0_16px_32px_-18px_rgba(0,0,0,0.92),0_2px_6px_rgba(0,0,0,0.5)]"
        style={thumbStyle}
      />

      {options.map((option, index) => {
        const isActive = index === activeIndex;

        return (
          <button
            key={option.value}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={option.disabled}
            data-state={isActive ? 'active' : 'inactive'}
            tabIndex={isActive ? 0 : -1}
            className={cn(
              'relative z-10 flex min-h-[23px] min-w-0 items-center justify-center gap-1 rounded-[10px] px-2 py-0 text-[12px] font-medium tracking-[-0.01em] text-zinc-500 transition-[color,opacity] duration-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/65 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-offset-zinc-950 data-[state=active]:text-zinc-950 dark:data-[state=active]:text-white disabled:cursor-not-allowed disabled:text-zinc-300 dark:disabled:text-zinc-600',
              optionClassName,
            )}
            onClick={() => onValueChange(option.value)}
            onKeyDown={handleKeyDown}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

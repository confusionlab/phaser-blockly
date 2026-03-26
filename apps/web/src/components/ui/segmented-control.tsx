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
  layout?: 'fill' | 'content';
};

export function SegmentedControl<T extends string>({
  ariaLabel,
  className,
  layout = 'fill',
  onValueChange,
  optionClassName,
  options,
  style,
  value,
  ...props
}: SegmentedControlProps<T>) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [thumbMetrics, setThumbMetrics] = React.useState({ left: 0, width: 0 });

  const enabledIndices = React.useMemo(
    () => options.reduce<number[]>((indices, option, index) => {
      if (!option.disabled) {
        indices.push(index);
      }
      return indices;
    }, []),
    [options],
  );

  const matchedIndex = options.findIndex((option) => option.value === value);
  const activeIndex = matchedIndex >= 0 && !options[matchedIndex]?.disabled
    ? matchedIndex
    : (enabledIndices[0] ?? 0);

  const updateThumbMetrics = React.useCallback(() => {
    if (layout !== 'content') {
      return;
    }

    const activeNode = optionRefs.current[activeIndex];
    if (!activeNode) {
      return;
    }

    const nextMetrics = {
      left: activeNode.offsetLeft,
      width: activeNode.offsetWidth,
    };

    setThumbMetrics((current) => (
      current.left === nextMetrics.left && current.width === nextMetrics.width
        ? current
        : nextMetrics
    ));
  }, [activeIndex, layout]);

  React.useLayoutEffect(() => {
    if (layout !== 'content') {
      return;
    }

    updateThumbMetrics();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          updateThumbMetrics();
        })
      : null;

    if (resizeObserver) {
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      optionRefs.current.forEach((node) => {
        if (node) {
          resizeObserver.observe(node);
        }
      });
    }

    window.addEventListener('resize', updateThumbMetrics);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateThumbMetrics);
    };
  }, [layout, options.length, updateThumbMetrics]);

  if (options.length === 0) {
    return null;
  }

  const containerSizeClassName = 'h-[calc(var(--editor-panel-header-height)-4px)] rounded-[10px] p-[2px]';
  const thumbClassName = 'inset-y-[2px] rounded-[8px]';
  const optionSizeClassName = 'h-full min-h-0 gap-1.5 rounded-[8px] px-3 py-0 text-[13px]';

  const thumbStyle: React.CSSProperties = layout === 'content'
    ? {
        left: thumbMetrics.left,
        width: thumbMetrics.width,
      }
    : {
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
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-grid max-w-full items-center bg-zinc-100 dark:bg-zinc-950',
        containerSizeClassName,
        layout === 'fill' ? 'w-full' : 'w-fit',
        className,
      )}
      style={{
        ...style,
        gridTemplateColumns: layout === 'content'
          ? `repeat(${options.length}, auto)`
          : `repeat(${options.length}, minmax(0, 1fr))`,
      }}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute border border-transparent bg-white duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-white/14 dark:bg-zinc-700 dark:shadow-[0_16px_32px_-18px_rgba(0,0,0,0.92),0_2px_6px_rgba(0,0,0,0.5)]',
          thumbClassName,
          layout === 'content'
            ? 'transition-[left,width] shadow-[0_6px_14px_-14px_rgba(15,23,42,0.7),0_1px_3px_rgba(15,23,42,0.1)]'
            : 'left-[2px] shadow-[0_6px_14px_-14px_rgba(15,23,42,0.7),0_1px_3px_rgba(15,23,42,0.1)] transition-transform',
        )}
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
              'relative z-10 flex min-w-0 items-center justify-center font-medium tracking-[-0.01em] text-zinc-500 transition-[color,opacity] duration-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/65 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-offset-zinc-950 data-[state=active]:text-zinc-950 dark:data-[state=active]:text-white disabled:cursor-not-allowed disabled:text-zinc-300 dark:disabled:text-zinc-600',
              optionSizeClassName,
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

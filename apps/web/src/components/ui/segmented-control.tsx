'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconOnly?: boolean;
};

type SegmentedControlProps<T extends string> = Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  ariaLabel: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  optionClassName?: string;
  layout?: 'fill' | 'content';
  size?: 'compact' | 'expanded';
};

export function SegmentedControl<T extends string>({
  ariaLabel,
  className,
  layout = 'fill',
  onValueChange,
  optionClassName,
  options,
  size,
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
  const isExpanded = size === 'expanded' || (size === undefined && options.some((option) => option.description));

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

  const containerSizeClassName = isExpanded
    ? 'min-h-[3.5rem] rounded-xl p-[3px]'
    : 'h-8 rounded-[10px] p-[2px]';
  const thumbClassName = isExpanded
    ? 'inset-y-[3px] rounded-[10px]'
    : 'inset-y-[2px] rounded-[8px]';
  const optionSizeClassName = isExpanded
    ? 'h-full min-h-[3.125rem] rounded-[10px] px-3 py-2 text-[12px]'
    : 'h-full min-h-0 gap-1.5 rounded-[8px] px-3 py-0 text-[13px]';
  const fillThumbInsetPx = isExpanded ? 3 : 2;

  const thumbStyle: React.CSSProperties = layout === 'content'
    ? {
        left: thumbMetrics.left,
        width: thumbMetrics.width,
      }
    : {
        left: fillThumbInsetPx,
        width: `calc((100% - ${fillThumbInsetPx * 2}px) / ${options.length})`,
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

  if (options.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-grid max-w-full items-center bg-surface-subtle',
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
          'pointer-events-none absolute border border-border/70 bg-surface-control-active duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:shadow-[0_16px_32px_-18px_rgba(0,0,0,0.92),0_2px_6px_rgba(0,0,0,0.5)]',
          thumbClassName,
          layout === 'content'
            ? 'transition-[left,width] shadow-[0_6px_14px_-14px_rgba(15,23,42,0.7),0_1px_3px_rgba(15,23,42,0.1)]'
            : 'shadow-[0_6px_14px_-14px_rgba(15,23,42,0.7),0_1px_3px_rgba(15,23,42,0.1)] transition-transform',
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
            aria-label={option.iconOnly ? option.label : undefined}
            aria-checked={isActive}
            disabled={option.disabled}
            data-state={isActive ? 'active' : 'inactive'}
            tabIndex={isActive ? 0 : -1}
            title={option.iconOnly ? option.label : undefined}
            className={cn(
              'relative z-10 flex min-w-0 font-medium tracking-[-0.01em] text-muted-foreground transition-[color,opacity] duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/65 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel data-[state=active]:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/55',
              isExpanded ? 'flex-col items-start justify-center gap-0.5 text-left' : 'items-center justify-center',
              optionSizeClassName,
              optionClassName,
            )}
            onClick={() => onValueChange(option.value)}
            onKeyDown={handleKeyDown}
          >
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5',
                isExpanded ? 'w-full' : '',
                option.iconOnly && 'justify-center',
              )}
            >
              {option.icon}
              <span className={cn(option.iconOnly ? 'sr-only' : 'truncate')}>{option.label}</span>
            </span>
            {isExpanded && option.description ? (
              <span className="w-full text-left text-[10px] font-normal leading-[1.25] text-zinc-500/90 dark:text-zinc-400/90">
                {option.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

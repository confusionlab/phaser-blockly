import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

const toolbarSliderThumbClassName =
  'block size-4 rounded-full border border-primary/50 bg-background shadow transition-colors';
const toolbarSliderTrackClassName = 'relative h-1.5 w-full grow rounded-full bg-secondary';
const toolbarSliderRangeClassName = 'absolute h-full rounded-full bg-primary';

interface FloatingToolbarSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  className?: string;
  thumbClassName?: string;
  onValueCommit?: () => void;
  onPointerDownCapture?: () => void;
  onFocusCapture?: () => void;
  onBlurCapture?: () => void;
}

export function FloatingToolbarSlider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className,
  thumbClassName,
  onValueCommit,
  onPointerDownCapture,
  onFocusCapture,
  onBlurCapture,
}: FloatingToolbarSliderProps) {
  const [isFocused, setIsFocused] = useState(false);
  const clampedValue = useMemo(() => {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }, [max, min, value]);
  const progressPercent = useMemo(() => {
    if (max <= min) {
      return 0;
    }
    return ((clampedValue - min) / (max - min)) * 100;
  }, [clampedValue, max, min]);

  const commitValue = () => {
    onValueCommit?.();
  };

  return (
    <div
      className={cn('relative flex h-4 w-full touch-none items-center', className)}
    >
      <div className={cn(toolbarSliderTrackClassName, 'pointer-events-none')} />
      <div
        className={cn(
          toolbarSliderRangeClassName,
          'pointer-events-none left-0 top-1/2 h-1.5 -translate-y-1/2',
        )}
        style={{ width: `${progressPercent}%` }}
      />
      <div
        className={cn(
          toolbarSliderThumbClassName,
          'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2',
          isFocused && 'ring-1 ring-ring',
          thumbClassName,
        )}
        style={{ left: `${progressPercent}%` }}
      />
      <input
        type="range"
        className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        value={clampedValue}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onValueChange(Number(event.currentTarget.value))}
        onPointerDownCapture={onPointerDownCapture}
        onPointerUp={commitValue}
        onKeyUp={commitValue}
        onFocusCapture={() => {
          setIsFocused(true);
          onFocusCapture?.();
        }}
        onBlurCapture={() => {
          setIsFocused(false);
          onBlurCapture?.();
        }}
      />
    </div>
  );
}

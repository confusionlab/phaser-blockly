import { useCallback, useMemo, useRef, useState } from 'react';
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
  onValueCommit?: (value: number) => void;
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
  const latestValueRef = useRef(value);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const clampedValue = useMemo(() => {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }, [max, min, value]);
  latestValueRef.current = clampedValue;
  const progressPercent = useMemo(() => {
    if (max <= min) {
      return 0;
    }
    return ((clampedValue - min) / (max - min)) * 100;
  }, [clampedValue, max, min]);

  const normalizeValue = useCallback((nextValue: number) => {
    if (!Number.isFinite(nextValue)) {
      return min;
    }
    const clamped = Math.max(min, Math.min(max, nextValue));
    if (!Number.isFinite(step) || step <= 0) {
      return clamped;
    }
    const stepped = Math.round((clamped - min) / step) * step + min;
    return Math.max(min, Math.min(max, stepped));
  }, [max, min, step]);

  const previewValue = useCallback((nextValue: number) => {
    const normalized = normalizeValue(nextValue);
    latestValueRef.current = normalized;
    onValueChange(normalized);
  }, [normalizeValue, onValueChange]);

  const commitValue = useCallback((nextValue?: number) => {
    onValueCommit?.(typeof nextValue === 'number' ? normalizeValue(nextValue) : latestValueRef.current);
  }, [normalizeValue, onValueCommit]);

  const getValueFromClientX = useCallback((clientX: number) => {
    const slider = sliderRef.current;
    if (!slider) {
      return latestValueRef.current;
    }
    const rect = slider.getBoundingClientRect();
    if (rect.width <= 0 || max <= min) {
      return latestValueRef.current;
    }
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return min + percent * (max - min);
  }, [max, min]);

  const adjustValueByStep = useCallback((direction: -1 | 1, multiplier = 1) => {
    const delta = (!Number.isFinite(step) || step <= 0 ? 1 : step) * multiplier * direction;
    return normalizeValue(latestValueRef.current + delta);
  }, [normalizeValue, step]);

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
      <div
        ref={sliderRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clampedValue}
        aria-orientation="horizontal"
        className="absolute inset-0 cursor-pointer touch-none outline-none"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          dragPointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          onPointerDownCapture?.();
          previewValue(getValueFromClientX(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragPointerIdRef.current !== event.pointerId) {
            return;
          }
          previewValue(getValueFromClientX(event.clientX));
        }}
        onPointerUp={(event) => {
          if (dragPointerIdRef.current !== event.pointerId) {
            return;
          }
          dragPointerIdRef.current = null;
          previewValue(getValueFromClientX(event.clientX));
          event.currentTarget.releasePointerCapture(event.pointerId);
          commitValue();
        }}
        onPointerCancel={(event) => {
          if (dragPointerIdRef.current !== event.pointerId) {
            return;
          }
          dragPointerIdRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          let nextValue: number | null = null;
          switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
              nextValue = adjustValueByStep(-1);
              break;
            case 'ArrowRight':
            case 'ArrowUp':
              nextValue = adjustValueByStep(1);
              break;
            case 'PageDown':
              nextValue = adjustValueByStep(-1, 10);
              break;
            case 'PageUp':
              nextValue = adjustValueByStep(1, 10);
              break;
            case 'Home':
              nextValue = min;
              break;
            case 'End':
              nextValue = max;
              break;
            default:
              return;
          }
          event.preventDefault();
          previewValue(nextValue);
        }}
        onKeyUp={(event) => {
          if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowDown' ||
            event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' ||
            event.key === 'PageDown' ||
            event.key === 'PageUp' ||
            event.key === 'Home' ||
            event.key === 'End'
          ) {
            commitValue();
          }
        }}
        onFocusCapture={() => {
          setIsFocused(true);
          onFocusCapture?.();
        }}
        onBlurCapture={() => {
          setIsFocused(false);
          dragPointerIdRef.current = null;
          onBlurCapture?.();
        }}
      />
    </div>
  );
}

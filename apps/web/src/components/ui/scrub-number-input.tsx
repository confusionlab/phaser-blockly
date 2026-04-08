import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { cn } from '@/lib/utils';

export interface ScrubNumberInputProps {
  label: string;
  value: number;
  onChange?: (value: number, source?: 'input' | 'drag', delta?: number) => void;
  onCommit?: (value: number, source: 'drag') => void;
  className?: string;
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  suffix?: string;
  mixed?: boolean;
  disabled?: boolean;
  density?: 'default' | 'compact';
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function ScrubNumberInput({
  label,
  value,
  onChange,
  onCommit,
  className,
  step = 1,
  precision = 2,
  min,
  max,
  suffix = '',
  mixed = false,
  disabled = false,
  density = 'default',
  onDragStart,
  onDragEnd,
}: ScrubNumberInputProps) {
  const [localValue, setLocalValue] = useState(mixed ? 'multiple' : value.toFixed(precision));
  const [isDragging, setIsDragging] = useState(false);
  const [isAltHover, setIsAltHover] = useState(false);
  const startXRef = useRef(0);
  const startValueRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isHoveringRef = useRef(false);
  const dragValueRef = useRef(value);
  const dragDeltaRef = useRef(0);
  const dragDidChangeRef = useRef(false);

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(mixed ? 'multiple' : value.toFixed(precision));
    }
  }, [value, precision, mixed, isDragging]);

  useEffect(() => {
    if (disabled) {
      setIsAltHover(false);
      isHoveringRef.current = false;
    }
  }, [disabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && isHoveringRef.current && !disabled) {
        setIsAltHover(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltHover(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [disabled]);

  const clampValue = useCallback((nextValue: number) => {
    let resolvedValue = nextValue;
    if (min !== undefined) {
      resolvedValue = Math.max(min, resolvedValue);
    }
    if (max !== undefined) {
      resolvedValue = Math.min(max, resolvedValue);
    }
    return Number(resolvedValue.toFixed(precision));
  }, [max, min, precision]);

  const handleMouseEnter = useCallback(() => {
    if (disabled) {
      return;
    }
    isHoveringRef.current = true;
  }, [disabled]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    setIsAltHover(false);
  }, []);

  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled || !event.altKey) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
    startXRef.current = event.clientX;
    startValueRef.current = value;
    dragValueRef.current = value;
    dragDeltaRef.current = 0;
    dragDidChangeRef.current = false;
    onDragStart?.();
    document.body.style.cursor = 'ew-resize';
  }, [disabled, onDragStart, value]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - startXRef.current;
      const sensitivity = event.shiftKey ? 0.1 : 1;
      const nextValue = clampValue(startValueRef.current + (deltaX * step * sensitivity));
      const delta = Number((nextValue - startValueRef.current).toFixed(precision));

      dragValueRef.current = nextValue;
      dragDeltaRef.current = delta;
      dragDidChangeRef.current = dragDidChangeRef.current || nextValue !== startValueRef.current;
      setLocalValue(nextValue.toFixed(precision));
      onChange?.(nextValue, 'drag', delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (dragDidChangeRef.current) {
        onCommit?.(dragValueRef.current, 'drag');
      }
      onDragEnd?.();
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clampValue, isDragging, onChange, onCommit, onDragEnd, precision, step]);

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = suffix ? event.target.value.replace(suffix, '') : event.target.value;
    setLocalValue(nextValue);
  }, [suffix]);

  const handleFocus = useCallback(() => {
    if (mixed) {
      setLocalValue('');
    }
  }, [mixed]);

  const handleBlur = useCallback(() => {
    const trimmed = localValue.trim();
    if (!trimmed || trimmed.toLowerCase() === 'multiple') {
      setLocalValue(mixed ? 'multiple' : value.toFixed(precision));
      return;
    }

    const parsedValue = Number.parseFloat(trimmed);
    if (Number.isNaN(parsedValue)) {
      setLocalValue(mixed ? 'multiple' : value.toFixed(precision));
      return;
    }

    const resolvedValue = clampValue(parsedValue);
    onChange?.(resolvedValue, 'input');
    setLocalValue(resolvedValue.toFixed(precision));
  }, [clampValue, localValue, mixed, onChange, precision, value]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      inputRef.current?.blur();
    }
  }, []);

  const densityClassName = density === 'compact'
    ? 'h-8 gap-2 rounded-md px-2.5 py-1.5'
    : 'gap-2 rounded-lg px-3 py-2';

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-1 items-center border border-border/70 bg-surface-interactive shadow-none transition-colors duration-150 hover:bg-surface-interactive-hover focus-within:bg-surface-interactive-hover',
        densityClassName,
        isDragging && 'ring-1 ring-primary',
        !isDragging && 'focus-within:ring-1 focus-within:ring-primary/40',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
      style={{ cursor: !disabled && (isAltHover || isDragging) ? 'ew-resize' : undefined }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="shrink-0 select-none text-xs text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={localValue === 'multiple' ? localValue : localValue + suffix}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="w-0 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none disabled:cursor-not-allowed"
        style={{ cursor: !disabled && (isAltHover || isDragging) ? 'ew-resize' : 'text' }}
      />
    </div>
  );
}

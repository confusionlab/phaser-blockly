import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Color from 'color';

import { AnchoredPopupSurface } from '@/components/editors/shared/AnchoredPopupSurface';
import { CompactColorPicker } from '@/components/ui/color-picker';
import {
  getBackgroundSampleElements,
  resolveAdaptiveSwatchOutlineColor,
  resolveElementSurfaceColor,
} from '@/lib/ui/adaptiveColorSwatch';

const toolbarPopupSideOffset = 10;

function resolveColorPickerValue(value: Parameters<typeof Color.rgb>[0]) {
  try {
    return Color(value).hex();
  } catch {
    return null;
  }
}

export interface FloatingToolbarColorControlProps {
  label: string;
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onColorChange: (color: string) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  labelDisplay?: 'none' | 'left';
  disabled?: boolean;
}

export function FloatingToolbarColorControl({
  label,
  value,
  open,
  onOpenChange,
  onColorChange,
  opacity,
  onOpacityChange,
  labelDisplay = 'left',
  disabled = false,
}: FloatingToolbarColorControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const swatchRef = useRef<HTMLSpanElement>(null);
  const [swatchOutlineColor, setSwatchOutlineColor] = useState<string | null>(null);

  const handleColorChange = useCallback((nextValue: Parameters<typeof Color.rgb>[0]) => {
    const resolved = resolveColorPickerValue(nextValue);
    if (!resolved) {
      return;
    }

    onColorChange(resolved);
  }, [onColorChange]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const sampleRoot = buttonRef.current?.parentElement ?? swatchRef.current?.parentElement ?? null;
    if (!sampleRoot) {
      return undefined;
    }

    let animationFrame = 0;
    const updateOutline = () => {
      animationFrame = 0;
      const surfaceColor = resolveElementSurfaceColor(sampleRoot);
      const nextOutlineColor = resolveAdaptiveSwatchOutlineColor(value, surfaceColor);
      setSwatchOutlineColor((currentColor) => (
        currentColor === nextOutlineColor ? currentColor : nextOutlineColor
      ));
    };
    const scheduleUpdate = () => {
      if (animationFrame !== 0) {
        return;
      }

      animationFrame = window.requestAnimationFrame(updateOutline);
    };

    scheduleUpdate();

    const sampleElements = getBackgroundSampleElements(sampleRoot);
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => scheduleUpdate())
      : null;
    sampleElements.forEach((element) => resizeObserver?.observe(element));

    const mutationObserver = new MutationObserver(() => scheduleUpdate());
    sampleElements.forEach((element) => {
      mutationObserver.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    });

    const colorSchemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const addColorSchemeListener = colorSchemeMediaQuery.addEventListener?.bind(colorSchemeMediaQuery);
    const removeColorSchemeListener = colorSchemeMediaQuery.removeEventListener?.bind(colorSchemeMediaQuery);
    const legacyAddColorSchemeListener = colorSchemeMediaQuery.addListener?.bind(colorSchemeMediaQuery);
    const legacyRemoveColorSchemeListener = colorSchemeMediaQuery.removeListener?.bind(colorSchemeMediaQuery);
    if (addColorSchemeListener) {
      addColorSchemeListener('change', scheduleUpdate);
    } else {
      legacyAddColorSchemeListener?.(scheduleUpdate);
    }
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      if (removeColorSchemeListener) {
        removeColorSchemeListener('change', scheduleUpdate);
      } else {
        legacyRemoveColorSchemeListener?.(scheduleUpdate);
      }
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [value]);

  const swatchStyle = useMemo(() => ({
    backgroundColor: value,
    boxShadow: swatchOutlineColor ? `0 0 0 1px ${swatchOutlineColor}` : undefined,
  }), [swatchOutlineColor, value]);

  return (
    <>
      <div className="relative flex items-center gap-2">
        {labelDisplay === 'left' && (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
        )}
        <button
          ref={buttonRef}
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => onOpenChange(!open)}
          title={label}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
        >
          <span
            ref={swatchRef}
            className="size-6 rounded-md transition-[box-shadow]"
            style={swatchStyle}
            aria-hidden="true"
          />
        </button>
      </div>

      <AnchoredPopupSurface
        open={open && !disabled}
        anchorRef={buttonRef}
        onClose={() => onOpenChange(false)}
        side="top"
        align="center"
        sideOffset={toolbarPopupSideOffset}
        className="w-[212px] p-3"
      >
        <CompactColorPicker
          value={value}
          onChange={handleColorChange}
          opacity={opacity}
          onOpacityChange={onOpacityChange}
        />
      </AnchoredPopupSurface>
    </>
  );
}

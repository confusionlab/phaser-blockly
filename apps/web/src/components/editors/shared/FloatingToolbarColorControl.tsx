import { useCallback, useRef } from 'react';
import Color from 'color';

import { AnchoredPopupSurface } from '@/components/editors/shared/AnchoredPopupSurface';
import type { ToolbarSliderChangeMeta } from '@/components/editors/shared/toolbarSliderCommitBoundary';
import { CompactColorPicker } from '@/components/ui/color-picker';
import { ColorSwatchButton } from '@/components/ui/color-swatch-button';

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
  mixed?: boolean;
  swatchVariant?: 'fill' | 'stroke';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onColorChange: (color: string, meta?: ToolbarSliderChangeMeta) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number, meta?: ToolbarSliderChangeMeta) => void;
  labelDisplay?: 'none' | 'left';
  disabled?: boolean;
}

export function FloatingToolbarColorControl({
  label,
  value,
  mixed = false,
  swatchVariant = 'fill',
  open,
  onOpenChange,
  onColorChange,
  opacity,
  onOpacityChange,
  labelDisplay = 'left',
  disabled = false,
}: FloatingToolbarColorControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previewStateRef = useRef<{
    color: string;
    opacity?: number;
    changedColor: boolean;
    changedOpacity: boolean;
  } | null>(null);

  const ensurePreviewState = useCallback(() => {
    const current = previewStateRef.current;
    if (current) {
      return current;
    }
    const nextState = {
      color: value,
      opacity,
      changedColor: false,
      changedOpacity: false,
    };
    previewStateRef.current = nextState;
    return nextState;
  }, [opacity, value]);

  const handleColorChange = useCallback((nextValue: Parameters<typeof Color.rgb>[0]) => {
    const resolved = resolveColorPickerValue(nextValue);
    if (!resolved) {
      return;
    }

    const previewState = ensurePreviewState();
    previewState.color = resolved;
    previewState.changedColor = previewState.changedColor || resolved !== value;
    onColorChange(resolved, {
      source: 'picker',
      phase: 'preview',
    });
  }, [ensurePreviewState, onColorChange, value]);

  const handleOpacityChange = useCallback((nextOpacity: number) => {
    if (!onOpacityChange) {
      return;
    }

    const previewState = ensurePreviewState();
    previewState.opacity = nextOpacity;
    previewState.changedOpacity = previewState.changedOpacity || nextOpacity !== opacity;
    onOpacityChange(nextOpacity, {
      source: 'picker',
      phase: 'preview',
    });
  }, [ensurePreviewState, onOpacityChange, opacity]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      const previewState = previewStateRef.current;
      if (previewState) {
        if (previewState.changedColor) {
          onColorChange(previewState.color, {
            source: 'picker',
            phase: 'commit',
          });
        }
        if (previewState.changedOpacity && typeof previewState.opacity === 'number' && onOpacityChange) {
          onOpacityChange(previewState.opacity, {
            source: 'picker',
            phase: 'commit',
          });
        }
      }
      previewStateRef.current = null;
    } else {
      previewStateRef.current = {
        color: value,
        opacity,
        changedColor: false,
        changedOpacity: false,
      };
    }

    onOpenChange(nextOpen);
  }, [onColorChange, onOpacityChange, onOpenChange, opacity, value]);

  return (
    <>
      <div className="relative flex items-center gap-2">
        {labelDisplay === 'left' && (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
        )}
        <ColorSwatchButton
          ref={buttonRef}
          value={value}
          mixed={mixed}
          opacity={opacity}
          variant={swatchVariant}
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
          swatchClassName="size-6 rounded-md"
          onClick={() => handleOpenChange(!open)}
          title={mixed ? `${label} (mixed)` : label}
          aria-label={mixed ? `${label} (mixed)` : label}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
        />
      </div>

      <AnchoredPopupSurface
        open={open && !disabled}
        anchorRef={buttonRef}
        onClose={() => handleOpenChange(false)}
        side="top"
        align="center"
        sideOffset={toolbarPopupSideOffset}
        className="w-[212px] p-3"
      >
        <CompactColorPicker
          value={value}
          onChange={handleColorChange}
          opacity={opacity}
          onOpacityChange={handleOpacityChange}
        />
      </AnchoredPopupSurface>
    </>
  );
}

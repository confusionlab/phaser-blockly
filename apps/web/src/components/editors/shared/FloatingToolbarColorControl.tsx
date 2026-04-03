import { useCallback, useRef } from 'react';
import Color from 'color';

import { AnchoredPopupSurface } from '@/components/editors/shared/AnchoredPopupSurface';
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

  const handleColorChange = useCallback((nextValue: Parameters<typeof Color.rgb>[0]) => {
    const resolved = resolveColorPickerValue(nextValue);
    if (!resolved) {
      return;
    }

    onColorChange(resolved);
  }, [onColorChange]);

  return (
    <>
      <div className="relative flex items-center gap-2">
        {labelDisplay === 'left' && (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
        )}
        <ColorSwatchButton
          ref={buttonRef}
          value={value}
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
          swatchClassName="size-6 rounded-md"
          onClick={() => onOpenChange(!open)}
          title={label}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
        />
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

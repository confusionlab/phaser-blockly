import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { AnchoredPopupSurface } from '@/components/editors/shared/AnchoredPopupSurface';
import {
  FloatingBottomToolbar,
  FloatingBottomToolbarDock,
} from '@/components/editors/shared/FloatingBottomToolbar';
import {
  ColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
} from '@/components/ui/color-picker';
import {
  MousePointer2,
  PenTool,
  Paintbrush,
  Eraser,
  PaintBucket,
  Circle,
  Square,
  Minus,
  Triangle,
  Star,
  ChevronDown,
  Check,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  FlipHorizontal2,
  FlipVertical2,
  RotateCw,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import Color from 'color';
import type { CostumeEditorMode } from '@/types';
import {
  BITMAP_BRUSH_OPTIONS,
  type BitmapBrushKind,
} from '@/lib/background/brushCore';
import {
  BITMAP_FILL_TEXTURE_OPTIONS,
  type BitmapFillTextureId,
} from '@/lib/background/bitmapFillCore';
import {
  VECTOR_STROKE_BRUSH_OPTIONS,
  type VectorStrokeBrushId,
} from '@/lib/vector/vectorStrokeBrushCore';
import {
  VECTOR_FILL_TEXTURE_OPTIONS,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';

export type EditorMode = CostumeEditorMode;
export type DrawingTool = 'select' | 'pen' | 'brush' | 'eraser' | 'fill' | 'circle' | 'rectangle' | 'triangle' | 'star' | 'line' | 'text' | 'collider';
export type MoveOrderAction = 'forward' | 'backward' | 'front' | 'back';
export type SelectionFlipAxis = 'horizontal' | 'vertical';
export type VectorPathNodeHandleType = 'linear' | 'corner' | 'smooth' | 'symmetric';
export type EditableVectorHandleMode = VectorPathNodeHandleType;
export type VectorHandleMode = EditableVectorHandleMode | 'multiple';
export type AlignAction =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom';

export interface TextToolStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  underline: boolean;
  textAlign: 'left' | 'center' | 'right';
  opacity: number;
}

export interface VectorToolStyle {
  fillColor: string;
  fillTextureId: VectorFillTextureId;
  strokeColor: string;
  strokeWidth: number;
  strokeBrushId: VectorStrokeBrushId;
}

export interface BitmapShapeStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface BitmapFillStyle {
  textureId: BitmapFillTextureId;
}

export interface VectorStyleCapabilities {
  supportsFill: boolean;
}

export function vectorHandleModeToPathNodeHandleType(mode: EditableVectorHandleMode): VectorPathNodeHandleType {
  return mode;
}

export function pathNodeHandleTypeToVectorHandleMode(type: VectorPathNodeHandleType | null | undefined): EditableVectorHandleMode {
  return type ?? 'linear';
}

interface ToolDefinition {
  tool: DrawingTool;
  icon: React.ReactNode;
  label: string;
}

function AlignCanvasActionIcon({ action }: { action: AlignAction }) {
  const isVertical = action === 'left' || action === 'center-x' || action === 'right';
  const guideX = action === 'left' ? 4 : action === 'center-x' ? 12 : 20;
  const guideY = action === 'top' ? 4 : action === 'center-y' ? 12 : 20;
  const rectX = action === 'left' ? 11 : action === 'center-x' ? 8 : 5;
  const rectY = action === 'top' ? 11 : action === 'center-y' ? 8 : 5;

  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      {isVertical ? (
        <>
          <line x1={guideX} y1="2" x2={guideX} y2="22" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
          <rect x={rectX} y="8" width="8" height="8" rx="2" fill="currentColor" />
        </>
      ) : (
        <>
          <line x1="2" y1={guideY} x2="22" y2={guideY} stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
          <rect x="8" y={rectY} width="8" height="8" rx="2" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

interface FloatingToolButtonProps {
  tool: DrawingTool;
  icon: React.ReactNode;
  label: string;
  activeTool: DrawingTool;
  onClick: (tool: DrawingTool) => void;
}

type ToolbarColorMenuId = 'color' | 'fill-color' | 'stroke-color';

type ToolbarMenuId =
  | 'move-order'
  | 'vector-handles'
  | 'align'
  | 'brush-kind'
  | 'bitmap-fill-texture'
  | 'vector-fill-texture'
  | 'vector-stroke-brush'
  | ToolbarColorMenuId
  | 'font-family'
  | 'text-format'
  | 'text-align'
  | 'shape-tools';

const floatingToolButtonBaseClass =
  'h-11 rounded-[18px] bg-transparent text-muted-foreground shadow-none transition-colors duration-200 hover:!bg-transparent hover:text-foreground';
const floatingToolButtonActiveClass =
  '!bg-foreground/[0.08] text-foreground shadow-none hover:!bg-foreground/[0.08] dark:!bg-white/[0.12] dark:hover:!bg-white/[0.12]';
const toolbarPopupSideOffset = 10;

const FloatingToolButton = memo(({
  tool,
  icon,
  label,
  activeTool,
  onClick,
}: FloatingToolButtonProps) => {
  const isActive = activeTool === tool;

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className={cn(
        floatingToolButtonBaseClass,
        'w-11',
        isActive && floatingToolButtonActiveClass,
      )}
      onClick={() => onClick(tool)}
      title={label}
      aria-pressed={isActive}
      data-tool={tool}
    >
      {icon}
    </Button>
  );
});

FloatingToolButton.displayName = 'FloatingToolButton';

function resolveColorPickerValue(value: Parameters<typeof Color.rgb>[0]) {
  try {
    return Color(value).hex();
  } catch {
    return null;
  }
}

interface ToolbarColorControlProps {
  label: string;
  value: string;
  menuId: ToolbarColorMenuId;
  openMenu: ToolbarMenuId | null;
  onMenuOpenChange: (menu: ToolbarMenuId, open: boolean) => void;
  onColorChange: (color: string) => void;
  labelDisplay?: 'none' | 'left';
}

const ToolbarColorControl = memo(({
  label,
  value,
  menuId,
  openMenu,
  onMenuOpenChange,
  onColorChange,
  labelDisplay = 'left',
}: ToolbarColorControlProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isOpen = openMenu === menuId;

  const handleColorChange = useCallback((nextValue: Parameters<typeof Color.rgb>[0]) => {
    const resolved = resolveColorPickerValue(nextValue);
    if (!resolved) {
      return;
    }

    onColorChange(resolved);
  }, [onColorChange]);

  return (
    <>
      <div className="relative flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
        {labelDisplay === 'left' && (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
        )}
        <button
          ref={buttonRef}
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent/60"
          onClick={() => onMenuOpenChange(menuId, !isOpen)}
          title={label}
          aria-label={label}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
        >
          <span
            className="size-6 rounded-md ring-1 ring-black/15"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
        </button>
      </div>

      <AnchoredPopupSurface
        open={isOpen}
        anchorRef={buttonRef}
        onClose={() => onMenuOpenChange(menuId, false)}
        side="top"
        align="center"
        sideOffset={toolbarPopupSideOffset}
        className="w-[212px] p-3"
      >
        <ColorPicker value={value} onChange={handleColorChange} className="w-48">
          <ColorPickerSelection className="mb-2 h-32 rounded" />
          <ColorPickerHue />
        </ColorPicker>
      </AnchoredPopupSurface>
    </>
  );
});

ToolbarColorControl.displayName = 'ToolbarColorControl';

const toolbarSliderThumbClassName =
  'block size-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const toolbarSliderTrackClassName = 'relative h-1.5 w-full grow rounded-full bg-secondary';
const toolbarSliderRangeClassName = 'absolute h-full rounded-full bg-primary';
const toolbarSliderPreviewSurfaceClassName =
  'pointer-events-none overflow-visible rounded-md bg-background px-4 py-3';

interface ToolbarPreviewSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  preview: React.ReactNode;
  className?: string;
  sliderClassName?: string;
  valueClassName?: string;
  thumbClassName?: string;
}

const ToolbarPreviewSlider = memo(({
  label,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  preview,
  className,
  sliderClassName,
  valueClassName,
  thumbClassName,
}: ToolbarPreviewSliderProps) => {
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPreviewVisible) {
      return;
    }

    const handlePointerEnd = () => {
      setIsPreviewVisible(false);
    };

    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [isPreviewVisible]);

  return (
    <div className={cn('flex min-w-[136px] items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0', className)}>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <div ref={anchorRef} className="relative flex min-w-0 grow items-center">
        <Slider.Root
          className={cn('relative flex h-4 w-full touch-none items-center', sliderClassName)}
          value={[value]}
          onValueChange={([nextValue]) => onValueChange(nextValue)}
          onValueCommit={() => setIsPreviewVisible(false)}
          onPointerDownCapture={() => setIsPreviewVisible(true)}
          onFocusCapture={() => setIsPreviewVisible(true)}
          onBlurCapture={() => setIsPreviewVisible(false)}
          min={min}
          max={max}
          step={step}
        >
          <Slider.Track className={toolbarSliderTrackClassName}>
            <Slider.Range className={toolbarSliderRangeClassName} />
          </Slider.Track>
          <Slider.Thumb className={cn(toolbarSliderThumbClassName, thumbClassName)} />
        </Slider.Root>
      </div>
      <span className={cn('w-8 text-right text-xs text-muted-foreground', valueClassName)}>{value}</span>
      <AnchoredPopupSurface
        open={isPreviewVisible}
        anchorRef={anchorRef}
        onClose={() => setIsPreviewVisible(false)}
        side="top"
        align="center"
        sideOffset={toolbarPopupSideOffset}
        className={toolbarSliderPreviewSurfaceClassName}
      >
        <div aria-hidden="true">
          {preview}
        </div>
      </AnchoredPopupSurface>
    </div>
  );
});

ToolbarPreviewSlider.displayName = 'ToolbarPreviewSlider';

interface StrokeWidthPreviewProps {
  thickness: number;
  color: string;
  previewScale: number;
}

const StrokeWidthPreview = memo(({
  thickness,
  color,
  previewScale,
}: StrokeWidthPreviewProps) => {
  const displayThickness = Math.max(0, thickness * previewScale);
  const previewHeight = Math.max(72, displayThickness + 28);

  return (
    <div
      className="flex w-[136px] items-center justify-center"
      style={{ minHeight: `${previewHeight}px` }}
    >
      {displayThickness > 0 && (
        <div
          className="w-full rounded-full"
          style={{
            height: `${displayThickness}px`,
            backgroundColor: color,
          }}
        />
      )}
    </div>
  );
});

StrokeWidthPreview.displayName = 'StrokeWidthPreview';

interface TextSizePreviewProps {
  textStyle: TextToolStyle;
  color: string;
  previewScale: number;
}

const TextSizePreview = memo(({
  textStyle,
  color,
  previewScale,
}: TextSizePreviewProps) => {
  const displayFontSize = Math.max(1, textStyle.fontSize * previewScale);
  const previewHeight = Math.max(96, Math.min(220, displayFontSize + 44));
  const previewWidth = Math.max(176, Math.min(320, displayFontSize * 2.8));

  return (
    <div
      className="flex items-center justify-center"
      style={{
        minHeight: `${previewHeight}px`,
        minWidth: `${previewWidth}px`,
      }}
    >
      <span
        className="whitespace-nowrap text-center"
        style={{
          color,
          fontFamily: textStyle.fontFamily,
          fontSize: `${displayFontSize}px`,
          fontWeight: textStyle.fontWeight,
          fontStyle: textStyle.fontStyle,
          textDecoration: textStyle.underline ? 'underline' : 'none',
          lineHeight: 1.1,
        }}
      >
        Text
      </span>
    </div>
  );
});

TextSizePreview.displayName = 'TextSizePreview';

interface CostumeToolbarProps {
  editorMode: EditorMode;
  activeTool: DrawingTool;
  hasActiveSelection: boolean;
  showModeSwitcher?: boolean;
  selectionActionsEnabled?: boolean;
  showTextControls: boolean;
  isVectorPointEditing: boolean;
  hasSelectedVectorPoints: boolean;
  bitmapBrushKind: BitmapBrushKind;
  brushColor: string;
  brushSize: number;
  bitmapFillStyle: BitmapFillStyle;
  bitmapShapeStyle: BitmapShapeStyle;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  vectorStyleCapabilities: VectorStyleCapabilities;
  previewScale?: number;
  onEditorModeChange: (mode: EditorMode) => void;
  onToolChange: (tool: DrawingTool) => void;
  onMoveOrder: (action: MoveOrderAction) => void;
  onFlipSelection: (axis: SelectionFlipAxis) => void;
  onRotateSelection: () => void;
  vectorHandleMode: VectorHandleMode;
  onVectorHandleModeChange: (mode: EditableVectorHandleMode) => void;
  onAlign: (action: AlignAction) => void;
  alignDisabled: boolean;
  onColorChange: (color: string) => void;
  onBitmapBrushKindChange: (kind: BitmapBrushKind) => void;
  onBrushSizeChange: (size: number) => void;
  onBitmapFillStyleChange: (updates: Partial<BitmapFillStyle>) => void;
  onBitmapShapeStyleChange: (updates: Partial<BitmapShapeStyle>) => void;
  onTextStyleChange: (updates: Partial<TextToolStyle>) => void;
  onVectorStyleChange: (updates: Partial<VectorToolStyle>) => void;
}

const bitmapPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <MousePointer2 className="size-[18px]" />, label: 'Select' },
  { tool: 'brush', icon: <Paintbrush className="size-[18px]" />, label: 'Brush' },
  { tool: 'eraser', icon: <Eraser className="size-[18px]" />, label: 'Eraser' },
  { tool: 'fill', icon: <PaintBucket className="size-[18px]" />, label: 'Fill' },
];

const vectorPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <MousePointer2 className="size-[18px]" />, label: 'Select' },
  { tool: 'pen', icon: <PenTool className="size-[18px]" />, label: 'Pen' },
];

const vectorTrailingTools: ToolDefinition[] = [
  { tool: 'text', icon: <Type className="size-[18px]" />, label: 'Text' },
];

const shapeTools: ToolDefinition[] = [
  { tool: 'rectangle', icon: <Square className="size-[18px]" />, label: 'Rectangle' },
  { tool: 'circle', icon: <Circle className="size-[18px]" />, label: 'Circle' },
  { tool: 'triangle', icon: <Triangle className="size-[18px]" />, label: 'Triangle' },
  { tool: 'star', icon: <Star className="size-[18px]" />, label: 'Star' },
  { tool: 'line', icon: <Minus className="size-[18px]" />, label: 'Line' },
];

const modeOptions: SegmentedControlOption<EditorMode>[] = [
  { value: 'bitmap', label: 'Pixel' },
  { value: 'vector', label: 'Vector' },
];

const fontFamilyOptions = [
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Courier New',
];

const textAlignOptions: Array<{
  value: TextToolStyle['textAlign'];
  label: string;
  Icon: typeof AlignLeft;
}> = [
  { value: 'left', label: 'Left', Icon: AlignLeft },
  { value: 'center', label: 'Center', Icon: AlignCenter },
  { value: 'right', label: 'Right', Icon: AlignRight },
];

const alignOptions: Array<{ action: AlignAction; title: string }> = [
  { action: 'left', title: 'Align Left' },
  { action: 'center-x', title: 'Center Horizontally' },
  { action: 'right', title: 'Align Right' },
  { action: 'top', title: 'Align Top' },
  { action: 'center-y', title: 'Center Vertically' },
  { action: 'bottom', title: 'Align Bottom' },
];

const vectorHandleModeOptions: Array<{ value: EditableVectorHandleMode; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'corner', label: 'No Mirror' },
  { value: 'smooth', label: 'Mirror Angle' },
  { value: 'symmetric', label: 'Mirror Angle and Length' },
];

function getVectorHandleModeLabel(mode: VectorHandleMode) {
  if (mode === 'multiple') return 'Multiple';
  switch (mode) {
    case 'corner':
      return 'No Mirror';
    case 'smooth':
      return 'Mirror Angle';
    case 'symmetric':
      return 'Mirror Angle and Length';
    case 'linear':
    default:
      return 'Linear';
  }
}

function getVectorStrokeBrushLabel(brushId: VectorStrokeBrushId) {
  return VECTOR_STROKE_BRUSH_OPTIONS.find((option) => option.value === brushId)?.label ?? 'Solid';
}

function getBitmapFillTextureLabel(textureId: BitmapFillTextureId) {
  return BITMAP_FILL_TEXTURE_OPTIONS.find((option) => option.value === textureId)?.label ?? 'Solid';
}

function getVectorFillTextureLabel(textureId: VectorFillTextureId) {
  return VECTOR_FILL_TEXTURE_OPTIONS.find((option) => option.value === textureId)?.label ?? 'Solid';
}

function isShapeTool(tool: DrawingTool) {
  return shapeTools.some((shapeTool) => shapeTool.tool === tool);
}

export const CostumeToolbar = memo(({
  editorMode,
  activeTool,
  hasActiveSelection,
  showModeSwitcher = true,
  selectionActionsEnabled = true,
  showTextControls,
  isVectorPointEditing,
  hasSelectedVectorPoints,
  bitmapBrushKind,
  brushColor,
  brushSize,
  bitmapFillStyle,
  bitmapShapeStyle,
  textStyle,
  vectorStyle,
  vectorStyleCapabilities,
  previewScale = 1,
  onEditorModeChange,
  onToolChange,
  onMoveOrder,
  onFlipSelection,
  onRotateSelection,
  vectorHandleMode,
  onVectorHandleModeChange,
  onAlign,
  alignDisabled,
  onColorChange,
  onBitmapBrushKindChange,
  onBrushSizeChange,
  onBitmapFillStyleChange,
  onBitmapShapeStyleChange,
  onTextStyleChange,
  onVectorStyleChange,
}: CostumeToolbarProps) => {
  const [openMenu, setOpenMenu] = useState<ToolbarMenuId | null>(null);

  const handleMenuOpenChange = useCallback((menu: ToolbarMenuId, open: boolean) => {
    setOpenMenu((current) => {
      if (open) return menu;
      return current === menu ? null : current;
    });
  }, []);

  const isShapeMenuOpen = openMenu === 'shape-tools';

  const leadingTools = editorMode === 'vector' ? vectorPrimaryTools : bitmapPrimaryTools;
  const trailingTools = editorMode === 'vector' ? vectorTrailingTools : [];
  const currentShapeTool = shapeTools.find((tool) => tool.tool === activeTool) ?? shapeTools[0];
  const shapeToolIsActive = isShapeTool(activeTool);
  const showSelectionActions = selectionActionsEnabled && activeTool === 'select' && !isVectorPointEditing && hasActiveSelection;
  const showVectorHandleControl = editorMode === 'vector' && isVectorPointEditing && hasSelectedVectorPoints;
  const showBitmapShapeStyleControls = editorMode === 'bitmap' && shapeToolIsActive;
  const showBitmapShapeFillControl = showBitmapShapeStyleControls && activeTool !== 'line';
  const showBitmapFillTextureControl = editorMode === 'bitmap' && activeTool === 'fill';
  const showBitmapBrushSizeControl =
    editorMode === 'bitmap' &&
    !shapeToolIsActive &&
    (activeTool === 'brush' || activeTool === 'eraser');
  const showBitmapBrushTypeControl =
    editorMode === 'bitmap' &&
    !shapeToolIsActive &&
    (activeTool === 'brush' || activeTool === 'eraser');
  const showBitmapPrimaryColorControl =
    editorMode === 'bitmap' &&
    !shapeToolIsActive &&
    (activeTool === 'brush' || activeTool === 'fill');
  const showPrimaryColorControl = showBitmapPrimaryColorControl || showTextControls;
  const showVectorStyleControls =
    editorMode === 'vector' &&
    !showTextControls &&
    (showSelectionActions || isVectorPointEditing || shapeToolIsActive || activeTool === 'pen');
  const showVectorFillControl =
    showVectorStyleControls &&
    (hasActiveSelection ? vectorStyleCapabilities.supportsFill : activeTool !== 'line');
  const showTextToolbarControls = editorMode === 'vector' && showTextControls;
  const showContextualPropertyBar =
    showSelectionActions ||
    showVectorHandleControl ||
    showPrimaryColorControl ||
    showBitmapBrushTypeControl ||
    showBitmapFillTextureControl ||
    showBitmapShapeStyleControls ||
    showVectorStyleControls ||
    showBitmapBrushSizeControl ||
    showTextToolbarControls;
  const activeTextAlign = textAlignOptions.find((option) => option.value === textStyle.textAlign) ?? textAlignOptions[0];
  const ActiveTextAlignIcon = activeTextAlign.Icon;
  const activeBrushPreviewColor = activeTool === 'eraser' ? '#94a3b8' : brushColor;

  useEffect(() => {
    if (!showContextualPropertyBar) {
      setOpenMenu(null);
    }
  }, [showContextualPropertyBar]);

  useEffect(() => {
    if (!hasSelectedVectorPoints && openMenu === 'vector-handles') {
      setOpenMenu(null);
    }
  }, [hasSelectedVectorPoints, openMenu]);

  return (
    <>
      <FloatingBottomToolbarDock>
          {showContextualPropertyBar && (
            <FloatingBottomToolbar variant="property" testId="costume-toolbar-properties">
                <div className="flex min-w-max items-center gap-2">
                  {editorMode === 'vector' && showSelectionActions && hasActiveSelection && (
                    <div className="flex items-center border-r pr-2 last:border-r-0 last:pr-0">
                      <DropdownMenu
                        open={openMenu === 'move-order'}
                        onOpenChange={(open) => handleMenuOpenChange('move-order', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                            Move Order
                            <ChevronDown className="size-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[160px]">
                          <DropdownMenuItem onClick={() => onMoveOrder('forward')}>
                            Move Forward
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onMoveOrder('backward')}>
                            Move Backward
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onMoveOrder('front')}>
                            Move To Front
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onMoveOrder('back')}>
                            Move To Back
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showVectorHandleControl && (
                    <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">Handles</span>
                      <DropdownMenu
                        open={openMenu === 'vector-handles'}
                        onOpenChange={(open) => handleMenuOpenChange('vector-handles', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 min-w-[176px] justify-between gap-2 px-2 text-xs"
                          >
                            <span>{getVectorHandleModeLabel(vectorHandleMode)}</span>
                            <ChevronDown className="size-3 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[208px]">
                          {vectorHandleModeOptions.map((option) => {
                            const showIndicator = vectorHandleMode === 'multiple' || vectorHandleMode === option.value;
                            return (
                              <DropdownMenuItem
                                key={option.value}
                                onSelect={() => onVectorHandleModeChange(option.value)}
                                className="relative pl-8"
                              >
                                <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
                                  <span
                                    className={cn(
                                      'size-2 rounded-full bg-current transition-opacity',
                                      showIndicator ? 'opacity-100' : 'opacity-0',
                                    )}
                                  />
                                </span>
                                {option.label}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showSelectionActions && (
                    <div className="flex items-center gap-1 border-r pr-2 last:border-r-0 last:pr-0">
                      <DropdownMenu
                        open={openMenu === 'align'}
                        onOpenChange={(open) => handleMenuOpenChange('align', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={alignDisabled}>
                            Align
                            <ChevronDown className="size-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="w-auto p-2">
                          <div className="flex items-center gap-1">
                            {alignOptions.map((item) => (
                              <DropdownMenuItem
                                key={item.action}
                                className="h-8 w-8 justify-center rounded border p-0 text-muted-foreground"
                                title={item.title}
                                onSelect={(event) => event.preventDefault()}
                                onClick={() => onAlign(item.action)}
                              >
                                <AlignCanvasActionIcon action={item.action} />
                              </DropdownMenuItem>
                            ))}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="Flip Horizontal"
                        aria-label="Flip Horizontal"
                        onClick={() => onFlipSelection('horizontal')}
                      >
                        <FlipHorizontal2 className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="Flip Vertical"
                        aria-label="Flip Vertical"
                        onClick={() => onFlipSelection('vertical')}
                      >
                        <FlipVertical2 className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="Rotate 90 Degrees"
                        aria-label="Rotate 90 Degrees"
                        onClick={onRotateSelection}
                      >
                        <RotateCw className="size-4" />
                      </Button>
                    </div>
                  )}

                  {showPrimaryColorControl && (
                    <ToolbarColorControl
                      label="Color"
                      value={brushColor}
                      menuId="color"
                      openMenu={openMenu}
                      onMenuOpenChange={handleMenuOpenChange}
                      onColorChange={onColorChange}
                      labelDisplay="none"
                    />
                  )}

                  {showBitmapBrushTypeControl && (
                    <div className="flex items-center border-r pr-2 last:border-r-0 last:pr-0">
                      <DropdownMenu
                        open={openMenu === 'brush-kind'}
                        onOpenChange={(open) => handleMenuOpenChange('brush-kind', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 min-w-[128px] justify-between gap-2 px-2 text-xs"
                          >
                            <span>{BITMAP_BRUSH_OPTIONS.find((option) => option.value === bitmapBrushKind)?.label ?? 'Harsh Circle'}</span>
                            <ChevronDown className="size-3 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[156px]">
                          <DropdownMenuRadioGroup
                            value={bitmapBrushKind}
                            onValueChange={(nextKind) => onBitmapBrushKindChange(nextKind as BitmapBrushKind)}
                          >
                            {BITMAP_BRUSH_OPTIONS.map((option) => (
                              <DropdownMenuRadioItem key={option.value} value={option.value}>
                                {option.label}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showBitmapFillTextureControl && (
                    <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">Texture</span>
                      <DropdownMenu
                        open={openMenu === 'bitmap-fill-texture'}
                        onOpenChange={(open) => handleMenuOpenChange('bitmap-fill-texture', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 min-w-[112px] justify-between gap-2 px-2 text-xs"
                          >
                            <span>{getBitmapFillTextureLabel(bitmapFillStyle.textureId)}</span>
                            <ChevronDown className="size-3 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[148px]">
                          <DropdownMenuRadioGroup
                            value={bitmapFillStyle.textureId}
                            onValueChange={(textureId) => onBitmapFillStyleChange({ textureId: textureId as BitmapFillTextureId })}
                          >
                            {BITMAP_FILL_TEXTURE_OPTIONS.map((option) => (
                              <DropdownMenuRadioItem key={option.value} value={option.value}>
                                {option.label}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showBitmapShapeStyleControls && (
                    <>
                      {showBitmapShapeFillControl && (
                        <ToolbarColorControl
                          label="Fill"
                          value={bitmapShapeStyle.fillColor}
                          menuId="fill-color"
                          openMenu={openMenu}
                          onMenuOpenChange={handleMenuOpenChange}
                          onColorChange={(fillColor) => onBitmapShapeStyleChange({ fillColor })}
                          labelDisplay="left"
                        />
                      )}

                      <ToolbarColorControl
                        label="Stroke"
                        value={bitmapShapeStyle.strokeColor}
                        menuId="stroke-color"
                        openMenu={openMenu}
                        onMenuOpenChange={handleMenuOpenChange}
                        onColorChange={(strokeColor) => onBitmapShapeStyleChange({ strokeColor })}
                        labelDisplay="left"
                      />

                      <ToolbarPreviewSlider
                        label="Stroke"
                        value={bitmapShapeStyle.strokeWidth}
                        onValueChange={(strokeWidth) => onBitmapShapeStyleChange({ strokeWidth })}
                        min={0}
                        max={50}
                        preview={(
                          <StrokeWidthPreview
                            thickness={bitmapShapeStyle.strokeWidth}
                            color={bitmapShapeStyle.strokeColor}
                            previewScale={previewScale}
                          />
                        )}
                      />
                    </>
                  )}

                  {showVectorStyleControls && (
                    <>
                      <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Brush</span>
                        <DropdownMenu
                          open={openMenu === 'vector-stroke-brush'}
                          onOpenChange={(open) => handleMenuOpenChange('vector-stroke-brush', open)}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 min-w-[112px] justify-between gap-2 px-2 text-xs"
                            >
                              <span>{getVectorStrokeBrushLabel(vectorStyle.strokeBrushId)}</span>
                              <ChevronDown className="size-3 shrink-0" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[148px]">
                            <DropdownMenuRadioGroup
                              value={vectorStyle.strokeBrushId}
                              onValueChange={(strokeBrushId) => onVectorStyleChange({ strokeBrushId: strokeBrushId as VectorStrokeBrushId })}
                            >
                              {VECTOR_STROKE_BRUSH_OPTIONS.map((option) => (
                                <DropdownMenuRadioItem key={option.value} value={option.value}>
                                  {option.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {showVectorFillControl && (
                        <>
                          <ToolbarColorControl
                            label="Fill"
                            value={vectorStyle.fillColor}
                            menuId="fill-color"
                            openMenu={openMenu}
                            onMenuOpenChange={handleMenuOpenChange}
                            onColorChange={(fillColor) => onVectorStyleChange({ fillColor })}
                            labelDisplay="left"
                          />

                          <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                            <span className="whitespace-nowrap text-xs text-muted-foreground">Texture</span>
                            <DropdownMenu
                              open={openMenu === 'vector-fill-texture'}
                              onOpenChange={(open) => handleMenuOpenChange('vector-fill-texture', open)}
                            >
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 min-w-[112px] justify-between gap-2 px-2 text-xs"
                                >
                                  <span>{getVectorFillTextureLabel(vectorStyle.fillTextureId)}</span>
                                  <ChevronDown className="size-3 shrink-0" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[148px]">
                                <DropdownMenuRadioGroup
                                  value={vectorStyle.fillTextureId}
                                  onValueChange={(fillTextureId) => onVectorStyleChange({ fillTextureId: fillTextureId as VectorFillTextureId })}
                                >
                                  {VECTOR_FILL_TEXTURE_OPTIONS.map((option) => (
                                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                                      {option.label}
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </>
                      )}

                      <ToolbarColorControl
                        label="Stroke"
                        value={vectorStyle.strokeColor}
                        menuId="stroke-color"
                        openMenu={openMenu}
                        onMenuOpenChange={handleMenuOpenChange}
                        onColorChange={(strokeColor) => onVectorStyleChange({ strokeColor })}
                        labelDisplay="left"
                      />

                      <ToolbarPreviewSlider
                        label="Stroke"
                        value={vectorStyle.strokeWidth}
                        onValueChange={(strokeWidth) => onVectorStyleChange({ strokeWidth })}
                        min={0}
                        max={50}
                        preview={(
                          <StrokeWidthPreview
                            thickness={vectorStyle.strokeWidth}
                            color={vectorStyle.strokeColor}
                            previewScale={previewScale}
                          />
                        )}
                      />
                    </>
                  )}

                  {showBitmapBrushSizeControl && (
                    <ToolbarPreviewSlider
                      label="Size"
                      value={brushSize}
                      onValueChange={onBrushSizeChange}
                      min={1}
                      max={50}
                        preview={(
                          <StrokeWidthPreview
                            thickness={brushSize}
                            color={activeBrushPreviewColor}
                            previewScale={previewScale}
                          />
                        )}
                      />
                  )}

                  {showTextToolbarControls && (
                    <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                      <DropdownMenu
                        open={openMenu === 'font-family'}
                        onOpenChange={(open) => handleMenuOpenChange('font-family', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 min-w-[120px] justify-between gap-2 px-2 text-xs"
                          >
                            <span className="truncate">{textStyle.fontFamily}</span>
                            <ChevronDown className="size-3 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[156px]">
                          <DropdownMenuRadioGroup
                            value={textStyle.fontFamily}
                            onValueChange={(fontFamily) => onTextStyleChange({ fontFamily })}
                          >
                            {fontFamilyOptions.map((family) => (
                              <DropdownMenuRadioItem key={family} value={family}>
                                {family}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <ToolbarPreviewSlider
                        label="Size"
                        value={textStyle.fontSize}
                        onValueChange={(fontSize) => onTextStyleChange({ fontSize })}
                        min={8}
                        max={120}
                        sliderClassName="w-16"
                        thumbClassName="size-3"
                        preview={(
                          <TextSizePreview
                            textStyle={textStyle}
                            color={brushColor}
                            previewScale={previewScale}
                          />
                        )}
                      />

                      <DropdownMenu
                        open={openMenu === 'text-format'}
                        onOpenChange={(open) => handleMenuOpenChange('text-format', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-2 px-2 text-xs"
                          >
                            <span className={cn('font-semibold', textStyle.fontWeight === 'bold' && 'text-foreground')}>
                              B
                            </span>
                            <span className={cn('italic', textStyle.fontStyle === 'italic' && 'text-foreground')}>
                              I
                            </span>
                            <span className={cn('underline underline-offset-2', textStyle.underline && 'text-foreground')}>
                              U
                            </span>
                            <ChevronDown className="size-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[156px]">
                          <DropdownMenuCheckboxItem
                            checked={textStyle.fontWeight === 'bold'}
                            onCheckedChange={(checked) => onTextStyleChange({ fontWeight: checked ? 'bold' : 'normal' })}
                            onSelect={(event) => event.preventDefault()}
                          >
                            B
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={textStyle.fontStyle === 'italic'}
                            onCheckedChange={(checked) => onTextStyleChange({ fontStyle: checked ? 'italic' : 'normal' })}
                            onSelect={(event) => event.preventDefault()}
                          >
                            I
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={textStyle.underline}
                            onCheckedChange={(checked) => onTextStyleChange({ underline: checked === true })}
                            onSelect={(event) => event.preventDefault()}
                          >
                            U
                          </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <DropdownMenu
                        open={openMenu === 'text-align'}
                        onOpenChange={(open) => handleMenuOpenChange('text-align', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-2 px-2 text-xs"
                            aria-label={`Text alignment: ${activeTextAlign.label}`}
                          >
                            <ActiveTextAlignIcon className="size-3.5" />
                            <ChevronDown className="size-3 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[148px]">
                          <DropdownMenuRadioGroup
                            value={textStyle.textAlign}
                            onValueChange={(textAlign) => onTextStyleChange({ textAlign: textAlign as TextToolStyle['textAlign'] })}
                          >
                            {textAlignOptions.map(({ value, label, Icon }) => (
                              <DropdownMenuRadioItem key={value} value={value}>
                                <span className="inline-flex items-center gap-2">
                                  <Icon className="size-3.5" />
                                  <span>{label}</span>
                                </span>
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
            </FloatingBottomToolbar>
          )}

          <FloatingBottomToolbar variant="tool" testId="costume-toolbar-tools">
              <div className="flex min-w-max items-center gap-3">
                <div className="flex items-center gap-1">
                  {leadingTools.map(({ tool, icon, label }) => (
                    <FloatingToolButton
                      key={tool}
                      tool={tool}
                      icon={icon}
                      label={label}
                      activeTool={activeTool}
                      onClick={onToolChange}
                    />
                  ))}

                  <DropdownMenu
                    open={isShapeMenuOpen}
                    onOpenChange={(open) => handleMenuOpenChange('shape-tools', open)}
                  >
                    <div
                      className={cn(
                        'flex items-center gap-1 rounded-[18px] bg-transparent',
                        shapeToolIsActive && floatingToolButtonActiveClass,
                      )}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setOpenMenu('shape-tools');
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          floatingToolButtonBaseClass,
                          'h-11 rounded-[18px] !pl-3 !pr-0 text-sm',
                          shapeToolIsActive && 'bg-transparent shadow-none',
                        )}
                        onClick={() => onToolChange(currentShapeTool.tool)}
                        title={currentShapeTool.label}
                        aria-pressed={shapeToolIsActive}
                      >
                        {currentShapeTool.icon}
                      </Button>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            floatingToolButtonBaseClass,
                            'h-11 rounded-[18px] !pl-0 !pr-3 text-sm',
                            shapeToolIsActive && 'bg-transparent shadow-none',
                          )}
                          title="Open shape tools"
                          aria-label="Open shape tools"
                          aria-expanded={isShapeMenuOpen}
                        >
                          <ChevronDown className="size-3.5 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                    </div>
                    <DropdownMenuContent
                      side="top"
                      align="center"
                      sideOffset={toolbarPopupSideOffset}
                      className="min-w-[180px] rounded-2xl border p-2"
                    >
                      {shapeTools.map((shapeTool) => {
                        const isActive = activeTool === shapeTool.tool;

                        return (
                          <DropdownMenuItem
                            key={shapeTool.tool}
                            className="flex items-center justify-between rounded-xl px-3 py-2 text-sm"
                            onClick={() => {
                              onToolChange(shapeTool.tool);
                              setOpenMenu((current) => (current === 'shape-tools' ? null : current));
                            }}
                          >
                            <span className="flex items-center gap-3">
                              {shapeTool.icon}
                              <span>{shapeTool.label}</span>
                            </span>
                            <Check className={cn('size-3.5 text-foreground/70', !isActive && 'opacity-0')} />
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {trailingTools.map(({ tool, icon, label }) => (
                    <FloatingToolButton
                      key={tool}
                      tool={tool}
                      icon={icon}
                      label={label}
                      activeTool={activeTool}
                      onClick={onToolChange}
                    />
                  ))}
                </div>

                {showModeSwitcher && (
                  <>
                    <div className="h-10 w-px bg-border/65" />

                    <div className="w-[164px]">
                      <SegmentedControl
                        ariaLabel="Costume editor mode"
                        options={modeOptions}
                        size="large"
                        value={editorMode}
                        onValueChange={onEditorModeChange}
                        className="w-full"
                        optionClassName="min-h-[40px] px-3 text-[13px]"
                      />
                    </div>
                  </>
                )}
              </div>
          </FloatingBottomToolbar>
      </FloatingBottomToolbarDock>
    </>
  );
});

CostumeToolbar.displayName = 'CostumeToolbar';

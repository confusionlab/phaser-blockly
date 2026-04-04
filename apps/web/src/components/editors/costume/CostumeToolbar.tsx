import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { AnchoredPopupSurface } from '@/components/editors/shared/AnchoredPopupSurface';
import {
  FloatingBottomToolbarDock,
  FloatingPropertyToolbar,
  FloatingToolToolbar,
  floatingToolbarControlActiveClass,
  floatingToolbarControlBaseClass,
} from '@/components/editors/shared/FloatingBottomToolbar';
import { FloatingToolbarColorControl } from '@/components/editors/shared/FloatingToolbarColorControl';
import { FloatingToolbarSlider } from '@/components/editors/shared/FloatingToolbarSlider';
import {
  MousePointer2,
  PenTool,
  Paintbrush,
  Pencil,
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
} from '@/components/ui/icons';
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
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokeBrushId: VectorStrokeBrushId;
}

export type VectorToolStyleMixedState = Partial<Record<keyof VectorToolStyle, boolean>>;

export interface VectorToolStyleSelectionSnapshot {
  style: Partial<VectorToolStyle>;
  mixed: VectorToolStyleMixedState;
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

function SelectToolIcon() {
  return <MousePointer2 className="size-[18px]" aria-hidden="true" />;
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

function AlignMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <line x1="4" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
      <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
      <line x1="20" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
      <rect x="6" y="7" width="4" height="4" rx="1.4" fill="currentColor" />
      <rect x="10" y="10" width="4" height="4" rx="1.4" fill="currentColor" />
      <rect x="14" y="13" width="4" height="4" rx="1.4" fill="currentColor" />
    </svg>
  );
}

function MoveOrderMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <rect x="5" y="7" width="10" height="10" rx="2" fill="currentColor" opacity="0.35" />
      <rect x="9" y="4" width="10" height="10" rx="2" fill="currentColor" />
      <path d="M12 20V11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.5 14 12 11.5 14.5 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
    <IconButton
      className={cn(
        floatingToolbarControlBaseClass,
        'w-11',
        isActive && floatingToolbarControlActiveClass,
      )}
      label={label}
      onClick={() => onClick(tool)}
      pressed={isActive}
      size="lg"
      data-tool={tool}
    >
      {icon}
    </IconButton>
  );
});

FloatingToolButton.displayName = 'FloatingToolButton';

const toolbarSliderPreviewSurfaceClassName =
  'pointer-events-none overflow-visible border-0 bg-transparent p-0 shadow-none';

interface ToolbarPreviewSliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  preview: React.ReactNode;
  labelDisplay?: 'left' | 'none';
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
  labelDisplay = 'left',
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
      {labelDisplay === 'left' && label ? (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      ) : null}
      <div ref={anchorRef} className="relative flex min-w-0 grow items-center">
        <FloatingToolbarSlider
          className={sliderClassName}
          value={value}
          onValueChange={onValueChange}
          onValueCommit={() => setIsPreviewVisible(false)}
          onPointerDownCapture={() => setIsPreviewVisible(true)}
          onFocusCapture={() => setIsPreviewVisible(true)}
          onBlurCapture={() => setIsPreviewVisible(false)}
          min={min}
          max={max}
          step={step}
          thumbClassName={thumbClassName}
        />
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

interface BrushSizePreviewProps {
  size: number;
  previewScale: number;
}

const BrushSizePreview = memo(({
  size,
  previewScale,
}: BrushSizePreviewProps) => {
  const displayDiameter = Math.max(6, size * previewScale);
  const previewExtent = Math.max(72, displayDiameter + 24);

  return (
    <div
      className="flex items-center justify-center"
      style={{
        minWidth: `${previewExtent}px`,
        minHeight: `${previewExtent}px`,
      }}
    >
      <div
        className="rounded-full border-2 border-black bg-transparent"
        style={{
          width: `${displayDiameter}px`,
          height: `${displayDiameter}px`,
        }}
      />
    </div>
  );
});

BrushSizePreview.displayName = 'BrushSizePreview';

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
  toolVisibility?: {
    showSelectTool?: boolean;
    showPenTool?: boolean;
    showBrushTool?: boolean;
    showShapeTools?: boolean;
    showTextTool?: boolean;
  };
  showModeSwitcher?: boolean;
  selectionActionsEnabled?: boolean;
  showTextControls: boolean;
  isVectorPointEditing: boolean;
  hasSelectedVectorPoints: boolean;
  bitmapBrushKind: BitmapBrushKind;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  bitmapFillStyle: BitmapFillStyle;
  bitmapShapeStyle: BitmapShapeStyle;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  vectorStyleMixedState?: VectorToolStyleMixedState;
  vectorStyleCapabilities: VectorStyleCapabilities;
  previewScale?: number;
  onToolChange: (tool: DrawingTool) => void;
  onMoveOrder: (action: MoveOrderAction) => void;
  onFlipSelection: (axis: SelectionFlipAxis) => void;
  onRotateSelection: () => void;
  vectorHandleMode: VectorHandleMode;
  onVectorHandleModeChange: (mode: EditableVectorHandleMode) => void;
  onAlign: (action: AlignAction) => void;
  alignDisabled: boolean;
  onColorChange: (color: string) => void;
  onBrushOpacityChange: (opacity: number) => void;
  onBitmapBrushKindChange: (kind: BitmapBrushKind) => void;
  onBrushSizeChange: (size: number) => void;
  onBitmapFillStyleChange: (updates: Partial<BitmapFillStyle>) => void;
  onBitmapShapeStyleChange: (updates: Partial<BitmapShapeStyle>) => void;
  onTextStyleChange: (updates: Partial<TextToolStyle>) => void;
  onVectorStyleChange: (updates: Partial<VectorToolStyle>) => void;
  toolAccessory?: ReactNode;
}

const bitmapPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <SelectToolIcon />, label: 'Select' },
  { tool: 'brush', icon: <Paintbrush className="size-[18px]" />, label: 'Brush' },
  { tool: 'eraser', icon: <Eraser className="size-[18px]" />, label: 'Eraser' },
  { tool: 'fill', icon: <PaintBucket className="size-[18px]" />, label: 'Fill' },
];

const vectorPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <SelectToolIcon />, label: 'Select' },
  { tool: 'pen', icon: <PenTool className="size-[18px]" />, label: 'Pen' },
  { tool: 'brush', icon: <Pencil className="size-[18px]" />, label: 'Pencil' },
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
  toolVisibility,
  showModeSwitcher = false,
  selectionActionsEnabled = true,
  showTextControls,
  isVectorPointEditing,
  hasSelectedVectorPoints,
  bitmapBrushKind,
  brushColor,
  brushOpacity,
  brushSize,
  bitmapFillStyle,
  bitmapShapeStyle,
  textStyle,
  vectorStyle,
  vectorStyleMixedState = {},
  vectorStyleCapabilities,
  previewScale = 1,
  onToolChange,
  onMoveOrder,
  onFlipSelection,
  onRotateSelection,
  vectorHandleMode,
  onVectorHandleModeChange,
  onAlign,
  alignDisabled,
  onColorChange,
  onBrushOpacityChange,
  onBitmapBrushKindChange,
  onBrushSizeChange,
  onBitmapFillStyleChange,
  onBitmapShapeStyleChange,
  onTextStyleChange,
  onVectorStyleChange,
  toolAccessory,
}: CostumeToolbarProps) => {
  const [openMenu, setOpenMenu] = useState<ToolbarMenuId | null>(null);
  const showSelectTool = toolVisibility?.showSelectTool ?? true;
  const showPenTool = toolVisibility?.showPenTool ?? true;
  const showBrushTool = toolVisibility?.showBrushTool ?? true;
  const showShapeTools = toolVisibility?.showShapeTools ?? true;
  const showTextTool = toolVisibility?.showTextTool ?? true;

  const handleMenuOpenChange = useCallback((menu: ToolbarMenuId, open: boolean) => {
    setOpenMenu((current) => {
      if (open) return menu;
      return current === menu ? null : current;
    });
  }, []);

  const isShapeMenuOpen = openMenu === 'shape-tools';

  const leadingTools = (editorMode === 'vector' ? vectorPrimaryTools : bitmapPrimaryTools)
    .filter((tool) => {
      if (tool.tool === 'select') return showSelectTool;
      if (tool.tool === 'pen') return showPenTool;
      if (tool.tool === 'brush') return showBrushTool;
      return true;
    });
  const trailingTools = editorMode === 'vector'
    ? vectorTrailingTools.filter((tool) => showTextTool || tool.tool !== 'text')
    : [];
  const currentShapeTool = shapeTools.find((tool) => tool.tool === activeTool) ?? shapeTools[0];
  const shapeToolIsActive = showShapeTools && isShapeTool(activeTool);
  const selectionTool: DrawingTool = 'select';
  const showSelectionActions = selectionActionsEnabled && activeTool === selectionTool && !isVectorPointEditing && hasActiveSelection;
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
    (showSelectionActions || isVectorPointEditing || shapeToolIsActive || activeTool === 'pen' || activeTool === 'brush');
  const showVectorFillControl =
    showVectorStyleControls &&
    (hasActiveSelection ? vectorStyleCapabilities.supportsFill : activeTool !== 'line' && activeTool !== 'brush');
  const hasMixedVectorStrokeColor = vectorStyleMixedState.strokeColor === true;
  const hasMixedVectorFillColor = vectorStyleMixedState.fillColor === true;
  const hasMixedVectorStrokeBrush = vectorStyleMixedState.strokeBrushId === true;
  const hasMixedVectorFillTexture = vectorStyleMixedState.fillTextureId === true;
  const showTextToolbarControls = editorMode === 'vector' && showTextControls;
  const showVectorTopRowControls = showSelectionActions || showVectorHandleControl;
  const useVectorSelectionTwoRowLayout =
    editorMode === 'vector' &&
    showVectorTopRowControls &&
    showVectorStyleControls;
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
  const primaryColorOpacity = showTextControls
    ? textStyle.opacity
    : (editorMode === 'bitmap' && activeTool === 'brush' ? brushOpacity : undefined);
  const handlePrimaryColorOpacityChange = showTextControls
    ? (opacity: number) => onTextStyleChange({ opacity })
    : (editorMode === 'bitmap' && activeTool === 'brush'
      ? onBrushOpacityChange
      : undefined);
  const activeTextAlign = textAlignOptions.find((option) => option.value === textStyle.textAlign) ?? textAlignOptions[0];
  const ActiveTextAlignIcon = activeTextAlign.Icon;
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
            <FloatingPropertyToolbar testId="costume-toolbar-properties">
                <div className={cn('min-w-max', useVectorSelectionTwoRowLayout ? 'flex flex-col items-center gap-2' : 'flex items-center justify-center gap-2')}>
                  <div className="flex min-w-max items-center justify-center gap-2">
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
                      {editorMode === 'vector' && hasActiveSelection && (
                        <DropdownMenu
                          open={openMenu === 'move-order'}
                          onOpenChange={(open) => handleMenuOpenChange('move-order', open)}
                        >
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              className="h-8 w-8"
                              label="Move Order"
                              size="md"
                              variant="outline"
                            >
                              <MoveOrderMenuIcon />
                            </IconButton>
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
                      )}
                      <DropdownMenu
                        open={openMenu === 'align'}
                        onOpenChange={(open) => handleMenuOpenChange('align', open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            className="h-8 w-8"
                            disabled={alignDisabled}
                            label="Align"
                            size="md"
                            variant="outline"
                          >
                            <AlignMenuIcon />
                          </IconButton>
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
                      <IconButton
                        className="h-8 w-8"
                        label="Flip Horizontal"
                        onClick={() => onFlipSelection('horizontal')}
                        size="md"
                        variant="outline"
                      >
                        <FlipHorizontal2 className="size-4" />
                      </IconButton>
                      <IconButton
                        className="h-8 w-8"
                        label="Flip Vertical"
                        onClick={() => onFlipSelection('vertical')}
                        size="md"
                        variant="outline"
                      >
                        <FlipVertical2 className="size-4" />
                      </IconButton>
                      <IconButton
                        className="h-8 w-8"
                        label="Rotate 90 Degrees"
                        onClick={onRotateSelection}
                        size="md"
                        variant="outline"
                      >
                        <RotateCw className="size-4" />
                      </IconButton>
                    </div>
                  )}

                  {showPrimaryColorControl && (
                    <FloatingToolbarColorControl
                      label="Color"
                      value={brushColor}
                      open={openMenu === 'color'}
                      onOpenChange={(open) => handleMenuOpenChange('color', open)}
                      onColorChange={onColorChange}
                      opacity={primaryColorOpacity}
                      onOpacityChange={handlePrimaryColorOpacityChange}
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
                              <span>{BITMAP_BRUSH_OPTIONS.find((option) => option.value === bitmapBrushKind)?.label ?? 'Hard'}</span>
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
                        <FloatingToolbarColorControl
                          label="Fill"
                          value={bitmapShapeStyle.fillColor}
                          open={openMenu === 'fill-color'}
                          onOpenChange={(open) => handleMenuOpenChange('fill-color', open)}
                          onColorChange={(fillColor) => onBitmapShapeStyleChange({ fillColor })}
                          labelDisplay="left"
                        />
                      )}

                      <FloatingToolbarColorControl
                        label="Stroke"
                        value={bitmapShapeStyle.strokeColor}
                        open={openMenu === 'stroke-color'}
                        onOpenChange={(open) => handleMenuOpenChange('stroke-color', open)}
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

                  {!useVectorSelectionTwoRowLayout && showVectorStyleControls && (
                    <>
                      <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Stroke</span>
                        <FloatingToolbarColorControl
                          label="Stroke"
                          value={vectorStyle.strokeColor}
                          mixed={hasMixedVectorStrokeColor}
                          open={openMenu === 'stroke-color'}
                          onOpenChange={(open) => handleMenuOpenChange('stroke-color', open)}
                          onColorChange={(strokeColor) => onVectorStyleChange({ strokeColor })}
                          opacity={vectorStyle.strokeOpacity}
                          onOpacityChange={(strokeOpacity) => onVectorStyleChange({ strokeOpacity })}
                          labelDisplay="none"
                        />
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
                              <span>{hasMixedVectorStrokeBrush ? 'Multiple' : getVectorStrokeBrushLabel(vectorStyle.strokeBrushId)}</span>
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
                        <ToolbarPreviewSlider
                          value={vectorStyle.strokeWidth}
                          onValueChange={(strokeWidth) => onVectorStyleChange({ strokeWidth })}
                          min={0}
                          max={50}
                          labelDisplay="none"
                          className="min-w-[124px] border-r-0 pr-0"
                          sliderClassName="w-16"
                          preview={(
                            <StrokeWidthPreview
                              thickness={vectorStyle.strokeWidth}
                              color={vectorStyle.strokeColor}
                              previewScale={previewScale}
                            />
                          )}
                        />
                      </div>

                      {showVectorFillControl && (
                        <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                          <span className="whitespace-nowrap text-xs text-muted-foreground">Fill</span>
                          <FloatingToolbarColorControl
                            label="Fill"
                            value={vectorStyle.fillColor}
                            mixed={hasMixedVectorFillColor}
                            open={openMenu === 'fill-color'}
                            onOpenChange={(open) => handleMenuOpenChange('fill-color', open)}
                            onColorChange={(fillColor) => onVectorStyleChange({ fillColor })}
                            opacity={vectorStyle.fillOpacity}
                            onOpacityChange={(fillOpacity) => onVectorStyleChange({ fillOpacity })}
                            labelDisplay="none"
                          />
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
                                <span>{hasMixedVectorFillTexture ? 'Multiple' : getVectorFillTextureLabel(vectorStyle.fillTextureId)}</span>
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
                      )}
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
                          <BrushSizePreview
                            size={brushSize}
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

                  {useVectorSelectionTwoRowLayout && (
                    <div className="flex min-w-max items-center justify-center gap-2">
                      <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Stroke</span>
                        <FloatingToolbarColorControl
                          label="Stroke"
                          value={vectorStyle.strokeColor}
                          mixed={hasMixedVectorStrokeColor}
                          open={openMenu === 'stroke-color'}
                          onOpenChange={(open) => handleMenuOpenChange('stroke-color', open)}
                          onColorChange={(strokeColor) => onVectorStyleChange({ strokeColor })}
                          opacity={vectorStyle.strokeOpacity}
                          onOpacityChange={(strokeOpacity) => onVectorStyleChange({ strokeOpacity })}
                          labelDisplay="none"
                        />
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
                              <span>{hasMixedVectorStrokeBrush ? 'Multiple' : getVectorStrokeBrushLabel(vectorStyle.strokeBrushId)}</span>
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
                        <ToolbarPreviewSlider
                          value={vectorStyle.strokeWidth}
                          onValueChange={(strokeWidth) => onVectorStyleChange({ strokeWidth })}
                          min={0}
                          max={50}
                          labelDisplay="none"
                          className="min-w-[124px] border-r-0 pr-0"
                          sliderClassName="w-16"
                          preview={(
                            <StrokeWidthPreview
                              thickness={vectorStyle.strokeWidth}
                              color={vectorStyle.strokeColor}
                              previewScale={previewScale}
                            />
                          )}
                        />
                      </div>

                      {showVectorFillControl && (
                        <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                          <span className="whitespace-nowrap text-xs text-muted-foreground">Fill</span>
                          <FloatingToolbarColorControl
                            label="Fill"
                            value={vectorStyle.fillColor}
                            mixed={hasMixedVectorFillColor}
                            open={openMenu === 'fill-color'}
                            onOpenChange={(open) => handleMenuOpenChange('fill-color', open)}
                            onColorChange={(fillColor) => onVectorStyleChange({ fillColor })}
                            opacity={vectorStyle.fillOpacity}
                            onOpacityChange={(fillOpacity) => onVectorStyleChange({ fillOpacity })}
                            labelDisplay="none"
                          />
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
                                <span>{hasMixedVectorFillTexture ? 'Multiple' : getVectorFillTextureLabel(vectorStyle.fillTextureId)}</span>
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
                      )}
                    </div>
                  )}
                </div>
            </FloatingPropertyToolbar>
          )}

          <FloatingToolToolbar testId="costume-toolbar-tools">
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

                  {showShapeTools ? (
                    <DropdownMenu
                      open={isShapeMenuOpen}
                      onOpenChange={(open) => handleMenuOpenChange('shape-tools', open)}
                    >
                      <div
                        className={cn(
                          'flex items-center gap-1 rounded-[18px] bg-transparent',
                          shapeToolIsActive && floatingToolbarControlActiveClass,
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
                            floatingToolbarControlBaseClass,
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
                            floatingToolbarControlBaseClass,
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
                  ) : null}

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
                {toolAccessory ? (
                  <>
                    <div className="app-divider-x app-divider-fill h-8 shrink-0" />
                    <div className="flex min-w-max items-center gap-2">
                      {toolAccessory}
                    </div>
                  </>
                ) : null}
                {showModeSwitcher ? <div className="hidden" /> : null}
              </div>
          </FloatingToolToolbar>
      </FloatingBottomToolbarDock>
    </>
  );
});

CostumeToolbar.displayName = 'CostumeToolbar';

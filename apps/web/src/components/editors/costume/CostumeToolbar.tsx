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
  Pencil,
  Eraser,
  PaintBucket,
  Circle,
  Square,
  Minus,
  ChevronDown,
  Check,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
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

export type EditorMode = CostumeEditorMode;
export type DrawingTool = 'select' | 'vector' | 'brush' | 'eraser' | 'fill' | 'circle' | 'rectangle' | 'line' | 'text' | 'collider';
export type MoveOrderAction = 'forward' | 'backward' | 'front' | 'back';
export type VectorHandleMode = 'pointed' | 'curved';
export type VectorPathNodeHandleType = 'linear' | 'corner' | 'smooth' | 'symmetric';
export type AlignAction =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

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
  strokeColor: string;
  strokeWidth: number;
}

export interface VectorStyleCapabilities {
  supportsFill: boolean;
}

export function vectorHandleModeToPathNodeHandleType(mode: VectorHandleMode): VectorPathNodeHandleType {
  return mode === 'curved' ? 'smooth' : 'linear';
}

export function pathNodeHandleTypeToVectorHandleMode(type: VectorPathNodeHandleType | null | undefined): VectorHandleMode {
  return type === 'smooth' || type === 'symmetric' ? 'curved' : 'pointed';
}

interface ToolDefinition {
  tool: DrawingTool;
  icon: React.ReactNode;
  label: string;
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
}

const ToolbarColorControl = memo(({
  label,
  value,
  menuId,
  openMenu,
  onMenuOpenChange,
  onColorChange,
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
        <button
          ref={buttonRef}
          type="button"
          className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
          onClick={() => onMenuOpenChange(menuId, !isOpen)}
          title={label}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
        >
          <span
            className="size-4 rounded border border-foreground/15"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
          <span>{label}</span>
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

interface CostumeToolbarProps {
  editorMode: EditorMode;
  activeTool: DrawingTool;
  hasActiveSelection: boolean;
  showTextControls: boolean;
  isVectorPointEditing: boolean;
  hasSelectedVectorPoints: boolean;
  brushColor: string;
  brushSize: number;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  vectorStyleCapabilities: VectorStyleCapabilities;
  onEditorModeChange: (mode: EditorMode) => void;
  onToolChange: (tool: DrawingTool) => void;
  onMoveOrder: (action: MoveOrderAction) => void;
  vectorHandleMode: VectorHandleMode;
  onVectorHandleModeChange: (mode: VectorHandleMode) => void;
  onAlign: (action: AlignAction) => void;
  alignDisabled: boolean;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onTextStyleChange: (updates: Partial<TextToolStyle>) => void;
  onVectorStyleChange: (updates: Partial<VectorToolStyle>) => void;
}

const bitmapPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <MousePointer2 className="size-[18px]" />, label: 'Select' },
  { tool: 'brush', icon: <Pencil className="size-[18px]" />, label: 'Brush' },
  { tool: 'eraser', icon: <Eraser className="size-[18px]" />, label: 'Eraser' },
  { tool: 'fill', icon: <PaintBucket className="size-[18px]" />, label: 'Fill' },
];

const vectorPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <MousePointer2 className="size-[18px]" />, label: 'Select' },
];

const vectorTrailingTools: ToolDefinition[] = [
  { tool: 'text', icon: <Type className="size-[18px]" />, label: 'Text' },
];

const shapeTools: ToolDefinition[] = [
  { tool: 'rectangle', icon: <Square className="size-[18px]" />, label: 'Rectangle' },
  { tool: 'circle', icon: <Circle className="size-[18px]" />, label: 'Circle' },
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

const alignGrid: Array<{ action: AlignAction; label: string; title: string }> = [
  { action: 'top-left', label: '↖', title: 'Top Left' },
  { action: 'top-center', label: '↑', title: 'Top Center' },
  { action: 'top-right', label: '↗', title: 'Top Right' },
  { action: 'middle-left', label: '←', title: 'Middle Left' },
  { action: 'middle-center', label: '•', title: 'Center' },
  { action: 'middle-right', label: '→', title: 'Middle Right' },
  { action: 'bottom-left', label: '↙', title: 'Bottom Left' },
  { action: 'bottom-center', label: '↓', title: 'Bottom Center' },
  { action: 'bottom-right', label: '↘', title: 'Bottom Right' },
];

const vectorHandleModeOptions: Array<{ value: VectorHandleMode; label: string }> = [
  { value: 'pointed', label: 'Pointed' },
  { value: 'curved', label: 'Curved' },
];

function isShapeTool(tool: DrawingTool) {
  return shapeTools.some((shapeTool) => shapeTool.tool === tool);
}

export const CostumeToolbar = memo(({
  editorMode,
  activeTool,
  hasActiveSelection,
  showTextControls,
  isVectorPointEditing,
  hasSelectedVectorPoints,
  brushColor,
  brushSize,
  textStyle,
  vectorStyle,
  vectorStyleCapabilities,
  onEditorModeChange,
  onToolChange,
  onMoveOrder,
  vectorHandleMode,
  onVectorHandleModeChange,
  onAlign,
  alignDisabled,
  onColorChange,
  onBrushSizeChange,
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
  const showSelectionActions = activeTool === 'select' && !isVectorPointEditing;
  const showContextualPropertyBar = isVectorPointEditing || !(showSelectionActions && !hasActiveSelection);
  const showPrimaryColorControl = editorMode === 'bitmap' || showTextControls;
  const showVectorStyleControls =
    editorMode === 'vector' &&
    !showTextControls &&
    (showSelectionActions || isVectorPointEditing || shapeToolIsActive);
  const showVectorFillControl =
    showVectorStyleControls &&
    (hasActiveSelection ? vectorStyleCapabilities.supportsFill : activeTool !== 'line');
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

                  {editorMode === 'vector' && isVectorPointEditing && hasSelectedVectorPoints && (
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
                            className="h-8 min-w-[120px] justify-between gap-2 px-2 text-xs"
                          >
                            <span>{vectorHandleMode === 'curved' ? 'Curved' : 'Pointed'}</span>
                            <ChevronDown className="size-3 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="min-w-[140px]">
                          <DropdownMenuRadioGroup
                            value={vectorHandleMode}
                            onValueChange={(value) => onVectorHandleModeChange(value as VectorHandleMode)}
                          >
                            {vectorHandleModeOptions.map((option) => (
                              <DropdownMenuRadioItem key={option.value} value={option.value}>
                                {option.label}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showSelectionActions && (
                    <div className="flex items-center border-r pr-2 last:border-r-0 last:pr-0">
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
                        <DropdownMenuContent align="start" side="top" sideOffset={toolbarPopupSideOffset} className="w-[140px] p-2">
                          <div className="grid grid-cols-3 gap-1">
                            {alignGrid.map((item) => (
                              <DropdownMenuItem
                                key={item.action}
                                className="h-8 w-8 justify-center rounded border p-0 text-sm"
                                title={item.title}
                                onClick={() => onAlign(item.action)}
                              >
                                {item.label}
                              </DropdownMenuItem>
                            ))}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
                    />
                  )}

                  {showVectorStyleControls && (
                    <>
                      {showVectorFillControl && (
                        <ToolbarColorControl
                          label="Fill"
                          value={vectorStyle.fillColor}
                          menuId="fill-color"
                          openMenu={openMenu}
                          onMenuOpenChange={handleMenuOpenChange}
                          onColorChange={(fillColor) => onVectorStyleChange({ fillColor })}
                        />
                      )}

                      <ToolbarColorControl
                        label="Stroke"
                        value={vectorStyle.strokeColor}
                        menuId="stroke-color"
                        openMenu={openMenu}
                        onMenuOpenChange={handleMenuOpenChange}
                        onColorChange={(strokeColor) => onVectorStyleChange({ strokeColor })}
                      />

                      <div className="flex min-w-[132px] items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Stroke</span>
                        <Slider.Root
                          className="relative flex h-4 w-full touch-none items-center"
                          value={[vectorStyle.strokeWidth]}
                          onValueChange={([strokeWidth]) => onVectorStyleChange({ strokeWidth })}
                          min={0}
                          max={50}
                          step={1}
                        >
                          <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-secondary">
                            <Slider.Range className="absolute h-full rounded-full bg-primary" />
                          </Slider.Track>
                          <Slider.Thumb className="block size-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                        </Slider.Root>
                        <span className="w-6 text-right text-xs text-muted-foreground">{vectorStyle.strokeWidth}</span>
                      </div>
                    </>
                  )}

                  {editorMode === 'bitmap' && (
                    <div className="flex min-w-[120px] items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">Size:</span>
                      <Slider.Root
                        className="relative flex h-4 w-full touch-none items-center"
                        value={[brushSize]}
                        onValueChange={([value]) => onBrushSizeChange(value)}
                        min={1}
                        max={50}
                        step={1}
                      >
                        <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-secondary">
                          <Slider.Range className="absolute h-full rounded-full bg-primary" />
                        </Slider.Track>
                        <Slider.Thumb className="block size-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                      </Slider.Root>
                      <span className="w-6 text-right text-xs text-muted-foreground">{brushSize}</span>
                    </div>
                  )}

                  {editorMode === 'vector' && showTextControls && (
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

                      <div className="flex min-w-[90px] items-center gap-1">
                        <span className="text-xs text-muted-foreground">Sz</span>
                        <Slider.Root
                          className="relative flex h-4 w-16 touch-none items-center"
                          value={[textStyle.fontSize]}
                          onValueChange={([value]) => onTextStyleChange({ fontSize: value })}
                          min={8}
                          max={120}
                          step={1}
                        >
                          <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-secondary">
                            <Slider.Range className="absolute h-full rounded-full bg-primary" />
                          </Slider.Track>
                          <Slider.Thumb className="block size-3 rounded-full border border-primary/50 bg-background shadow" />
                        </Slider.Root>
                        <span className="w-6 text-right text-xs text-muted-foreground">{textStyle.fontSize}</span>
                      </div>

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
                            className="h-8 min-w-[110px] justify-between gap-2 px-2 text-xs"
                          >
                            <span className="inline-flex items-center gap-2">
                              <ActiveTextAlignIcon className="size-3.5" />
                              <span>{activeTextAlign.label}</span>
                            </span>
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
              </div>
          </FloatingBottomToolbar>
      </FloatingBottomToolbarDock>
    </>
  );
});

CostumeToolbar.displayName = 'CostumeToolbar';

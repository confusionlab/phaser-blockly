import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import * as Select from '@radix-ui/react-select';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import {
  ColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
} from '@/components/ui/color-picker';
import {
  MousePointer2,
  PenTool,
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
export type VectorHandleType = 'linear' | 'corner' | 'smooth' | 'symmetric';
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

const floatingToolButtonBaseClass =
  'h-11 rounded-[18px] bg-transparent text-muted-foreground shadow-none transition-colors duration-200 hover:!bg-transparent hover:text-foreground';
const floatingToolButtonActiveClass =
  '!bg-foreground/[0.08] text-foreground shadow-none hover:!bg-foreground/[0.08] dark:!bg-white/[0.12] dark:hover:!bg-white/[0.12]';
const floatingBarChromeClass =
  'pointer-events-auto max-w-full border border-border/70 bg-background/95 backdrop-blur-xl dark:bg-background/90';
const floatingPropertyBarClass =
  `${floatingBarChromeClass} rounded-[24px] px-3 py-2 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45),0_6px_18px_-14px_rgba(15,23,42,0.24)] dark:shadow-[0_24px_64px_-38px_rgba(0,0,0,0.8),0_6px_18px_-14px_rgba(0,0,0,0.52)]`;
const floatingToolBarClass =
  `${floatingBarChromeClass} rounded-[28px] p-2 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.5),0_8px_20px_-16px_rgba(15,23,42,0.28)] dark:shadow-[0_28px_72px_-38px_rgba(0,0,0,0.8),0_8px_24px_-18px_rgba(0,0,0,0.6)]`;

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

interface CostumeToolbarProps {
  editorMode: EditorMode;
  activeTool: DrawingTool;
  hasActiveSelection: boolean;
  showTextControls: boolean;
  brushColor: string;
  brushSize: number;
  textStyle: TextToolStyle;
  onEditorModeChange: (mode: EditorMode) => void;
  onToolChange: (tool: DrawingTool) => void;
  onMoveOrder: (action: MoveOrderAction) => void;
  vectorHandleType: VectorHandleType;
  onVectorHandleTypeChange: (type: VectorHandleType) => void;
  onAlign: (action: AlignAction) => void;
  alignDisabled: boolean;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onTextStyleChange: (updates: Partial<TextToolStyle>) => void;
}

const bitmapPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <MousePointer2 className="size-[18px]" />, label: 'Select' },
  { tool: 'brush', icon: <Pencil className="size-[18px]" />, label: 'Brush' },
  { tool: 'eraser', icon: <Eraser className="size-[18px]" />, label: 'Eraser' },
  { tool: 'fill', icon: <PaintBucket className="size-[18px]" />, label: 'Fill' },
];

const vectorPrimaryTools: ToolDefinition[] = [
  { tool: 'select', icon: <MousePointer2 className="size-[18px]" />, label: 'Select' },
  { tool: 'vector', icon: <PenTool className="size-[18px]" />, label: 'Vector Point' },
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

const vectorHandleTypeOptions: Array<{ value: VectorHandleType; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'corner', label: 'Corner' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'symmetric', label: 'Symmetric' },
];

function isShapeTool(tool: DrawingTool) {
  return shapeTools.some((shapeTool) => shapeTool.tool === tool);
}

export const CostumeToolbar = memo(({
  editorMode,
  activeTool,
  hasActiveSelection,
  showTextControls,
  brushColor,
  brushSize,
  textStyle,
  onEditorModeChange,
  onToolChange,
  onMoveOrder,
  vectorHandleType,
  onVectorHandleTypeChange,
  onAlign,
  alignDisabled,
  onColorChange,
  onBrushSizeChange,
  onTextStyleChange,
}: CostumeToolbarProps) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const colorControlRef = useRef<HTMLDivElement>(null);

  const handleColorChange = useCallback((value: Parameters<typeof Color.rgb>[0]) => {
    try {
      const color = Color(value);
      onColorChange(color.hex());
    } catch {
      // Ignore invalid color payloads.
    }
  }, [onColorChange]);

  useEffect(() => {
    if (!showColorPicker) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (colorControlRef.current?.contains(target)) return;
      setShowColorPicker(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowColorPicker(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showColorPicker]);

  const leadingTools = editorMode === 'vector' ? vectorPrimaryTools : bitmapPrimaryTools;
  const trailingTools = editorMode === 'vector' ? vectorTrailingTools : [];
  const currentShapeTool = shapeTools.find((tool) => tool.tool === activeTool) ?? shapeTools[0];
  const shapeToolIsActive = isShapeTool(activeTool);
  const showSelectionActions = activeTool === 'select';
  const activeTextAlign = textAlignOptions.find((option) => option.value === textStyle.textAlign) ?? textAlignOptions[0];
  const ActiveTextAlignIcon = activeTextAlign.Icon;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
        <div className="flex max-w-full flex-col items-center gap-3">
          <div className={floatingPropertyBarClass} data-testid="costume-toolbar-properties">
            <div className="hide-scrollbar max-w-full overflow-x-auto overflow-y-visible">
              <div className="flex min-w-max items-center gap-2">
              {editorMode === 'vector' && showSelectionActions && hasActiveSelection && (
                <div className="flex items-center border-r pr-2 last:border-r-0 last:pr-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                        Move Order
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" sideOffset={10} className="min-w-[160px]">
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

              {editorMode === 'vector' && activeTool === 'vector' && (
                <div className="flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0">
                  <span className="whitespace-nowrap text-xs text-muted-foreground">Handles</span>
                  <Select.Root value={vectorHandleType} onValueChange={(value) => onVectorHandleTypeChange(value as VectorHandleType)}>
                    <Select.Trigger className="flex h-8 min-w-[120px] items-center justify-between gap-2 rounded-md border bg-background px-2 text-xs">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="z-[70] rounded-md border bg-popover shadow-md">
                        <Select.Viewport className="p-1">
                          {vectorHandleTypeOptions.map((option) => (
                            <Select.Item
                              key={option.value}
                              value={option.value}
                              className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                            >
                              <Select.ItemText>{option.label}</Select.ItemText>
                              <Select.ItemIndicator>
                                <Check className="size-3" />
                              </Select.ItemIndicator>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              )}

              {showSelectionActions && (
                <div className="flex items-center border-r pr-2 last:border-r-0 last:pr-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={alignDisabled}>
                        Align
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" sideOffset={10} className="w-[140px] p-2">
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

              <div
                ref={colorControlRef}
                className="relative flex items-center gap-2 border-r pr-2 last:border-r-0 last:pr-0"
              >
                <button
                  type="button"
                  className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
                  onClick={() => setShowColorPicker((prev) => !prev)}
                  title="Color"
                  aria-expanded={showColorPicker}
                  aria-haspopup="dialog"
                >
                  <span
                    className="size-4 rounded border border-foreground/15"
                    style={{ backgroundColor: brushColor }}
                    aria-hidden="true"
                  />
                  <span>Color</span>
                </button>
                {showColorPicker && (
                  <div className="absolute bottom-full left-0 z-50 mb-2 rounded-lg border bg-popover p-3 shadow-lg">
                    <ColorPicker value={brushColor} onChange={handleColorChange} className="w-48">
                      <ColorPickerSelection className="mb-2 h-32 rounded" />
                      <ColorPickerHue />
                    </ColorPicker>
                  </div>
                )}
              </div>

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
                  <DropdownMenu>
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
                    <DropdownMenuContent align="start" side="top" sideOffset={10} className="min-w-[156px]">
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

                  <DropdownMenu>
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
                    <DropdownMenuContent align="start" side="top" sideOffset={10} className="min-w-[156px]">
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

                  <DropdownMenu>
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
                    <DropdownMenuContent align="start" side="top" sideOffset={10} className="min-w-[148px]">
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
            </div>
          </div>

          <div className={floatingToolBarClass} data-testid="costume-toolbar-tools">
            <div className="hide-scrollbar max-w-full overflow-x-auto overflow-y-visible">
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

                <DropdownMenu open={shapeMenuOpen} onOpenChange={setShapeMenuOpen}>
                  <div
                    className={cn(
                      'flex items-center gap-1 rounded-[18px] bg-transparent',
                      shapeToolIsActive && floatingToolButtonActiveClass,
                    )}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setShapeMenuOpen(true);
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
                        aria-expanded={shapeMenuOpen}
                      >
                        <ChevronDown className="size-3.5 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                  </div>
                  <DropdownMenuContent
                    side="top"
                    align="center"
                    sideOffset={12}
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
                            setShapeMenuOpen(false);
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

                <div className="w-[164px] rounded-[20px] bg-black/[0.045] p-1 dark:bg-white/[0.05]">
                  <SegmentedControl
                    ariaLabel="Costume editor mode"
                    options={modeOptions}
                    value={editorMode}
                    onValueChange={onEditorModeChange}
                    className="w-full rounded-[16px] bg-background/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] dark:bg-black/30"
                    optionClassName="min-h-[40px] rounded-[14px] px-3 text-[13px] font-medium"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});

CostumeToolbar.displayName = 'CostumeToolbar';

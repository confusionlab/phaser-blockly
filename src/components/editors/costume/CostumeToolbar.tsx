import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import * as Select from '@radix-ui/react-select';
import { Button } from '@/components/ui/button';
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Color from 'color';

export type EditorMode = 'bitmap' | 'vector';
export type DrawingTool = 'select' | 'vector' | 'brush' | 'eraser' | 'fill' | 'circle' | 'rectangle' | 'line' | 'text' | 'collider';
export type MoveOrderAction = 'forward' | 'backward' | 'front' | 'back';
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
  textAlign: 'left' | 'center' | 'right';
  opacity: number;
}

interface ToolButtonProps {
  tool: DrawingTool;
  icon: React.ReactNode;
  label: string;
  activeTool: DrawingTool;
  onClick: (tool: DrawingTool) => void;
}

const ToolButton = memo(({ tool, icon, label, activeTool, onClick }: ToolButtonProps) => (
  <Button
    variant={activeTool === tool ? 'default' : 'ghost'}
    size="icon"
    className="size-8"
    onClick={() => onClick(tool)}
    title={label}
  >
    {icon}
  </Button>
));

ToolButton.displayName = 'ToolButton';

interface CostumeToolbarProps {
  editorMode: EditorMode;
  activeTool: DrawingTool;
  showTextControls: boolean;
  brushColor: string;
  brushSize: number;
  textStyle: TextToolStyle;
  onEditorModeChange: (mode: EditorMode) => void;
  onToolChange: (tool: DrawingTool) => void;
  onMoveOrder: (action: MoveOrderAction) => void;
  onAlign: (action: AlignAction) => void;
  alignDisabled: boolean;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onTextStyleChange: (updates: Partial<TextToolStyle>) => void;
}

const bitmapTools: { tool: DrawingTool; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 className="size-4" />, label: 'Select' },
  { tool: 'brush', icon: <Pencil className="size-4" />, label: 'Brush' },
  { tool: 'eraser', icon: <Eraser className="size-4" />, label: 'Eraser' },
  { tool: 'fill', icon: <PaintBucket className="size-4" />, label: 'Fill' },
  { tool: 'circle', icon: <Circle className="size-4" />, label: 'Circle' },
  { tool: 'rectangle', icon: <Square className="size-4" />, label: 'Rectangle' },
  { tool: 'line', icon: <Minus className="size-4" />, label: 'Line' },
];

const vectorTools: { tool: DrawingTool; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 className="size-4" />, label: 'Select' },
  { tool: 'vector', icon: <PenTool className="size-4" />, label: 'Vector Point' },
  { tool: 'rectangle', icon: <Square className="size-4" />, label: 'Rectangle' },
  { tool: 'circle', icon: <Circle className="size-4" />, label: 'Circle' },
  { tool: 'line', icon: <Minus className="size-4" />, label: 'Line' },
  { tool: 'text', icon: <Type className="size-4" />, label: 'Text' },
];

const fontFamilyOptions = [
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Courier New',
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

export const CostumeToolbar = memo(({
  editorMode,
  activeTool,
  showTextControls,
  brushColor,
  brushSize,
  textStyle,
  onEditorModeChange,
  onToolChange,
  onMoveOrder,
  onAlign,
  alignDisabled,
  onColorChange,
  onBrushSizeChange,
  onTextStyleChange,
}: CostumeToolbarProps) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPosition, setColorPickerPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const colorButtonRef = useRef<HTMLButtonElement>(null);

  const handleColorChange = useCallback((value: Parameters<typeof Color.rgb>[0]) => {
    try {
      const color = Color(value);
      onColorChange(color.hex());
    } catch {
      // Ignore invalid color payloads.
    }
  }, [onColorChange]);

  const tools = editorMode === 'vector' ? vectorTools : bitmapTools;

  const updateColorPickerPosition = useCallback(() => {
    const button = colorButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const pickerWidth = 212; // 192px content + padding/border
    const viewportPadding = 8;
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - pickerWidth - viewportPadding)
    );
    setColorPickerPosition({
      left,
      top: rect.bottom + 8,
    });
  }, []);

  useEffect(() => {
    if (!showColorPicker) return;
    updateColorPickerPosition();
    const onViewportChange = () => updateColorPickerPosition();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [showColorPicker, updateColorPickerPosition]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-background overflow-x-auto overflow-y-hidden">
      <div className="flex items-center gap-1 border-r pr-2">
        <Button
          variant={editorMode === 'bitmap' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onEditorModeChange('bitmap')}
        >
          Bitmap
        </Button>
        <Button
          variant={editorMode === 'vector' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onEditorModeChange('vector')}
        >
          Vector
        </Button>
      </div>

      <div className="flex items-center gap-0.5 border-r pr-2">
        {tools.map(({ tool, icon, label }) => (
          <ToolButton
            key={tool}
            tool={tool}
            icon={icon}
            label={label}
            activeTool={activeTool}
            onClick={onToolChange}
          />
        ))}
      </div>

      {editorMode === 'vector' && (
        <div className="flex items-center border-r pr-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                Move Order
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
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

      <div className="flex items-center border-r pr-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" disabled={alignDisabled}>
              Align
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[140px] p-2">
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

      <div className="relative flex items-center gap-2 border-r pr-2">
        <button
          ref={colorButtonRef}
          type="button"
          className="size-7 rounded border cursor-pointer"
          style={{ backgroundColor: brushColor }}
          onClick={() => {
            if (!showColorPicker) {
              updateColorPickerPosition();
            }
            setShowColorPicker(!showColorPicker);
          }}
          title="Color"
        />
        {showColorPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowColorPicker(false)} />
            <div
              className="fixed z-50 bg-popover border rounded-lg p-3 shadow-lg"
              style={{
                left: colorPickerPosition.left,
                top: colorPickerPosition.top,
              }}
            >
              <ColorPicker value={brushColor} onChange={handleColorChange} className="w-48">
                <ColorPickerSelection className="h-32 rounded mb-2" />
                <ColorPickerHue />
              </ColorPicker>
            </div>
          </>
        )}
      </div>

      {editorMode === 'bitmap' && (
        <div className="flex items-center gap-2 border-r pr-2 min-w-[120px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Size:</span>
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
          <span className="text-xs text-muted-foreground w-6 text-right">{brushSize}</span>
        </div>
      )}

      {editorMode === 'vector' && showTextControls && (
        <div className="flex items-center gap-2 border-r pr-2">
          <Select.Root
            value={textStyle.fontFamily}
            onValueChange={(fontFamily) => onTextStyleChange({ fontFamily })}
          >
            <Select.Trigger className="inline-flex items-center justify-between gap-1 h-8 px-2 text-xs bg-background border rounded hover:bg-accent min-w-[120px]">
              <Select.Value />
              <Select.Icon>
                <ChevronDown className="size-3" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="bg-popover border rounded-md shadow-md z-50">
                <Select.Viewport className="p-1">
                  {fontFamilyOptions.map((family) => (
                    <Select.Item
                      key={family}
                      value={family}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none hover:bg-accent data-[highlighted]:bg-accent"
                    >
                      <Select.ItemIndicator>
                        <Check className="size-3" />
                      </Select.ItemIndicator>
                      <Select.ItemText>{family}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          <div className="flex items-center gap-1 min-w-[90px]">
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
            <span className="text-xs text-muted-foreground w-6 text-right">{textStyle.fontSize}</span>
          </div>

          <Button
            size="sm"
            variant={textStyle.fontWeight === 'bold' ? 'default' : 'outline'}
            className="h-8 px-2 text-xs font-bold"
            onClick={() => onTextStyleChange({ fontWeight: textStyle.fontWeight === 'bold' ? 'normal' : 'bold' })}
          >
            B
          </Button>

          <div className="flex items-center gap-0.5">
            {(['left', 'center', 'right'] as const).map((align) => (
              <Button
                key={align}
                size="icon"
                variant={textStyle.textAlign === align ? 'default' : 'outline'}
                className="size-8"
                onClick={() => onTextStyleChange({ textAlign: align })}
                title={`Align ${align}`}
              >
                {align === 'left' && <AlignLeft className="size-3.5" />}
                {align === 'center' && <AlignCenter className="size-3.5" />}
                {align === 'right' && <AlignRight className="size-3.5" />}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1 min-w-[110px]">
            <span className="text-xs text-muted-foreground">Op</span>
            <Slider.Root
              className="relative flex h-4 w-16 touch-none items-center"
              value={[Math.round(textStyle.opacity * 100)]}
              onValueChange={([value]) => onTextStyleChange({ opacity: value / 100 })}
              min={10}
              max={100}
              step={1}
            >
              <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-secondary">
                <Slider.Range className="absolute h-full rounded-full bg-primary" />
              </Slider.Track>
              <Slider.Thumb className="block size-3 rounded-full border border-primary/50 bg-background shadow" />
            </Slider.Root>
            <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(textStyle.opacity * 100)}%</span>
          </div>
        </div>
      )}

    </div>
  );
});

CostumeToolbar.displayName = 'CostumeToolbar';

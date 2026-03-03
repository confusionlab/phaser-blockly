export type BitmapBrushTool = 'brush' | 'eraser';

export interface BrushCursorStyle {
  diameter: number;
  stroke: string;
  fill: string;
  borderWidth: number;
}

export function isEraseTool(tool: BitmapBrushTool): boolean {
  return tool === 'eraser';
}

export function getCompositeOperation(tool: BitmapBrushTool): GlobalCompositeOperation {
  return isEraseTool(tool) ? 'destination-out' : 'source-over';
}

export function getBrushPaintColor(tool: BitmapBrushTool, brushColor: string): string {
  return isEraseTool(tool) ? '#000000' : brushColor;
}

export function getBrushCursorStyle(
  tool: BitmapBrushTool,
  brushColor: string,
  brushSize: number,
  displayScale: number,
): BrushCursorStyle {
  const diameter = Math.max(6, brushSize * displayScale);
  if (isEraseTool(tool)) {
    return {
      diameter,
      stroke: 'rgba(17,17,17,0.95)',
      fill: 'rgba(255,255,255,0.55)',
      borderWidth: 2,
    };
  }

  return {
    diameter,
    stroke: brushColor,
    fill: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
  };
}

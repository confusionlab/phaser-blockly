import { ActiveSelection, Canvas as FabricCanvas, PencilBrush } from 'fabric';
import Color from 'color';
import {
  DEFAULT_VECTOR_FILL_TEXTURE_ID,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';
import {
  DEFAULT_VECTOR_STROKE_BRUSH_ID,
  type VectorStrokeBrushId,
} from '@/lib/vector/vectorStrokeBrushCore';
import type {
  VectorStyleCapabilities,
  VectorToolStyle,
} from './CostumeToolbar';
import { HANDLE_SIZE } from './costumeCanvasShared';

export const VECTOR_JSON_EXTRA_PROPS = [
  'nodeHandleTypes',
  'strokeUniform',
  'vectorFillTextureId',
  'vectorFillColor',
  'vectorStrokeBrushId',
  'vectorStrokeColor',
];

export const VECTOR_POINT_CONTROL_STYLE = {
  cornerColor: '#0ea5e9',
  cornerStrokeColor: '#ffffff',
  cornerSize: HANDLE_SIZE,
  transparentCorners: false,
};

export function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

export function isActiveSelectionObject(obj: unknown): obj is ActiveSelection {
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

export function isTextObject(obj: unknown): obj is { type: string; set: (props: Record<string, unknown>) => void } {
  const type = getFabricObjectType(obj);
  return type === 'itext' || type === 'i-text' || type === 'textbox' || type === 'text';
}

export function isImageObject(obj: unknown): obj is { type: string } {
  return getFabricObjectType(obj) === 'image';
}

export function getSelectedObjects(obj: unknown): any[] {
  if (!obj) return [];
  if (isActiveSelectionObject(obj) && typeof obj.getObjects === 'function') {
    return (obj.getObjects() as any[]).filter(Boolean);
  }
  return [obj];
}

export function isDirectlyEditablePathObject(obj: unknown): obj is { type: 'path' } {
  return getFabricObjectType(obj) === 'path';
}

export function getVectorStyleTargets(obj: unknown): any[] {
  return getSelectedObjects(obj).filter((candidate) => (
    !!candidate &&
    !isImageObject(candidate) &&
    !isTextObject(candidate) &&
    !isActiveSelectionObject(candidate)
  ));
}

export interface VectorBrushStylableObject {
  fill?: unknown;
  noScaleCache?: boolean;
  opacity?: number;
  set?: (props: Record<string, unknown>) => void;
  stroke?: unknown;
  strokeUniform?: boolean;
  strokeWidth?: number;
  vectorFillColor?: string;
  vectorFillTextureId?: VectorFillTextureId;
  vectorStrokeBrushId?: VectorStrokeBrushId;
  vectorStrokeColor?: string;
}

export function getVectorObjectFillTextureId(obj: unknown): VectorFillTextureId {
  const textureId = (obj as VectorBrushStylableObject | null | undefined)?.vectorFillTextureId;
  return typeof textureId === 'string' ? (textureId as VectorFillTextureId) : DEFAULT_VECTOR_FILL_TEXTURE_ID;
}

export function getVectorObjectFillColor(obj: unknown): string | undefined {
  const vectorFillColor = (obj as VectorBrushStylableObject | null | undefined)?.vectorFillColor;
  if (typeof vectorFillColor === 'string' && vectorFillColor.length > 0) {
    return vectorFillColor;
  }
  const fill = (obj as VectorBrushStylableObject | null | undefined)?.fill;
  if (typeof fill === 'string' && fill.length > 0) {
    return fill;
  }
  return undefined;
}

export function getVectorObjectStrokeBrushId(obj: unknown): VectorStrokeBrushId {
  const brushId = (obj as VectorBrushStylableObject | null | undefined)?.vectorStrokeBrushId;
  return typeof brushId === 'string' ? (brushId as VectorStrokeBrushId) : DEFAULT_VECTOR_STROKE_BRUSH_ID;
}

export function getVectorObjectStrokeColor(obj: unknown): string | undefined {
  const vectorStrokeColor = (obj as VectorBrushStylableObject | null | undefined)?.vectorStrokeColor;
  if (typeof vectorStrokeColor === 'string' && vectorStrokeColor.length > 0) {
    return vectorStrokeColor;
  }
  const stroke = (obj as VectorBrushStylableObject | null | undefined)?.stroke;
  if (typeof stroke === 'string' && stroke.length > 0) {
    return stroke;
  }
  return undefined;
}

export function getVectorObjectOpacity(obj: unknown): number | undefined {
  const opacity = (obj as VectorBrushStylableObject | null | undefined)?.opacity;
  return typeof opacity === 'number' && Number.isFinite(opacity) ? opacity : undefined;
}

export function getFabricStrokeValueForVectorBrush(brushId: VectorStrokeBrushId, strokeColor: string) {
  return brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID
    ? strokeColor
    : Color(strokeColor).alpha(0).rgb().string();
}

export function getFabricFillValueForVectorTexture(textureId: VectorFillTextureId, fillColor: string) {
  return textureId === DEFAULT_VECTOR_FILL_TEXTURE_ID
    ? fillColor
    : Color(fillColor).alpha(0).rgb().string();
}

export function applyVectorFillStyleToObject(
  obj: VectorBrushStylableObject | null | undefined,
  style: Pick<VectorToolStyle, 'fillColor' | 'fillTextureId'>,
): boolean {
  if (!obj || typeof obj.set !== 'function') {
    return false;
  }

  const updates: Record<string, unknown> = {};
  if (obj.vectorFillTextureId !== style.fillTextureId) {
    updates.vectorFillTextureId = style.fillTextureId;
  }
  if (obj.vectorFillColor !== style.fillColor) {
    updates.vectorFillColor = style.fillColor;
  }
  const renderFill = getFabricFillValueForVectorTexture(style.fillTextureId, style.fillColor);
  if (obj.fill !== renderFill) {
    updates.fill = renderFill;
  }
  if (Object.keys(updates).length === 0) {
    return false;
  }

  obj.set(updates);
  return true;
}

export function applyVectorStrokeStyleToObject(
  obj: VectorBrushStylableObject | null | undefined,
  style: Pick<VectorToolStyle, 'strokeBrushId' | 'strokeColor' | 'strokeWidth'>,
): boolean {
  if (!obj || typeof obj.set !== 'function') {
    return false;
  }

  const strokeWidth = Math.max(0, style.strokeWidth);
  const updates: Record<string, unknown> = {};
  if (obj.vectorStrokeBrushId !== style.strokeBrushId) {
    updates.vectorStrokeBrushId = style.strokeBrushId;
  }
  if (obj.vectorStrokeColor !== style.strokeColor) {
    updates.vectorStrokeColor = style.strokeColor;
  }
  const renderStroke = getFabricStrokeValueForVectorBrush(style.strokeBrushId, style.strokeColor);
  if (obj.stroke !== renderStroke) {
    updates.stroke = renderStroke;
  }
  if (obj.strokeWidth !== strokeWidth) {
    updates.strokeWidth = strokeWidth;
  }
  if (obj.strokeUniform !== true) {
    updates.strokeUniform = true;
  }
  if (obj.noScaleCache !== false) {
    updates.noScaleCache = false;
  }
  if (Object.keys(updates).length === 0) {
    return false;
  }

  obj.set(updates);
  return true;
}

export function applyVectorOpacityToObject(
  obj: VectorBrushStylableObject | null | undefined,
  opacity: number,
): boolean {
  if (!obj || typeof obj.set !== 'function') {
    return false;
  }

  const normalizedOpacity = Math.max(0, Math.min(1, opacity));
  if (obj.opacity === normalizedOpacity) {
    return false;
  }

  obj.set({ opacity: normalizedOpacity });
  return true;
}

export function normalizeVectorObjectRendering(obj: unknown): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
    return false;
  }

  const candidate = obj as {
    strokeUniform?: boolean;
    noScaleCache?: boolean;
    set?: (props: Record<string, unknown>) => void;
  };
  if (typeof candidate.set !== 'function') {
    return false;
  }

  const updates: Record<string, unknown> = {};
  if (candidate.strokeUniform !== true) {
    updates.strokeUniform = true;
  }
  if (candidate.noScaleCache !== false) {
    updates.noScaleCache = false;
  }
  const strokeColor = getVectorObjectStrokeColor(candidate);
  const brushId = getVectorObjectStrokeBrushId(candidate);
  const fillColor = getVectorObjectFillColor(candidate);
  const fillTextureId = getVectorObjectFillTextureId(candidate);
  if (typeof strokeColor === 'string' && strokeColor.length > 0) {
    const renderStroke = getFabricStrokeValueForVectorBrush(brushId, strokeColor);
    if ((candidate as { stroke?: unknown }).stroke !== renderStroke) {
      updates.stroke = renderStroke;
    }
  }
  if (typeof fillColor === 'string' && fillColor.length > 0) {
    const renderFill = getFabricFillValueForVectorTexture(fillTextureId, fillColor);
    if ((candidate as { fill?: unknown }).fill !== renderFill) {
      updates.fill = renderFill;
    }
  }
  if (Object.keys(updates).length === 0) {
    return false;
  }

  candidate.set(updates);
  return true;
}

export function getPathCommandType(command: unknown): string {
  if (!Array.isArray(command) || typeof command[0] !== 'string') return '';
  return command[0].trim().toUpperCase();
}

export function getPathCommandEndpoint(command: unknown): { x: number; y: number } | null {
  if (!Array.isArray(command) || command.length < 3) return null;
  const x = Number(command[command.length - 2]);
  const y = Number(command[command.length - 1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function pathCommandsDescribeClosedShape(path: unknown): boolean {
  if (!Array.isArray(path) || path.length === 0) return false;
  if (path.some((command) => getPathCommandType(command) === 'Z')) {
    return true;
  }

  const start = getPathCommandEndpoint(path[0]);
  if (!start) return false;

  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (getPathCommandType(path[index]) === 'Z') {
      continue;
    }

    const end = getPathCommandEndpoint(path[index]);
    if (!end) return false;
    return Math.abs(start.x - end.x) <= 0.0001 && Math.abs(start.y - end.y) <= 0.0001;
  }

  return false;
}

export function vectorObjectSupportsFill(obj: unknown): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
    return false;
  }

  const type = getFabricObjectType(obj);
  if (type === 'line' || type === 'polyline') {
    return false;
  }
  if (type === 'path') {
    return pathCommandsDescribeClosedShape((obj as { path?: unknown }).path);
  }

  return true;
}

export function getVectorStyleCapabilitiesForSelection(obj: unknown): VectorStyleCapabilities {
  const targets = getVectorStyleTargets(obj);
  if (targets.length === 0) {
    return { supportsFill: true };
  }

  return {
    supportsFill: targets.every((target) => vectorObjectSupportsFill(target)),
  };
}

export function isVectorPointSelectableObject(obj: unknown): obj is Record<string, any> {
  if (!obj || typeof obj !== 'object') return false;
  if (isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) return false;
  return true;
}

interface VectorPencilBrushOptions {
  opacity: number;
  strokeBrushId: VectorStrokeBrushId;
  strokeColor: string;
  strokeWidth: number;
}

export class VectorPencilBrush extends PencilBrush {
  private readonly opacityValue: number;
  private readonly strokeBrushId: VectorStrokeBrushId;
  private readonly strokeColor: string;
  private readonly strokeWidthValue: number;

  constructor(canvas: FabricCanvas, options: VectorPencilBrushOptions) {
    super(canvas as any);
    this.opacityValue = Math.max(0, Math.min(1, options.opacity));
    this.strokeBrushId = options.strokeBrushId;
    this.strokeColor = options.strokeColor;
    this.strokeWidthValue = Math.max(1, options.strokeWidth);
    this.width = this.strokeWidthValue;
    this.color = options.strokeColor;
    this.decimate = 0.4;
  }

  override createPath(pathData: any) {
    const path = super.createPath(pathData);
    path.set({
      fill: null,
      opacity: this.opacityValue,
      stroke: getFabricStrokeValueForVectorBrush(this.strokeBrushId, this.strokeColor),
      strokeWidth: this.strokeWidthValue,
      strokeUniform: true,
      noScaleCache: false,
      vectorStrokeBrushId: this.strokeBrushId,
      vectorStrokeColor: this.strokeColor,
    } as any);
    return path;
  }
}

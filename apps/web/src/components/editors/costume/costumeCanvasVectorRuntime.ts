import { ActiveSelection, Canvas as FabricCanvas, PencilBrush, Point } from 'fabric';
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
  VectorPathNodeHandleType,
  VectorStyleCapabilities,
  VectorToolStyleMixedState,
  VectorToolStyleSelectionSnapshot,
  VectorToolStyle,
} from './CostumeToolbar';
import { HANDLE_SIZE } from './costumeCanvasShared';

export const VECTOR_JSON_EXTRA_PROPS = [
  'nodeHandleTypes',
  'strokeUniform',
  'vectorFillTextureId',
  'vectorFillColor',
  'vectorFillOpacity',
  'vectorStrokeBrushId',
  'vectorStrokeColor',
  'vectorStrokeOpacity',
];

export async function cloneFabricObjectWithVectorStyle<T extends { clone?: (...args: any[]) => any }>(
  obj: T | null | undefined,
): Promise<T> {
  if (!obj || typeof obj.clone !== 'function') {
    throw new Error('Object is not cloneable');
  }

  const maybePromise = obj.clone(VECTOR_JSON_EXTRA_PROPS);
  if (maybePromise && typeof maybePromise.then === 'function') {
    return await maybePromise;
  }

  return await new Promise<T>((resolve) => {
    obj.clone?.(VECTOR_JSON_EXTRA_PROPS, (cloned: T) => resolve(cloned));
  });
}

export function createVectorTexturePreviewPathObject(options: {
  fillColor?: string;
  fillOpacity?: number;
  fillTextureId?: VectorFillTextureId;
  path: any[];
  strokeBrushId: VectorStrokeBrushId;
  strokeColor: string;
  strokeDashArray?: number[] | null;
  strokeDashOffset?: number;
  strokeLineCap?: CanvasLineCap;
  strokeLineJoin?: CanvasLineJoin;
  strokeMiterLimit?: number;
  strokeOpacity: number;
  strokeWidth: number;
}): VectorTexturePreviewPathObject {
  return {
    type: 'path',
    path: options.path,
    pathOffset: new Point(0, 0),
    calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
    fill: options.fillTextureId
      ? getFabricFillValueForVectorTexture(
          options.fillTextureId,
          options.fillColor ?? '#000000',
          options.fillOpacity ?? 1,
        )
      : null,
    opacity: 1,
    stroke: getFabricStrokeValueForVectorBrush(
      options.strokeBrushId,
      options.strokeColor,
      options.strokeOpacity,
    ),
    strokeWidth: Math.max(0, options.strokeWidth),
    strokeLineCap: options.strokeLineCap ?? 'round',
    strokeLineJoin: options.strokeLineJoin ?? 'round',
    strokeMiterLimit: options.strokeMiterLimit,
    strokeDashArray: options.strokeDashArray,
    strokeDashOffset: options.strokeDashOffset,
    vectorFillTextureId: options.fillTextureId,
    vectorFillColor: options.fillColor,
    vectorFillOpacity: options.fillOpacity,
    vectorStrokeBrushId: options.strokeBrushId,
    vectorStrokeColor: options.strokeColor,
    vectorStrokeOpacity: options.strokeOpacity,
  };
}

export const VECTOR_POINT_CONTROL_STYLE = {
  cornerColor: 'rgba(0, 0, 0, 0)',
  cornerStrokeColor: 'rgba(0, 0, 0, 0)',
  cornerSize: HANDLE_SIZE,
  transparentCorners: false,
};

export interface VectorTexturePreviewPathObject {
  calcTransformMatrix: () => [number, number, number, number, number, number];
  fill: string | null;
  opacity: number;
  path: any[];
  pathOffset: Point;
  stroke: string;
  strokeDashArray?: number[] | null;
  strokeDashOffset?: number;
  strokeLineCap: CanvasLineCap;
  strokeLineJoin: CanvasLineJoin;
  strokeMiterLimit?: number;
  strokeWidth: number;
  type: 'path';
  vectorFillColor?: string;
  vectorFillOpacity?: number;
  vectorFillTextureId?: VectorFillTextureId;
  vectorStrokeBrushId: VectorStrokeBrushId;
  vectorStrokeColor: string;
  vectorStrokeOpacity: number;
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const MIN_VECTOR_PENCIL_DECIMATION = 1.1;
const MAX_VECTOR_PENCIL_DECIMATION = 2.4;
const MIN_VECTOR_PENCIL_SIMPLIFY_TOLERANCE = 1.8;
const MAX_VECTOR_PENCIL_SIMPLIFY_TOLERANCE = 4.2;

function getVectorPencilDecimation(strokeWidth: number): number {
  // Fabric's default decimation keeps almost every captured point, which makes
  // freehand paths harder to edit because they produce very dense handles. We
  // use a slightly stronger, width-aware simplification so paths stay smoother
  // while preserving the drawn silhouette.
  return Math.min(
    MAX_VECTOR_PENCIL_DECIMATION,
    Math.max(MIN_VECTOR_PENCIL_DECIMATION, strokeWidth * 0.35),
  );
}

function getVectorPencilSimplifyTolerance(strokeWidth: number): number {
  return Math.min(
    MAX_VECTOR_PENCIL_SIMPLIFY_TOLERANCE,
    Math.max(MIN_VECTOR_PENCIL_SIMPLIFY_TOLERANCE, strokeWidth * 0.6),
  );
}

function getSquaredDistanceToSegment(point: Point, segmentStart: Point, segmentEnd: Point): number {
  const deltaX = segmentEnd.x - segmentStart.x;
  const deltaY = segmentEnd.y - segmentStart.y;

  if (deltaX === 0 && deltaY === 0) {
    const pointDeltaX = point.x - segmentStart.x;
    const pointDeltaY = point.y - segmentStart.y;
    return pointDeltaX * pointDeltaX + pointDeltaY * pointDeltaY;
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * deltaX + (point.y - segmentStart.y) * deltaY)
      / (deltaX * deltaX + deltaY * deltaY),
    ),
  );
  const closestX = segmentStart.x + deltaX * projection;
  const closestY = segmentStart.y + deltaY * projection;
  const closestDeltaX = point.x - closestX;
  const closestDeltaY = point.y - closestY;
  return closestDeltaX * closestDeltaX + closestDeltaY * closestDeltaY;
}

function simplifyVectorPencilPoints(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) {
    return points;
  }

  const squaredTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  const lastIndex = points.length - 1;
  keep[0] = 1;
  keep[lastIndex] = 1;

  const stack: Array<[startIndex: number, endIndex: number]> = [[0, lastIndex]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let furthestIndex = -1;
    let maxSquaredDistance = 0;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const squaredDistance = getSquaredDistanceToSegment(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (squaredDistance > maxSquaredDistance) {
        maxSquaredDistance = squaredDistance;
        furthestIndex = index;
      }
    }

    if (furthestIndex !== -1 && maxSquaredDistance > squaredTolerance) {
      keep[furthestIndex] = 1;
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }

  const simplified: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) {
      simplified.push(points[index]);
    }
  }
  return simplified.length >= 2 ? simplified : [points[0], points[lastIndex]];
}

function getVectorPathNodeHandleTypes(raw: unknown): Record<string, VectorPathNodeHandleType> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const next: Record<string, VectorPathNodeHandleType> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'linear' || value === 'corner' || value === 'smooth' || value === 'symmetric') {
      next[key] = value;
    }
  }
  return next;
}

function areVectorPathNodeHandleTypesEqual(
  a: Record<string, VectorPathNodeHandleType>,
  b: Record<string, VectorPathNodeHandleType>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}

function convertQuadraticPathToCubic(path: unknown): any[] | null {
  if (!Array.isArray(path)) {
    return null;
  }

  let currentPoint: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;
  let changed = false;
  const nextPath = path.map((command) => {
    if (!Array.isArray(command) || typeof command[0] !== 'string') {
      return command;
    }

    const commandType = command[0].trim().toUpperCase();
    if (commandType === 'Q' && currentPoint) {
      const startX = currentPoint.x;
      const startY = currentPoint.y;
      const controlX = Number(command[1]);
      const controlY = Number(command[2]);
      const endX = Number(command[3]);
      const endY = Number(command[4]);
      if (
        Number.isFinite(controlX) &&
        Number.isFinite(controlY) &&
        Number.isFinite(endX) &&
        Number.isFinite(endY)
      ) {
        changed = true;
        currentPoint = { x: endX, y: endY };
        return [
          'C',
          startX + ((controlX - startX) * 2) / 3,
          startY + ((controlY - startY) * 2) / 3,
          endX + ((controlX - endX) * 2) / 3,
          endY + ((controlY - endY) * 2) / 3,
          endX,
          endY,
        ];
      }
    }

    const cloned = command.slice();
    const endpoint = getPathCommandEndpoint(cloned);
    switch (commandType) {
      case 'M':
        currentPoint = endpoint;
        subpathStart = endpoint;
        break;
      case 'L':
      case 'C':
      case 'Q':
        currentPoint = endpoint;
        break;
      case 'Z':
        currentPoint = subpathStart;
        break;
    }
    return cloned;
  });

  return changed ? nextPath : null;
}

function findPreviousDrawablePathCommandIndex(path: any[], commandIndex: number): number {
  for (let index = commandIndex - 1; index >= 0; index -= 1) {
    if (getPathCommandType(path[index]) !== 'Z') {
      return index;
    }
  }
  return -1;
}

function inferPathNodeHandleTypesFromCommands(
  path: unknown,
  rawNodeHandleTypes: unknown,
): Record<string, VectorPathNodeHandleType> | null {
  if (!Array.isArray(path)) {
    return null;
  }

  const existing = getVectorPathNodeHandleTypes(rawNodeHandleTypes);
  const next = { ...existing };
  const incomingAnchors = new Set<number>();
  const outgoingAnchors = new Set<number>();

  path.forEach((command, commandIndex) => {
    if (getPathCommandType(command) !== 'C') {
      return;
    }
    incomingAnchors.add(commandIndex);
    const previousIndex = findPreviousDrawablePathCommandIndex(path, commandIndex);
    if (previousIndex >= 0) {
      outgoingAnchors.add(previousIndex);
    }
  });

  let changed = false;
  const curvedAnchors = new Set<number>([
    ...incomingAnchors,
    ...outgoingAnchors,
  ]);
  for (const anchorIndex of curvedAnchors) {
    const key = String(anchorIndex);
    if (next[key]) {
      continue;
    }
    next[key] = incomingAnchors.has(anchorIndex) && outgoingAnchors.has(anchorIndex)
      ? 'smooth'
      : 'corner';
    changed = true;
  }

  return changed || !areVectorPathNodeHandleTypesEqual(existing, next) ? next : null;
}

function normalizeEditableVectorPathGeometry(candidate: {
  path?: unknown;
  nodeHandleTypes?: unknown;
  set?: (props: Record<string, unknown>) => void;
  setCoords?: () => void;
  setDimensions?: () => void;
}): boolean {
  if (!Array.isArray(candidate.path)) {
    return false;
  }

  const nextPath = convertQuadraticPathToCubic(candidate.path);
  const normalizedPath = nextPath ?? candidate.path;
  const nextNodeHandleTypes = inferPathNodeHandleTypesFromCommands(
    normalizedPath,
    candidate.nodeHandleTypes,
  );

  let changed = false;
  if (nextPath) {
    candidate.path = nextPath;
    changed = true;
  }
  if (nextNodeHandleTypes) {
    if (typeof candidate.set === 'function') {
      candidate.set({ nodeHandleTypes: nextNodeHandleTypes });
    } else {
      candidate.nodeHandleTypes = nextNodeHandleTypes;
    }
    changed = true;
  }

  if (changed) {
    candidate.setDimensions?.();
    candidate.setCoords?.();
  }

  return changed;
}

const normalizeOpaqueColor = (value: string): string => {
  try {
    return Color(value).alpha(1).hex();
  } catch {
    return value;
  }
};

const getColorAlpha = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  try {
    return clampUnit(Color(value).alpha());
  } catch {
    return undefined;
  }
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

export function isTextObject(obj: unknown): obj is {
  type: string;
  fill?: unknown;
  set: (props: Record<string, unknown>) => void;
  setCoords?: () => void;
} {
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
  vectorFillOpacity?: number;
  vectorFillTextureId?: VectorFillTextureId;
  vectorStrokeBrushId?: VectorStrokeBrushId;
  vectorStrokeColor?: string;
  vectorStrokeOpacity?: number;
}

type VectorFillStyleUpdates = Partial<Pick<VectorToolStyle, 'fillColor' | 'fillOpacity' | 'fillTextureId'>>;
type VectorStrokeStyleUpdates = Partial<Pick<VectorToolStyle, 'strokeBrushId' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth'>>;

type CenterPreservingVectorObject = VectorBrushStylableObject & {
  getCenterPoint?: () => unknown;
  group?: unknown;
  setCoords?: () => void;
  setPositionByOrigin?: (point: unknown, originX: 'center', originY: 'center') => void;
};

export interface ApplyVectorStyleUpdatesToSelectionOptions {
  fillStyle?: VectorFillStyleUpdates;
  normalizeRendering?: boolean;
  strokeStyle?: VectorStrokeStyleUpdates;
}

function hasOwnVectorStyleUpdate<Key extends PropertyKey>(
  updates: object,
  key: Key,
): updates is Record<Key, unknown> {
  return Object.prototype.hasOwnProperty.call(updates, key);
}

export function getVectorObjectFillTextureId(obj: unknown): VectorFillTextureId {
  const textureId = (obj as VectorBrushStylableObject | null | undefined)?.vectorFillTextureId;
  return typeof textureId === 'string' ? (textureId as VectorFillTextureId) : DEFAULT_VECTOR_FILL_TEXTURE_ID;
}

export function getVectorObjectFillColor(obj: unknown): string | undefined {
  const vectorFillColor = (obj as VectorBrushStylableObject | null | undefined)?.vectorFillColor;
  if (typeof vectorFillColor === 'string' && vectorFillColor.length > 0) {
    return normalizeOpaqueColor(vectorFillColor);
  }
  const fill = (obj as VectorBrushStylableObject | null | undefined)?.fill;
  if (typeof fill === 'string' && fill.length > 0) {
    return normalizeOpaqueColor(fill);
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
    return normalizeOpaqueColor(vectorStrokeColor);
  }
  const stroke = (obj as VectorBrushStylableObject | null | undefined)?.stroke;
  if (typeof stroke === 'string' && stroke.length > 0) {
    return normalizeOpaqueColor(stroke);
  }
  return undefined;
}

function getVectorObjectLegacyOpacity(obj: unknown): number | undefined {
  const opacity = (obj as VectorBrushStylableObject | null | undefined)?.opacity;
  return typeof opacity === 'number' && Number.isFinite(opacity) ? clampUnit(opacity) : undefined;
}

export function getVectorObjectFillOpacity(obj: unknown): number | undefined {
  const explicitOpacity = (obj as VectorBrushStylableObject | null | undefined)?.vectorFillOpacity;
  if (typeof explicitOpacity === 'number' && Number.isFinite(explicitOpacity)) {
    return clampUnit(explicitOpacity);
  }

  const fillTextureId = getVectorObjectFillTextureId(obj);
  if (fillTextureId === DEFAULT_VECTOR_FILL_TEXTURE_ID) {
    const colorOpacity = getColorAlpha(
      (obj as VectorBrushStylableObject | null | undefined)?.vectorFillColor
      ?? (obj as VectorBrushStylableObject | null | undefined)?.fill,
    );
    if (typeof colorOpacity === 'number') {
      return colorOpacity;
    }
  }

  return getVectorObjectLegacyOpacity(obj);
}

export function getVectorObjectStrokeOpacity(obj: unknown): number | undefined {
  const explicitOpacity = (obj as VectorBrushStylableObject | null | undefined)?.vectorStrokeOpacity;
  if (typeof explicitOpacity === 'number' && Number.isFinite(explicitOpacity)) {
    return clampUnit(explicitOpacity);
  }

  const strokeBrushId = getVectorObjectStrokeBrushId(obj);
  if (strokeBrushId === DEFAULT_VECTOR_STROKE_BRUSH_ID) {
    const colorOpacity = getColorAlpha(
      (obj as VectorBrushStylableObject | null | undefined)?.vectorStrokeColor
      ?? (obj as VectorBrushStylableObject | null | undefined)?.stroke,
    );
    if (typeof colorOpacity === 'number') {
      return colorOpacity;
    }
  }

  return getVectorObjectLegacyOpacity(obj);
}

function normalizeVectorPartOpacity(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampUnit(value) : 1;
}

function migrateLegacySharedOpacity(
  obj: VectorBrushStylableObject,
  updates: Record<string, unknown>,
): void {
  const legacyOpacity = getVectorObjectLegacyOpacity(obj);
  if (typeof legacyOpacity !== 'number' || legacyOpacity === 1) {
    return;
  }

  if (typeof obj.vectorStrokeOpacity !== 'number') {
    updates.vectorStrokeOpacity = normalizeVectorPartOpacity(getVectorObjectStrokeOpacity(obj));
  }
  if (vectorObjectSupportsFill(obj) && typeof obj.vectorFillOpacity !== 'number') {
    updates.vectorFillOpacity = normalizeVectorPartOpacity(getVectorObjectFillOpacity(obj));
  }
  updates.opacity = 1;
}

export function getFabricStrokeValueForVectorBrush(
  brushId: VectorStrokeBrushId,
  strokeColor: string,
  strokeOpacity = 1,
) {
  return brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID
    ? Color(strokeColor).alpha(clampUnit(strokeOpacity)).rgb().string()
    : Color(strokeColor).alpha(0).rgb().string();
}

export function getFabricFillValueForVectorTexture(
  textureId: VectorFillTextureId,
  fillColor: string,
  fillOpacity = 1,
) {
  return textureId === DEFAULT_VECTOR_FILL_TEXTURE_ID
    ? Color(fillColor).alpha(clampUnit(fillOpacity)).rgb().string()
    : Color(fillColor).alpha(0).rgb().string();
}

export function applyVectorFillStyleToObject(
  obj: VectorBrushStylableObject | null | undefined,
  style: Partial<Pick<VectorToolStyle, 'fillColor' | 'fillOpacity' | 'fillTextureId'>>,
): boolean {
  if (!obj || typeof obj.set !== 'function') {
    return false;
  }
  const hasFillColorUpdate = hasOwnVectorStyleUpdate(style, 'fillColor');
  const hasFillOpacityUpdate = hasOwnVectorStyleUpdate(style, 'fillOpacity');
  const hasFillTextureUpdate = hasOwnVectorStyleUpdate(style, 'fillTextureId');
  if (!hasFillColorUpdate && !hasFillOpacityUpdate && !hasFillTextureUpdate) {
    return false;
  }

  const updates: Record<string, unknown> = {};
  migrateLegacySharedOpacity(obj, updates);
  const nextFillTextureId = hasFillTextureUpdate && typeof style.fillTextureId === 'string'
    ? style.fillTextureId
    : getVectorObjectFillTextureId(obj);
  if (obj.vectorFillTextureId !== nextFillTextureId) {
    updates.vectorFillTextureId = nextFillTextureId;
  }
  const nextFillColor = hasFillColorUpdate && typeof style.fillColor === 'string' && style.fillColor.length > 0
    ? normalizeOpaqueColor(style.fillColor)
    : (getVectorObjectFillColor(obj) ?? '#000000');
  if (obj.vectorFillColor !== nextFillColor) {
    updates.vectorFillColor = nextFillColor;
  }
  const nextFillOpacity = hasFillOpacityUpdate && typeof style.fillOpacity === 'number' && Number.isFinite(style.fillOpacity)
    ? style.fillOpacity
    : getVectorObjectFillOpacity(obj);
  const normalizedFillOpacity = normalizeVectorPartOpacity(nextFillOpacity);
  if (obj.vectorFillOpacity !== normalizedFillOpacity) {
    updates.vectorFillOpacity = normalizedFillOpacity;
  }
  const renderFill = getFabricFillValueForVectorTexture(nextFillTextureId, nextFillColor, normalizedFillOpacity);
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
  style: Partial<Pick<VectorToolStyle, 'strokeBrushId' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth'>>,
): boolean {
  if (!obj || typeof obj.set !== 'function') {
    return false;
  }
  const hasStrokeBrushUpdate = hasOwnVectorStyleUpdate(style, 'strokeBrushId');
  const hasStrokeColorUpdate = hasOwnVectorStyleUpdate(style, 'strokeColor');
  const hasStrokeOpacityUpdate = hasOwnVectorStyleUpdate(style, 'strokeOpacity');
  const hasStrokeWidthUpdate = hasOwnVectorStyleUpdate(style, 'strokeWidth');
  if (!hasStrokeBrushUpdate && !hasStrokeColorUpdate && !hasStrokeOpacityUpdate && !hasStrokeWidthUpdate) {
    return false;
  }

  const nextStrokeWidth = hasStrokeWidthUpdate && typeof style.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)
    ? Math.max(0, style.strokeWidth)
    : Math.max(0, typeof obj.strokeWidth === 'number' && Number.isFinite(obj.strokeWidth) ? obj.strokeWidth : 0);
  const updates: Record<string, unknown> = {};
  migrateLegacySharedOpacity(obj, updates);
  const nextStrokeBrushId = hasStrokeBrushUpdate && typeof style.strokeBrushId === 'string'
    ? style.strokeBrushId
    : getVectorObjectStrokeBrushId(obj);
  if (obj.vectorStrokeBrushId !== nextStrokeBrushId) {
    updates.vectorStrokeBrushId = nextStrokeBrushId;
  }
  const nextStrokeColor = hasStrokeColorUpdate && typeof style.strokeColor === 'string' && style.strokeColor.length > 0
    ? normalizeOpaqueColor(style.strokeColor)
    : (getVectorObjectStrokeColor(obj) ?? '#000000');
  if (obj.vectorStrokeColor !== nextStrokeColor) {
    updates.vectorStrokeColor = nextStrokeColor;
  }
  const nextStrokeOpacity = hasStrokeOpacityUpdate && typeof style.strokeOpacity === 'number' && Number.isFinite(style.strokeOpacity)
    ? style.strokeOpacity
    : getVectorObjectStrokeOpacity(obj);
  const normalizedStrokeOpacity = normalizeVectorPartOpacity(nextStrokeOpacity);
  if (obj.vectorStrokeOpacity !== normalizedStrokeOpacity) {
    updates.vectorStrokeOpacity = normalizedStrokeOpacity;
  }
  const renderStroke = getFabricStrokeValueForVectorBrush(
    nextStrokeBrushId,
    nextStrokeColor,
    normalizedStrokeOpacity,
  );
  if (obj.stroke !== renderStroke) {
    updates.stroke = renderStroke;
  }
  if (obj.strokeWidth !== nextStrokeWidth) {
    updates.strokeWidth = nextStrokeWidth;
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

function getRequestedStrokeWidth(
  target: VectorBrushStylableObject,
  strokeStyle: VectorStrokeStyleUpdates,
): number | null {
  if (!hasOwnVectorStyleUpdate(strokeStyle, 'strokeWidth')) {
    return null;
  }

  if (typeof strokeStyle.strokeWidth === 'number' && Number.isFinite(strokeStyle.strokeWidth)) {
    return Math.max(0, strokeStyle.strokeWidth);
  }

  return Math.max(0, typeof target.strokeWidth === 'number' && Number.isFinite(target.strokeWidth) ? target.strokeWidth : 0);
}

export function applyVectorStyleUpdatesToSelection(
  obj: unknown,
  {
    fillStyle = {},
    normalizeRendering = false,
    strokeStyle = {},
  }: ApplyVectorStyleUpdatesToSelectionOptions,
): boolean {
  const targets = getVectorStyleTargets(obj) as CenterPreservingVectorObject[];
  let didChange = false;

  for (const target of targets) {
    const requestedStrokeWidth = getRequestedStrokeWidth(target, strokeStyle);
    const groupedByActiveSelection =
      !!target.group &&
      isActiveSelectionObject(target.group);
    const shouldPreserveCenter =
      !groupedByActiveSelection &&
      (
        target.strokeUniform !== true ||
        (requestedStrokeWidth !== null && target.strokeWidth !== requestedStrokeWidth)
      );
    const centerPoint = shouldPreserveCenter && typeof target.getCenterPoint === 'function'
      ? target.getCenterPoint()
      : null;
    const fillChanged = vectorObjectSupportsFill(target)
      ? applyVectorFillStyleToObject(target, fillStyle)
      : false;
    const strokeChanged = applyVectorStrokeStyleToObject(target, strokeStyle);
    const renderingChanged = normalizeRendering
      ? normalizeVectorObjectRendering(target)
      : false;

    if (strokeChanged && centerPoint && typeof target.setPositionByOrigin === 'function') {
      target.setPositionByOrigin(centerPoint, 'center', 'center');
    }
    if (fillChanged || strokeChanged || renderingChanged) {
      target.setCoords?.();
      didChange = true;
    }
  }

  return didChange;
}

export function normalizeVectorObjectRendering(obj: unknown): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
    return false;
  }

  const candidate = obj as {
    path?: unknown;
    nodeHandleTypes?: unknown;
    strokeUniform?: boolean;
    noScaleCache?: boolean;
    set?: (props: Record<string, unknown>) => void;
    setCoords?: () => void;
    setDimensions?: () => void;
  };
  if (typeof candidate.set !== 'function') {
    return false;
  }

  const didChange = normalizeEditableVectorPathGeometry(candidate);
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
  const strokeOpacity = normalizeVectorPartOpacity(getVectorObjectStrokeOpacity(candidate));
  const fillOpacity = normalizeVectorPartOpacity(getVectorObjectFillOpacity(candidate));
  if ((candidate as VectorBrushStylableObject).vectorStrokeOpacity !== strokeOpacity) {
    updates.vectorStrokeOpacity = strokeOpacity;
  }
  if (vectorObjectSupportsFill(candidate) && (candidate as VectorBrushStylableObject).vectorFillOpacity !== fillOpacity) {
    updates.vectorFillOpacity = fillOpacity;
  }
  if (typeof (candidate as VectorBrushStylableObject).opacity === 'number' && (candidate as VectorBrushStylableObject).opacity !== 1) {
    updates.opacity = 1;
  }
  if (typeof strokeColor === 'string' && strokeColor.length > 0) {
    const renderStroke = getFabricStrokeValueForVectorBrush(brushId, strokeColor, strokeOpacity);
    if ((candidate as { stroke?: unknown }).stroke !== renderStroke) {
      updates.stroke = renderStroke;
    }
  }
  if (typeof fillColor === 'string' && fillColor.length > 0) {
    const renderFill = getFabricFillValueForVectorTexture(fillTextureId, fillColor, fillOpacity);
    if ((candidate as { fill?: unknown }).fill !== renderFill) {
      updates.fill = renderFill;
    }
  }
  if (Object.keys(updates).length === 0) {
    return didChange;
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
    // Fabric paths can render fills even when the path data is left open, and the
    // editor already represents pen strokes as editable `path` objects. Treating
    // open paths as fill-capable keeps the toolbar consistent and lets users opt
    // into a fill after the fact instead of hiding the control entirely.
    return true;
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

function areVectorStyleSelectionValuesEqual(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) <= 0.0001;
  }
  return left === right;
}

export function getVectorStyleSelectionSnapshot(obj: unknown): VectorToolStyleSelectionSnapshot | null {
  const targets = getVectorStyleTargets(obj);
  const [firstTarget] = targets;
  if (!firstTarget) {
    return null;
  }

  const style: Partial<VectorToolStyle> = {
    fillColor: getVectorObjectFillColor(firstTarget),
    fillOpacity: getVectorObjectFillOpacity(firstTarget),
    fillTextureId: getVectorObjectFillTextureId(firstTarget),
    strokeColor: getVectorObjectStrokeColor(firstTarget),
    strokeOpacity: getVectorObjectStrokeOpacity(firstTarget),
    strokeWidth: typeof firstTarget.strokeWidth === 'number' ? firstTarget.strokeWidth : undefined,
    strokeBrushId: getVectorObjectStrokeBrushId(firstTarget),
  };
  const mixed: VectorToolStyleMixedState = {};

  const markMixedIfNeeded = <K extends keyof VectorToolStyle>(
    key: K,
    getter: (target: any) => VectorToolStyle[K] | undefined,
  ) => {
    const firstValue = getter(firstTarget);
    if (targets.some((target) => !areVectorStyleSelectionValuesEqual(getter(target), firstValue))) {
      mixed[key] = true;
    }
  };

  markMixedIfNeeded('fillColor', getVectorObjectFillColor);
  markMixedIfNeeded('fillOpacity', getVectorObjectFillOpacity);
  markMixedIfNeeded('fillTextureId', getVectorObjectFillTextureId);
  markMixedIfNeeded('strokeColor', getVectorObjectStrokeColor);
  markMixedIfNeeded('strokeOpacity', getVectorObjectStrokeOpacity);
  markMixedIfNeeded('strokeWidth', (target) => (typeof target.strokeWidth === 'number' ? target.strokeWidth : undefined));
  markMixedIfNeeded('strokeBrushId', getVectorObjectStrokeBrushId);

  return {
    style,
    mixed,
  };
}

export function isVectorPointSelectableObject(obj: unknown): obj is Record<string, any> {
  if (!obj || typeof obj !== 'object') return false;
  if (isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) return false;
  return true;
}

interface VectorPencilBrushOptions {
  onPreviewUpdated?: () => void;
  strokeBrushId: VectorStrokeBrushId;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export class VectorPencilBrush extends PencilBrush {
  private readonly onPreviewUpdated?: () => void;
  private readonly strokeBrushId: VectorStrokeBrushId;
  private readonly strokeColor: string;
  private readonly strokeOpacityValue: number;
  private readonly strokeWidthValue: number;
  private previewActive = false;

  constructor(canvas: FabricCanvas, options: VectorPencilBrushOptions) {
    super(canvas as any);
    this.onPreviewUpdated = options.onPreviewUpdated;
    this.strokeBrushId = options.strokeBrushId;
    this.strokeColor = options.strokeColor;
    this.strokeOpacityValue = clampUnit(options.strokeOpacity);
    this.strokeWidthValue = Math.max(1, options.strokeWidth);
    this.width = this.strokeWidthValue;
    this.color = getFabricStrokeValueForVectorBrush(
      this.strokeBrushId,
      this.strokeColor,
      this.strokeOpacityValue,
    );
    this.decimate = getVectorPencilDecimation(this.strokeWidthValue);
    this.strokeLineCap = 'round';
    this.strokeLineJoin = 'round';
  }

  private notifyPreviewUpdated() {
    this.onPreviewUpdated?.();
  }

  override onMouseDown(pointer: Point, options: any) {
    this.previewActive = true;
    super.onMouseDown(pointer, options);
    this.notifyPreviewUpdated();
  }

  override onMouseMove(pointer: Point, options: any) {
    super.onMouseMove(pointer, options);
    this.notifyPreviewUpdated();
  }

  override onMouseUp(options: any) {
    const result = super.onMouseUp(options);
    this.previewActive = false;
    this.notifyPreviewUpdated();
    return result;
  }

  override convertPointsToSVGPath(points: Point[]) {
    return super.convertPointsToSVGPath(
      simplifyVectorPencilPoints(
        points,
        getVectorPencilSimplifyTolerance(this.strokeWidthValue),
      ),
    );
  }

  override createPath(pathData: any) {
    const path = super.createPath(pathData);
    path.set({
      fill: null,
      opacity: 1,
      stroke: getFabricStrokeValueForVectorBrush(this.strokeBrushId, this.strokeColor, this.strokeOpacityValue),
      strokeWidth: this.strokeWidthValue,
      strokeUniform: true,
      noScaleCache: false,
      vectorStrokeBrushId: this.strokeBrushId,
      vectorStrokeColor: this.strokeColor,
      vectorStrokeOpacity: this.strokeOpacityValue,
    } as any);
    return path;
  }

  getTexturePreviewObject(): VectorTexturePreviewPathObject | null {
    if (!this.previewActive || this.strokeBrushId === DEFAULT_VECTOR_STROKE_BRUSH_ID || this._points.length === 0) {
      return null;
    }

    const previewPoints = this._points.map((point) => new Point(point.x, point.y));
    if (previewPoints.length === 2 && previewPoints[0]?.eq(previewPoints[1]!)) {
      const widthAdjustment = this.width / 1000;
      previewPoints[0].x -= widthAdjustment;
      previewPoints[1].x += widthAdjustment;
    }

    const pathData = this.convertPointsToSVGPath(previewPoints);
    if (!Array.isArray(pathData) || pathData.length === 0) {
      return null;
    }

    return createVectorTexturePreviewPathObject({
      path: pathData,
      strokeBrushId: this.strokeBrushId,
      strokeColor: this.strokeColor,
      strokeDashArray: this.strokeDashArray,
      strokeDashOffset: this.strokeDashOffset,
      strokeLineCap: this.strokeLineCap,
      strokeLineJoin: this.strokeLineJoin,
      strokeMiterLimit: this.strokeMiterLimit,
      strokeOpacity: this.strokeOpacityValue,
      strokeWidth: this.strokeWidthValue,
    });
  }
}

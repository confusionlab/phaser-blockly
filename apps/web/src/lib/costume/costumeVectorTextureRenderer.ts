import { Point, StaticCanvas } from 'fabric';
import Color from 'color';
import {
  createVectorFillTextureTile,
  getVectorFillTexturePreset,
  DEFAULT_VECTOR_FILL_TEXTURE_ID,
  parseVectorFillTextureId,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';
import {
  createVectorStrokeBrushRenderStyle,
  getVectorStrokeBrushPreset,
  DEFAULT_VECTOR_STROKE_BRUSH_ID,
  normalizeVectorStrokeWiggle,
  parseVectorStrokeBrushId,
  type VectorStrokeBrushId,
  type VectorStrokeBrushRenderStyle,
} from '@/lib/vector/vectorStrokeBrushCore';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import {
  getFabricChildObjects,
  isFabricGroupObject,
} from '@/lib/editor/fabricVectorSelection';
import { getCanvas2dContext } from '@/utils/canvas2d';
import { COSTUME_CANVAS_SIZE } from './costumeDocument';

const MAX_VECTOR_STROKE_BRUSH_RENDER_CACHE_ENTRIES = 256;
const MAX_VECTOR_STROKE_WIGGLE_NORMAL_MULTIPLIER = 0.9;

const vectorStrokeBrushRenderCache = new Map<string, VectorStrokeBrushRenderStyle>();
const vectorTextureCache = new Map<string, HTMLImageElement | null>();
const vectorTexturePending = new Set<string>();
const vectorTextureReadyListeners = new Map<string, Set<() => void>>();

function rememberVectorStrokeBrushRenderStyle(
  cacheKey: string,
  renderStyle: VectorStrokeBrushRenderStyle,
): VectorStrokeBrushRenderStyle {
  if (vectorStrokeBrushRenderCache.size >= MAX_VECTOR_STROKE_BRUSH_RENDER_CACHE_ENTRIES) {
    vectorStrokeBrushRenderCache.clear();
  }
  vectorStrokeBrushRenderCache.set(cacheKey, renderStyle);
  return renderStyle;
}

function notifyVectorTextureReadyListeners(texturePath: string) {
  const listeners = vectorTextureReadyListeners.get(texturePath);
  if (!listeners) {
    return;
  }
  vectorTextureReadyListeners.delete(texturePath);
  listeners.forEach((listener) => listener());
}

function registerVectorTextureReadyListener(
  texturePath: string,
  onTextureSourceReady?: (() => void) | null,
) {
  if (!onTextureSourceReady) {
    return;
  }

  const listeners = vectorTextureReadyListeners.get(texturePath) ?? new Set<() => void>();
  listeners.add(onTextureSourceReady);
  vectorTextureReadyListeners.set(texturePath, listeners);
}

export function resolveSharedTextureSource(
  texturePath?: string | null,
  onTextureSourceReady?: (() => void) | null,
): CanvasImageSource | null {
  const normalizedTexturePath = texturePath?.trim();
  if (!normalizedTexturePath) {
    return null;
  }

  if (vectorTextureCache.has(normalizedTexturePath)) {
    return vectorTextureCache.get(normalizedTexturePath) ?? null;
  }

  registerVectorTextureReadyListener(normalizedTexturePath, onTextureSourceReady);
  if (!vectorTexturePending.has(normalizedTexturePath) && typeof Image !== 'undefined') {
    vectorTexturePending.add(normalizedTexturePath);
    void loadImageSource(normalizedTexturePath).then((image) => {
      vectorTexturePending.delete(normalizedTexturePath);
      vectorTextureCache.set(normalizedTexturePath, image);
      notifyVectorTextureReadyListeners(normalizedTexturePath);
    }).catch(() => {
      vectorTexturePending.delete(normalizedTexturePath);
      vectorTextureCache.set(normalizedTexturePath, null);
      notifyVectorTextureReadyListeners(normalizedTexturePath);
    });
  }

  return null;
}

function resolveVectorFillTextureSource(
  textureId: VectorFillTextureId,
  onTextureSourceReady?: (() => void) | null,
) {
  const preset = getVectorFillTexturePreset(textureId);
  const texturePath = preset.texturePath?.trim();
  if (!texturePath) {
    return null;
  }
  return resolveSharedTextureSource(texturePath, onTextureSourceReady);
}

function resolveVectorStrokeBrushRenderStyle(
  brushId: VectorStrokeBrushId,
  strokeColor: string,
  strokeWidth: number,
  strokeWiggle: number,
  onTextureSourceReady?: (() => void) | null,
): VectorStrokeBrushRenderStyle | null {
  const preset = getVectorStrokeBrushPreset(brushId);
  const texturePath = preset.texturePath?.trim();
  const textureSource = texturePath
    ? resolveSharedTextureSource(texturePath, onTextureSourceReady)
    : null;

  if (texturePath && !textureSource && !vectorTextureCache.has(texturePath)) {
    return null;
  }

  const cacheKey = [
    brushId,
    strokeColor,
    strokeWidth.toFixed(3),
    strokeWiggle.toFixed(3),
    texturePath ?? 'builtin',
    textureSource ? 'ready' : 'fallback',
  ].join('|');
  const cached = vectorStrokeBrushRenderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return rememberVectorStrokeBrushRenderStyle(
    cacheKey,
    createVectorStrokeBrushRenderStyle(brushId, strokeColor, strokeWidth, {
      textureSource,
      wiggle: strokeWiggle,
    }),
  );
}

function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') {
    return '';
  }
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

function isActiveSelectionObject(obj: unknown): boolean {
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

function isTextObject(obj: unknown): boolean {
  const type = getFabricObjectType(obj);
  return type === 'itext' || type === 'i-text' || type === 'textbox' || type === 'text';
}

function isImageObject(obj: unknown): boolean {
  return getFabricObjectType(obj) === 'image';
}

function getPathCommandType(command: unknown): string {
  if (!Array.isArray(command) || typeof command[0] !== 'string') {
    return '';
  }
  return command[0].trim().toUpperCase();
}

function getPathCommandEndpoint(command: unknown): { x: number; y: number } | null {
  if (!Array.isArray(command) || command.length < 3) {
    return null;
  }
  const x = Number(command[command.length - 2]);
  const y = Number(command[command.length - 1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function pathCommandsDescribeClosedShape(path: unknown): boolean {
  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }
  if (path.some((command) => getPathCommandType(command) === 'Z')) {
    return true;
  }

  const start = getPathCommandEndpoint(path[0]);
  if (!start) {
    return false;
  }

  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (getPathCommandType(path[index]) === 'Z') {
      continue;
    }

    const end = getPathCommandEndpoint(path[index]);
    if (!end) {
      return false;
    }
    return Math.abs(start.x - end.x) <= 0.0001 && Math.abs(start.y - end.y) <= 0.0001;
  }

  return false;
}

function vectorObjectSupportsFill(obj: unknown): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
    return false;
  }

  const type = getFabricObjectType(obj);
  if (type === 'line' || type === 'polyline') {
    return false;
  }
  if (type === 'path') {
    // Match the editor runtime: Fabric will still fill open path geometry, so the
    // textured overlay pipeline needs to treat those objects as fill-capable too.
    return true;
  }

  return true;
}

function getVectorObjectFillTextureId(obj: unknown): VectorFillTextureId {
  const textureId = (obj as { vectorFillTextureId?: unknown } | null | undefined)?.vectorFillTextureId;
  return parseVectorFillTextureId(textureId);
}

function getVectorObjectFillColor(obj: unknown): string | undefined {
  const vectorFillColor = (obj as { vectorFillColor?: unknown } | null | undefined)?.vectorFillColor;
  if (typeof vectorFillColor === 'string' && vectorFillColor.length > 0) {
    try {
      return Color(vectorFillColor).alpha(1).hex();
    } catch {
      return vectorFillColor;
    }
  }
  const fill = (obj as { fill?: unknown } | null | undefined)?.fill;
  if (typeof fill === 'string' && fill.length > 0) {
    try {
      return Color(fill).alpha(1).hex();
    } catch {
      return fill;
    }
  }
  return undefined;
}

function getVectorObjectStrokeBrushId(obj: unknown): VectorStrokeBrushId {
  const brushId = (obj as { vectorStrokeBrushId?: unknown } | null | undefined)?.vectorStrokeBrushId;
  return parseVectorStrokeBrushId(brushId);
}

function getVectorObjectStrokeColor(obj: unknown): string | undefined {
  const vectorStrokeColor = (obj as { vectorStrokeColor?: unknown } | null | undefined)?.vectorStrokeColor;
  if (typeof vectorStrokeColor === 'string' && vectorStrokeColor.length > 0) {
    try {
      return Color(vectorStrokeColor).alpha(1).hex();
    } catch {
      return vectorStrokeColor;
    }
  }
  const stroke = (obj as { stroke?: unknown } | null | undefined)?.stroke;
  if (typeof stroke === 'string' && stroke.length > 0) {
    try {
      return Color(stroke).alpha(1).hex();
    } catch {
      return stroke;
    }
  }
  return undefined;
}

function getVectorObjectFillOpacity(obj: unknown): number | undefined {
  const explicitOpacity = (obj as { vectorFillOpacity?: unknown } | null | undefined)?.vectorFillOpacity;
  if (typeof explicitOpacity === 'number' && Number.isFinite(explicitOpacity)) {
    return clampUnit(explicitOpacity);
  }

  if (getVectorObjectFillTextureId(obj) === DEFAULT_VECTOR_FILL_TEXTURE_ID) {
    const fillValue = (obj as { vectorFillColor?: unknown; fill?: unknown } | null | undefined)?.vectorFillColor
      ?? (obj as { fill?: unknown } | null | undefined)?.fill;
    if (typeof fillValue === 'string' && fillValue.length > 0) {
      try {
        return clampUnit(Color(fillValue).alpha());
      } catch {
        // noop
      }
    }
  }

  const legacyOpacity = (obj as { opacity?: unknown } | null | undefined)?.opacity;
  return typeof legacyOpacity === 'number' && Number.isFinite(legacyOpacity)
    ? clampUnit(legacyOpacity)
    : undefined;
}

function getVectorObjectStrokeOpacity(obj: unknown): number | undefined {
  const explicitOpacity = (obj as { vectorStrokeOpacity?: unknown } | null | undefined)?.vectorStrokeOpacity;
  if (typeof explicitOpacity === 'number' && Number.isFinite(explicitOpacity)) {
    return clampUnit(explicitOpacity);
  }

  if (getVectorObjectStrokeBrushId(obj) === DEFAULT_VECTOR_STROKE_BRUSH_ID) {
    const strokeValue = (obj as { vectorStrokeColor?: unknown; stroke?: unknown } | null | undefined)?.vectorStrokeColor
      ?? (obj as { stroke?: unknown } | null | undefined)?.stroke;
    if (typeof strokeValue === 'string' && strokeValue.length > 0) {
      try {
        return clampUnit(Color(strokeValue).alpha());
      } catch {
        // noop
      }
    }
  }

  const legacyOpacity = (obj as { opacity?: unknown } | null | undefined)?.opacity;
  return typeof legacyOpacity === 'number' && Number.isFinite(legacyOpacity)
    ? clampUnit(legacyOpacity)
    : undefined;
}

function getVectorObjectStrokeWiggle(obj: unknown): number {
  const explicitWiggle = (obj as { vectorStrokeWiggle?: unknown } | null | undefined)?.vectorStrokeWiggle;
  return normalizeVectorStrokeWiggle(
    typeof explicitWiggle === 'number' && Number.isFinite(explicitWiggle)
      ? explicitWiggle
      : undefined,
  );
}

function getFabricStrokeValueForVectorBrush(
  brushId: VectorStrokeBrushId,
  strokeColor: string,
  strokeOpacity = 1,
) {
  return brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID
    ? Color(strokeColor).alpha(clampUnit(strokeOpacity)).rgb().string()
    : Color(strokeColor).alpha(0).rgb().string();
}

function getFabricFillValueForVectorTexture(
  textureId: VectorFillTextureId,
  fillColor: string,
  fillOpacity = 1,
) {
  return textureId === DEFAULT_VECTOR_FILL_TEXTURE_ID
    ? Color(fillColor).alpha(clampUnit(fillOpacity)).rgb().string()
    : Color(fillColor).alpha(0).rgb().string();
}

export function normalizeVectorObjectRendering(obj: unknown): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
    return false;
  }

  if (isFabricGroupObject(obj)) {
    let changed = false;
    const group = obj as {
      set?: (props: Record<string, unknown>) => void;
      setCoords?: () => void;
      subTargetCheck?: boolean;
    };
    if (group.subTargetCheck !== true) {
      group.set?.({ subTargetCheck: true });
      changed = true;
    }
    for (const child of getFabricChildObjects(obj)) {
      changed = normalizeVectorObjectRendering(child) || changed;
    }
    if (changed) {
      group.setCoords?.();
    }
    return changed;
  }

  const candidate = obj as {
    fill?: unknown;
    noScaleCache?: boolean;
    set?: (props: Record<string, unknown>) => void;
    stroke?: unknown;
    strokeUniform?: boolean;
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
  const strokeOpacity = getVectorObjectStrokeOpacity(candidate) ?? 1;
  const strokeWiggle = getVectorObjectStrokeWiggle(candidate);
  const fillOpacity = getVectorObjectFillOpacity(candidate) ?? 1;
  if ((candidate as { vectorStrokeOpacity?: unknown }).vectorStrokeOpacity !== strokeOpacity) {
    updates.vectorStrokeOpacity = strokeOpacity;
  }
  if ((candidate as { vectorStrokeWiggle?: unknown }).vectorStrokeWiggle !== strokeWiggle) {
    updates.vectorStrokeWiggle = strokeWiggle;
  }
  if (vectorObjectSupportsFill(candidate) && (candidate as { vectorFillOpacity?: unknown }).vectorFillOpacity !== fillOpacity) {
    updates.vectorFillOpacity = fillOpacity;
  }
  if (typeof (candidate as { opacity?: unknown }).opacity === 'number' && (candidate as { opacity?: number }).opacity !== 1) {
    updates.opacity = 1;
  }
  if (typeof strokeColor === 'string' && strokeColor.length > 0) {
    const renderStroke = getFabricStrokeValueForVectorBrush(brushId, strokeColor, strokeOpacity);
    if (candidate.stroke !== renderStroke) {
      updates.stroke = renderStroke;
    }
  }
  if (typeof fillColor === 'string' && fillColor.length > 0) {
    const renderFill = getFabricFillValueForVectorTexture(fillTextureId, fillColor, fillOpacity);
    if (candidate.fill !== renderFill) {
      updates.fill = renderFill;
    }
  }

  if (Object.keys(updates).length === 0) {
    return false;
  }

  candidate.set(updates);
  return true;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerpNumber(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function getDistanceBetweenPoints(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function hashNumberTriplet(a: number, b: number, c: number) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453123;
  return value - Math.floor(value);
}

function getQuadraticBezierPoint(start: Point, control: Point, end: Point, t: number) {
  const inverse = 1 - t;
  return new Point(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  );
}

function getCubicBezierPoint(start: Point, control1: Point, control2: Point, end: Point, t: number) {
  const inverse = 1 - t;
  return new Point(
    inverse * inverse * inverse * start.x +
      3 * inverse * inverse * t * control1.x +
      3 * inverse * t * t * control2.x +
      t * t * t * end.x,
    inverse * inverse * inverse * start.y +
      3 * inverse * inverse * t * control1.y +
      3 * inverse * t * t * control2.y +
      t * t * t * end.y,
  );
}

function getVectorStrokeSampleSpacing(strokeWidth: number) {
  return Math.max(0.75, Math.min(3, Math.max(1, strokeWidth * 0.12)));
}

function buildClosedPolylinePoints(points: Point[], closed: boolean) {
  if (!closed || points.length < 2) {
    return points;
  }
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  return getDistanceBetweenPoints(firstPoint, lastPoint) <= 0.5
    ? points
    : [...points, firstPoint];
}

function buildPolylineArcTable(points: Point[]) {
  const cumulativeLengths = [0];
  let totalLength = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    totalLength += getDistanceBetweenPoints(points[index], points[index + 1]);
    cumulativeLengths.push(totalLength);
  }
  return { cumulativeLengths, totalLength };
}

function resolveDistanceAlongPolyline(distance: number, totalLength: number, closed: boolean) {
  if (totalLength <= 0) {
    return 0;
  }
  if (!closed) {
    return Math.max(0, Math.min(totalLength, distance));
  }
  const wrappedDistance = distance % totalLength;
  return wrappedDistance < 0 ? wrappedDistance + totalLength : wrappedDistance;
}

function findPolylineSegmentIndex(cumulativeLengths: number[], distance: number) {
  let low = 0;
  let high = cumulativeLengths.length - 1;

  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (cumulativeLengths[mid] <= distance) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.max(0, Math.min(cumulativeLengths.length - 2, low));
}

function samplePointAlongPolyline(
  points: Point[],
  cumulativeLengths: number[],
  totalLength: number,
  distance: number,
  closed: boolean,
) {
  if (points.length === 0) {
    return new Point(0, 0);
  }
  if (points.length === 1 || totalLength <= 0) {
    return points[0];
  }

  const resolvedDistance = resolveDistanceAlongPolyline(distance, totalLength, closed);
  const segmentIndex = findPolylineSegmentIndex(cumulativeLengths, resolvedDistance);
  const segmentStart = cumulativeLengths[segmentIndex];
  const segmentEnd = cumulativeLengths[segmentIndex + 1];
  const segmentLength = Math.max(0.0001, segmentEnd - segmentStart);
  const progress = clampUnit((resolvedDistance - segmentStart) / segmentLength);
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  return new Point(
    lerpNumber(start.x, end.x, progress),
    lerpNumber(start.y, end.y, progress),
  );
}

function sampleAngleAlongPolyline(
  points: Point[],
  cumulativeLengths: number[],
  totalLength: number,
  distance: number,
  closed: boolean,
  window: number,
) {
  const sampleWindow = closed
    ? Math.max(0.5, Math.min(window, totalLength * 0.49))
    : Math.max(0.5, Math.min(window, totalLength));
  const previousPoint = samplePointAlongPolyline(
    points,
    cumulativeLengths,
    totalLength,
    distance - sampleWindow,
    closed,
  );
  const nextPoint = samplePointAlongPolyline(
    points,
    cumulativeLengths,
    totalLength,
    distance + sampleWindow,
    closed,
  );
  return Math.atan2(nextPoint.y - previousPoint.y, nextPoint.x - previousPoint.x);
}

function getVectorObjectLocalContourPaths(obj: any): Array<{ closed: boolean; points: Point[] }> {
  if (!obj) {
    return [];
  }

  const objectType = getFabricObjectType(obj);
  const strokeSampleSpacing = getVectorStrokeSampleSpacing(
    typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
  );

  if (objectType === 'line' && typeof obj.calcLinePoints === 'function') {
    const points = obj.calcLinePoints();
    return [{
      closed: false,
      points: [
        new Point(points.x1, points.y1),
        new Point(points.x2, points.y2),
      ],
    }];
  }

  if (objectType === 'rect') {
    const halfWidth = (typeof obj.width === 'number' ? obj.width : 0) / 2;
    const halfHeight = (typeof obj.height === 'number' ? obj.height : 0) / 2;
    return [{
      closed: true,
      points: [
        new Point(-halfWidth, -halfHeight),
        new Point(halfWidth, -halfHeight),
        new Point(halfWidth, halfHeight),
        new Point(-halfWidth, halfHeight),
      ],
    }];
  }

  if (objectType === 'ellipse' || objectType === 'circle') {
    const radiusX = typeof obj.rx === 'number' ? obj.rx : ((typeof obj.width === 'number' ? obj.width : 0) / 2);
    const radiusY = typeof obj.ry === 'number' ? obj.ry : ((typeof obj.height === 'number' ? obj.height : 0) / 2);
    const ellipseCircumference = Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
    const segments = Math.max(24, Math.ceil(ellipseCircumference / strokeSampleSpacing));
    const points: Point[] = [];
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(new Point(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY));
    }
    return [{ closed: true, points }];
  }

  if ((objectType === 'polygon' || objectType === 'polyline') && Array.isArray(obj.points) && obj.points.length > 1) {
    const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
    return [{
      closed: objectType === 'polygon',
      points: obj.points.map((point: { x: number; y: number }) => new Point(point.x - pathOffset.x, point.y - pathOffset.y)),
    }];
  }

  if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
    const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
    const sampledPoints: Point[] = [];
    let currentPoint: Point | null = null;
    let subpathStart: Point | null = null;
    const targetSpacing = strokeSampleSpacing;

    const appendPoint = (point: Point) => {
      const lastPoint = sampledPoints[sampledPoints.length - 1];
      if (!lastPoint || getDistanceBetweenPoints(lastPoint, point) > 0.5) {
        sampledPoints.push(point);
      }
    };

    for (const command of obj.path) {
      const commandType = getPathCommandType(command);
      if (commandType === 'M') {
        currentPoint = new Point(command[1] - pathOffset.x, command[2] - pathOffset.y);
        subpathStart = currentPoint;
        appendPoint(currentPoint);
        continue;
      }
      if (!currentPoint) {
        continue;
      }
      if (commandType === 'L') {
        const endPoint = new Point(command[1] - pathOffset.x, command[2] - pathOffset.y);
        appendPoint(endPoint);
        currentPoint = endPoint;
        continue;
      }
      if (commandType === 'Q') {
        const control = new Point(command[1] - pathOffset.x, command[2] - pathOffset.y);
        const endPoint = new Point(command[3] - pathOffset.x, command[4] - pathOffset.y);
        const estimatedLength =
          getDistanceBetweenPoints(currentPoint, control) +
          getDistanceBetweenPoints(control, endPoint);
        const segments = Math.max(8, Math.ceil(estimatedLength / targetSpacing));
        for (let segmentIndex = 1; segmentIndex <= segments; segmentIndex += 1) {
          appendPoint(getQuadraticBezierPoint(currentPoint, control, endPoint, segmentIndex / segments));
        }
        currentPoint = endPoint;
        continue;
      }
      if (commandType === 'C') {
        const control1 = new Point(command[1] - pathOffset.x, command[2] - pathOffset.y);
        const control2 = new Point(command[3] - pathOffset.x, command[4] - pathOffset.y);
        const endPoint = new Point(command[5] - pathOffset.x, command[6] - pathOffset.y);
        const estimatedLength =
          getDistanceBetweenPoints(currentPoint, control1) +
          getDistanceBetweenPoints(control1, control2) +
          getDistanceBetweenPoints(control2, endPoint);
        const segments = Math.max(10, Math.ceil(estimatedLength / targetSpacing));
        for (let segmentIndex = 1; segmentIndex <= segments; segmentIndex += 1) {
          appendPoint(getCubicBezierPoint(currentPoint, control1, control2, endPoint, segmentIndex / segments));
        }
        currentPoint = endPoint;
        continue;
      }
      if (commandType === 'Z' && subpathStart) {
        appendPoint(subpathStart);
        currentPoint = subpathStart;
      }
    }

    return sampledPoints.length > 1
      ? [{ closed: pathCommandsDescribeClosedShape(obj.path), points: sampledPoints }]
      : [];
  }

  return [];
}

function getVectorObjectContourPaths(obj: any): Array<{ closed: boolean; points: Point[] }> {
  if (!obj || typeof obj.calcTransformMatrix !== 'function') {
    return [];
  }

  const localContours = getVectorObjectLocalContourPaths(obj);
  if (localContours.length === 0) {
    return [];
  }

  const transform = obj.calcTransformMatrix();
  return localContours.map((contour) => ({
    closed: contour.closed,
    points: contour.points.map((point) => point.transform(transform)),
  }));
}

function getStableContourSeed(
  localPoints: Point[],
  closed: boolean,
  contourIndex: number,
) {
  const start = localPoints[0];
  if (!start) {
    return hashNumberTriplet(contourIndex, closed ? 1 : 0, 0);
  }
  const nextDistinctPoint = localPoints.find((point, index) => (
    index > 0 && getDistanceBetweenPoints(point, start) > 0.0001
  )) ?? start;
  return hashNumberTriplet(
    start.x + contourIndex * 0.131,
    start.y + (closed ? 0.733 : 0.271),
    nextDistinctPoint.x * 0.071 + nextDistinctPoint.y * 0.047,
  );
}

function drawVectorStrokeBrushPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  renderStyle: VectorStrokeBrushRenderStyle,
  options: {
    contourSeed?: number;
  } = {},
) {
  if (renderStyle.kind !== 'bitmap-dab' || renderStyle.dabs.length === 0 || points.length < 2) {
    return;
  }

  const pathPoints = buildClosedPolylinePoints(points, closed);
  if (pathPoints.length < 2) {
    return;
  }
  const { cumulativeLengths, totalLength } = buildPolylineArcTable(pathPoints);
  if (totalLength <= 0) {
    return;
  }

  const tangentWindow = Math.max(1, renderStyle.spacing * 0.85);
  const contourSeed = Number.isFinite(options.contourSeed)
    ? Number(options.contourSeed)
    : hashNumberTriplet(pathPoints[0]?.x ?? 0, pathPoints[0]?.y ?? 0, closed ? 1 : 0);

  const renderDabAt = (distanceAlongPath: number, dabIndex: number) => {
    const dabPositionSeed = dabIndex + 1;
    const wiggleRandom = hashNumberTriplet(dabPositionSeed, contourSeed, dabIndex * 0.61);
    const point = samplePointAlongPolyline(
      pathPoints,
      cumulativeLengths,
      totalLength,
      distanceAlongPath,
      closed,
    );
    const angle = sampleAngleAlongPolyline(
      pathPoints,
      cumulativeLengths,
      totalLength,
      distanceAlongPath,
      closed,
      tangentWindow,
    );
    const dab = renderStyle.dabs[dabIndex % renderStyle.dabs.length];
    const scaleRandom = hashNumberTriplet(dabPositionSeed, contourSeed, dabIndex * 0.17);
    const opacityRandom = hashNumberTriplet(dabPositionSeed, contourSeed, dabIndex * 0.23);
    const rotationRandom = hashNumberTriplet(dabPositionSeed, contourSeed, dabIndex * 0.41);
    const scatterAngleRandom = hashNumberTriplet(dabPositionSeed, contourSeed, dabIndex * 0.83);
    const scatterRadiusRandom = hashNumberTriplet(dabPositionSeed, contourSeed, dabIndex * 1.29);
    const jitterScale = 1 + (((scaleRandom * 2) - 1) * renderStyle.scaleJitter);
    const jitterRotation = ((rotationRandom * 2) - 1) * renderStyle.rotationJitter;
    const jitterOpacity = clampUnit(1 + (((opacityRandom * 2) - 1) * renderStyle.opacityJitter));
    const scatterAngle = scatterAngleRandom * Math.PI * 2;
    const scatterRadius = renderStyle.scatter > 0 ? scatterRadiusRandom * renderStyle.scatter : 0;
    const drawWidth = Math.max(1, dab.width * jitterScale);
    const drawHeight = Math.max(1, dab.height * jitterScale);
    const wiggleOffset = renderStyle.wiggle > 0
      ? (
          ((wiggleRandom * 2) - 1)
          * drawHeight
          * renderStyle.wiggle
          * MAX_VECTOR_STROKE_WIGGLE_NORMAL_MULTIPLIER
        )
      : 0;
    const normalAngle = angle + (Math.PI / 2);
    const renderX =
      point.x +
      Math.cos(scatterAngle) * scatterRadius +
      Math.cos(normalAngle) * wiggleOffset;
    const renderY =
      point.y +
      Math.sin(scatterAngle) * scatterRadius +
      Math.sin(normalAngle) * wiggleOffset;

    ctx.save();
    ctx.globalAlpha = dab.opacity * jitterOpacity;
    ctx.translate(renderX, renderY);
    ctx.rotate(angle + jitterRotation);
    ctx.drawImage(
      dab.image,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight,
    );
    ctx.restore();
  };

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  let dabIndex = 0;
  for (let distanceAlongPath = 0; distanceAlongPath < totalLength; distanceAlongPath += renderStyle.spacing) {
    renderDabAt(distanceAlongPath, dabIndex);
    dabIndex += 1;
  }
  if (!closed) {
    renderDabAt(totalLength, dabIndex);
  }
  ctx.restore();
}

export function renderVectorStrokeBrushPreview(
  ctx: CanvasRenderingContext2D,
  options: {
    brushId: VectorStrokeBrushId;
    canvasHeight: number;
    canvasWidth: number;
    clear?: boolean;
    onTextureSourceReady?: (() => void) | null;
    strokeColor: string;
    strokeWiggle?: number;
    strokeOpacity?: number;
    strokeWidth: number;
  },
) {
  const canvasWidth = Math.max(1, options.canvasWidth);
  const canvasHeight = Math.max(1, options.canvasHeight);
  if (options.clear !== false) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  const strokeWidth = Math.max(0, options.strokeWidth);
  if (strokeWidth <= 0) {
    return;
  }

  const strokeOpacity = clampUnit(options.strokeOpacity ?? 1);
  const inset = Math.min(
    Math.max(12, strokeWidth / 2 + 6),
    Math.max(12, (canvasWidth / 2) - 1),
  );
  const startX = inset;
  const endX = Math.max(startX + 1, canvasWidth - inset);
  const centerY = canvasHeight / 2;

  if (options.brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = Color(options.strokeColor).alpha(strokeOpacity).rgb().string();
    ctx.beginPath();
    ctx.moveTo(startX, centerY);
    ctx.lineTo(endX, centerY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const renderStyle = resolveVectorStrokeBrushRenderStyle(
    options.brushId,
    options.strokeColor,
    strokeWidth,
    normalizeVectorStrokeWiggle(options.strokeWiggle),
    options.onTextureSourceReady,
  );
  if (!renderStyle) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = strokeOpacity;
  drawVectorStrokeBrushPath(
    ctx,
    [
      new Point(startX, centerY),
      new Point(endX, centerY),
    ],
    false,
    renderStyle,
    {},
  );
  ctx.restore();
}

function traceVectorObjectLocalPath(ctx: CanvasRenderingContext2D, obj: any): boolean {
  const objectType = getFabricObjectType(obj);

  if (objectType === 'rect') {
    const width = typeof obj.width === 'number' ? obj.width : 0;
    const height = typeof obj.height === 'number' ? obj.height : 0;
    ctx.beginPath();
    ctx.rect(-width / 2, -height / 2, width, height);
    return true;
  }

  if (objectType === 'ellipse' || objectType === 'circle') {
    const radiusX = typeof obj.rx === 'number' ? obj.rx : ((typeof obj.width === 'number' ? obj.width : 0) / 2);
    const radiusY = typeof obj.ry === 'number' ? obj.ry : ((typeof obj.height === 'number' ? obj.height : 0) / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    return true;
  }

  if (objectType === 'polygon' && Array.isArray(obj.points) && obj.points.length > 1) {
    const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
    ctx.beginPath();
    obj.points.forEach((point: { x: number; y: number }, index: number) => {
      const localX = point.x - pathOffset.x;
      const localY = point.y - pathOffset.y;
      if (index === 0) {
        ctx.moveTo(localX, localY);
      } else {
        ctx.lineTo(localX, localY);
      }
    });
    ctx.closePath();
    return true;
  }

  if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
    const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
    ctx.beginPath();
    for (const command of obj.path as any[]) {
      if (!Array.isArray(command) || typeof command[0] !== 'string') {
        continue;
      }
      switch (command[0].toUpperCase()) {
        case 'M':
          ctx.moveTo(Number(command[1]) - pathOffset.x, Number(command[2]) - pathOffset.y);
          break;
        case 'L':
          ctx.lineTo(Number(command[1]) - pathOffset.x, Number(command[2]) - pathOffset.y);
          break;
        case 'Q':
          ctx.quadraticCurveTo(
            Number(command[1]) - pathOffset.x,
            Number(command[2]) - pathOffset.y,
            Number(command[3]) - pathOffset.x,
            Number(command[4]) - pathOffset.y,
          );
          break;
        case 'C':
          ctx.bezierCurveTo(
            Number(command[1]) - pathOffset.x,
            Number(command[2]) - pathOffset.y,
            Number(command[3]) - pathOffset.x,
            Number(command[4]) - pathOffset.y,
            Number(command[5]) - pathOffset.x,
            Number(command[6]) - pathOffset.y,
          );
          break;
        case 'Z':
          ctx.closePath();
          break;
      }
    }
    // Canvas fill/clip semantics implicitly close open subpaths, which matches
    // how Fabric renders fills for open path objects.
    return true;
  }

  return false;
}

function traceScenePolylinePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
): boolean {
  if (points.length < 2) {
    return false;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  if (closed) {
    ctx.closePath();
  }
  return true;
}

function cutOutSolidStrokeFromTexturedFill(ctx: CanvasRenderingContext2D, obj: any): void {
  const brushId = getVectorObjectStrokeBrushId(obj);
  const strokeWidth = typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 0;
  if (brushId !== DEFAULT_VECTOR_STROKE_BRUSH_ID || strokeWidth <= 0) {
    return;
  }

  const contourPaths = getVectorObjectContourPaths(obj);
  if (contourPaths.length === 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = obj.strokeLineCap ?? 'round';
  ctx.lineJoin = obj.strokeLineJoin ?? 'round';
  ctx.miterLimit = typeof obj.strokeMiterLimit === 'number' ? obj.strokeMiterLimit : 4;
  ctx.setLineDash(Array.isArray(obj.strokeDashArray) ? obj.strokeDashArray : []);
  ctx.lineDashOffset = typeof obj.strokeDashOffset === 'number' ? obj.strokeDashOffset : 0;
  ctx.strokeStyle = '#000000';

  for (const contour of contourPaths) {
    if (!traceScenePolylinePath(ctx, contour.points, contour.closed)) {
      continue;
    }
    ctx.stroke();
  }

  ctx.restore();
}

function objectHasVectorTextureDecorations(obj: any): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
    return false;
  }

  if (isFabricGroupObject(obj)) {
    return getFabricChildObjects(obj).some((child) => objectHasVectorTextureDecorations(child));
  }

  const fillTextureId = getVectorObjectFillTextureId(obj);
  const hasTexturedFill = (
    vectorObjectSupportsFill(obj)
    && fillTextureId !== DEFAULT_VECTOR_FILL_TEXTURE_ID
    && !!getVectorObjectFillColor(obj)
  );

  const brushId = getVectorObjectStrokeBrushId(obj);
  const strokeColor = getVectorObjectStrokeColor(obj);
  const strokeWidth = typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 0;
  const hasTexturedStroke = brushId !== DEFAULT_VECTOR_STROKE_BRUSH_ID && !!strokeColor && strokeWidth > 0;

  return hasTexturedFill || hasTexturedStroke;
}

function applyContextTransform(
  ctx: CanvasRenderingContext2D,
  contextTransform?: number[] | null,
) {
  if (!contextTransform) {
    return;
  }

  ctx.transform(
    contextTransform[0] ?? 1,
    contextTransform[1] ?? 0,
    contextTransform[2] ?? 0,
    contextTransform[3] ?? 1,
    contextTransform[4] ?? 0,
    contextTransform[5] ?? 0,
  );
}

function renderVectorObjectBaseToContext(
  ctx: CanvasRenderingContext2D,
  obj: any,
  options: {
    contextTransform?: number[] | null;
  } = {},
): boolean {
  if (!obj || isActiveSelectionObject(obj) || isFabricGroupObject(obj) || typeof obj.render !== 'function') {
    return false;
  }

  ctx.save();
  applyContextTransform(ctx, options.contextTransform);
  obj.render(ctx);
  ctx.restore();
  return true;
}

function renderVectorTextureDecorationsForObject(
  ctx: CanvasRenderingContext2D,
  obj: any,
  options: {
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    contextTransform?: number[] | null;
    onTextureSourceReady?: (() => void) | null;
  } = {},
): boolean {
  if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj) || isFabricGroupObject(obj)) {
    return false;
  }

  const canvasWidth = options.canvasWidth ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  const canvasHeight = options.canvasHeight ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;

  ctx.save();
  applyContextTransform(ctx, options.contextTransform);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  let rendered = false;

  const fillTextureId = getVectorObjectFillTextureId(obj);
  const fillColor = getVectorObjectFillColor(obj);
  if (vectorObjectSupportsFill(obj) && fillTextureId !== DEFAULT_VECTOR_FILL_TEXTURE_ID && fillColor) {
    const textureTile = createVectorFillTextureTile(
      fillTextureId,
      fillColor,
      resolveVectorFillTextureSource(fillTextureId, options.onTextureSourceReady),
    );
    if (textureTile && typeof obj.calcTransformMatrix === 'function') {
      ctx.save();
      const transform = obj.calcTransformMatrix();
      ctx.transform(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]);
      if (traceVectorObjectLocalPath(ctx, obj)) {
        const pattern = ctx.createPattern(textureTile, 'repeat');
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.globalAlpha = getVectorObjectFillOpacity(obj) ?? 1;
          ctx.clip();
          ctx.fillRect(-canvasWidth, -canvasHeight, canvasWidth * 3, canvasHeight * 3);
          rendered = true;
        }
      }
      ctx.restore();
      // Remove the fill under a solid stroke so the object's base stroke remains visible.
      cutOutSolidStrokeFromTexturedFill(ctx, obj);
    }
  }

  const brushId = getVectorObjectStrokeBrushId(obj);
  if (brushId !== DEFAULT_VECTOR_STROKE_BRUSH_ID) {
    const strokeColor = getVectorObjectStrokeColor(obj);
    const strokeWidth = typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 0;
    if (strokeColor && strokeWidth > 0) {
      const renderStyle = resolveVectorStrokeBrushRenderStyle(
        brushId,
        strokeColor,
        strokeWidth,
        getVectorObjectStrokeWiggle(obj),
        options.onTextureSourceReady,
      );
      if (renderStyle && renderStyle.kind === 'bitmap-dab') {
        const objectOpacity = getVectorObjectStrokeOpacity(obj) ?? 1;
        const resolvedRenderStyle = objectOpacity === 1
          ? renderStyle
          : {
              ...renderStyle,
              dabs: renderStyle.dabs.map((dab) => ({
                ...dab,
                opacity: dab.opacity * objectOpacity,
              })),
            };

        const localContourPaths = getVectorObjectLocalContourPaths(obj);
        const contourPaths = getVectorObjectContourPaths(obj);
        if (contourPaths.length === localContourPaths.length) {
          for (let contourIndex = 0; contourIndex < contourPaths.length; contourIndex += 1) {
            const contour = contourPaths[contourIndex];
            const localContour = localContourPaths[contourIndex];
            drawVectorStrokeBrushPath(ctx, contour.points, contour.closed, resolvedRenderStyle, {
              contourSeed: getStableContourSeed(localContour.points, localContour.closed, contourIndex),
            });
            rendered = true;
          }
        }
      }
    }
  }

  ctx.restore();
  return rendered;
}

function renderVectorTextureOverlayNode(
  overlayCtx: CanvasRenderingContext2D,
  obj: any,
  options: {
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    contextTransform?: number[] | null;
    onTextureSourceReady?: (() => void) | null;
  } = {},
) {
  if (!obj || isActiveSelectionObject(obj)) {
    return;
  }

  normalizeVectorObjectRendering(obj);
  if (isFabricGroupObject(obj)) {
    for (const child of getFabricChildObjects(obj)) {
      renderVectorTextureOverlayNode(overlayCtx, child, options);
    }
    return;
  }

  if (!objectHasVectorTextureDecorations(obj)) {
    return;
  }

  renderVectorTextureDecorationsForObject(overlayCtx, obj, options);
}

function renderComposedVectorSceneNode(
  ctx: CanvasRenderingContext2D,
  decorationCtx: CanvasRenderingContext2D,
  decorationCanvas: HTMLCanvasElement,
  obj: any,
  options: {
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    contextTransform?: number[] | null;
    onTextureSourceReady?: (() => void) | null;
    motionSnapshot?: {
      canvas: CanvasImageSource;
      drawOffsetX: number;
      drawOffsetY: number;
      target: any;
    } | null;
  } = {},
) {
  if (!obj || isActiveSelectionObject(obj)) {
    return;
  }

  normalizeVectorObjectRendering(obj);
  const motionSnapshot = options.motionSnapshot;
  if (motionSnapshot && motionSnapshot.target === obj) {
    ctx.drawImage(
      motionSnapshot.canvas,
      motionSnapshot.drawOffsetX,
      motionSnapshot.drawOffsetY,
    );
    return;
  }

  if (isFabricGroupObject(obj)) {
    for (const child of getFabricChildObjects(obj)) {
      renderComposedVectorSceneNode(ctx, decorationCtx, decorationCanvas, child, options);
    }
    return;
  }

  renderVectorObjectBaseToContext(ctx, obj, options);
  if (!objectHasVectorTextureDecorations(obj)) {
    return;
  }

  const canvasWidth = options.canvasWidth ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  const canvasHeight = options.canvasHeight ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  decorationCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  const renderedDecorations = renderVectorTextureDecorationsForObject(decorationCtx, obj, options);
  if (renderedDecorations) {
    ctx.drawImage(decorationCanvas, 0, 0, canvasWidth, canvasHeight);
  }
}

export function renderVectorTextureOverlayForObjects(
  ctx: CanvasRenderingContext2D,
  objects: readonly any[],
  options: {
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    clear?: boolean;
    contextTransform?: number[] | null;
    onTextureSourceReady?: (() => void) | null;
  } = {},
) {
  const canvasWidth = options.canvasWidth ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  const canvasHeight = options.canvasHeight ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  if (options.clear !== false) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = Math.max(1, Math.round(canvasWidth));
  overlayCanvas.height = Math.max(1, Math.round(canvasHeight));
  const overlayCtx = getCanvas2dContext(overlayCanvas, 'readback');
  if (!overlayCtx) {
    return;
  }

  for (const obj of objects) {
    renderVectorTextureOverlayNode(overlayCtx, obj, options);
  }

  ctx.drawImage(overlayCanvas, 0, 0, canvasWidth, canvasHeight);
}

export function renderComposedVectorSceneForObjects(
  ctx: CanvasRenderingContext2D,
  objects: readonly any[],
  options: {
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    clear?: boolean;
    contextTransform?: number[] | null;
    onTextureSourceReady?: (() => void) | null;
    motionSnapshot?: {
      canvas: CanvasImageSource;
      drawOffsetX: number;
      drawOffsetY: number;
      target: any;
    } | null;
  } = {},
) {
  const canvasWidth = options.canvasWidth ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  const canvasHeight = options.canvasHeight ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  if (options.clear !== false) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  const decorationCanvas = document.createElement('canvas');
  decorationCanvas.width = Math.max(1, Math.round(canvasWidth));
  decorationCanvas.height = Math.max(1, Math.round(canvasHeight));
  const decorationCtx = getCanvas2dContext(decorationCanvas, 'readback');
  if (!decorationCtx) {
    return;
  }

  for (const obj of objects) {
    renderComposedVectorSceneNode(ctx, decorationCtx, decorationCanvas, obj, options);
  }
}

export function renderVectorTextureOverlayForFabricCanvas(
  ctx: CanvasRenderingContext2D,
  fabricCanvas: {
    getObjects: () => any[];
    viewportTransform?: number[] | null;
  },
  options: {
    additionalObjects?: readonly any[];
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    clear?: boolean;
    onTextureSourceReady?: (() => void) | null;
  } = {},
) {
  const canvasWidth = options.canvasWidth ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  const canvasHeight = options.canvasHeight ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  if (options.clear !== false) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  renderVectorTextureOverlayForObjects(
    ctx,
    [
      ...(fabricCanvas.getObjects() as any[]),
      ...(options.additionalObjects ?? []),
    ],
    {
      ...options,
      clear: false,
      contextTransform: fabricCanvas.viewportTransform,
    },
  );
}

export function renderComposedVectorSceneForFabricCanvas(
  ctx: CanvasRenderingContext2D,
  fabricCanvas: {
    getObjects: () => any[];
    viewportTransform?: number[] | null;
  },
  options: {
    additionalObjects?: readonly any[];
    canvasSize?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    clear?: boolean;
    onTextureSourceReady?: (() => void) | null;
    motionSnapshot?: {
      canvas: CanvasImageSource;
      drawOffsetX: number;
      drawOffsetY: number;
      target: any;
    } | null;
  } = {},
) {
  const canvasWidth = options.canvasWidth ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  const canvasHeight = options.canvasHeight ?? options.canvasSize ?? COSTUME_CANVAS_SIZE;
  if (options.clear !== false) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  renderComposedVectorSceneForObjects(
    ctx,
    [
      ...(fabricCanvas.getObjects() as any[]),
      ...(options.additionalObjects ?? []),
    ],
    {
      ...options,
      clear: false,
      contextTransform: fabricCanvas.viewportTransform,
    },
  );
}

export async function renderVectorLayerDocumentToCanvas(
  fabricJson: string,
  canvasSize = COSTUME_CANVAS_SIZE,
): Promise<HTMLCanvasElement | null> {
  const vectorCanvasElement = document.createElement('canvas');
  vectorCanvasElement.width = canvasSize;
  vectorCanvasElement.height = canvasSize;
  const vectorCanvas = new StaticCanvas(vectorCanvasElement, {
    width: canvasSize,
    height: canvasSize,
    renderOnAddRemove: false,
    enableRetinaScaling: false,
  });

  try {
    const parsed = JSON.parse(fabricJson);
    await vectorCanvas.loadFromJSON(parsed);
    for (const obj of vectorCanvas.getObjects() as any[]) {
      normalizeVectorObjectRendering(obj);
    }
    vectorCanvas.renderAll();

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = canvasSize;
    snapshotCanvas.height = canvasSize;
    const snapshotCtx = getCanvas2dContext(snapshotCanvas, 'readback');
    if (!snapshotCtx) {
      return null;
    }

    renderComposedVectorSceneForFabricCanvas(snapshotCtx, vectorCanvas, { canvasSize });
    return snapshotCanvas;
  } finally {
    vectorCanvas.dispose();
  }
}

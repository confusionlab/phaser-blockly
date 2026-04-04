import { Point, StaticCanvas } from 'fabric';
import Color from 'color';
import {
  createVectorFillTextureTile,
  getVectorFillTexturePreset,
  DEFAULT_VECTOR_FILL_TEXTURE_ID,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';
import {
  createVectorStrokeBrushRenderStyle,
  getVectorStrokeBrushPreset,
  DEFAULT_VECTOR_STROKE_BRUSH_ID,
  type VectorStrokeBrushId,
  type VectorStrokeBrushRenderStyle,
} from '@/lib/vector/vectorStrokeBrushCore';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import { getCanvas2dContext } from '@/utils/canvas2d';
import { COSTUME_CANVAS_SIZE } from './costumeDocument';

const MAX_VECTOR_STROKE_BRUSH_RENDER_CACHE_ENTRIES = 256;

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
    texturePath ?? 'builtin',
    textureSource ? 'ready' : 'fallback',
  ].join('|');
  const cached = vectorStrokeBrushRenderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return rememberVectorStrokeBrushRenderStyle(
    cacheKey,
    createVectorStrokeBrushRenderStyle(brushId, strokeColor, strokeWidth, textureSource),
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
  return typeof textureId === 'string' ? (textureId as VectorFillTextureId) : DEFAULT_VECTOR_FILL_TEXTURE_ID;
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
  return typeof brushId === 'string' ? (brushId as VectorStrokeBrushId) : DEFAULT_VECTOR_STROKE_BRUSH_ID;
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
  const fillOpacity = getVectorObjectFillOpacity(candidate) ?? 1;
  if ((candidate as { vectorStrokeOpacity?: unknown }).vectorStrokeOpacity !== strokeOpacity) {
    updates.vectorStrokeOpacity = strokeOpacity;
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

function transformVectorLocalPointToScene(obj: any, x: number, y: number, pathOffset?: Point | null) {
  const offsetX = pathOffset?.x ?? 0;
  const offsetY = pathOffset?.y ?? 0;
  return new Point(x - offsetX, y - offsetY).transform(obj.calcTransformMatrix());
}

function getVectorObjectContourPaths(obj: any): Array<{ closed: boolean; points: Point[] }> {
  if (!obj || typeof obj.calcTransformMatrix !== 'function') {
    return [];
  }

  const objectType = getFabricObjectType(obj);
  const strokeSampleSpacing = getVectorStrokeSampleSpacing(
    typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
  );
  const transformPoint = (x: number, y: number, pathOffset?: Point | null) => (
    transformVectorLocalPointToScene(obj, x, y, pathOffset)
  );

  if (objectType === 'line' && typeof obj.calcLinePoints === 'function') {
    const points = obj.calcLinePoints();
    return [{
      closed: false,
      points: [
        transformPoint(points.x1, points.y1),
        transformPoint(points.x2, points.y2),
      ],
    }];
  }

  if (objectType === 'rect') {
    const halfWidth = (typeof obj.width === 'number' ? obj.width : 0) / 2;
    const halfHeight = (typeof obj.height === 'number' ? obj.height : 0) / 2;
    return [{
      closed: true,
      points: [
        transformPoint(-halfWidth, -halfHeight),
        transformPoint(halfWidth, -halfHeight),
        transformPoint(halfWidth, halfHeight),
        transformPoint(-halfWidth, halfHeight),
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
      points.push(transformPoint(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY));
    }
    return [{ closed: true, points }];
  }

  if ((objectType === 'polygon' || objectType === 'polyline') && Array.isArray(obj.points) && obj.points.length > 1) {
    const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
    return [{
      closed: objectType === 'polygon',
      points: obj.points.map((point: { x: number; y: number }) => transformPoint(point.x, point.y, pathOffset)),
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
        currentPoint = transformPoint(command[1], command[2], pathOffset);
        subpathStart = currentPoint;
        appendPoint(currentPoint);
        continue;
      }
      if (!currentPoint) {
        continue;
      }
      if (commandType === 'L') {
        const endPoint = transformPoint(command[1], command[2], pathOffset);
        appendPoint(endPoint);
        currentPoint = endPoint;
        continue;
      }
      if (commandType === 'Q') {
        const control = transformPoint(command[1], command[2], pathOffset);
        const endPoint = transformPoint(command[3], command[4], pathOffset);
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
        const control1 = transformPoint(command[1], command[2], pathOffset);
        const control2 = transformPoint(command[3], command[4], pathOffset);
        const endPoint = transformPoint(command[5], command[6], pathOffset);
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

function drawVectorStrokeBrushPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  renderStyle: VectorStrokeBrushRenderStyle,
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

  const renderDabAt = (distanceAlongPath: number, dabIndex: number) => {
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
    const scaleRandom = hashNumberTriplet(point.x, point.y, dabIndex * 0.17);
    const opacityRandom = hashNumberTriplet(point.y, point.x, dabIndex * 0.23);
    const rotationRandom = hashNumberTriplet(point.y, point.x, dabIndex * 0.41);
    const scatterAngleRandom = hashNumberTriplet(point.x, angle, dabIndex * 0.83);
    const scatterRadiusRandom = hashNumberTriplet(point.y, angle, dabIndex * 1.29);
    const jitterScale = 1 + (((scaleRandom * 2) - 1) * renderStyle.scaleJitter);
    const jitterRotation = ((rotationRandom * 2) - 1) * renderStyle.rotationJitter;
    const jitterOpacity = clampUnit(1 + (((opacityRandom * 2) - 1) * renderStyle.opacityJitter));
    const scatterAngle = scatterAngleRandom * Math.PI * 2;
    const scatterRadius = renderStyle.scatter > 0 ? scatterRadiusRandom * renderStyle.scatter : 0;
    const renderX = point.x + Math.cos(scatterAngle) * scatterRadius;
    const renderY = point.y + Math.sin(scatterAngle) * scatterRadius;
    const drawWidth = Math.max(1, dab.width * jitterScale);
    const drawHeight = Math.max(1, dab.height * jitterScale);

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

  overlayCtx.save();
  const contextTransform = options.contextTransform;
  if (contextTransform) {
    overlayCtx.transform(
      contextTransform[0] ?? 1,
      contextTransform[1] ?? 0,
      contextTransform[2] ?? 0,
      contextTransform[3] ?? 1,
      contextTransform[4] ?? 0,
      contextTransform[5] ?? 0,
    );
  }
  overlayCtx.lineCap = 'round';
  overlayCtx.lineJoin = 'round';
  overlayCtx.setLineDash([]);

  for (const obj of objects) {
    if (!obj || isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) {
      continue;
    }

    const fillTextureId = getVectorObjectFillTextureId(obj);
    const fillColor = getVectorObjectFillColor(obj);
    if (vectorObjectSupportsFill(obj) && fillTextureId !== DEFAULT_VECTOR_FILL_TEXTURE_ID && fillColor) {
      const textureTile = createVectorFillTextureTile(
        fillTextureId,
        fillColor,
        resolveVectorFillTextureSource(fillTextureId, options.onTextureSourceReady),
      );
      if (textureTile && typeof obj.calcTransformMatrix === 'function') {
        overlayCtx.save();
        const transform = obj.calcTransformMatrix();
        overlayCtx.transform(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]);
        if (traceVectorObjectLocalPath(overlayCtx, obj)) {
          const pattern = overlayCtx.createPattern(textureTile, 'repeat');
          if (pattern) {
            overlayCtx.fillStyle = pattern;
            overlayCtx.globalAlpha = getVectorObjectFillOpacity(obj) ?? 1;
            overlayCtx.clip();
            overlayCtx.fillRect(-canvasWidth, -canvasHeight, canvasWidth * 3, canvasHeight * 3);
          }
        }
        overlayCtx.restore();
        // Textured fills are composited in a post-pass above Fabric's solid stroke.
        // Punch the stroke band back out so the already-rendered solid stroke stays visible.
        cutOutSolidStrokeFromTexturedFill(overlayCtx, obj);
      }
    }

    const brushId = getVectorObjectStrokeBrushId(obj);
    if (brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID) {
      continue;
    }
    const strokeColor = getVectorObjectStrokeColor(obj);
    const strokeWidth = typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 0;
    if (!strokeColor || strokeWidth <= 0) {
      continue;
    }

    const renderStyle = resolveVectorStrokeBrushRenderStyle(
      brushId,
      strokeColor,
      strokeWidth,
      options.onTextureSourceReady,
    );
    if (!renderStyle || renderStyle.kind !== 'bitmap-dab') {
      continue;
    }
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

    const contourPaths = getVectorObjectContourPaths(obj);
    if (contourPaths.length === 0) {
      continue;
    }

    for (const contour of contourPaths) {
      drawVectorStrokeBrushPath(overlayCtx, contour.points, contour.closed, resolvedRenderStyle);
    }
  }

  overlayCtx.restore();
  ctx.drawImage(overlayCanvas, 0, 0, canvasWidth, canvasHeight);
}

export function renderVectorTextureOverlayForFabricCanvas(
  ctx: CanvasRenderingContext2D,
  fabricCanvas: {
    getObjects: () => any[];
    viewportTransform?: number[] | null;
  },
  options: {
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
    fabricCanvas.getObjects() as any[],
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

    snapshotCtx.drawImage(vectorCanvasElement, 0, 0, canvasSize, canvasSize);
    renderVectorTextureOverlayForFabricCanvas(snapshotCtx, vectorCanvas, {
      canvasSize,
      clear: false,
    });
    return snapshotCanvas;
  } finally {
    vectorCanvas.dispose();
  }
}

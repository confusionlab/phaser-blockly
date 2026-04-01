export type TransformGizmoCorner = 'nw' | 'ne' | 'se' | 'sw';
export type TransformGizmoEdge = 'horizontal' | 'vertical';
export type TransformGizmoSide = 'n' | 'e' | 's' | 'w';

export interface TransformGizmoPoint {
  x: number;
  y: number;
}

export interface TransformGizmoCorners<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  nw: TPoint;
  ne: TPoint;
  se: TPoint;
  sw: TPoint;
}

export interface TransformGizmoFrame<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  center: TPoint;
  corners: TransformGizmoCorners<TPoint>;
}

export interface TransformGizmoEdgeSegment<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  start: TPoint;
  end: TPoint;
  center: TPoint;
  edge: TransformGizmoEdge;
  handleSign: -1 | 1;
}

export interface CornerScaleResult<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  width: number;
  height: number;
  signedWidth: number;
  signedHeight: number;
  center: TPoint;
}

export interface EdgeScaleResult<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  width: number;
  height: number;
  signedWidth: number;
  signedHeight: number;
  center: TPoint;
}

export const TRANSFORM_GIZMO_BORDER_COLOR = '#0ea5e9';
export const TRANSFORM_GIZMO_FILL_COLOR = 'rgba(14, 165, 233, 0.08)';
export const TRANSFORM_GIZMO_HANDLE_FILL = '#ffffff';
export const TRANSFORM_GIZMO_HANDLE_STROKE = TRANSFORM_GIZMO_BORDER_COLOR;
export const TRANSFORM_GIZMO_HANDLE_RADIUS = 7;
export const TRANSFORM_GIZMO_STROKE_WIDTH = 1.5;
export const TRANSFORM_GIZMO_ROTATE_RING_INSET = 2;
export const TRANSFORM_GIZMO_ROTATE_RING_OUTSET = 12;
export const TRANSFORM_GIZMO_TOUCH_PADDING = 4;
export const TRANSFORM_GIZMO_PROPORTIONAL_GUIDE_DASH = [6, 5] as const;
const TRANSFORM_CURSOR_SIZE = 24;
const TRANSFORM_CURSOR_HOTSPOT = 12;
const TRANSFORM_ROTATE_CURSOR_QUANTIZATION_DEGREES = 45;
const transformCursorCache = new Map<string, string>();

const ROTATE_CURSOR_MARKUP = [
  '<path d="M8 16.25A6.2 6.2 0 0 1 16.25 8" stroke="#ffffff" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M12.8 7.15H17.35V11.7" stroke="#ffffff" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M8 16.25A6.2 6.2 0 0 1 16.25 8" stroke="#111827" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M12.8 7.15H17.35V11.7" stroke="#111827" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
].join('');

const SYSTEM_AXIS_RESIZE_CURSORS = [
  'ew-resize',
  'nwse-resize',
  'ns-resize',
  'nesw-resize',
] as const;

function normalizeCursorDegrees(degrees: number) {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function quantizeCursorDegrees(degrees: number, incrementDegrees: number) {
  return normalizeCursorDegrees(
    Math.round(degrees / incrementDegrees) * incrementDegrees,
  );
}

function buildTransformCursorDataUrl(markup: string, rotationDegrees: number) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TRANSFORM_CURSOR_SIZE}" height="${TRANSFORM_CURSOR_SIZE}" viewBox="0 0 ${TRANSFORM_CURSOR_SIZE} ${TRANSFORM_CURSOR_SIZE}" fill="none">`,
    `<g transform="rotate(${rotationDegrees.toFixed(2)} ${TRANSFORM_CURSOR_HOTSPOT} ${TRANSFORM_CURSOR_HOTSPOT})">`,
    markup,
    '</g>',
    '</svg>',
  ].join('');
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${TRANSFORM_CURSOR_HOTSPOT} ${TRANSFORM_CURSOR_HOTSPOT}`;
}

function getTransformCursor(
  key: string,
  markup: string,
  rotationDegrees: number,
  fallback: string,
  incrementDegrees: number = TRANSFORM_ROTATE_CURSOR_QUANTIZATION_DEGREES,
) {
  const quantizedDegrees = quantizeCursorDegrees(rotationDegrees, incrementDegrees);
  const cacheKey = `${key}:${quantizedDegrees}`;
  const cached = transformCursorCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const cursor = `${buildTransformCursorDataUrl(markup, quantizedDegrees)}, ${fallback}`;
  transformCursorCache.set(cacheKey, cursor);
  return cursor;
}

function getCornerBaseDegrees(corner: TransformGizmoCorner) {
  switch (corner) {
    case 'nw':
      return 225;
    case 'ne':
      return 315;
    case 'se':
      return 45;
    case 'sw':
      return 135;
  }
}

function getRotateCornerBaseDegrees(corner?: TransformGizmoCorner) {
  switch (corner) {
    case 'ne':
      return 0;
    case 'se':
      return 90;
    case 'sw':
      return 180;
    case 'nw':
      return 270;
    default:
      return 0;
  }
}

function getDoubleSidedResizeCursor(rotationDegrees: number) {
  const axisIndex = Math.round(normalizeCursorDegrees(rotationDegrees) / 45) % 4;
  return SYSTEM_AXIS_RESIZE_CURSORS[axisIndex]!;
}

export function getTransformGizmoCornerCursor(corner: TransformGizmoCorner, rotationRadians: number = 0) {
  const rotationDegrees = getCornerBaseDegrees(corner) + (rotationRadians * 180) / Math.PI;
  return getDoubleSidedResizeCursor(rotationDegrees);
}

export function getTransformGizmoEdgeCursor(edge: TransformGizmoEdge, rotationRadians: number = 0) {
  const baseDegrees = edge === 'horizontal' ? 0 : 90;
  const rotationDegrees = baseDegrees + (rotationRadians * 180) / Math.PI;
  return getDoubleSidedResizeCursor(rotationDegrees);
}

export function getTransformGizmoRotateCursor(rotationRadians: number = 0, corner?: TransformGizmoCorner) {
  const rotationDegrees = getRotateCornerBaseDegrees(corner) + (rotationRadians * 180) / Math.PI;
  return getTransformCursor(`rotate-${corner ?? 'free'}`, ROTATE_CURSOR_MARKUP, rotationDegrees, 'grab');
}

export function rotateTransformPoint<TPoint extends TransformGizmoPoint>(point: TPoint, radians: number): TPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  } as TPoint;
}

export function getTransformCornerDiagonal<TPoint extends TransformGizmoPoint>(
  corners: TransformGizmoCorners<TPoint>,
  corner: TransformGizmoCorner,
) {
  switch (corner) {
    case 'nw':
      return { start: corners.nw, end: corners.se };
    case 'ne':
      return { start: corners.ne, end: corners.sw };
    case 'se':
      return { start: corners.se, end: corners.nw };
    case 'sw':
      return { start: corners.sw, end: corners.ne };
  }
}

export function drawTransformProportionalGuide(
  ctx: CanvasRenderingContext2D,
  start: TransformGizmoPoint,
  end: TransformGizmoPoint,
  color: string = TRANSFORM_GIZMO_BORDER_COLOR,
) {
  ctx.save();
  ctx.setLineDash([...TRANSFORM_GIZMO_PROPORTIONAL_GUIDE_DASH]);
  ctx.strokeStyle = color;
  ctx.lineWidth = TRANSFORM_GIZMO_STROKE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

export function getTransformGizmoDistance(a: TransformGizmoPoint, b: TransformGizmoPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function isPointInsideTransformHandle(
  point: TransformGizmoPoint,
  center: TransformGizmoPoint,
  radius: number,
) {
  return getTransformGizmoDistance(point, center) <= radius;
}

export function isPointInsideTransformRotateRing(
  point: TransformGizmoPoint,
  center: TransformGizmoPoint,
  handleRadius: number,
  corner?: TransformGizmoCorner,
  rotationRadians: number = 0,
) {
  const distance = getTransformGizmoDistance(point, center);
  const innerRadius = handleRadius + TRANSFORM_GIZMO_ROTATE_RING_INSET;
  const outerRadius = handleRadius + TRANSFORM_GIZMO_ROTATE_RING_OUTSET;
  if (!(distance > innerRadius && distance <= outerRadius)) {
    return false;
  }

  if (!corner) {
    return true;
  }

  const localOffset = rotateTransformPoint({
    x: point.x - center.x,
    y: point.y - center.y,
  }, -rotationRadians);

  switch (corner) {
    case 'nw':
      return localOffset.x <= 0 && localOffset.y <= 0;
    case 'ne':
      return localOffset.x >= 0 && localOffset.y <= 0;
    case 'se':
      return localOffset.x >= 0 && localOffset.y >= 0;
    case 'sw':
      return localOffset.x <= 0 && localOffset.y >= 0;
  }
}

interface CornerScaleComputationOptions<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  referencePoint: TPoint;
  pointerPoint: TPoint;
  handleXSign: -1 | 1;
  handleYSign: -1 | 1;
  rotationRadians: number;
  baseWidth: number;
  baseHeight: number;
  minWidth: number;
  minHeight: number;
  proportional: boolean;
  centered: boolean;
}

interface EdgeScaleComputationOptions<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  referencePoint: TPoint;
  pointerPoint: TPoint;
  edge: TransformGizmoEdge;
  handleSign: -1 | 1;
  rotationRadians: number;
  baseWidth: number;
  baseHeight: number;
  minWidth: number;
  minHeight: number;
  proportional: boolean;
  centered: boolean;
}

function clampSignedExtent(value: number, minMagnitude: number) {
  if (!Number.isFinite(value)) {
    return minMagnitude;
  }
  const sign = value < 0 ? -1 : 1;
  return sign * Math.max(Math.abs(value), minMagnitude);
}

export function computeCornerScaleResult<TPoint extends TransformGizmoPoint>({
  referencePoint,
  pointerPoint,
  handleXSign,
  handleYSign,
  rotationRadians,
  baseWidth,
  baseHeight,
  minWidth,
  minHeight,
  proportional,
  centered,
}: CornerScaleComputationOptions<TPoint>): CornerScaleResult<TPoint> {
  const rotatedPointer = rotateTransformPoint({
    x: pointerPoint.x - referencePoint.x,
    y: pointerPoint.y - referencePoint.y,
  }, rotationRadians);

  const rawWidth = centered
    ? handleXSign * rotatedPointer.x * 2
    : handleXSign * rotatedPointer.x;
  const rawHeight = centered
    ? handleYSign * rotatedPointer.y * 2
    : handleYSign * rotatedPointer.y;

  let signedWidth = clampSignedExtent(rawWidth, minWidth);
  let signedHeight = clampSignedExtent(rawHeight, minHeight);
  if (proportional) {
    const safeBaseWidth = Math.max(baseWidth, 0.0001);
    const safeBaseHeight = Math.max(baseHeight, 0.0001);
    const proportionalScale = Math.max(Math.abs(rawWidth) / safeBaseWidth, Math.abs(rawHeight) / safeBaseHeight);
    const proportionalWidth = Math.max(minWidth, safeBaseWidth * proportionalScale);
    const proportionalHeight = Math.max(minHeight, safeBaseHeight * proportionalScale);
    signedWidth = (signedWidth < 0 ? -1 : 1) * proportionalWidth;
    signedHeight = (signedHeight < 0 ? -1 : 1) * proportionalHeight;
  }

  const width = Math.abs(signedWidth);
  const height = Math.abs(signedHeight);

  if (centered) {
    return {
      width,
      height,
      signedWidth,
      signedHeight,
      center: { ...referencePoint },
    };
  }

  const halfExtents = rotateTransformPoint({
    x: handleXSign * signedWidth * 0.5,
    y: handleYSign * signedHeight * 0.5,
  }, -rotationRadians);

  return {
    width,
    height,
    signedWidth,
    signedHeight,
    center: {
      x: referencePoint.x + halfExtents.x,
      y: referencePoint.y + halfExtents.y,
    } as TPoint,
  };
}

export function computeEdgeScaleResult<TPoint extends TransformGizmoPoint>({
  referencePoint,
  pointerPoint,
  edge,
  handleSign,
  rotationRadians,
  baseWidth,
  baseHeight,
  minWidth,
  minHeight,
  proportional,
  centered,
}: EdgeScaleComputationOptions<TPoint>): EdgeScaleResult<TPoint> {
  const rotatedPointer = rotateTransformPoint({
    x: pointerPoint.x - referencePoint.x,
    y: pointerPoint.y - referencePoint.y,
  }, rotationRadians);

  let signedWidth = baseWidth;
  let signedHeight = baseHeight;
  if (edge === 'horizontal') {
    const rawWidth = centered
      ? handleSign * rotatedPointer.x * 2
      : handleSign * rotatedPointer.x;
    signedWidth = clampSignedExtent(rawWidth, minWidth);
  } else {
    const rawHeight = centered
      ? handleSign * rotatedPointer.y * 2
      : handleSign * rotatedPointer.y;
    signedHeight = clampSignedExtent(rawHeight, minHeight);
  }

  if (proportional) {
    const safeBaseWidth = Math.max(baseWidth, 0.0001);
    const safeBaseHeight = Math.max(baseHeight, 0.0001);
    if (edge === 'horizontal') {
      const scale = signedWidth / safeBaseWidth;
      signedHeight = scale * safeBaseHeight;
      signedHeight = clampSignedExtent(signedHeight, minHeight);
    } else {
      const scale = signedHeight / safeBaseHeight;
      signedWidth = scale * safeBaseWidth;
      signedWidth = clampSignedExtent(signedWidth, minWidth);
    }
  }

  const width = Math.abs(signedWidth);
  const height = Math.abs(signedHeight);

  if (centered) {
    return {
      width,
      height,
      signedWidth,
      signedHeight,
      center: { ...referencePoint },
    };
  }

  const halfExtents = rotateTransformPoint({
    x: edge === 'horizontal' ? handleSign * signedWidth * 0.5 : 0,
    y: edge === 'vertical' ? handleSign * signedHeight * 0.5 : 0,
  }, -rotationRadians);

  return {
    width,
    height,
    signedWidth,
    signedHeight,
    center: {
      x: referencePoint.x + halfExtents.x,
      y: referencePoint.y + halfExtents.y,
    } as TPoint,
  };
}

export function getTransformGizmoHandleFrame<TPoint extends TransformGizmoPoint>(
  center: TPoint,
  width: number,
  height: number,
  rotationRadians: number,
): TransformGizmoFrame<TPoint> {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const mapLocal = (x: number, y: number) => {
    const rotated = rotateTransformPoint({ x, y }, rotationRadians);
    return {
      x: center.x + rotated.x,
      y: center.y + rotated.y,
    } as TPoint;
  };

  return {
    center,
    corners: {
      nw: mapLocal(-halfWidth, -halfHeight),
      ne: mapLocal(halfWidth, -halfHeight),
      se: mapLocal(halfWidth, halfHeight),
      sw: mapLocal(-halfWidth, halfHeight),
    },
  };
}

export function getTransformGizmoEdgeSegments<TPoint extends TransformGizmoPoint>(
  frame: TransformGizmoFrame<TPoint>,
): Record<TransformGizmoSide, TransformGizmoEdgeSegment<TPoint>> {
  const midpoint = (start: TPoint, end: TPoint) => ({
    x: (start.x + end.x) * 0.5,
    y: (start.y + end.y) * 0.5,
  }) as TPoint;

  return {
    n: {
      start: frame.corners.nw,
      end: frame.corners.ne,
      center: midpoint(frame.corners.nw, frame.corners.ne),
      edge: 'vertical',
      handleSign: -1,
    },
    e: {
      start: frame.corners.ne,
      end: frame.corners.se,
      center: midpoint(frame.corners.ne, frame.corners.se),
      edge: 'horizontal',
      handleSign: 1,
    },
    s: {
      start: frame.corners.sw,
      end: frame.corners.se,
      center: midpoint(frame.corners.sw, frame.corners.se),
      edge: 'vertical',
      handleSign: 1,
    },
    w: {
      start: frame.corners.nw,
      end: frame.corners.sw,
      center: midpoint(frame.corners.nw, frame.corners.sw),
      edge: 'horizontal',
      handleSign: -1,
    },
  };
}

export function getOppositeTransformGizmoSide(side: TransformGizmoSide): TransformGizmoSide {
  switch (side) {
    case 'n':
      return 's';
    case 'e':
      return 'w';
    case 's':
      return 'n';
    case 'w':
      return 'e';
  }
}

export function getTransformGizmoDistanceToSegment(
  point: TransformGizmoPoint,
  start: TransformGizmoPoint,
  end: TransformGizmoPoint,
) {
  const segmentDx = end.x - start.x;
  const segmentDy = end.y - start.y;
  const segmentLengthSquared = segmentDx * segmentDx + segmentDy * segmentDy;
  if (segmentLengthSquared <= 0.0001) {
    return getTransformGizmoDistance(point, start);
  }

  const projection = (
    ((point.x - start.x) * segmentDx) +
    ((point.y - start.y) * segmentDy)
  ) / segmentLengthSquared;
  const clampedProjection = Math.min(1, Math.max(0, projection));
  const closest = {
    x: start.x + segmentDx * clampedProjection,
    y: start.y + segmentDy * clampedProjection,
  };
  return getTransformGizmoDistance(point, closest);
}

export function isPointNearTransformEdge(
  point: TransformGizmoPoint,
  start: TransformGizmoPoint,
  end: TransformGizmoPoint,
  padding: number,
) {
  return getTransformGizmoDistanceToSegment(point, start, end) <= padding;
}

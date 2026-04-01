export type TransformGizmoCorner = 'nw' | 'ne' | 'se' | 'sw';

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

export interface CornerScaleResult<TPoint extends TransformGizmoPoint = TransformGizmoPoint> {
  width: number;
  height: number;
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

const ROTATE_CURSOR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M17.6 8.1A6.5 6.5 0 1 0 18.5 14" stroke="#0ea5e9" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14.2 5.2h4.7v4.7" stroke="#0ea5e9" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
);

export const TRANSFORM_GIZMO_ROTATE_CURSOR = `url("data:image/svg+xml,${ROTATE_CURSOR_SVG}") 12 12, grab`;

export function getTransformGizmoCornerCursor(corner: TransformGizmoCorner) {
  return corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
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
) {
  const distance = getTransformGizmoDistance(point, center);
  const innerRadius = handleRadius + TRANSFORM_GIZMO_ROTATE_RING_INSET;
  const outerRadius = handleRadius + TRANSFORM_GIZMO_ROTATE_RING_OUTSET;
  return distance > innerRadius && distance <= outerRadius;
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

  const rawWidth = Math.max(
    minWidth,
    centered
      ? Math.abs(rotatedPointer.x) * 2
      : handleXSign * rotatedPointer.x,
  );
  const rawHeight = Math.max(
    minHeight,
    centered
      ? Math.abs(rotatedPointer.y) * 2
      : handleYSign * rotatedPointer.y,
  );

  let width = rawWidth;
  let height = rawHeight;
  if (proportional) {
    const safeBaseWidth = Math.max(baseWidth, 0.0001);
    const safeBaseHeight = Math.max(baseHeight, 0.0001);
    const proportionalScale = Math.max(rawWidth / safeBaseWidth, rawHeight / safeBaseHeight);
    width = Math.max(minWidth, safeBaseWidth * proportionalScale);
    height = Math.max(minHeight, safeBaseHeight * proportionalScale);
  }

  if (centered) {
    return {
      width,
      height,
      center: { ...referencePoint },
    };
  }

  const halfExtents = rotateTransformPoint({
    x: handleXSign * width * 0.5,
    y: handleYSign * height * 0.5,
  }, -rotationRadians);

  return {
    width,
    height,
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

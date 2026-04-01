import {
  DEFAULT_TRANSFORM_GIZMO_PROPORTIONAL_DIAGONAL,
  TRANSFORM_GIZMO_BORDER_COLOR,
  TRANSFORM_GIZMO_FILL_COLOR,
  TRANSFORM_GIZMO_HANDLE_FILL,
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  TRANSFORM_GIZMO_HANDLE_STROKE,
  TRANSFORM_GIZMO_STROKE_WIDTH,
  drawTransformProportionalGuide,
  getTransformDiagonal,
  getTransformDiagonalFromCorner,
  getTransformCornerDiagonal,
  type TransformGizmoDiagonal,
  type TransformGizmoCorner,
  type TransformGizmoCorners,
} from './unifiedTransformGizmo';

export interface ScreenSpaceTransformOverlayOptions {
  corner?: TransformGizmoCorner | null;
  fillColor?: string;
  handleFill?: string;
  handleRadius?: number;
  handleStroke?: string;
  handleStrokeWidth?: number;
  proportionalGuide?: boolean;
  proportionalGuideDiagonal?: TransformGizmoDiagonal | null;
  showFill?: boolean;
  showHandles?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
}

export function renderScreenSpaceTransformOverlay(
  ctx: CanvasRenderingContext2D,
  corners: TransformGizmoCorners,
  options: ScreenSpaceTransformOverlayOptions = {},
): void {
  const {
    corner = null,
    fillColor = TRANSFORM_GIZMO_FILL_COLOR,
    handleFill = TRANSFORM_GIZMO_HANDLE_FILL,
    handleRadius = TRANSFORM_GIZMO_HANDLE_RADIUS,
    handleStroke = TRANSFORM_GIZMO_HANDLE_STROKE,
    handleStrokeWidth = 2,
    proportionalGuide = false,
    proportionalGuideDiagonal = null,
    showFill = true,
    showHandles = true,
    strokeColor = TRANSFORM_GIZMO_BORDER_COLOR,
    strokeWidth = TRANSFORM_GIZMO_STROKE_WIDTH,
  } = options;

  ctx.save();
  try {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    if (showFill) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    ctx.stroke();

    if (proportionalGuide || proportionalGuideDiagonal || corner) {
      const diagonal = proportionalGuideDiagonal
        ?? (corner ? getTransformDiagonalFromCorner(corner) : DEFAULT_TRANSFORM_GIZMO_PROPORTIONAL_DIAGONAL);
      const diagonalLine = getTransformDiagonal(corners, diagonal)
        ?? (corner ? getTransformCornerDiagonal(corners, corner) : null);
      if (diagonalLine) {
        drawTransformProportionalGuide(ctx, diagonalLine.start, diagonalLine.end, strokeColor);
      }
    }

    if (!showHandles) {
      return;
    }

    ctx.fillStyle = handleFill;
    ctx.strokeStyle = handleStroke;
    ctx.lineWidth = handleStrokeWidth;
    for (const point of [corners.nw, corners.ne, corners.se, corners.sw]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

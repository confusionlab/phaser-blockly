import { Point } from 'fabric';
import type { CostumeAssetFrame, CostumeEditorMode } from '@/types';
import { readCanvasImageData } from '@/utils/canvas2d';
import { areCostumeAssetFramesEqual, cloneCostumeAssetFrame } from '@/lib/costume/costumeAssetFrame';
import type { TransformGizmoCorner, TransformGizmoCornerTarget } from '@/lib/editor/unifiedTransformGizmo';
import type {
  VectorHandleMode,
  VectorPathNodeHandleType,
  VectorToolStyle,
  VectorToolStyleMixedState,
} from './CostumeToolbar';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import { EDITOR_VIEWPORT_ZOOM_STEP } from '@/lib/editor/editorViewportPolicy';
import {
  DEFAULT_EDITOR_SELECTION_ACCENT,
  DEFAULT_EDITOR_SELECTION_FILL,
  DEFAULT_EDITOR_SELECTION_HANDLE_FILL,
} from '@/lib/ui/editorSelectionTokens';

export const CANVAS_SIZE = 1024;
export const BASE_DISPLAY_SIZE = 480;
export const BASE_VIEW_SCALE = BASE_DISPLAY_SIZE / CANVAS_SIZE;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
export const ZOOM_STEP = EDITOR_VIEWPORT_ZOOM_STEP;
export const MAX_PAN_OVERSCROLL_PX = 160;
export const HANDLE_SIZE = 20;
export const VECTOR_SELECTION_COLOR = DEFAULT_EDITOR_SELECTION_ACCENT;
export const VECTOR_SELECTION_CORNER_COLOR = DEFAULT_EDITOR_SELECTION_HANDLE_FILL;
export const VECTOR_SELECTION_CORNER_STROKE = DEFAULT_EDITOR_SELECTION_ACCENT;
export const VECTOR_SELECTION_BORDER_OPACITY = 1;
export const VECTOR_SELECTION_BORDER_SCALE = 2;
export const CIRCLE_CUBIC_KAPPA = 0.5522847498307936;
export const VECTOR_POINT_EDIT_GUIDE_STROKE = '#cbd5e1';
export const VECTOR_POINT_EDIT_GUIDE_STROKE_WIDTH = 6;
export const VECTOR_POINT_HANDLE_GUIDE_STROKE = '#94a3b8';
export const VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH = 2;
export const VECTOR_POINT_SELECTION_BOX_FILL = DEFAULT_EDITOR_SELECTION_FILL;
export const VECTOR_POINT_SELECTION_HANDLE_SIZE = 12;
export const VECTOR_POINT_SELECTION_HIT_PADDING = 6;
export const VECTOR_POINT_SELECTION_MIN_SIZE = 12;
export const VECTOR_POINT_INSERTION_HIT_RADIUS_PX = 8;
export const VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX = 10;
export const VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX = 4;
export const PEN_TOOL_CLOSE_HIT_RADIUS_PX = 10;
export const PEN_TOOL_DRAG_THRESHOLD_PX = 4;
export const OBJECT_SELECTION_CORNER_SIZE = 12;
export const OBJECT_SELECTION_PADDING = 2;
export const DEFAULT_COSTUME_PREVIEW_SCALE = BASE_VIEW_SCALE;
export const SHAPE_LINE_SNAP_INCREMENT_RADIANS = Math.PI / 4;
export const VECTOR_TOOL_STYLE_KEYS: Array<keyof VectorToolStyle> = [
  'fillColor',
  'fillTextureId',
  'fillOpacity',
  'strokeColor',
  'strokeOpacity',
  'strokeWidth',
  'strokeBrushId',
];

export const COSTUME_WORLD_RECT = {
  left: 0,
  top: 0,
  width: CANVAS_SIZE,
  height: CANVAS_SIZE,
} as const;

export function getZoomInvariantCanvasMetric(metric: number, zoom: number) {
  return metric / Math.max(zoom, 0.0001);
}

export function normalizeRadians(angleRadians: number) {
  const fullTurn = Math.PI * 2;
  if (!Number.isFinite(angleRadians)) {
    return 0;
  }

  let normalized = angleRadians % fullTurn;
  if (normalized <= -Math.PI) {
    normalized += fullTurn;
  } else if (normalized > Math.PI) {
    normalized -= fullTurn;
  }
  return normalized;
}

export function normalizeDegrees(angleDegrees: number) {
  if (!Number.isFinite(angleDegrees)) {
    return 0;
  }

  let normalized = angleDegrees % 360;
  if (normalized <= -180) {
    normalized += 360;
  } else if (normalized > 180) {
    normalized -= 360;
  }
  return normalized;
}

export function getStrokedShapeBoundsFromPathBounds(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  strokeWidth: number,
) {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  const strokeInset = Math.max(0, strokeWidth) / 2;

  return {
    left: left - strokeInset,
    top: top - strokeInset,
    width,
    height,
  };
}

export function extractVisibleCanvasRegion(
  sourceCanvas: HTMLCanvasElement,
  alphaThreshold = 0,
): { bounds: { x: number; y: number; width: number; height: number }; canvas: HTMLCanvasElement } | null {
  const imageData = readCanvasImageData(sourceCanvas);
  if (!imageData) {
    return null;
  }
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
      if (alpha <= alphaThreshold) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = bounds.width;
  croppedCanvas.height = bounds.height;
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) {
    return null;
  }

  croppedCtx.putImageData(imageData, -bounds.x, -bounds.y);
  return {
    bounds,
    canvas: croppedCanvas,
  };
}

export function lerpNumber(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

export function getDistanceBetweenPoints(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function areVectorToolStylesEqual(a: VectorToolStyle, b: VectorToolStyle) {
  return VECTOR_TOOL_STYLE_KEYS.every((key) => a[key] === b[key]);
}

export function areVectorToolStyleMixedStatesEqual(
  a: VectorToolStyleMixedState,
  b: VectorToolStyleMixedState,
) {
  return VECTOR_TOOL_STYLE_KEYS.every((key) => (a[key] === true) === (b[key] === true));
}

export function clearVectorToolStyleMixedState(
  mixedState: VectorToolStyleMixedState,
  updates: Partial<VectorToolStyle>,
): VectorToolStyleMixedState {
  let changed = false;
  const nextState: VectorToolStyleMixedState = { ...mixedState };

  VECTOR_TOOL_STYLE_KEYS.forEach((key) => {
    if (!(key in updates) || nextState[key] !== true) {
      return;
    }
    delete nextState[key];
    changed = true;
  });

  return changed ? nextState : mixedState;
}

export function hashNumberTriplet(a: number, b: number, c: number) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453123;
  return value - Math.floor(value);
}

export function getQuadraticBezierPoint(start: Point, control: Point, end: Point, t: number) {
  const inverse = 1 - t;
  return new Point(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  );
}

export function getCubicBezierPoint(start: Point, control1: Point, control2: Point, end: Point, t: number) {
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

export function getVectorStrokeSampleSpacing(strokeWidth: number) {
  return Math.max(0.75, Math.min(3, Math.max(1, strokeWidth * 0.12)));
}

export function buildClosedPolylinePoints(points: Point[], closed: boolean) {
  if (!closed || points.length < 2) {
    return points;
  }
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  return getDistanceBetweenPoints(firstPoint, lastPoint) <= 0.5
    ? points
    : [...points, firstPoint];
}

export function buildPolylineArcTable(points: Point[]) {
  const cumulativeLengths = [0];
  let totalLength = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    totalLength += getDistanceBetweenPoints(points[index], points[index + 1]);
    cumulativeLengths.push(totalLength);
  }
  return { cumulativeLengths, totalLength };
}

export function resolveDistanceAlongPolyline(distance: number, totalLength: number, closed: boolean) {
  if (totalLength <= 0) {
    return 0;
  }
  if (!closed) {
    return Math.max(0, Math.min(totalLength, distance));
  }
  const wrappedDistance = distance % totalLength;
  return wrappedDistance < 0 ? wrappedDistance + totalLength : wrappedDistance;
}

export function findPolylineSegmentIndex(cumulativeLengths: number[], distance: number) {
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

export function samplePointAlongPolyline(
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

export function sampleAngleAlongPolyline(
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

export function buildTrianglePoints(width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x: width / 2, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

export function buildStarPoints(
  width: number,
  height: number,
  pointCount = 5,
  innerRadiusScale = 0.5,
): Array<{ x: number; y: number }> {
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadiusX = width / 2;
  const outerRadiusY = height / 2;
  const innerRadiusX = outerRadiusX * innerRadiusScale;
  const innerRadiusY = outerRadiusY * innerRadiusScale;
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < pointCount * 2; index += 1) {
    const isOuterPoint = index % 2 === 0;
    const radiusX = isOuterPoint ? outerRadiusX : innerRadiusX;
    const radiusY = isOuterPoint ? outerRadiusY : innerRadiusY;
    const angle = -Math.PI / 2 + (index * Math.PI) / pointCount;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  }

  return points;
}

export type ShapeDraftType = 'rectangle' | 'circle' | 'triangle' | 'star' | 'line';

export interface ShapeDraftPointer {
  x: number;
  y: number;
}

export interface ShapeDraftResolution {
  start: ShapeDraftPointer;
  end: ShapeDraftPointer;
}

export interface ShapeDraftMoveSession {
  originPointer: ShapeDraftPointer;
  originAnchor: ShapeDraftPointer;
  originResolution: ShapeDraftResolution;
}

export interface ShapeDraftSession {
  type: ShapeDraftType;
  anchor: ShapeDraftPointer;
  currentPointer: ShapeDraftPointer;
  moveSession: ShapeDraftMoveSession | null;
  object: any;
}

function resolveConstraintSign(primaryDelta: number, secondaryDelta: number) {
  if (primaryDelta > 0) return 1;
  if (primaryDelta < 0) return -1;
  if (secondaryDelta > 0) return 1;
  if (secondaryDelta < 0) return -1;
  return 1;
}

export function getConstrainedShapeDelta(
  type: ShapeDraftType,
  deltaX: number,
  deltaY: number,
  options: { proportional?: boolean } = {},
) {
  if (type === 'line' && options.proportional) {
    const length = Math.hypot(deltaX, deltaY);
    if (length <= 0.0001) {
      return { deltaX: 0, deltaY: 0 };
    }

    const snappedAngle = Math.round(Math.atan2(deltaY, deltaX) / SHAPE_LINE_SNAP_INCREMENT_RADIANS)
      * SHAPE_LINE_SNAP_INCREMENT_RADIANS;
    return {
      deltaX: Math.cos(snappedAngle) * length,
      deltaY: Math.sin(snappedAngle) * length,
    };
  }

  if (!options.proportional || type === 'line') {
    return { deltaX, deltaY };
  }

  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  return {
    deltaX: resolveConstraintSign(deltaX, deltaY) * size,
    deltaY: resolveConstraintSign(deltaY, deltaX) * size,
  };
}

export function resolveShapeDraft(
  type: ShapeDraftType,
  anchor: ShapeDraftPointer,
  current: ShapeDraftPointer,
  options: { centered?: boolean; proportional?: boolean } = {},
): ShapeDraftResolution {
  const constrainedDelta = getConstrainedShapeDelta(
    type,
    current.x - anchor.x,
    current.y - anchor.y,
    { proportional: options.proportional },
  );

  if (options.centered) {
    return {
      start: {
        x: anchor.x - constrainedDelta.deltaX,
        y: anchor.y - constrainedDelta.deltaY,
      },
      end: {
        x: anchor.x + constrainedDelta.deltaX,
        y: anchor.y + constrainedDelta.deltaY,
      },
    };
  }

  return {
    start: { x: anchor.x, y: anchor.y },
    end: {
      x: anchor.x + constrainedDelta.deltaX,
      y: anchor.y + constrainedDelta.deltaY,
    },
  };
}

export function translateShapeDraftResolution(
  resolution: ShapeDraftResolution,
  delta: ShapeDraftPointer,
): ShapeDraftResolution {
  return {
    start: {
      x: resolution.start.x + delta.x,
      y: resolution.start.y + delta.y,
    },
    end: {
      x: resolution.end.x + delta.x,
      y: resolution.end.y + delta.y,
    },
  };
}

export function isSpaceKeyEvent(event: { key?: string; code?: string }) {
  return (
    event.key === ' ' ||
    event.key === 'Space' ||
    event.key === 'Spacebar' ||
    event.code === 'Space'
  );
}

export function buildPolygonShapeDraft(
  kind: 'triangle' | 'star',
  start: { x: number; y: number },
  current: { x: number; y: number },
): {
  left: number;
  top: number;
  points: Array<{ x: number; y: number }>;
} {
  const left = Math.min(start.x, current.x);
  const right = Math.max(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const bottom = Math.max(start.y, current.y);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return {
    left: left + width * 0.5,
    top: top + height * 0.5,
    points: kind === 'triangle'
      ? buildTrianglePoints(width, height)
      : buildStarPoints(width, height),
  };
}

export function getFabricShapeDraftObjectProps(
  type: ShapeDraftType,
  start: { x: number; y: number },
  current: { x: number; y: number },
  strokeWidth: number,
):
  | { left: number; top: number; width: number; height: number }
  | { left: number; top: number; rx: number; ry: number }
  | { left: number; top: number; points: Array<{ x: number; y: number }> }
  | { x1: number; y1: number; x2: number; y2: number } {
  if (type === 'rectangle') {
    const bounds = getStrokedShapeBoundsFromPathBounds(
      start.x,
      start.y,
      current.x,
      current.y,
      strokeWidth,
    );
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
  }

  if (type === 'circle') {
    const bounds = getStrokedShapeBoundsFromPathBounds(
      start.x,
      start.y,
      current.x,
      current.y,
      strokeWidth,
    );
    return {
      left: bounds.left,
      top: bounds.top,
      rx: bounds.width * 0.5,
      ry: bounds.height * 0.5,
    };
  }

  if (type === 'triangle' || type === 'star') {
    const polygonDraft = buildPolygonShapeDraft(type, start, current);
    return {
      left: polygonDraft.left,
      top: polygonDraft.top,
      points: polygonDraft.points,
    };
  }

  return {
    x1: start.x,
    y1: start.y,
    x2: current.x,
    y2: current.y,
  };
}

export function getEditableVectorHandleMode(mode: VectorHandleMode): Exclude<VectorHandleMode, 'multiple'> {
  return mode === 'multiple' ? 'linear' : mode;
}

export function cloneScenePoint(point: Point | null): Point | null {
  return point ? new Point(point.x, point.y) : null;
}

export function mirrorPointAcrossAnchor(anchor: Point, handlePoint: Point): Point {
  return new Point(
    anchor.x * 2 - handlePoint.x,
    anchor.y * 2 - handlePoint.y,
  );
}

export function resolvePathNodeHandleTypeForControlDrag({
  breakMirroring,
  changed,
  currentType,
  fallbackType,
}: {
  breakMirroring: boolean;
  changed: 'anchor' | 'incoming' | 'outgoing';
  currentType: VectorPathNodeHandleType | null | undefined;
  fallbackType: VectorPathNodeHandleType;
}): VectorPathNodeHandleType {
  if (breakMirroring && (changed === 'incoming' || changed === 'outgoing')) {
    return 'corner';
  }
  return currentType ?? fallbackType;
}

export type CanvasHistorySnapshot = {
  mode: CostumeEditorMode;
  bitmapDataUrl: string;
  bitmapAssetFrame: CostumeAssetFrame | null;
  vectorJson: string | null;
};

export interface CanvasSelectionBoundsSnapshot {
  selectionObject: any;
  selectedObjects: any[];
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export type PathAnchorDragState = {
  previousAnchor: Point;
  previousIncoming: Point | null;
  previousOutgoing: Point | null;
};

export type MirroredPathAnchorHandleRole = 'incoming' | 'outgoing';

export interface MirroredPathAnchorDragSession {
  path: any;
  anchorIndex: number;
  handleRole: MirroredPathAnchorHandleRole;
  dragState: PathAnchorDragState | null;
  currentPointerScene: Point;
  hasChanged: boolean;
  moveAnchorMode: boolean;
  moveAnchorStartCommandPoint: Point | null;
  moveAnchorSnapshot: PathAnchorDragState | null;
  controlsHydrated: boolean;
}

export type PointSelectionTransformMode =
  | 'move'
  | TransformGizmoCornerTarget;

export interface SelectedPathAnchorTransformSnapshot {
  anchorIndex: number;
  anchorScene: Point;
  incomingScene: Point | null;
  outgoingScene: Point | null;
}

export interface PointSelectionTransformBounds {
  center: Point;
  width: number;
  height: number;
  rotationRadians: number;
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface PointSelectionTransformSnapshot {
  path: any;
  selectionKey: string;
  anchors: SelectedPathAnchorTransformSnapshot[];
  bounds: PointSelectionTransformBounds;
}

export interface PointSelectionTransformSession {
  path: any;
  mode: PointSelectionTransformMode;
  corner: TransformGizmoCorner | null;
  proportional: boolean;
  centered: boolean;
  startPointerScene: Point;
  snapshot: PointSelectionTransformSnapshot;
  hasChanged: boolean;
}

export interface PointSelectionMarqueeSession {
  path: any;
  startPointerScene: Point;
  currentPointerScene: Point;
  initialSelectedAnchorIndices: number[];
  toggleSelection: boolean;
}

export interface PointSelectionTransformFrameState {
  path: any;
  selectionKey: string;
  rotationRadians: number;
}

export interface PenDraftAnchor {
  point: Point;
  incoming: Point | null;
  outgoing: Point | null;
  handleType: VectorPathNodeHandleType;
}

export interface PenDraftState {
  anchors: PenDraftAnchor[];
  previewPoint: Point | null;
}

export type PenHandleRole = 'incoming' | 'outgoing';

export interface PenAnchorPlacementSession {
  anchorIndex: number;
  handleRole: PenHandleRole;
  startPointerScene: Point;
  currentPointerScene: Point;
  hasDragged: boolean;
  moveAnchorMode: boolean;
  moveAnchorStartPointerScene: Point | null;
  moveAnchorSnapshot: PenDraftAnchor | null;
  cuspMode: boolean;
  cuspFixedOpposite: Point | null;
}

export function clonePenDraftAnchor(anchor: PenDraftAnchor): PenDraftAnchor {
  return {
    point: new Point(anchor.point.x, anchor.point.y),
    incoming: cloneScenePoint(anchor.incoming),
    outgoing: cloneScenePoint(anchor.outgoing),
    handleType: anchor.handleType,
  };
}

export function createPenDraftAnchor(point: Point): PenDraftAnchor {
  return {
    point: new Point(point.x, point.y),
    incoming: null,
    outgoing: null,
    handleType: 'linear',
  };
}

export function getPenToolCloseHitRadiusPx() {
  // Match the visible anchor handle footprint so closing feels as forgiving as clicking the gizmo itself.
  return Math.max(PEN_TOOL_CLOSE_HIT_RADIUS_PX, HANDLE_SIZE);
}

export function buildPenDraftPathData(
  anchors: PenDraftAnchor[],
  closed: boolean,
): string {
  const commands = buildPenDraftPathCommands(anchors, closed);
  if (commands.length === 0) return '';

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return commands.map((command) => (
    command.length > 1
      ? `${command[0]} ${command.slice(1).map((value) => round(Number(value))).join(' ')}`
      : command[0]
  )).join(' ');
}

export function buildPenDraftPathCommands(
  anchors: PenDraftAnchor[],
  closed: boolean,
): Array<[string, ...number[]]> {
  if (anchors.length === 0) return [];

  const commands: Array<[string, ...number[]]> = [['M', anchors[0].point.x, anchors[0].point.y]];

  const appendSegment = (fromAnchor: PenDraftAnchor, toAnchor: PenDraftAnchor) => {
    const control1 = fromAnchor.outgoing;
    const control2 = toAnchor.incoming;
    if (!control1 && !control2) {
      commands.push(['L', toAnchor.point.x, toAnchor.point.y]);
      return;
    }

    const resolvedControl1 = control1 ?? fromAnchor.point;
    const resolvedControl2 = control2 ?? toAnchor.point;
    commands.push([
      'C',
      resolvedControl1.x,
      resolvedControl1.y,
      resolvedControl2.x,
      resolvedControl2.y,
      toAnchor.point.x,
      toAnchor.point.y,
    ]);
  };

  for (let index = 1; index < anchors.length; index += 1) {
    appendSegment(anchors[index - 1], anchors[index]);
  }

  if (closed && anchors.length > 1) {
    const lastAnchor = anchors[anchors.length - 1];
    const firstAnchor = anchors[0];
    const hasClosingCurve = !!lastAnchor.outgoing || !!firstAnchor.incoming;
    if (hasClosingCurve) {
      appendSegment(lastAnchor, firstAnchor);
    }
    commands.push(['Z']);
  }

  return commands;
}

export function buildPenDraftNodeHandleTypes(
  anchors: PenDraftAnchor[],
): Record<string, VectorPathNodeHandleType> {
  const next: Record<string, VectorPathNodeHandleType> = {};
  anchors.forEach((anchor, index) => {
    next[String(index)] = anchor.handleType;
  });
  return next;
}

export function areHistorySnapshotsEqual(
  a: CanvasHistorySnapshot | null | undefined,
  b: CanvasHistorySnapshot | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.mode === b.mode &&
    a.bitmapDataUrl === b.bitmapDataUrl &&
    areCostumeAssetFramesEqual(a.bitmapAssetFrame, b.bitmapAssetFrame) &&
    a.vectorJson === b.vectorJson
  );
}

export function cloneHistorySnapshot(snapshot: CanvasHistorySnapshot): CanvasHistorySnapshot {
  return {
    mode: snapshot.mode,
    bitmapDataUrl: snapshot.bitmapDataUrl,
    bitmapAssetFrame: cloneCostumeAssetFrame(snapshot.bitmapAssetFrame) ?? null,
    vectorJson: snapshot.vectorJson,
  };
}

export function createHistorySnapshotFromActiveLayerCanvasState(
  state: ActiveLayerCanvasState,
): CanvasHistorySnapshot {
  return {
    mode: state.editorMode,
    bitmapDataUrl: state.dataUrl,
    bitmapAssetFrame: cloneCostumeAssetFrame(state.bitmapAssetFrame) ?? null,
    vectorJson: state.editorMode === 'vector' && state.vectorDocument
      ? state.vectorDocument.fabricJson
      : null,
  };
}

export function createActiveLayerCanvasStateFromSnapshot(snapshot: CanvasHistorySnapshot): ActiveLayerCanvasState {
  return {
    editorMode: snapshot.mode,
    dataUrl: snapshot.bitmapDataUrl,
    bitmapAssetFrame: cloneCostumeAssetFrame(snapshot.bitmapAssetFrame) ?? null,
    vectorDocument: snapshot.mode === 'vector' && snapshot.vectorJson
      ? {
          engine: 'fabric',
          version: 1,
          fabricJson: snapshot.vectorJson,
        }
      : undefined,
  };
}

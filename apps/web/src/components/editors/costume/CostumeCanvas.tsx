import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import {
  Canvas as FabricCanvas,
  BaseBrush,
  PencilBrush,
  Path,
  Rect,
  Ellipse,
  Line,
  Polygon,
  IText,
  ActiveSelection,
  FabricImage,
  Control,
  Point,
  controlsUtils,
  util,
} from 'fabric';
import { calculateBoundsFromCanvas, calculateBoundsFromImageData } from '@/utils/imageBounds';
import {
  pathNodeHandleTypeToVectorHandleMode,
  vectorHandleModeToPathNodeHandleType,
} from './CostumeToolbar';
import type {
  AlignAction,
  BitmapFillStyle,
  BitmapShapeStyle,
  DrawingTool,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorHandleMode,
  VectorPathNodeHandleType,
  VectorStyleCapabilities,
  VectorToolStyle,
} from './CostumeToolbar';
import type { Costume, CostumeBounds, ColliderConfig, CostumeEditorMode, CostumeVectorDocument } from '@/types';
import { CanvasViewportOverlay } from '@/components/editors/shared/CanvasViewportOverlay';
import { deleteActiveCanvasSelection } from './costumeSelectionCommands';
import { attachTextEditingContainer, beginTextEditing, isTextEditableObject } from './costumeTextCommands';
import Color from 'color';
import {
  getBitmapBrushCursorStyle,
  getBitmapBrushStampDefinition,
  getBrushPaintColor,
  getCompositeOperation,
  type BitmapBrushKind,
} from '@/lib/background/brushCore';
import {
  applyBitmapBucketFill,
  getBitmapFillTexturePreset,
  type BitmapFillTextureId,
} from '@/lib/background/bitmapFillCore';
import {
  createVectorStrokeBrushStamp,
  getVectorStrokeBrushPreset,
  DEFAULT_VECTOR_STROKE_BRUSH_ID,
  type VectorStrokeBrushId,
} from '@/lib/vector/vectorStrokeBrushCore';
import {
  createVectorFillTextureTile,
  getVectorFillTexturePreset,
  DEFAULT_VECTOR_FILL_TEXTURE_ID,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';
import {
  clampCameraToWorldRect,
  clampViewportZoom,
  panCameraFromDrag,
  panCameraFromWheel,
  zoomCameraAtClientPoint,
} from '@/lib/viewportNavigation';

const CANVAS_SIZE = 1024;
const BASE_DISPLAY_SIZE = 480;
const BASE_VIEW_SCALE = BASE_DISPLAY_SIZE / CANVAS_SIZE;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;
const MAX_PAN_OVERSCROLL_PX = 160;
const HANDLE_SIZE = 20;
const VECTOR_SELECTION_COLOR = '#005eff';
const VECTOR_SELECTION_CORNER_COLOR = '#ffffff';
const VECTOR_SELECTION_CORNER_STROKE = '#005eff';
const VECTOR_SELECTION_BORDER_OPACITY = 1;
const VECTOR_SELECTION_BORDER_SCALE = 2;
const VECTOR_JSON_EXTRA_PROPS = [
  'nodeHandleTypes',
  'strokeUniform',
  'vectorFillTextureId',
  'vectorFillColor',
  'vectorStrokeBrushId',
  'vectorStrokeColor',
];
const CIRCLE_CUBIC_KAPPA = 0.5522847498307936;
const VECTOR_POINT_EDIT_GUIDE_STROKE = '#cbd5e1';
const VECTOR_POINT_EDIT_GUIDE_STROKE_WIDTH = 6;
const VECTOR_POINT_HANDLE_GUIDE_STROKE = '#94a3b8';
const VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH = 2;
const VECTOR_POINT_SELECTION_BOX_FILL = 'rgba(0, 94, 255, 0.08)';
const VECTOR_POINT_SELECTION_HANDLE_SIZE = 12;
const VECTOR_POINT_SELECTION_ROTATE_OFFSET = 28;
const VECTOR_POINT_SELECTION_HIT_PADDING = 6;
const VECTOR_POINT_SELECTION_MIN_SIZE = 12;
const VECTOR_POINT_INSERTION_HIT_RADIUS_PX = 8;
const VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX = 10;
const VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX = 4;
const PEN_TOOL_CLOSE_HIT_RADIUS_PX = 10;
const PEN_TOOL_DRAG_THRESHOLD_PX = 4;
const OBJECT_SELECTION_CORNER_SIZE = 12;
const OBJECT_SELECTION_PADDING = 2;
export const DEFAULT_COSTUME_PREVIEW_SCALE = BASE_VIEW_SCALE;

function getZoomInvariantCanvasMetric(metric: number, zoom: number) {
  return metric / Math.max(zoom, 0.0001);
}

function normalizeRadians(angleRadians: number) {
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

function normalizeDegrees(angleDegrees: number) {
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

function getStrokedShapeBoundsFromPathBounds(
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

function extractVisibleCanvasRegion(
  sourceCanvas: HTMLCanvasElement,
  alphaThreshold = 0,
): { bounds: CostumeBounds; canvas: HTMLCanvasElement } | null {
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) {
    return null;
  }

  const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = calculateBoundsFromImageData(imageData, alphaThreshold);
  if (!bounds) {
    return null;
  }

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

function buildTrianglePoints(width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x: width / 2, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function buildStarPoints(
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

function getEditableVectorHandleMode(mode: VectorHandleMode): Exclude<VectorHandleMode, 'multiple'> {
  return mode === 'multiple' ? 'linear' : mode;
}

function getEraserPreviewSourceCanvas(fabricCanvas: FabricCanvas): HTMLCanvasElement | null {
  const liveLowerCanvas = (fabricCanvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl;
  if (liveLowerCanvas) {
    return liveLowerCanvas;
  }

  try {
    if (typeof fabricCanvas.toCanvasElement === 'function') {
      return fabricCanvas.toCanvasElement(1);
    }
  } catch {
    // Fall back to the live lower canvas if Fabric snapshotting fails.
  }

  return null;
}

function applyCanvasCursor(fabricCanvas: FabricCanvas, cursor: string) {
  fabricCanvas.defaultCursor = cursor;
  fabricCanvas.hoverCursor = cursor;
  fabricCanvas.moveCursor = cursor;
  fabricCanvas.freeDrawingCursor = cursor;
  if (fabricCanvas.upperCanvasEl) {
    fabricCanvas.upperCanvasEl.style.cursor = cursor;
  }
  if (fabricCanvas.lowerCanvasEl) {
    fabricCanvas.lowerCanvasEl.style.cursor = cursor;
  }
}

class CompositePencilBrush extends PencilBrush {
  compositeOperation: GlobalCompositeOperation = 'source-over';
  private previewSourceWasHidden = false;
  private previousLowerCanvasOpacity = '';

  override needsFullRender() {
    return this.compositeOperation === 'destination-out' || super.needsFullRender();
  }

  override _setBrushStyles(ctx: CanvasRenderingContext2D) {
    super._setBrushStyles(ctx);
    ctx.globalCompositeOperation = this.compositeOperation;
  }

  private setPreviewSourceHidden(hidden: boolean) {
    const lowerCanvas = (this.canvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl;
    if (!lowerCanvas) {
      return;
    }

    if (hidden) {
      if (this.previewSourceWasHidden) {
        return;
      }
      this.previousLowerCanvasOpacity = lowerCanvas.style.opacity;
      lowerCanvas.style.opacity = '0';
      this.previewSourceWasHidden = true;
      return;
    }

    if (!this.previewSourceWasHidden) {
      return;
    }
    lowerCanvas.style.opacity = this.previousLowerCanvasOpacity;
    this.previousLowerCanvasOpacity = '';
    this.previewSourceWasHidden = false;
  }

  override _render(ctx: CanvasRenderingContext2D = this.canvas.contextTop) {
    if (this.compositeOperation === 'destination-out' && ctx === this.canvas.contextTop) {
      this.setPreviewSourceHidden(true);
      const previewCtx = this.canvas.contextTop;
      const sourceCanvas = getEraserPreviewSourceCanvas(this.canvas);

      previewCtx.save();
      previewCtx.setTransform(1, 0, 0, 1, 0, 0);
      previewCtx.globalCompositeOperation = 'source-over';
      previewCtx.globalAlpha = 1;
      previewCtx.clearRect(0, 0, previewCtx.canvas.width, previewCtx.canvas.height);
      if (sourceCanvas) {
        previewCtx.drawImage(sourceCanvas, 0, 0);
      }
      previewCtx.restore();
    }

    super._render(ctx);
  }

  override onMouseUp(eventData: any) {
    try {
      return super.onMouseUp(eventData);
    } finally {
      this.setPreviewSourceHidden(false);
    }
  }

  override createPath(pathData: any) {
    const path = super.createPath(pathData);
    path.set('globalCompositeOperation', this.compositeOperation);
    return path;
  }
}

interface VectorPencilBrushOptions {
  strokeBrushId: VectorStrokeBrushId;
  strokeColor: string;
  strokeWidth: number;
}

class VectorPencilBrush extends PencilBrush {
  private readonly strokeBrushId: VectorStrokeBrushId;
  private readonly strokeColor: string;
  private readonly strokeWidthValue: number;

  constructor(canvas: FabricCanvas, options: VectorPencilBrushOptions) {
    super(canvas as any);
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

interface BitmapStampBrushCommitPayload {
  alphaThreshold: number;
  compositeOperation: GlobalCompositeOperation;
  strokeCanvas: HTMLCanvasElement;
}

interface BitmapStampBrushOptions {
  brushColor: string;
  brushKind: Exclude<BitmapBrushKind, 'hard-round'>;
  brushSize: number;
  compositeOperation: GlobalCompositeOperation;
  onCommit: (payload: BitmapStampBrushCommitPayload) => void;
}

class BitmapStampBrush extends BaseBrush {
  private accumulatedDistance = 0;
  private readonly compositeOperation: GlobalCompositeOperation;
  private lastPoint: Point | null = null;
  private readonly onCommit: (payload: BitmapStampBrushCommitPayload) => void;
  private readonly stampDefinition: ReturnType<typeof getBitmapBrushStampDefinition>;
  private strokeCanvas: HTMLCanvasElement | null = null;
  private strokeCtx: CanvasRenderingContext2D | null = null;
  private previewSourceWasHidden = false;
  private previousLowerCanvasOpacity = '';

  constructor(canvas: FabricCanvas, options: BitmapStampBrushOptions) {
    super(canvas as any);
    this.color = options.brushColor;
    this.width = options.brushSize;
    this.compositeOperation = options.compositeOperation;
    this.onCommit = options.onCommit;
    this.stampDefinition = getBitmapBrushStampDefinition(
      options.brushKind,
      options.brushColor,
      options.brushSize,
    );
  }

  override needsFullRender() {
    return true;
  }

  private setPreviewSourceHidden(hidden: boolean) {
    const lowerCanvas = (this.canvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl;
    if (!lowerCanvas) {
      return;
    }

    if (hidden) {
      if (this.previewSourceWasHidden) {
        return;
      }
      this.previousLowerCanvasOpacity = lowerCanvas.style.opacity;
      lowerCanvas.style.opacity = '0';
      this.previewSourceWasHidden = true;
      return;
    }

    if (!this.previewSourceWasHidden) {
      return;
    }
    lowerCanvas.style.opacity = this.previousLowerCanvasOpacity;
    this.previousLowerCanvasOpacity = '';
    this.previewSourceWasHidden = false;
  }

  override onMouseDown(pointer: Point, { e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    if (this.compositeOperation === 'destination-out') {
      this.setPreviewSourceHidden(true);
    }
    this.prepareStroke();
    this.lastPoint = new Point(pointer.x, pointer.y);
    this.stampAtPoint(pointer);
    this.renderPreview();
  }

  override onMouseMove(pointer: Point, { e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    if (this.limitedToCanvasSize === true && this._isOutSideCanvas(pointer)) {
      return;
    }
    if (!this.lastPoint) {
      this.onMouseDown(pointer, { e });
      return;
    }

    this.stampSegment(this.lastPoint, pointer);
    this.lastPoint = new Point(pointer.x, pointer.y);
    this.renderPreview();
  }

  override onMouseUp({ e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return true;
    }

    const strokeCanvas = this.strokeCanvas;
    const alphaThreshold = this.stampDefinition.alphaThreshold;
    this.resetStrokeState();
    this.canvas.clearContext(this.canvas.contextTop);
    this.setPreviewSourceHidden(false);

    if (strokeCanvas) {
      this.onCommit({
        strokeCanvas,
        compositeOperation: this.compositeOperation,
        alphaThreshold,
      });
    }

    return false;
  }

  override _render() {
    this.renderPreview();
  }

  private prepareStroke() {
    const width = this.canvas.getWidth();
    const height = this.canvas.getHeight();
    const strokeCanvas = document.createElement('canvas');
    strokeCanvas.width = width;
    strokeCanvas.height = height;
    this.strokeCanvas = strokeCanvas;
    this.strokeCtx = strokeCanvas.getContext('2d');
    this.lastPoint = null;
    this.accumulatedDistance = 0;
  }

  private resetStrokeState() {
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.lastPoint = null;
    this.accumulatedDistance = 0;
  }

  private stampSegment(from: Point, to: Point) {
    const distanceX = to.x - from.x;
    const distanceY = to.y - from.y;
    const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
    if (distance === 0) {
      return;
    }

    const spacing = this.stampDefinition.spacing;
    let cursor = Math.max(0, spacing - this.accumulatedDistance);
    while (cursor <= distance) {
      const progress = cursor / distance;
      this.stampAtPoint(new Point(
        from.x + distanceX * progress,
        from.y + distanceY * progress,
      ));
      cursor += spacing;
    }

    this.accumulatedDistance = distance - (cursor - spacing);
  }

  private stampAtPoint(point: Point) {
    const ctx = this.strokeCtx;
    if (!ctx) {
      return;
    }

    const {
      opacity,
      rotationJitter,
      scaleJitter,
      scatter,
      stamp,
    } = this.stampDefinition;
    const scatterAngle = Math.random() * Math.PI * 2;
    const scatterRadius = scatter > 0 ? Math.random() * scatter : 0;
    const centerX = point.x + Math.cos(scatterAngle) * scatterRadius;
    const centerY = point.y + Math.sin(scatterAngle) * scatterRadius;
    const rotation = rotationJitter > 0 ? (Math.random() * 2 - 1) * rotationJitter : 0;
    const scale = 1 + (scaleJitter > 0 ? (Math.random() * 2 - 1) * scaleJitter : 0);

    ctx.save();
    // Build the stroke into an isolated mask first; the actual paint/erase composite
    // is applied later when previewing and committing onto the bitmap layer.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = opacity;
    ctx.translate(centerX, centerY);
    if (rotation !== 0) {
      ctx.rotate(rotation);
    }
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }
    ctx.drawImage(stamp, -stamp.width / 2, -stamp.height / 2);
    ctx.restore();
  }

  private renderPreview() {
    const ctx = this.canvas.contextTop;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.compositeOperation === 'destination-out') {
      const sourceCanvas = getEraserPreviewSourceCanvas(this.canvas);
      if (sourceCanvas) {
        ctx.drawImage(sourceCanvas, 0, 0);
      }
    }
    ctx.restore();

    if (!this.strokeCanvas) {
      return;
    }

    this._saveAndTransform(ctx);
    ctx.globalCompositeOperation = this.compositeOperation;
    ctx.drawImage(this.strokeCanvas, 0, 0);
    ctx.restore();
  }
}

const VECTOR_POINT_CONTROL_STYLE = {
  cornerColor: '#0ea5e9',
  cornerStrokeColor: '#ffffff',
  cornerSize: HANDLE_SIZE,
  transparentCorners: false,
};

const COSTUME_WORLD_RECT = {
  left: 0,
  top: 0,
  width: CANVAS_SIZE,
  height: CANVAS_SIZE,
} as const;

function cloneScenePoint(point: Point | null): Point | null {
  return point ? new Point(point.x, point.y) : null;
}

type CanvasHistorySnapshot = {
  mode: CostumeEditorMode;
  bitmapDataUrl: string;
  vectorJson: string | null;
};

interface CanvasSelectionBoundsSnapshot {
  selectionObject: any;
  selectedObjects: any[];
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

type PathAnchorDragState = {
  previousAnchor: Point;
  previousIncoming: Point | null;
  previousOutgoing: Point | null;
};

type PointSelectionTransformMode =
  | 'move'
  | 'rotate'
  | 'scale-tl'
  | 'scale-tr'
  | 'scale-br'
  | 'scale-bl';

interface SelectedPathAnchorTransformSnapshot {
  anchorIndex: number;
  anchorScene: Point;
  incomingScene: Point | null;
  outgoingScene: Point | null;
}

interface PointSelectionTransformBounds {
  center: Point;
  width: number;
  height: number;
  rotationRadians: number;
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

interface PointSelectionTransformSnapshot {
  path: any;
  selectionKey: string;
  anchors: SelectedPathAnchorTransformSnapshot[];
  bounds: PointSelectionTransformBounds;
}

interface PointSelectionTransformSession {
  path: any;
  mode: PointSelectionTransformMode;
  startPointerScene: Point;
  snapshot: PointSelectionTransformSnapshot;
  hasChanged: boolean;
}

interface PointSelectionMarqueeSession {
  path: any;
  startPointerScene: Point;
  currentPointerScene: Point;
  initialSelectedAnchorIndices: number[];
  toggleSelection: boolean;
}

interface PointSelectionTransformFrameState {
  path: any;
  selectionKey: string;
  rotationRadians: number;
}

interface PenDraftAnchor {
  point: Point;
  incoming: Point | null;
  outgoing: Point | null;
  handleType: VectorPathNodeHandleType;
}

interface PenDraftState {
  anchors: PenDraftAnchor[];
  previewPoint: Point | null;
}

type PenHandleRole = 'incoming' | 'outgoing';

interface PenAnchorPlacementSession {
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

function clonePenDraftAnchor(anchor: PenDraftAnchor): PenDraftAnchor {
  return {
    point: new Point(anchor.point.x, anchor.point.y),
    incoming: cloneScenePoint(anchor.incoming),
    outgoing: cloneScenePoint(anchor.outgoing),
    handleType: anchor.handleType,
  };
}

function createPenDraftAnchor(point: Point): PenDraftAnchor {
  return {
    point: new Point(point.x, point.y),
    incoming: null,
    outgoing: null,
    handleType: 'linear',
  };
}

function buildPenDraftPathData(
  anchors: PenDraftAnchor[],
  closed: boolean,
): string {
  if (anchors.length === 0) return '';

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const commands: string[] = [`M ${round(anchors[0].point.x)} ${round(anchors[0].point.y)}`];

  const appendSegment = (fromAnchor: PenDraftAnchor, toAnchor: PenDraftAnchor) => {
    const control1 = fromAnchor.outgoing;
    const control2 = toAnchor.incoming;
    if (!control1 && !control2) {
      commands.push(`L ${round(toAnchor.point.x)} ${round(toAnchor.point.y)}`);
      return;
    }

    const resolvedControl1 = control1 ?? fromAnchor.point;
    const resolvedControl2 = control2 ?? toAnchor.point;
    commands.push(
      `C ${round(resolvedControl1.x)} ${round(resolvedControl1.y)} ${round(resolvedControl2.x)} ${round(resolvedControl2.y)} ${round(toAnchor.point.x)} ${round(toAnchor.point.y)}`,
    );
  };

  for (let index = 1; index < anchors.length; index += 1) {
    appendSegment(anchors[index - 1], anchors[index]);
  }

  if (closed && anchors.length > 1) {
    appendSegment(anchors[anchors.length - 1], anchors[0]);
    commands.push('Z');
  }

  return commands.join(' ');
}

function buildPenDraftNodeHandleTypes(
  anchors: PenDraftAnchor[],
): Record<string, VectorPathNodeHandleType> {
  const next: Record<string, VectorPathNodeHandleType> = {};
  anchors.forEach((anchor, index) => {
    next[String(index)] = anchor.handleType;
  });
  return next;
}

export interface CostumeCanvasExportState {
  dataUrl: string;
  bounds: CostumeBounds | null;
  editorMode: CostumeEditorMode;
  vectorDocument?: CostumeVectorDocument;
}

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string, sessionKey?: string | null) => Promise<void>;
  loadCostume: (sessionKey: string, costume: Costume) => Promise<void>;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  hasUnsavedChanges: (sessionKey?: string | null) => boolean;
  markPersisted: (sessionKey?: string | null) => void;
  setEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  getEditorMode: () => CostumeEditorMode;
  getLoadedSessionKey: () => string | null;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  moveSelectionOrder: (action: MoveOrderAction) => boolean;
  flipSelection: (axis: SelectionFlipAxis) => boolean;
  rotateSelection: () => boolean;
  alignSelection: (action: AlignAction) => boolean;
  isTextEditing: () => boolean;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface CostumeCanvasProps {
  initialEditorMode: CostumeEditorMode;
  activeTool: DrawingTool;
  bitmapBrushKind: BitmapBrushKind;
  brushColor: string;
  brushSize: number;
  bitmapFillStyle: BitmapFillStyle;
  bitmapShapeStyle: BitmapShapeStyle;
  vectorHandleMode: VectorHandleMode;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  collider: ColliderConfig | null;
  onHistoryChange?: () => void;
  onColliderChange?: (collider: ColliderConfig) => void;
  onModeChange?: (mode: CostumeEditorMode) => void;
  onTextStyleSync?: (updates: Partial<TextToolStyle>) => void;
  onVectorStyleSync?: (updates: Partial<VectorToolStyle>) => void;
  onVectorHandleModeSync?: (handleMode: VectorHandleMode) => void;
  onVectorStyleCapabilitiesSync?: (capabilities: VectorStyleCapabilities) => void;
  onVectorPointEditingChange?: (isEditing: boolean) => void;
  onVectorPointSelectionChange?: (hasSelectedPoints: boolean) => void;
  onTextSelectionChange?: (hasTextSelection: boolean) => void;
  onSelectionStateChange?: (state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => void;
  onViewScaleChange?: (scale: number) => void;
}

function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

function isActiveSelectionObject(obj: unknown): obj is ActiveSelection {
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

function isTextObject(obj: unknown): obj is { type: string; set: (props: Record<string, unknown>) => void } {
  const type = getFabricObjectType(obj);
  return type === 'itext' || type === 'i-text' || type === 'textbox' || type === 'text';
}

function isImageObject(obj: unknown): obj is { type: string } {
  return getFabricObjectType(obj) === 'image';
}

function getSelectedObjects(obj: unknown): any[] {
  if (!obj) return [];
  if (isActiveSelectionObject(obj) && typeof obj.getObjects === 'function') {
    return (obj.getObjects() as any[]).filter(Boolean);
  }
  return [obj];
}

function isDirectlyEditablePathObject(obj: unknown): obj is { type: 'path' } {
  return getFabricObjectType(obj) === 'path';
}

function getVectorStyleTargets(obj: unknown): any[] {
  return getSelectedObjects(obj).filter((candidate) => (
    !!candidate &&
    !isImageObject(candidate) &&
    !isTextObject(candidate) &&
    !isActiveSelectionObject(candidate)
  ));
}

interface VectorBrushStylableObject {
  fill?: unknown;
  noScaleCache?: boolean;
  set?: (props: Record<string, unknown>) => void;
  stroke?: unknown;
  strokeUniform?: boolean;
  strokeWidth?: number;
  vectorFillColor?: string;
  vectorFillTextureId?: VectorFillTextureId;
  vectorStrokeBrushId?: VectorStrokeBrushId;
  vectorStrokeColor?: string;
}

function getVectorObjectFillTextureId(obj: unknown): VectorFillTextureId {
  const textureId = (obj as VectorBrushStylableObject | null | undefined)?.vectorFillTextureId;
  return typeof textureId === 'string' ? (textureId as VectorFillTextureId) : DEFAULT_VECTOR_FILL_TEXTURE_ID;
}

function getVectorObjectFillColor(obj: unknown): string | undefined {
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

function getVectorObjectStrokeBrushId(obj: unknown): VectorStrokeBrushId {
  const brushId = (obj as VectorBrushStylableObject | null | undefined)?.vectorStrokeBrushId;
  return typeof brushId === 'string' ? (brushId as VectorStrokeBrushId) : DEFAULT_VECTOR_STROKE_BRUSH_ID;
}

function getVectorObjectStrokeColor(obj: unknown): string | undefined {
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

function getFabricStrokeValueForVectorBrush(brushId: VectorStrokeBrushId, strokeColor: string) {
  return brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID
    ? strokeColor
    : Color(strokeColor).alpha(0).rgb().string();
}

function getFabricFillValueForVectorTexture(textureId: VectorFillTextureId, fillColor: string) {
  return textureId === DEFAULT_VECTOR_FILL_TEXTURE_ID
    ? fillColor
    : Color(fillColor).alpha(0).rgb().string();
}

function applyVectorFillStyleToObject(
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

function applyVectorStrokeStyleToObject(
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

function normalizeVectorObjectRendering(obj: unknown): boolean {
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

function getPathCommandType(command: unknown): string {
  if (!Array.isArray(command) || typeof command[0] !== 'string') return '';
  return command[0].trim().toUpperCase();
}

function getPathCommandEndpoint(command: unknown): { x: number; y: number } | null {
  if (!Array.isArray(command) || command.length < 3) return null;
  const x = Number(command[command.length - 2]);
  const y = Number(command[command.length - 1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function pathCommandsDescribeClosedShape(path: unknown): boolean {
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

function vectorObjectSupportsFill(obj: unknown): boolean {
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

function getVectorStyleCapabilitiesForSelection(obj: unknown): VectorStyleCapabilities {
  const targets = getVectorStyleTargets(obj);
  if (targets.length === 0) {
    return { supportsFill: true };
  }

  return {
    supportsFill: targets.every((target) => vectorObjectSupportsFill(target)),
  };
}

function isVectorPointSelectableObject(obj: unknown): obj is Record<string, any> {
  if (!obj || typeof obj !== 'object') return false;
  if (isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) return false;
  return true;
}

function areHistorySnapshotsEqual(
  a: CanvasHistorySnapshot | null,
  b: CanvasHistorySnapshot | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.mode === b.mode &&
    a.bitmapDataUrl === b.bitmapDataUrl &&
    a.vectorJson === b.vectorJson
  );
}

function cloneHistorySnapshot(snapshot: CanvasHistorySnapshot): CanvasHistorySnapshot {
  return {
    mode: snapshot.mode,
    bitmapDataUrl: snapshot.bitmapDataUrl,
    vectorJson: snapshot.vectorJson,
  };
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  initialEditorMode,
  activeTool,
  bitmapBrushKind,
  brushColor,
  brushSize,
  bitmapFillStyle,
  bitmapShapeStyle,
  vectorHandleMode,
  textStyle,
  vectorStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  collider,
  onHistoryChange,
  onColliderChange,
  onModeChange,
  onTextStyleSync,
  onVectorStyleSync,
  onVectorHandleModeSync,
  onVectorStyleCapabilitiesSync,
  onVectorPointEditingChange,
  onVectorPointSelectionChange,
  onTextSelectionChange,
  onSelectionStateChange,
  onViewScaleChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textEditingHostRef = useRef<HTMLDivElement>(null);
  const brushCursorOverlayRef = useRef<HTMLDivElement>(null);
  const fabricCanvasElementRef = useRef<HTMLCanvasElement>(null);
  const vectorStrokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorGuideCanvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapSelectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const colliderCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorStrokeCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const vectorGuideCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bitmapSelectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const colliderCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);

  const [zoom, setZoom] = useState(1);
  const [cameraCenter, setCameraCenter] = useState({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [isViewportPanning, setIsViewportPanning] = useState(false);
  const [editorModeState, setEditorModeState] = useState<CostumeEditorMode>(initialEditorMode);
  const [hasBitmapFloatingSelection, setHasBitmapFloatingSelection] = useState(false);
  const [canZoomToSelection, setCanZoomToSelection] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const cameraCenterRef = useRef(cameraCenter);
  cameraCenterRef.current = cameraCenter;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const panSessionRef = useRef<{
    startX: number;
    startY: number;
    cameraStartX: number;
    cameraStartY: number;
  } | null>(null);

  const editorModeRef = useRef<CostumeEditorMode>(initialEditorMode);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const bitmapBrushKindRef = useRef(bitmapBrushKind);
  bitmapBrushKindRef.current = bitmapBrushKind;

  const brushColorRef = useRef(brushColor);
  brushColorRef.current = brushColor;

  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  const bitmapFillStyleRef = useRef(bitmapFillStyle);
  bitmapFillStyleRef.current = bitmapFillStyle;

  const bitmapShapeStyleRef = useRef(bitmapShapeStyle);
  bitmapShapeStyleRef.current = bitmapShapeStyle;

  const vectorHandleModeRef = useRef<VectorHandleMode>(vectorHandleMode);
  vectorHandleModeRef.current = vectorHandleMode;
  const pendingSelectionSyncedVectorHandleModeRef = useRef<VectorHandleMode | null>(null);

  const textStyleRef = useRef(textStyle);
  textStyleRef.current = textStyle;

  const vectorStyleRef = useRef(vectorStyle);
  vectorStyleRef.current = vectorStyle;

  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;

  const onColliderChangeRef = useRef(onColliderChange);
  onColliderChangeRef.current = onColliderChange;

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  const onTextStyleSyncRef = useRef(onTextStyleSync);
  onTextStyleSyncRef.current = onTextStyleSync;

  const onVectorStyleSyncRef = useRef(onVectorStyleSync);
  onVectorStyleSyncRef.current = onVectorStyleSync;
  const onVectorHandleModeSyncRef = useRef(onVectorHandleModeSync);
  onVectorHandleModeSyncRef.current = onVectorHandleModeSync;

  const onVectorStyleCapabilitiesSyncRef = useRef(onVectorStyleCapabilitiesSync);
  onVectorStyleCapabilitiesSyncRef.current = onVectorStyleCapabilitiesSync;

  const onVectorPointEditingChangeRef = useRef(onVectorPointEditingChange);
  onVectorPointEditingChangeRef.current = onVectorPointEditingChange;
  const onVectorPointSelectionChangeRef = useRef(onVectorPointSelectionChange);
  onVectorPointSelectionChangeRef.current = onVectorPointSelectionChange;

  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  onTextSelectionChangeRef.current = onTextSelectionChange;
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  onSelectionStateChangeRef.current = onSelectionStateChange;
  const onViewScaleChangeRef = useRef(onViewScaleChange);
  onViewScaleChangeRef.current = onViewScaleChange;

  const colliderRef = useRef(collider);
  colliderRef.current = collider;

  const suppressHistoryRef = useRef(false);
  const bitmapRasterCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const vectorStrokeTextureCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const vectorStrokeTexturePendingRef = useRef<Set<string>>(new Set());

  const historyRef = useRef<CanvasHistorySnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const persistedSnapshotRef = useRef<CanvasHistorySnapshot | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  const shapeDraftRef = useRef<{
    type: 'rectangle' | 'circle' | 'triangle' | 'star' | 'line';
    startX: number;
    startY: number;
    object: any;
  } | null>(null);

  const colliderDragModeRef = useRef<'none' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b'>('none');
  const colliderDragStartRef = useRef<{ x: number; y: number; collider: ColliderConfig } | null>(null);

  const bitmapFloatingObjectRef = useRef<any | null>(null);
  const bitmapSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const bitmapMarqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const bitmapSelectionDragModeRef = useRef<'none' | 'marquee'>('none');
  const bitmapSelectionBusyRef = useRef(false);
  const suppressBitmapSelectionAutoCommitRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const loadedSessionKeyRef = useRef<string | null>(null);
  const originalControlsRef = useRef<WeakMap<object, Record<string, Control> | undefined>>(new WeakMap());
  const brushCursorEnabledRef = useRef(false);
  const brushCursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const activePathAnchorRef = useRef<{ path: any; anchorIndex: number } | null>(null);
  const selectedPathAnchorIndicesRef = useRef<number[]>([]);
  const vectorPointEditingTargetRef = useRef<any | null>(null);
  const insertedPathAnchorDragSessionRef = useRef<{
    path: any;
    anchorIndex: number;
    dragState: PathAnchorDragState;
  } | null>(null);
  const pointSelectionTransformFrameRef = useRef<PointSelectionTransformFrameState | null>(null);
  const pointSelectionTransformSessionRef = useRef<PointSelectionTransformSession | null>(null);
  const pointSelectionMarqueeSessionRef = useRef<PointSelectionMarqueeSession | null>(null);
  const penDraftRef = useRef<PenDraftState | null>(null);
  const penAnchorPlacementSessionRef = useRef<PenAnchorPlacementSession | null>(null);
  const penModifierStateRef = useRef({
    alt: false,
    space: false,
  });

  const setVectorPointEditingTarget = useCallback((nextTarget: any | null) => {
    if (vectorPointEditingTargetRef.current === nextTarget) {
      return;
    }

    vectorPointEditingTargetRef.current = nextTarget;
    activePathAnchorRef.current = null;
    selectedPathAnchorIndicesRef.current = [];
    insertedPathAnchorDragSessionRef.current = null;
    pointSelectionTransformFrameRef.current = null;
    pointSelectionTransformSessionRef.current = null;
    pointSelectionMarqueeSessionRef.current = null;
    pendingSelectionSyncedVectorHandleModeRef.current = null;
    onVectorPointSelectionChangeRef.current?.(false);
    onVectorPointEditingChangeRef.current?.(!!nextTarget);
  }, []);

  const getSelectionBoundsSnapshot = useCallback((): CanvasSelectionBoundsSnapshot | null => {
    const fabricCanvas = fabricCanvasRef.current;
    const mode = editorModeRef.current;
    const activeObject = fabricCanvas?.getActiveObject() as any;
    const selectionObject = mode === 'bitmap'
      ? bitmapFloatingObjectRef.current
      : activeObject;
    if (!selectionObject) return null;
    if (isTextObject(selectionObject) && (selectionObject as any).isEditing) return null;

    const selectedObjects = isActiveSelectionObject(selectionObject) && typeof selectionObject.getObjects === 'function'
      ? (selectionObject.getObjects() as any[]).filter(Boolean)
      : [selectionObject];
    if (selectedObjects.length === 0) return null;

    const boundsList = selectedObjects
      .map((obj) => ({ obj, rect: obj.getBoundingRect() as { left: number; top: number; width: number; height: number } }))
      .filter((entry) => Number.isFinite(entry.rect.left) && Number.isFinite(entry.rect.top));
    if (boundsList.length === 0) return null;

    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (const { rect } of boundsList) {
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.left + rect.width);
      maxBottom = Math.max(maxBottom, rect.top + rect.height);
    }

    return {
      selectionObject,
      selectedObjects: boundsList.map((entry) => entry.obj),
      bounds: {
        left: minLeft,
        top: minTop,
        width: Math.max(1, maxRight - minLeft),
        height: Math.max(1, maxBottom - minTop),
      },
    };
  }, []);

  const restoreCanvasSelection = useCallback((selectedObjects: any[]) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const nextObjects = selectedObjects.filter((obj) => fabricCanvas.getObjects().includes(obj));
    if (nextObjects.length === 0) {
      fabricCanvas.discardActiveObject();
      return;
    }

    if (nextObjects.length === 1) {
      nextObjects[0].setCoords?.();
      fabricCanvas.setActiveObject(nextObjects[0]);
      return;
    }

    const nextSelection = new ActiveSelection(nextObjects, { canvas: fabricCanvas });
    nextSelection.setCoords?.();
    fabricCanvas.setActiveObject(nextSelection);
  }, []);

  const syncSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    const hasBitmap = !!bitmapFloatingObjectRef.current;
    const hasActive = !!fabricCanvas?.getActiveObject();
    const hasSelection = hasBitmap || (editorModeRef.current === 'vector' && hasActive);
    setCanZoomToSelection(!!getSelectionBoundsSnapshot());
    onSelectionStateChangeRef.current?.({
      hasSelection,
      hasBitmapFloatingSelection: hasBitmap,
    });
  }, [getSelectionBoundsSnapshot]);

  const syncBrushCursorOverlay = useCallback(() => {
    const overlay = brushCursorOverlayRef.current;
    if (!overlay) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;
    const isBitmapBrushTool = mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    brushCursorEnabledRef.current = isBitmapBrushTool;

    if (!isBitmapBrushTool) {
      overlay.style.opacity = '0';
      return;
    }

    const displayScale = BASE_VIEW_SCALE * zoomRef.current;
    const cursorStyle = getBitmapBrushCursorStyle(
      tool,
      bitmapBrushKindRef.current,
      brushColorRef.current,
      brushSizeRef.current,
      displayScale,
    );
    overlay.style.width = `${cursorStyle.diameter}px`;
    overlay.style.height = `${cursorStyle.diameter}px`;
    overlay.style.border = `${cursorStyle.borderWidth}px solid ${cursorStyle.stroke}`;
    overlay.style.background = cursorStyle.fill;
    overlay.style.boxShadow = cursorStyle.boxShadow ?? 'none';

    const pos = brushCursorPosRef.current;
    if (pos) {
      overlay.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      overlay.style.opacity = '1';
    } else {
      overlay.style.opacity = '0';
    }
  }, []);

  const setEditorMode = useCallback((mode: CostumeEditorMode) => {
    editorModeRef.current = mode;
    setEditorModeState(mode);
    onModeChangeRef.current?.(mode);
    if (mode !== 'vector') {
      setVectorPointEditingTarget(null);
      activePathAnchorRef.current = null;
      onTextSelectionChangeRef.current?.(false);
    }
    syncSelectionState();
  }, [setVectorPointEditingTarget, syncSelectionState]);

  const isLoadRequestActive = useCallback((requestId?: number) => {
    if (typeof requestId !== 'number') return true;
    return loadRequestIdRef.current === requestId;
  }, []);

  const clampZoom = useCallback((value: number) => {
    return clampViewportZoom(value, MIN_ZOOM, MAX_ZOOM);
  }, []);

  const clampCameraCenter = useCallback((
    nextCamera: { x: number; y: number },
    zoomValue = zoomRef.current,
    view = viewportSizeRef.current,
  ) => {
    return clampCameraToWorldRect(
      nextCamera,
      view,
      BASE_VIEW_SCALE * zoomValue,
      COSTUME_WORLD_RECT,
      MAX_PAN_OVERSCROLL_PX,
    );
  }, []);

  const getZoomInvariantMetric = useCallback((metric: number, zoomValue = zoomRef.current) => {
    return getZoomInvariantCanvasMetric(metric, zoomValue);
  }, []);

  const zoomAtScreenPoint = useCallback((screenX: number, screenY: number, nextZoom: number) => {
    const clampedZoom = clampZoom(nextZoom);
    const currentZoom = zoomRef.current;
    if (Math.abs(clampedZoom - currentZoom) < 0.0001) return;

    const view = viewportSizeRef.current;
    if (view.width <= 0 || view.height <= 0) {
      setZoom(clampedZoom);
      return;
    }

    const currentCamera = cameraCenterRef.current;
    const beforeScale = BASE_VIEW_SCALE * currentZoom;
    const afterScale = BASE_VIEW_SCALE * clampedZoom;

    const worldBefore = {
      x: (screenX - view.width / 2) / beforeScale + currentCamera.x,
      y: (screenY - view.height / 2) / beforeScale + currentCamera.y,
    };
    const worldAfter = {
      x: (screenX - view.width / 2) / afterScale + currentCamera.x,
      y: (screenY - view.height / 2) / afterScale + currentCamera.y,
    };

    setCameraCenter(clampCameraCenter({
      x: currentCamera.x + (worldBefore.x - worldAfter.x),
      y: currentCamera.y + (worldBefore.y - worldAfter.y),
    }, clampedZoom, view));
    setZoom(clampedZoom);
  }, [clampCameraCenter, clampZoom]);

  const zoomAroundViewportCenter = useCallback((nextZoom: number) => {
    const view = viewportSizeRef.current;
    zoomAtScreenPoint(view.width / 2, view.height / 2, nextZoom);
  }, [zoomAtScreenPoint]);

  const drawBitmapSelectionOverlay = useCallback(() => {
    const overlayCtx = bitmapSelectionCtxRef.current;
    if (!overlayCtx) return;

    overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const marquee = bitmapMarqueeRectRef.current;
    if (marquee && bitmapSelectionDragModeRef.current === 'marquee') {
      overlayCtx.fillStyle = 'rgba(0, 102, 255, 0.1)';
      overlayCtx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
      overlayCtx.strokeStyle = '#0066ff';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 6]);
      overlayCtx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
      overlayCtx.setLineDash([]);
    }
  }, []);

  const resolveVectorTextureSource = useCallback((texturePath?: string | null) => {
    const normalizedTexturePath = texturePath?.trim();
    if (!normalizedTexturePath) {
      return null;
    }

    if (vectorStrokeTextureCacheRef.current.has(normalizedTexturePath)) {
      return vectorStrokeTextureCacheRef.current.get(normalizedTexturePath) ?? null;
    }

    if (!vectorStrokeTexturePendingRef.current.has(normalizedTexturePath)) {
      vectorStrokeTexturePendingRef.current.add(normalizedTexturePath);
      const image = new Image();
      image.onload = () => {
        vectorStrokeTexturePendingRef.current.delete(normalizedTexturePath);
        vectorStrokeTextureCacheRef.current.set(normalizedTexturePath, image);
        fabricCanvasRef.current?.requestRenderAll();
      };
      image.onerror = () => {
        vectorStrokeTexturePendingRef.current.delete(normalizedTexturePath);
        vectorStrokeTextureCacheRef.current.set(normalizedTexturePath, null);
        fabricCanvasRef.current?.requestRenderAll();
      };
      image.src = normalizedTexturePath;
    }

    return null;
  }, []);

  const resolveVectorStrokeTextureSource = useCallback((brushId: VectorStrokeBrushId) => {
    const preset = getVectorStrokeBrushPreset(brushId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const resolveVectorFillTextureSource = useCallback((textureId: VectorFillTextureId) => {
    const preset = getVectorFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const resolveBitmapFillTextureSource = useCallback((textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const transformVectorLocalPointToScene = useCallback((obj: any, x: number, y: number, pathOffset?: Point | null) => {
    const offsetX = pathOffset?.x ?? 0;
    const offsetY = pathOffset?.y ?? 0;
    return new Point(x - offsetX, y - offsetY).transform(obj.calcTransformMatrix());
  }, []);

  const getVectorObjectContourPaths = useCallback((obj: any): Array<{ closed: boolean; points: Point[] }> => {
    if (!obj || typeof obj.calcTransformMatrix !== 'function') {
      return [];
    }

    const objectType = getFabricObjectType(obj);
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
      const segments = Math.max(24, Math.ceil((Math.max(radiusX, radiusY) * Math.PI * 2) / 10));
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
      const targetSpacing = Math.max(4, (typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1) * 0.6);

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
  }, [transformVectorLocalPointToScene]);

  const drawVectorStrokeBrushPath = useCallback((
    ctx: CanvasRenderingContext2D,
    points: Point[],
    closed: boolean,
    stampConfig: NonNullable<ReturnType<typeof createVectorStrokeBrushStamp>>,
  ) => {
    if (points.length < 2) {
      return;
    }

    const pathPoints = closed ? [...points, points[0]] : points;

    const renderStampAt = (point: Point, angle: number, stampIndex: number) => {
      const scaleRandom = hashNumberTriplet(point.x, point.y, stampIndex * 0.17);
      const rotationRandom = hashNumberTriplet(point.y, point.x, stampIndex * 0.41);
      const scatterAngleRandom = hashNumberTriplet(point.x, angle, stampIndex * 0.83);
      const scatterRadiusRandom = hashNumberTriplet(point.y, angle, stampIndex * 1.29);
      const jitterScale = 1 + (((scaleRandom * 2) - 1) * stampConfig.scaleJitter);
      const jitterRotation = ((rotationRandom * 2) - 1) * stampConfig.rotationJitter;
      const scatterAngle = scatterAngleRandom * Math.PI * 2;
      const scatterRadius = stampConfig.scatter > 0 ? scatterRadiusRandom * stampConfig.scatter : 0;
      const renderX = point.x + Math.cos(scatterAngle) * scatterRadius;
      const renderY = point.y + Math.sin(scatterAngle) * scatterRadius;

      ctx.save();
      ctx.globalAlpha = stampConfig.opacity;
      ctx.translate(renderX, renderY);
      ctx.rotate(angle + jitterRotation);
      if (jitterScale !== 1) {
        ctx.scale(jitterScale, jitterScale);
      }
      ctx.drawImage(
        stampConfig.image,
        -stampConfig.image.width / 2,
        -stampConfig.image.height / 2,
      );
      ctx.restore();
    };

    let carry = 0;
    let stampIndex = 0;
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const start = pathPoints[index];
      const end = pathPoints[index + 1];
      const segmentLength = getDistanceBetweenPoints(start, end);
      if (segmentLength === 0) {
        continue;
      }

      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      let distanceAlong = index === 0 ? 0 : Math.max(0, stampConfig.advance - carry);
      if (index === 0) {
        renderStampAt(start, angle, stampIndex);
        stampIndex += 1;
        distanceAlong = stampConfig.advance;
      }

      while (distanceAlong <= segmentLength) {
        const progress = distanceAlong / segmentLength;
        renderStampAt(new Point(
          lerpNumber(start.x, end.x, progress),
          lerpNumber(start.y, end.y, progress),
        ), angle, stampIndex);
        stampIndex += 1;
        distanceAlong += stampConfig.advance;
      }

      carry = segmentLength - (distanceAlong - stampConfig.advance);
    }

    if (!closed) {
      const lastPoint = pathPoints[pathPoints.length - 1];
      const previousPoint = pathPoints[pathPoints.length - 2];
      renderStampAt(lastPoint, Math.atan2(lastPoint.y - previousPoint.y, lastPoint.x - previousPoint.x), stampIndex);
    }
  }, []);

  const traceVectorObjectLocalPath = useCallback((ctx: CanvasRenderingContext2D, obj: any): boolean => {
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

    if (objectType === 'path' && Array.isArray(obj.path) && pathCommandsDescribeClosedShape(obj.path)) {
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
      return true;
    }

    return false;
  }, []);

  const renderVectorBrushStrokeOverlay = useCallback((ctx: CanvasRenderingContext2D, options: { clear?: boolean } = {}) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (options.clear !== false) {
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    if (!fabricCanvas || editorModeRef.current !== 'vector') {
      return;
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    for (const obj of fabricCanvas.getObjects() as any[]) {
      if (getVectorStyleTargets(obj).length === 0) {
        continue;
      }

      const fillTextureId = getVectorObjectFillTextureId(obj);
      const fillColor = getVectorObjectFillColor(obj);
      if (vectorObjectSupportsFill(obj) && fillTextureId !== DEFAULT_VECTOR_FILL_TEXTURE_ID && fillColor) {
        const textureTile = createVectorFillTextureTile(
          fillTextureId,
          fillColor,
          resolveVectorFillTextureSource(fillTextureId),
        );
        if (textureTile && typeof obj.calcTransformMatrix === 'function') {
          ctx.save();
          const transform = obj.calcTransformMatrix();
          ctx.transform(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]);
          if (traceVectorObjectLocalPath(ctx, obj)) {
            const pattern = ctx.createPattern(textureTile, 'repeat');
            if (pattern) {
              ctx.fillStyle = pattern;
              ctx.globalAlpha = typeof obj.opacity === 'number' ? obj.opacity : 1;
              ctx.clip();
              ctx.fillRect(-CANVAS_SIZE, -CANVAS_SIZE, CANVAS_SIZE * 2, CANVAS_SIZE * 2);
            }
          }
          ctx.restore();
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

      const stampConfig = createVectorStrokeBrushStamp(
        brushId,
        strokeColor,
        strokeWidth,
        resolveVectorStrokeTextureSource(brushId),
      );
      if (!stampConfig) {
        continue;
      }
      const objectOpacity = typeof obj.opacity === 'number' ? obj.opacity : 1;
      const resolvedStampConfig = objectOpacity === 1
        ? stampConfig
        : {
            ...stampConfig,
            opacity: stampConfig.opacity * objectOpacity,
          };

      const contourPaths = getVectorObjectContourPaths(obj);
      if (contourPaths.length === 0) {
        continue;
      }

      for (const contour of contourPaths) {
        drawVectorStrokeBrushPath(ctx, contour.points, contour.closed, resolvedStampConfig);
      }
    }

    ctx.restore();
  }, [drawVectorStrokeBrushPath, getVectorObjectContourPaths, resolveVectorFillTextureSource, resolveVectorStrokeTextureSource, traceVectorObjectLocalPath]);

  const getCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      const baseCanvas = fabricCanvas.toCanvasElement(1);
      const composed = document.createElement('canvas');
      composed.width = CANVAS_SIZE;
      composed.height = CANVAS_SIZE;
      const composedCtx = composed.getContext('2d');
      if (!composedCtx) {
        return baseCanvas;
      }
      composedCtx.drawImage(baseCanvas, 0, 0);
      renderVectorBrushStrokeOverlay(composedCtx, { clear: false });
      return composed;
    }
    const fallback = document.createElement('canvas');
    fallback.width = CANVAS_SIZE;
    fallback.height = CANVAS_SIZE;
    return fallback;
  }, [renderVectorBrushStrokeOverlay]);

  const getSelectionMousePos = useCallback((event: MouseEvent) => {
    const canvas = bitmapSelectionCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: Math.max(0, Math.min(CANVAS_SIZE, (event.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(CANVAS_SIZE, (event.clientY - rect.top) * scaleY)),
    };
  }, []);

  const createSnapshot = useCallback((): CanvasHistorySnapshot => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        mode: editorModeRef.current,
        bitmapDataUrl: '',
        vectorJson: null,
      };
    }

    const composed = getCanvasElement();
    const bitmapDataUrl = composed.toDataURL('image/png');
    const mode = editorModeRef.current;
    const vectorJson = mode === 'vector' ? JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)) : null;
    return { mode, bitmapDataUrl, vectorJson };
  }, [getCanvasElement]);

  const updateDirtyStateFromSnapshot = useCallback((snapshot: CanvasHistorySnapshot | null) => {
    hasUnsavedChangesRef.current = !areHistorySnapshotsEqual(snapshot, persistedSnapshotRef.current);
  }, []);

  const markSnapshotPersisted = useCallback((snapshot: CanvasHistorySnapshot | null) => {
    persistedSnapshotRef.current = snapshot ? cloneHistorySnapshot(snapshot) : null;
    hasUnsavedChangesRef.current = false;
  }, []);

  const markCurrentSnapshotPersisted = useCallback((sessionKey?: string | null) => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return;
    }

    markSnapshotPersisted(createSnapshot());
  }, [createSnapshot, markSnapshotPersisted]);

  const saveHistory = useCallback(() => {
    if (suppressHistoryRef.current) return;
    const snapshot = createSnapshot();
    const current = historyRef.current[historyIndexRef.current];
    if (
      current &&
      current.mode === snapshot.mode &&
      current.bitmapDataUrl === snapshot.bitmapDataUrl &&
      current.vectorJson === snapshot.vectorJson
    ) {
      return;
    }

    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;

    if (historyRef.current.length > 50) {
      historyRef.current.shift();
      historyIndexRef.current -= 1;
    }

    updateDirtyStateFromSnapshot(snapshot);
    onHistoryChangeRef.current?.();
  }, [createSnapshot, updateDirtyStateFromSnapshot]);

  const applySelectionTransform = useCallback((transform: Parameters<typeof util.applyTransformToObject>[1]): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectedObjects = selectionSnapshot.selectedObjects.filter(Boolean);
    if (selectedObjects.length === 0) {
      return false;
    }

    if (isActiveSelectionObject(activeObject)) {
      fabricCanvas.discardActiveObject();
    }

    let changed = false;
    for (const obj of selectedObjects) {
      if (typeof obj?.calcTransformMatrix !== 'function') {
        continue;
      }
      const nextMatrix = util.multiplyTransformMatrices(transform, obj.calcTransformMatrix());
      util.applyTransformToObject(obj, nextMatrix);
      obj.setCoords?.();
      changed = true;
    }

    restoreCanvasSelection(selectedObjects);

    if (!changed) {
      return false;
    }

    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [getSelectionBoundsSnapshot, restoreCanvasSelection, saveHistory, syncSelectionState]);

  const mirrorPointAcrossAnchor = useCallback((anchor: Point, handlePoint: Point) => (
    new Point(
      anchor.x * 2 - handlePoint.x,
      anchor.y * 2 - handlePoint.y,
    )
  ), []);

  const translateScenePoint = useCallback((point: Point | null, deltaX: number, deltaY: number) => {
    if (!point) return null;
    return new Point(point.x + deltaX, point.y + deltaY);
  }, []);

  const resolvePenDraftAnchorHandleType = useCallback((anchor: PenDraftAnchor): VectorPathNodeHandleType => {
    const hasIncoming = !!anchor.incoming;
    const hasOutgoing = !!anchor.outgoing;
    if (!hasIncoming && !hasOutgoing) {
      return 'linear';
    }
    if (!hasIncoming || !hasOutgoing) {
      return 'corner';
    }

    const incoming = anchor.incoming!;
    const outgoing = anchor.outgoing!;
    const mirrored = (
      Math.abs(incoming.x + outgoing.x - anchor.point.x * 2) <= 0.0001 &&
      Math.abs(incoming.y + outgoing.y - anchor.point.y * 2) <= 0.0001
    );
    return mirrored ? 'symmetric' : 'corner';
  }, []);

  const commitCurrentPenPlacement = useCallback(() => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) {
      penAnchorPlacementSessionRef.current = null;
      return false;
    }

    if (!session.hasDragged) {
      anchor.incoming = null;
      anchor.outgoing = null;
      anchor.handleType = 'linear';
    } else {
      anchor.handleType = resolvePenDraftAnchorHandleType(anchor);
    }

    draft.previewPoint = cloneScenePoint(session.currentPointerScene);
    penAnchorPlacementSessionRef.current = null;
    return true;
  }, [resolvePenDraftAnchorHandleType]);

  const updatePenAnchorPlacement = useCallback((pointer: Point) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;

    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) return false;

    const nextPointer = new Point(pointer.x, pointer.y);
    session.currentPointerScene = nextPointer;

    const dragThreshold = getZoomInvariantMetric(PEN_TOOL_DRAG_THRESHOLD_PX);
    if (
      Math.hypot(
        nextPointer.x - session.startPointerScene.x,
        nextPointer.y - session.startPointerScene.y,
      ) >= dragThreshold
    ) {
      session.hasDragged = true;
    }

    if (session.moveAnchorMode && session.moveAnchorSnapshot && session.moveAnchorStartPointerScene) {
      const deltaX = nextPointer.x - session.moveAnchorStartPointerScene.x;
      const deltaY = nextPointer.y - session.moveAnchorStartPointerScene.y;
      anchor.point = new Point(
        session.moveAnchorSnapshot.point.x + deltaX,
        session.moveAnchorSnapshot.point.y + deltaY,
      );
      anchor.incoming = translateScenePoint(session.moveAnchorSnapshot.incoming, deltaX, deltaY);
      anchor.outgoing = translateScenePoint(session.moveAnchorSnapshot.outgoing, deltaX, deltaY);
      anchor.handleType = resolvePenDraftAnchorHandleType(anchor);
      return true;
    }

    if (session.handleRole === 'incoming') {
      anchor.incoming = nextPointer;
      anchor.outgoing = session.cuspMode
        ? cloneScenePoint(session.cuspFixedOpposite)
        : mirrorPointAcrossAnchor(anchor.point, nextPointer);
    } else {
      anchor.outgoing = nextPointer;
      anchor.incoming = session.cuspMode
        ? cloneScenePoint(session.cuspFixedOpposite)
        : mirrorPointAcrossAnchor(anchor.point, nextPointer);
    }
    anchor.handleType = session.cuspMode ? 'corner' : 'symmetric';
    draft.previewPoint = nextPointer;
    return true;
  }, [getZoomInvariantMetric, mirrorPointAcrossAnchor, resolvePenDraftAnchorHandleType, translateScenePoint]);

  const setPenAnchorMoveMode = useCallback((enabled: boolean) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    if (enabled === session.moveAnchorMode) return false;

    if (enabled) {
      const anchor = draft.anchors[session.anchorIndex];
      if (!anchor) return false;
      session.moveAnchorMode = true;
      session.moveAnchorStartPointerScene = cloneScenePoint(session.currentPointerScene);
      session.moveAnchorSnapshot = clonePenDraftAnchor(anchor);
      return true;
    }

    session.moveAnchorMode = false;
    session.moveAnchorStartPointerScene = null;
    session.moveAnchorSnapshot = null;
    return true;
  }, []);

  const setPenAnchorCuspMode = useCallback((enabled: boolean) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    if (enabled === session.cuspMode) return false;

    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) return false;

    session.cuspMode = enabled;
    if (enabled) {
      session.cuspFixedOpposite = cloneScenePoint(
        session.handleRole === 'incoming' ? anchor.outgoing : anchor.incoming,
      );
    } else {
      session.cuspFixedOpposite = null;
    }

    if (!session.moveAnchorMode) {
      updatePenAnchorPlacement(session.currentPointerScene);
    }
    return true;
  }, [updatePenAnchorPlacement]);

  const syncPenPlacementToAltModifier = useCallback((enabled: boolean) => {
    const session = penAnchorPlacementSessionRef.current;
    if (!session) {
      return false;
    }
    if (enabled) {
      return setPenAnchorCuspMode(true);
    }
    return false;
  }, [setPenAnchorCuspMode]);

  const discardPenDraft = useCallback(() => {
    penDraftRef.current = null;
    penAnchorPlacementSessionRef.current = null;
    penModifierStateRef.current.alt = false;
    penModifierStateRef.current.space = false;
    fabricCanvasRef.current?.requestRenderAll();
    syncSelectionState();
  }, [syncSelectionState]);

  const finalizePenDraft = useCallback((options: { close?: boolean } = {}): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const draft = penDraftRef.current;
    if (!fabricCanvas || !draft) return false;

    commitCurrentPenPlacement();

    if (draft.anchors.length < 2) {
      discardPenDraft();
      return false;
    }

    const shouldClose = options.close === true;
    const pathData = buildPenDraftPathData(draft.anchors, shouldClose);
    if (!pathData) {
      discardPenDraft();
      return false;
    }

    const strokeWidth = Math.max(0, vectorStyleRef.current.strokeWidth);
    const path = new Path(pathData, {
      fill: shouldClose
        ? getFabricFillValueForVectorTexture(vectorStyleRef.current.fillTextureId, vectorStyleRef.current.fillColor)
        : null,
      stroke: getFabricStrokeValueForVectorBrush(vectorStyleRef.current.strokeBrushId, vectorStyleRef.current.strokeColor),
      strokeWidth,
      strokeUniform: true,
      noScaleCache: false,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      nodeHandleTypes: buildPenDraftNodeHandleTypes(draft.anchors),
      vectorFillTextureId: shouldClose ? vectorStyleRef.current.fillTextureId : undefined,
      vectorFillColor: shouldClose ? vectorStyleRef.current.fillColor : undefined,
      vectorStrokeBrushId: vectorStyleRef.current.strokeBrushId,
      vectorStrokeColor: vectorStyleRef.current.strokeColor,
    } as any);

    path.setCoords?.();
    fabricCanvas.add(path);
    if (activeToolRef.current === 'pen') {
      fabricCanvas.discardActiveObject();
    } else {
      fabricCanvas.setActiveObject(path);
    }

    penDraftRef.current = null;
    penAnchorPlacementSessionRef.current = null;
    penModifierStateRef.current.alt = false;
    penModifierStateRef.current.space = false;
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [commitCurrentPenPlacement, discardPenDraft, saveHistory, syncSelectionState]);

  const removeLastPenDraftAnchor = useCallback(() => {
    const draft = penDraftRef.current;
    if (!draft) return false;

    penAnchorPlacementSessionRef.current = null;
    draft.anchors.pop();
    if (draft.anchors.length === 0) {
      discardPenDraft();
      return true;
    }

    draft.previewPoint = cloneScenePoint(draft.anchors[draft.anchors.length - 1]?.point ?? null);
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [discardPenDraft]);

  const startPenAnchorPlacement = useCallback((pointer: Point, options: { cuspMode?: boolean } = {}) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    let draft = penDraftRef.current;
    if (!draft) {
      draft = {
        anchors: [],
        previewPoint: null,
      };
      penDraftRef.current = draft;
    }

    if (draft.anchors.length >= 2) {
      const firstAnchor = draft.anchors[0]?.point ?? null;
      const closeRadius = getZoomInvariantMetric(PEN_TOOL_CLOSE_HIT_RADIUS_PX);
      if (
        firstAnchor &&
        Math.hypot(pointer.x - firstAnchor.x, pointer.y - firstAnchor.y) <= closeRadius
      ) {
        return finalizePenDraft({ close: true });
      }
    }

    const anchor = createPenDraftAnchor(pointer);
    const anchorIndex = draft.anchors.length;
    draft.anchors.push(anchor);
    draft.previewPoint = cloneScenePoint(pointer);
    penAnchorPlacementSessionRef.current = {
      anchorIndex,
      // Match Figma-style pen placement: the drag direction controls the
      // forward/outgoing handle, while the previous-side handle mirrors unless
      // Alt breaks the relationship into a cusp.
      handleRole: 'outgoing',
      startPointerScene: cloneScenePoint(pointer) ?? new Point(pointer.x, pointer.y),
      currentPointerScene: cloneScenePoint(pointer) ?? new Point(pointer.x, pointer.y),
      hasDragged: false,
      moveAnchorMode: false,
      moveAnchorStartPointerScene: null,
      moveAnchorSnapshot: null,
      cuspMode: options.cuspMode === true,
      cuspFixedOpposite: null,
    };
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    return true;
  }, [finalizePenDraft, getZoomInvariantMetric, syncSelectionState]);

  const renderPenDraftGuide = useCallback((ctx: CanvasRenderingContext2D) => {
    const draft = penDraftRef.current;
    if (!draft || draft.anchors.length === 0) return false;

    const activeAnchorIndex = penAnchorPlacementSessionRef.current?.anchorIndex ?? (draft.anchors.length - 1);
    const previewPoint = penAnchorPlacementSessionRef.current ? null : draft.previewPoint;
    const previewStrokeWidth = Math.max(1, vectorStyleRef.current.strokeWidth);

    ctx.save();
    try {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(draft.anchors[0].point.x, draft.anchors[0].point.y);
      for (let index = 1; index < draft.anchors.length; index += 1) {
        const previousAnchor = draft.anchors[index - 1];
        const currentAnchor = draft.anchors[index];
        if (previousAnchor.outgoing || currentAnchor.incoming) {
          const control1 = previousAnchor.outgoing ?? previousAnchor.point;
          const control2 = currentAnchor.incoming ?? currentAnchor.point;
          ctx.bezierCurveTo(
            control1.x,
            control1.y,
            control2.x,
            control2.y,
            currentAnchor.point.x,
            currentAnchor.point.y,
          );
        } else {
          ctx.lineTo(currentAnchor.point.x, currentAnchor.point.y);
        }
      }
      if (previewPoint && draft.anchors.length > 0) {
        const lastAnchor = draft.anchors[draft.anchors.length - 1];
        if (lastAnchor.outgoing) {
          ctx.bezierCurveTo(
            lastAnchor.outgoing.x,
            lastAnchor.outgoing.y,
            previewPoint.x,
            previewPoint.y,
            previewPoint.x,
            previewPoint.y,
          );
        } else {
          ctx.lineTo(previewPoint.x, previewPoint.y);
        }
      }
      ctx.strokeStyle = vectorStyleRef.current.strokeColor;
      ctx.lineWidth = previewStrokeWidth;
      ctx.stroke();

      ctx.strokeStyle = VECTOR_POINT_HANDLE_GUIDE_STROKE;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH);
      draft.anchors.forEach((anchor) => {
        if (anchor.incoming) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.incoming.x, anchor.incoming.y);
          ctx.stroke();
        }
        if (anchor.outgoing) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.outgoing.x, anchor.outgoing.y);
          ctx.stroke();
        }
      });

      const handleRadius = getZoomInvariantMetric(HANDLE_SIZE * 0.42);
      draft.anchors.forEach((anchor, anchorIndex) => {
        const isActive = anchorIndex === activeAnchorIndex;
        const drawHandle = (handlePoint: Point | null) => {
          if (!handlePoint) return;
          ctx.beginPath();
          ctx.arc(handlePoint.x, handlePoint.y, handleRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = getZoomInvariantMetric(2);
          ctx.strokeStyle = '#0ea5e9';
          ctx.stroke();
        };

        drawHandle(anchor.incoming);
        drawHandle(anchor.outgoing);

        ctx.beginPath();
        ctx.arc(anchor.point.x, anchor.point.y, getZoomInvariantMetric(HANDLE_SIZE / 2), 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#0ea5e9' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = getZoomInvariantMetric(2);
        ctx.strokeStyle = isActive ? '#ffffff' : '#0ea5e9';
        ctx.stroke();
      });
    } finally {
      ctx.restore();
    }

    return true;
  }, [getZoomInvariantMetric]);

  const deleteBitmapFloatingSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = bitmapFloatingObjectRef.current;
    if (!fabricCanvas || !floatingObject) return false;
    if (editorModeRef.current !== 'bitmap' || activeToolRef.current !== 'select') return false;
    if (bitmapSelectionBusyRef.current) return false;

    suppressBitmapSelectionAutoCommitRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }

      fabricCanvas.remove(floatingObject);
      bitmapFloatingObjectRef.current = null;
      setHasBitmapFloatingSelection(false);
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();
      fabricCanvas.requestRenderAll();
      syncSelectionState();
      saveHistory();
      return true;
    } finally {
      queueMicrotask(() => {
        suppressBitmapSelectionAutoCommitRef.current = false;
      });
    }
  }, [drawBitmapSelectionOverlay, saveHistory, syncSelectionState]);

  const syncTextStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || !isTextObject(activeObject)) return;
    const textObj = activeObject as any;

    onTextStyleSyncRef.current?.({
      fontFamily: typeof textObj.fontFamily === 'string' ? textObj.fontFamily : undefined,
      fontSize: typeof textObj.fontSize === 'number' ? textObj.fontSize : undefined,
      fontWeight: textObj.fontWeight === 'bold' ? 'bold' : 'normal',
      fontStyle: textObj.fontStyle === 'italic' ? 'italic' : 'normal',
      underline: textObj.underline === true,
      textAlign: textObj.textAlign === 'center' || textObj.textAlign === 'right' ? textObj.textAlign : 'left',
      opacity: typeof textObj.opacity === 'number' ? textObj.opacity : undefined,
    });
  }, []);

  const syncVectorStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onVectorStyleCapabilitiesSyncRef.current?.(getVectorStyleCapabilitiesForSelection(activeObject));
    const [vectorObject] = getVectorStyleTargets(activeObject);
    if (!vectorObject) return;

    onVectorStyleSyncRef.current?.({
      fillColor: getVectorObjectFillColor(vectorObject),
      fillTextureId: getVectorObjectFillTextureId(vectorObject),
      strokeColor: getVectorObjectStrokeColor(vectorObject),
      strokeWidth: typeof vectorObject.strokeWidth === 'number' ? vectorObject.strokeWidth : undefined,
      strokeBrushId: getVectorObjectStrokeBrushId(vectorObject),
    });
  }, []);

  const syncTextSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onTextSelectionChangeRef.current?.(!!activeObject && isTextObject(activeObject));
  }, []);

  const applyBitmapLayerSource = useCallback((
    source: FabricImage | HTMLImageElement | HTMLCanvasElement | null,
    selectable: boolean,
  ): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const image = source
      ? (source instanceof FabricImage ? source : new FabricImage(source as any))
      : null;

    suppressHistoryRef.current = true;
    try {
      bitmapFloatingObjectRef.current = null;
      setHasBitmapFloatingSelection(false);
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();

      fabricCanvas.clear();

      if (image) {
        const width = image.width || 1;
        const height = image.height || 1;
        const scale = Math.min(CANVAS_SIZE / width, CANVAS_SIZE / height, 1);

        image.set({
          left: CANVAS_SIZE / 2,
          top: CANVAS_SIZE / 2,
          originX: 'center',
          originY: 'center',
          selectable,
          evented: selectable,
          hasControls: selectable,
          hasBorders: selectable,
          lockMovementX: !selectable,
          lockMovementY: !selectable,
          lockRotation: !selectable,
          lockScalingX: !selectable,
          lockScalingY: !selectable,
        } as any);
        image.scale(scale);
        fabricCanvas.add(image);
      }

      fabricCanvas.requestRenderAll();
      syncSelectionState();
      return true;
    } finally {
      suppressHistoryRef.current = false;
    }
  }, [drawBitmapSelectionOverlay, syncSelectionState]);

  const loadBitmapLayer = useCallback(async (dataUrl: string, selectable: boolean, requestId?: number): Promise<boolean> => {
    if (!isLoadRequestActive(requestId)) return false;

    let image: FabricImage | null = null;
    if (dataUrl) {
      try {
        image = await FabricImage.fromURL(dataUrl);
      } catch (error) {
        console.error('Failed to load bitmap layer:', error);
        return false;
      }
      if (!isLoadRequestActive(requestId)) return false;
    }

    return applyBitmapLayerSource(image, selectable);
  }, [applyBitmapLayerSource, isLoadRequestActive]);

  const commitBitmapSelection = useCallback(async () => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = bitmapFloatingObjectRef.current;
    if (!fabricCanvas || !floatingObject) return false;
    if (bitmapSelectionBusyRef.current) return false;

    bitmapSelectionBusyRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }
      floatingObject.set({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
      });
      fabricCanvas.requestRenderAll();

      const raster = fabricCanvas.toCanvasElement(1);
      const applied = applyBitmapLayerSource(raster, false);
      if (!applied) return false;
      saveHistory();
      return true;
    } finally {
      bitmapSelectionBusyRef.current = false;
    }
  }, [applyBitmapLayerSource, saveHistory]);

  const queueBitmapRasterCommit = useCallback((
    mutateRaster?: (raster: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void | Promise<void>,
  ) => {
    const nextCommit = bitmapRasterCommitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const fabricCanvas = fabricCanvasRef.current;
        if (!fabricCanvas || editorModeRef.current !== 'bitmap') {
          return;
        }

        const raster = fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) {
          return;
        }

        if (mutateRaster) {
          await mutateRaster(raster, rasterCtx);
        }

        const applied = applyBitmapLayerSource(raster, false);
        if (!applied) {
          return;
        }
        saveHistory();
      })
      .catch((error) => {
        console.error('Failed to commit bitmap raster mutation:', error);
      });

    bitmapRasterCommitQueueRef.current = nextCommit;
    return nextCommit;
  }, [applyBitmapLayerSource, saveHistory]);

  const flattenBitmapLayer = useCallback(async () => {
    await queueBitmapRasterCommit();
  }, [queueBitmapRasterCommit]);

  const commitBitmapStampBrushStroke = useCallback((payload: BitmapStampBrushCommitPayload) => {
    void queueBitmapRasterCommit(async (_raster, rasterCtx) => {
      const visibleBounds = calculateBoundsFromCanvas(payload.strokeCanvas, payload.alphaThreshold);
      if (!visibleBounds) {
        return;
      }

      rasterCtx.save();
      rasterCtx.globalCompositeOperation = payload.compositeOperation;
      rasterCtx.drawImage(payload.strokeCanvas, 0, 0);
      rasterCtx.restore();
    });
  }, [queueBitmapRasterCommit]);

  const loadBitmapAsSingleVectorImage = useCallback(async (bitmapCanvas: HTMLCanvasElement, requestId?: number): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (!isLoadRequestActive(requestId)) return false;

    const extractedRegion = extractVisibleCanvasRegion(bitmapCanvas, 0);
    const bounds = extractedRegion?.bounds ?? null;
    let image: FabricImage | null = null;

    if (bounds && extractedRegion) {
      try {
        image = await FabricImage.fromURL(extractedRegion.canvas.toDataURL('image/png'));
      } catch (error) {
        console.error('Failed to create vector image from bitmap bounds:', error);
        return false;
      }
      if (!isLoadRequestActive(requestId)) return false;
    }

    suppressHistoryRef.current = true;
    try {
      fabricCanvas.clear();

      if (image && bounds) {
        image.set({
          left: bounds.x + bounds.width / 2,
          top: bounds.y + bounds.height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
        } as any);
        fabricCanvas.add(image);
      }

      fabricCanvas.requestRenderAll();
      return true;
    } finally {
      suppressHistoryRef.current = false;
    }
  }, [isLoadRequestActive]);

  const normalizeCanvasVectorStrokeUniform = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    let changed = false;
    fabricCanvas.forEachObject((obj: any) => {
      if (normalizeVectorObjectRendering(obj)) {
        obj.setCoords?.();
        changed = true;
      }
    });

    if (changed) {
      fabricCanvas.requestRenderAll();
    }

    return changed;
  }, []);

  const applySnapshot = useCallback(async (snapshot: CanvasHistorySnapshot) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    suppressHistoryRef.current = true;
    try {
      if (snapshot.mode === 'vector' && snapshot.vectorJson) {
        try {
          const parsed = JSON.parse(snapshot.vectorJson);
          fabricCanvas.clear();
          await fabricCanvas.loadFromJSON(parsed);
          normalizeCanvasVectorStrokeUniform();
          fabricCanvas.requestRenderAll();
          setEditorMode('vector');
        } catch (error) {
          console.warn('Failed to restore vector snapshot, falling back to bitmap:', error);
          await loadBitmapLayer(snapshot.bitmapDataUrl, false);
          setEditorMode('bitmap');
        }
      } else {
        await loadBitmapLayer(snapshot.bitmapDataUrl, false);
        setEditorMode('bitmap');
      }
    } finally {
      suppressHistoryRef.current = false;
      updateDirtyStateFromSnapshot(snapshot);
      onHistoryChangeRef.current?.();
    }
  }, [loadBitmapLayer, normalizeCanvasVectorStrokeUniform, setEditorMode, updateDirtyStateFromSnapshot]);

  const applyFill = useCallback(async (x: number, y: number) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'bitmap') return;

    const raster = fabricCanvas.toCanvasElement(1);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const didFill = applyBitmapBucketFill(
      imageData,
      Math.floor(x),
      Math.floor(y),
      {
        fillColor: brushColorRef.current,
        textureId: bitmapFillStyleRef.current.textureId,
      },
      {
        textureSource: resolveBitmapFillTextureSource(bitmapFillStyleRef.current.textureId),
      },
    );
    if (!didFill) {
      return;
    }
    ctx.putImageData(imageData, 0, 0);
    const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
    if (!loaded) return;
    saveHistory();
  }, [loadBitmapLayer, resolveBitmapFillTextureSource, saveHistory]);

  const switchEditorMode = useCallback(async (nextMode: CostumeEditorMode) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    if (editorModeRef.current === nextMode) return;

    const rasterizedCanvas = getCanvasElement();
    const rasterized = rasterizedCanvas.toDataURL('image/png');

    if (nextMode === 'bitmap') {
      const loaded = await loadBitmapLayer(rasterized, false);
      if (!loaded) return;
      setEditorMode('bitmap');
    } else {
      const loaded = await loadBitmapAsSingleVectorImage(rasterizedCanvas);
      if (!loaded) return;
      setEditorMode('vector');
    }

    saveHistory();
  }, [getCanvasElement, loadBitmapAsSingleVectorImage, loadBitmapLayer, saveHistory, setEditorMode]);

  const exportCostumeState = useCallback((sessionKey?: string | null): CostumeCanvasExportState | null => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return null;
    }

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        dataUrl: '',
        bounds: null,
        editorMode: editorModeRef.current,
      };
    }

    const composed = getCanvasElement();
    const dataUrl = composed.toDataURL('image/webp', 0.85);
    const bounds = calculateBoundsFromCanvas(composed);

    const mode = editorModeRef.current;
    if (mode === 'vector') {
      return {
        dataUrl,
        bounds,
        editorMode: mode,
        vectorDocument: {
          version: 1,
          fabricJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
        },
      };
    }

    return {
      dataUrl,
      bounds,
      editorMode: mode,
    };
  }, [getCanvasElement]);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current === 'bitmap') {
      return deleteBitmapFloatingSelection();
    }
    if (editorModeRef.current !== 'vector') return false;
    const deleted = deleteActiveCanvasSelection(fabricCanvas);
    if (!deleted) return false;
    saveHistory();
    return true;
  }, [deleteBitmapFloatingSelection, saveHistory]);

  const cloneFabricObject = useCallback(async (obj: any) => {
    if (!obj || typeof obj.clone !== 'function') {
      throw new Error('Object is not cloneable');
    }

    const maybePromise = obj.clone();
    if (maybePromise && typeof maybePromise.then === 'function') {
      return await maybePromise;
    }

    return await new Promise<any>((resolve) => {
      obj.clone((cloned: any) => resolve(cloned));
    });
  }, []);

  const duplicateSelection = useCallback(async (): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    const moveOffset = 20;
    const clones: any[] = [];

    if (isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function') {
      const selectedObjects = (activeObject.getObjects() as any[]).filter(Boolean);
      for (const selected of selectedObjects) {
        const cloned = await cloneFabricObject(selected);
        cloned.set({
          left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
          top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
        });
        fabricCanvas.add(cloned);
        clones.push(cloned);
      }
    } else {
      const cloned = await cloneFabricObject(activeObject);
      cloned.set({
        left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
        top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
      });
      fabricCanvas.add(cloned);
      clones.push(cloned);
    }

    if (clones.length === 0) return false;

    if (clones.length === 1) {
      fabricCanvas.setActiveObject(clones[0]);
    } else {
      const nextSelection = new ActiveSelection(clones, { canvas: fabricCanvas });
      fabricCanvas.setActiveObject(nextSelection);
    }

    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [cloneFabricObject, saveHistory]);

  const moveSelectionOrder = useCallback((action: MoveOrderAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    const selectedObjects = isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function'
      ? (activeObject.getObjects() as any[]).filter(Boolean)
      : [activeObject];
    if (selectedObjects.length === 0) return false;

    const stack = fabricCanvas.getObjects();
    const withIndices = selectedObjects
      .map((obj) => ({ obj, index: stack.indexOf(obj) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index);
    if (withIndices.length === 0) return false;

    if (action === 'forward') {
      for (const entry of [...withIndices].reverse()) {
        fabricCanvas.bringObjectForward(entry.obj, false);
      }
    } else if (action === 'backward') {
      for (const entry of withIndices) {
        fabricCanvas.sendObjectBackwards(entry.obj, false);
      }
    } else if (action === 'front') {
      for (const entry of withIndices) {
        fabricCanvas.bringObjectToFront(entry.obj);
      }
    } else {
      for (const entry of [...withIndices].reverse()) {
        fabricCanvas.sendObjectToBack(entry.obj);
      }
    }

    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [saveHistory]);

  const flipSelection = useCallback((axis: SelectionFlipAxis): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const centerX = selectionSnapshot.bounds.left + selectionSnapshot.bounds.width / 2;
    const centerY = selectionSnapshot.bounds.top + selectionSnapshot.bounds.height / 2;
    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectedObjects = selectionSnapshot.selectedObjects.filter(Boolean);
    if (selectedObjects.length === 0) {
      return false;
    }

    if (isActiveSelectionObject(activeObject)) {
      fabricCanvas.discardActiveObject();
    }

    let changed = false;
    for (const obj of selectedObjects) {
      if (typeof obj?.getCenterPoint !== 'function') {
        continue;
      }

      const currentCenter = obj.getCenterPoint();
      const nextCenter = new Point(
        axis === 'horizontal' ? centerX * 2 - currentCenter.x : currentCenter.x,
        axis === 'vertical' ? centerY * 2 - currentCenter.y : currentCenter.y,
      );
      const nextAngle = normalizeDegrees(-((typeof obj.angle === 'number' ? obj.angle : 0)));
      const currentFlipX = obj.flipX === true;
      const currentFlipY = obj.flipY === true;

      obj.set({
        angle: nextAngle,
        flipX: axis === 'horizontal' ? !currentFlipX : currentFlipX,
        flipY: axis === 'vertical' ? !currentFlipY : currentFlipY,
      });
      if (typeof obj.setPositionByOrigin === 'function') {
        obj.setPositionByOrigin(nextCenter, 'center', 'center');
      } else {
        obj.set({
          left: nextCenter.x,
          top: nextCenter.y,
          originX: 'center',
          originY: 'center',
        });
      }
      obj.setCoords?.();
      changed = true;
    }

    if (!changed) {
      return false;
    }

    restoreCanvasSelection(selectedObjects);
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [getSelectionBoundsSnapshot, restoreCanvasSelection, saveHistory, syncSelectionState]);

  const rotateSelection = useCallback((): boolean => {
    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const centerX = selectionSnapshot.bounds.left + selectionSnapshot.bounds.width / 2;
    const centerY = selectionSnapshot.bounds.top + selectionSnapshot.bounds.height / 2;
    const transform = util.createRotateMatrix({ angle: 90 }, { x: centerX, y: centerY });
    return applySelectionTransform(transform);
  }, [applySelectionTransform, getSelectionBoundsSnapshot]);

  const alignSelection = useCallback((action: AlignAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const { selectionObject, selectedObjects, bounds } = selectionSnapshot;
    const minLeft = bounds.left;
    const minTop = bounds.top;
    const groupWidth = bounds.width;
    const groupHeight = bounds.height;

    let targetLeft = minLeft;
    let targetTop = minTop;
    if (action === 'left') {
      targetLeft = 0;
    } else if (action === 'center-x') {
      targetLeft = (CANVAS_SIZE - groupWidth) / 2;
    } else if (action === 'right') {
      targetLeft = CANVAS_SIZE - groupWidth;
    }

    if (action === 'top') {
      targetTop = 0;
    } else if (action === 'center-y') {
      targetTop = (CANVAS_SIZE - groupHeight) / 2;
    } else if (action === 'bottom') {
      targetTop = CANVAS_SIZE - groupHeight;
    }

    const dx = targetLeft - minLeft;
    const dy = targetTop - minTop;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return false;
    }

    for (const obj of selectedObjects) {
      obj.set({
        left: (typeof obj.left === 'number' ? obj.left : 0) + dx,
        top: (typeof obj.top === 'number' ? obj.top : 0) + dy,
      });
      obj.setCoords?.();
    }

    if (selectionObject.setCoords) {
      selectionObject.setCoords();
    }
    fabricCanvas.requestRenderAll();
    saveHistory();
    syncSelectionState();
    return true;
  }, [getSelectionBoundsSnapshot, saveHistory, syncSelectionState]);

  const isTextEditing = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return false;
    const activeObject = fabricCanvas.getActiveObject() as any;
    return !!activeObject && isTextObject(activeObject) && !!(activeObject as any).isEditing;
  }, []);

  const loadCostume = useCallback(async (sessionKey: string, costume: Costume) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const requestId = ++loadRequestIdRef.current;
    loadedSessionKeyRef.current = null;

    const requestedMode: CostumeEditorMode = costume.editorMode === 'bitmap' ? 'bitmap' : 'vector';
    const hasValidVectorDocument =
      requestedMode === 'vector' &&
      costume.vectorDocument?.version === 1 &&
      typeof costume.vectorDocument.fabricJson === 'string';

    if (hasValidVectorDocument) {
      let loadedVector = false;
      try {
        const parsed = JSON.parse(costume.vectorDocument!.fabricJson);
        suppressHistoryRef.current = true;
        fabricCanvas.clear();
        await fabricCanvas.loadFromJSON(parsed);
        normalizeCanvasVectorStrokeUniform();
        if (!isLoadRequestActive(requestId)) return;
        fabricCanvas.requestRenderAll();
        setEditorMode('vector');
        loadedVector = true;
      } catch (error) {
        console.warn('Invalid vector document. Falling back to bitmap mode.', error);
      } finally {
        suppressHistoryRef.current = false;
      }

      if (!loadedVector) {
        const loaded = await loadBitmapLayer(costume.assetId, false, requestId);
        if (!loaded || !isLoadRequestActive(requestId)) return;
        setEditorMode('bitmap');
      }
    } else if (requestedMode === 'vector') {
      const loadedBitmap = await loadBitmapLayer(costume.assetId, false, requestId);
      if (!loadedBitmap || !isLoadRequestActive(requestId)) return;
      const rasterizedCanvas = fabricCanvas.toCanvasElement(1);
      const loadedVector = await loadBitmapAsSingleVectorImage(rasterizedCanvas, requestId);
      if (!loadedVector || !isLoadRequestActive(requestId)) return;
      setEditorMode('vector');
    } else {
      const loaded = await loadBitmapLayer(costume.assetId, false, requestId);
      if (!loaded || !isLoadRequestActive(requestId)) return;
      setEditorMode('bitmap');
    }

    if (!isLoadRequestActive(requestId)) return;
    loadedSessionKeyRef.current = sessionKey;
    historyRef.current = [];
    historyIndexRef.current = -1;
    saveHistory();
    markCurrentSnapshotPersisted(sessionKey);
  }, [isLoadRequestActive, loadBitmapAsSingleVectorImage, loadBitmapLayer, markCurrentSnapshotPersisted, normalizeCanvasVectorStrokeUniform, saveHistory, setEditorMode]);

  const restoreOriginalControls = useCallback((obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    const original = originalControlsRef.current.get(obj);
    if (original) {
      obj.controls = original;
      originalControlsRef.current.delete(obj);
    }
    if (typeof obj.setCoords === 'function') {
      obj.setCoords();
    }
  }, []);

  const restoreAllOriginalControls = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    fabricCanvas.forEachObject((obj: any) => restoreOriginalControls(obj));
  }, [restoreOriginalControls]);

  const toCanvasPoint = useCallback((obj: any, x: number, y: number) => {
    const matrix = typeof obj?.calcTransformMatrix === 'function' ? obj.calcTransformMatrix() : null;
    if (!matrix) return new Point(x, y);
    return new Point(x, y).transform(matrix);
  }, []);

  const isNearlyEqual = useCallback((a: number, b: number) => Math.abs(a - b) <= 0.0001, []);

  const getPathCommands = useCallback((pathObj: any) => {
    if (!pathObj || !Array.isArray(pathObj.path)) return [] as any[];
    return pathObj.path as any[];
  }, []);

  const getCommandType = useCallback((command: any): string => {
    if (!Array.isArray(command) || typeof command[0] !== 'string') return '';
    return command[0].toUpperCase();
  }, []);

  const getCommandEndpoint = useCallback((command: any): Point | null => {
    if (!Array.isArray(command) || command.length < 3) return null;
    const x = Number(command[command.length - 2]);
    const y = Number(command[command.length - 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return new Point(x, y);
  }, []);

  const getLastDrawableCommandIndex = useCallback((pathObj: any): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commands.length - 1; i >= 0; i -= 1) {
      if (getCommandType(commands[i]) !== 'Z') {
        return i;
      }
    }
    return -1;
  }, [getCommandType, getPathCommands]);

  const isClosedPath = useCallback((pathObj: any): boolean => {
    const commands = getPathCommands(pathObj);
    if (commands.length === 0) return false;
    if (commands.some((command) => getCommandType(command) === 'Z')) return true;
    const start = getCommandEndpoint(commands[0]);
    const lastIndex = getLastDrawableCommandIndex(pathObj);
    const end = lastIndex >= 0 ? getCommandEndpoint(commands[lastIndex]) : null;
    if (!start || !end) return false;
    return isNearlyEqual(start.x, end.x) && isNearlyEqual(start.y, end.y);
  }, [getCommandEndpoint, getCommandType, getLastDrawableCommandIndex, getPathCommands, isNearlyEqual]);

  const normalizeAnchorIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    if (anchorIndex <= 0) return 0;
    const commands = getPathCommands(pathObj);
    if (!commands[anchorIndex]) return anchorIndex;
    const closed = isClosedPath(pathObj);
    if (!closed) return anchorIndex;
    const lastDrawable = getLastDrawableCommandIndex(pathObj);
    if (anchorIndex !== lastDrawable) return anchorIndex;
    const start = getCommandEndpoint(commands[0]);
    const end = getCommandEndpoint(commands[anchorIndex]);
    if (!start || !end) return anchorIndex;
    if (isNearlyEqual(start.x, end.x) && isNearlyEqual(start.y, end.y)) {
      return 0;
    }
    return anchorIndex;
  }, [getCommandEndpoint, getLastDrawableCommandIndex, getPathCommands, isClosedPath, isNearlyEqual]);

  const getPathNodeHandleTypes = useCallback((pathObj: any): Record<string, VectorPathNodeHandleType> => {
    const raw = pathObj?.nodeHandleTypes;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, VectorPathNodeHandleType> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === 'linear' || value === 'corner' || value === 'smooth' || value === 'symmetric') {
        out[key] = value;
      }
    }
    return out;
  }, []);

  const setPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number, type: VectorPathNodeHandleType) => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const next = getPathNodeHandleTypes(pathObj);
    next[String(normalized)] = type;
    pathObj.set?.('nodeHandleTypes', next);
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const getPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number): VectorPathNodeHandleType | null => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const map = getPathNodeHandleTypes(pathObj);
    return map[String(normalized)] ?? null;
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const findPreviousDrawableCommandIndex = useCallback((pathObj: any, commandIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commandIndex - 1; i >= 0; i -= 1) {
      if (getCommandType(commands[i]) !== 'Z') return i;
    }
    if (isClosedPath(pathObj)) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        if (getCommandType(commands[i]) !== 'Z') return i;
      }
    }
    return 0;
  }, [getCommandType, getPathCommands, isClosedPath]);

  const findNextDrawableCommandIndex = useCallback((pathObj: any, commandIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commandIndex + 1; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'Z') return i;
    }
    if (isClosedPath(pathObj)) {
      for (let i = 0; i < commands.length; i += 1) {
        if (getCommandType(commands[i]) !== 'Z') return i;
      }
    }
    return commandIndex;
  }, [getCommandType, getPathCommands, isClosedPath]);

  const getAnchorPointForIndex = useCallback((pathObj: any, anchorIndex: number): Point | null => {
    const commands = getPathCommands(pathObj);
    if (!commands[anchorIndex]) return null;
    return getCommandEndpoint(commands[anchorIndex]);
  }, [getCommandEndpoint, getPathCommands]);

  const findIncomingCubicCommandIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    const commands = getPathCommands(pathObj);
    let found = -1;
    for (let i = 0; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'C') continue;
      const normalized = normalizeAnchorIndex(pathObj, i);
      if (normalized === anchorIndex) {
        found = i;
      }
    }
    return found;
  }, [getCommandType, getPathCommands, normalizeAnchorIndex]);

  const findOutgoingCubicCommandIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = 0; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'C') continue;
      const previousIndex = findPreviousDrawableCommandIndex(pathObj, i);
      const normalizedPrevious = normalizeAnchorIndex(pathObj, previousIndex);
      if (normalizedPrevious === anchorIndex) {
        return i;
      }
    }
    return -1;
  }, [findPreviousDrawableCommandIndex, getCommandType, getPathCommands, normalizeAnchorIndex]);

  const parsePathControlKey = useCallback((key: string): { commandIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null => {
    const cp1 = /^c_(\d+)_C_CP_1$/i.exec(key);
    if (cp1) {
      return { commandIndex: Number(cp1[1]), changed: 'outgoing' };
    }
    const cp2 = /^c_(\d+)_C_CP_2$/i.exec(key);
    if (cp2) {
      return { commandIndex: Number(cp2[1]), changed: 'incoming' };
    }
    const anchor = /^c_(\d+)_/i.exec(key);
    if (anchor) {
      return { commandIndex: Number(anchor[1]), changed: 'anchor' };
    }
    return null;
  }, []);

  const resolveAnchorFromPathControlKey = useCallback((pathObj: any, key: string): { anchorIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null => {
    const parsed = parsePathControlKey(key);
    if (!parsed) return null;
    if (parsed.changed === 'incoming' || parsed.changed === 'anchor') {
      return {
        anchorIndex: normalizeAnchorIndex(pathObj, parsed.commandIndex),
        changed: parsed.changed,
      };
    }
    const previousIndex = findPreviousDrawableCommandIndex(pathObj, parsed.commandIndex);
    return {
      anchorIndex: normalizeAnchorIndex(pathObj, previousIndex),
      changed: 'outgoing',
    };
  }, [findPreviousDrawableCommandIndex, normalizeAnchorIndex, parsePathControlKey]);

  const isPointSelectionToggleModifierPressed = useCallback((eventData: any) => {
    const source = eventData?.e ?? eventData;
    return !!(source?.shiftKey || source?.metaKey || source?.ctrlKey);
  }, []);

  const getSelectedPathAnchorIndices = useCallback((pathObj: any): number[] => {
    if (!pathObj || pathObj !== vectorPointEditingTargetRef.current) {
      return [];
    }

    return Array.from(
      new Set(
        selectedPathAnchorIndicesRef.current
          .map((anchorIndex) => normalizeAnchorIndex(pathObj, anchorIndex))
          .filter((anchorIndex) => Number.isFinite(anchorIndex)),
      ),
    ).sort((a, b) => a - b);
  }, [normalizeAnchorIndex]);

  const getSelectablePathAnchorIndices = useCallback((pathObj: any): number[] => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return [];

    const commands = getPathCommands(pathObj);
    const seen = new Set<number>();
    const anchorIndices: number[] = [];
    commands.forEach((command, commandIndex) => {
      if (getCommandType(command) === 'Z') return;
      if (!getCommandEndpoint(command)) return;
      const normalizedAnchorIndex = normalizeAnchorIndex(pathObj, commandIndex);
      if (seen.has(normalizedAnchorIndex)) return;
      seen.add(normalizedAnchorIndex);
      anchorIndices.push(normalizedAnchorIndex);
    });

    return anchorIndices.sort((a, b) => a - b);
  }, [getCommandEndpoint, getCommandType, getPathCommands, normalizeAnchorIndex]);

  const getSceneRectFromPoints = useCallback((startPoint: Point, endPoint: Point) => {
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const right = Math.max(startPoint.x, endPoint.x);
    const bottom = Math.max(startPoint.y, endPoint.y);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }, []);

  const getPointSelectionKey = useCallback((anchorIndices: number[]) => (
    anchorIndices.join(',')
  ), []);

  const getPointSelectionTransformAxes = useCallback((rotationRadians: number) => {
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    return {
      x: new Point(cos, sin),
      y: new Point(-sin, cos),
    };
  }, []);

  const toPointSelectionTransformLocalPoint = useCallback((
    bounds: PointSelectionTransformBounds,
    point: Point,
  ) => {
    const axes = getPointSelectionTransformAxes(bounds.rotationRadians);
    const dx = point.x - bounds.center.x;
    const dy = point.y - bounds.center.y;
    return new Point(
      dx * axes.x.x + dy * axes.x.y,
      dx * axes.y.x + dy * axes.y.y,
    );
  }, [getPointSelectionTransformAxes]);

  const toPointSelectionTransformScenePoint = useCallback((
    bounds: PointSelectionTransformBounds,
    point: Point,
  ) => {
    const axes = getPointSelectionTransformAxes(bounds.rotationRadians);
    return new Point(
      bounds.center.x + axes.x.x * point.x + axes.y.x * point.y,
      bounds.center.y + axes.x.y * point.x + axes.y.y * point.y,
    );
  }, [getPointSelectionTransformAxes]);

  const createPointSelectionTransformBounds = useCallback((
    points: Point[],
    rotationRadians: number,
  ): PointSelectionTransformBounds | null => {
    if (points.length < 2) {
      return null;
    }

    const normalizedRotation = normalizeRadians(rotationRadians);
    const axes = getPointSelectionTransformAxes(normalizedRotation);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      const projectionX = point.x * axes.x.x + point.y * axes.x.y;
      const projectionY = point.x * axes.y.x + point.y * axes.y.y;
      minX = Math.min(minX, projectionX);
      maxX = Math.max(maxX, projectionX);
      minY = Math.min(minY, projectionY);
      maxY = Math.max(maxY, projectionY);
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const center = new Point(
      axes.x.x * ((minX + maxX) / 2) + axes.y.x * ((minY + maxY) / 2),
      axes.x.y * ((minX + maxX) / 2) + axes.y.y * ((minY + maxY) / 2),
    );

    return {
      center,
      width,
      height,
      rotationRadians: normalizedRotation,
      topLeft: new Point(
        center.x - axes.x.x * halfWidth - axes.y.x * halfHeight,
        center.y - axes.x.y * halfWidth - axes.y.y * halfHeight,
      ),
      topRight: new Point(
        center.x + axes.x.x * halfWidth - axes.y.x * halfHeight,
        center.y + axes.x.y * halfWidth - axes.y.y * halfHeight,
      ),
      bottomRight: new Point(
        center.x + axes.x.x * halfWidth + axes.y.x * halfHeight,
        center.y + axes.x.y * halfWidth + axes.y.y * halfHeight,
      ),
      bottomLeft: new Point(
        center.x - axes.x.x * halfWidth + axes.y.x * halfHeight,
        center.y - axes.x.y * halfWidth + axes.y.y * halfHeight,
      ),
    };
  }, [getPointSelectionTransformAxes]);

  const hasPointSelectionMarqueeExceededThreshold = useCallback((session: PointSelectionMarqueeSession) => {
    const threshold = getZoomInvariantMetric(VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX);
    return Math.hypot(
      session.currentPointerScene.x - session.startPointerScene.x,
      session.currentPointerScene.y - session.startPointerScene.y,
    ) >= threshold;
  }, [getZoomInvariantMetric]);

  const syncVectorHandleModeFromSelection = useCallback(() => {
    const activeAnchor = activePathAnchorRef.current;
    if (!activeAnchor || getFabricObjectType(activeAnchor.path) !== 'path') return;
    const selectedAnchorIndices = getSelectedPathAnchorIndices(activeAnchor.path);
    const targetAnchorIndices = selectedAnchorIndices.length > 0
      ? selectedAnchorIndices
      : [activeAnchor.anchorIndex];

    const handleModes = new Set<VectorHandleMode>();
    for (const anchorIndex of targetAnchorIndices) {
      handleModes.add(pathNodeHandleTypeToVectorHandleMode(
        getPathNodeHandleType(activeAnchor.path, anchorIndex) ?? 'linear',
      ));
    }

    const syncedMode = handleModes.size > 1
      ? 'multiple'
      : Array.from(handleModes)[0] ?? 'linear';
    pendingSelectionSyncedVectorHandleModeRef.current = syncedMode;
    onVectorHandleModeSyncRef.current?.(syncedMode);
  }, [getPathNodeHandleType, getSelectedPathAnchorIndices]);

  const syncPathControlPointVisibility = useCallback((pathObj: any) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path' || !pathObj.controls) return;

    const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
    for (const [key, control] of Object.entries(pathObj.controls as Record<string, Control>)) {
      const resolved = resolveAnchorFromPathControlKey(pathObj, key);
      if (!resolved) continue;

      const isControlPoint = resolved.changed === 'incoming' || resolved.changed === 'outgoing';
      let visible = true;
      if (isControlPoint) {
        const handleType = getPathNodeHandleType(pathObj, resolved.anchorIndex) ?? 'linear';
        const isCurvedHandleType = handleType === 'smooth' || handleType === 'symmetric' || handleType === 'corner';
        const commandIndex = resolved.changed === 'incoming'
          ? findIncomingCubicCommandIndex(pathObj, resolved.anchorIndex)
          : findOutgoingCubicCommandIndex(pathObj, resolved.anchorIndex);
        visible = selectedAnchors.has(resolved.anchorIndex) && isCurvedHandleType && commandIndex >= 0;
      }

      if (typeof pathObj.setControlVisible === 'function') {
        pathObj.setControlVisible(key, visible);
      } else {
        (control as any).visible = visible;
      }
    }
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    resolveAnchorFromPathControlKey,
  ]);

  const syncPathAnchorSelectionAppearance = useCallback((pathObj: any) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path' || !pathObj.controls) return;

    const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
    for (const [key, control] of Object.entries(pathObj.controls as Record<string, Control>)) {
      const resolved = resolveAnchorFromPathControlKey(pathObj, key);
      if (!resolved || resolved.changed !== 'anchor') continue;

      const isSelected = selectedAnchors.has(resolved.anchorIndex);
      (control as any).controlFill = isSelected ? '#0ea5e9' : '#ffffff';
      (control as any).controlStroke = isSelected ? '#ffffff' : '#0ea5e9';
    }
  }, [getSelectedPathAnchorIndices, resolveAnchorFromPathControlKey]);

  const setSelectedPathAnchors = useCallback((
    pathObj: any,
    anchorIndices: number[],
    options: { primaryAnchorIndex?: number | null } = {},
  ) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return;

    const normalized = Array.from(
      new Set(
        anchorIndices
          .map((anchorIndex) => normalizeAnchorIndex(pathObj, anchorIndex))
          .filter((anchorIndex) => Number.isFinite(anchorIndex)),
      ),
    ).sort((a, b) => a - b);

    const selectionKey = getPointSelectionKey(normalized);
    const currentTransformFrame = pointSelectionTransformFrameRef.current;
    if (normalized.length < 2) {
      pointSelectionTransformFrameRef.current = null;
    } else if (
      !currentTransformFrame ||
      currentTransformFrame.path !== pathObj ||
      currentTransformFrame.selectionKey !== selectionKey
    ) {
      pointSelectionTransformFrameRef.current = {
        path: pathObj,
        selectionKey,
        rotationRadians: 0,
      };
    }

    selectedPathAnchorIndicesRef.current = normalized;
    if (normalized.length === 0) {
      activePathAnchorRef.current = null;
      pendingSelectionSyncedVectorHandleModeRef.current = null;
    } else {
      const requestedPrimary = options.primaryAnchorIndex == null
        ? null
        : normalizeAnchorIndex(pathObj, options.primaryAnchorIndex);
      const currentActiveAnchor = activePathAnchorRef.current;
      const preservedPrimary = currentActiveAnchor &&
        currentActiveAnchor.path === pathObj &&
        normalized.includes(currentActiveAnchor.anchorIndex)
        ? currentActiveAnchor.anchorIndex
        : null;
      const primaryAnchorIndex = requestedPrimary != null && normalized.includes(requestedPrimary)
        ? requestedPrimary
        : preservedPrimary ?? normalized[normalized.length - 1];
      activePathAnchorRef.current = { path: pathObj, anchorIndex: primaryAnchorIndex };
    }

    syncPathAnchorSelectionAppearance(pathObj);
    syncPathControlPointVisibility(pathObj);
    if (normalized.length > 0) {
      syncVectorHandleModeFromSelection();
    }
    onVectorPointSelectionChangeRef.current?.(normalized.length > 0);
    pathObj.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
  }, [getPointSelectionKey, normalizeAnchorIndex, syncPathAnchorSelectionAppearance, syncPathControlPointVisibility, syncVectorHandleModeFromSelection]);

  const clearSelectedPathAnchors = useCallback((pathObj?: any) => {
    selectedPathAnchorIndicesRef.current = [];
    activePathAnchorRef.current = null;
    pointSelectionTransformFrameRef.current = null;
    pendingSelectionSyncedVectorHandleModeRef.current = null;
    onVectorPointSelectionChangeRef.current?.(false);
    if (pathObj && getFabricObjectType(pathObj) === 'path') {
      syncPathAnchorSelectionAppearance(pathObj);
      syncPathControlPointVisibility(pathObj);
      pathObj.setCoords?.();
    }
    fabricCanvasRef.current?.requestRenderAll();
  }, [syncPathAnchorSelectionAppearance, syncPathControlPointVisibility]);

  const removeDuplicateClosedPathAnchorControl = useCallback((pathObj: any, controls: Record<string, Control>) => {
    if (!isClosedPath(pathObj)) return;
    const commands = getPathCommands(pathObj);
    if (commands.length === 0) return;
    const lastDrawable = getLastDrawableCommandIndex(pathObj);
    if (lastDrawable <= 0) return;

    const start = getCommandEndpoint(commands[0]);
    const end = getCommandEndpoint(commands[lastDrawable]);
    if (!start || !end) return;
    if (!isNearlyEqual(start.x, end.x) || !isNearlyEqual(start.y, end.y)) return;

    const commandType = getCommandType(commands[lastDrawable]);
    if (!commandType) return;
    delete controls[`c_${lastDrawable}_${commandType}`];
  }, [
    getCommandEndpoint,
    getCommandType,
    getLastDrawableCommandIndex,
    getPathCommands,
    isClosedPath,
    isNearlyEqual,
  ]);

  const clonePoint = useCallback((point: Point | null): Point | null => {
    if (!point) return null;
    return new Point(point.x, point.y);
  }, []);

  const lerpPoint = useCallback((a: Point, b: Point, t: number) => (
    new Point(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
    )
  ), []);

  const distanceSqBetweenPoints = useCallback((a: Point, b: Point) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }, []);

  const getScenePointFromOwnPlanePoint = useCallback((obj: any, point: Point): Point | null => {
    if (!obj || !point || typeof obj.calcOwnMatrix !== 'function') return null;
    return point.transform(obj.calcOwnMatrix());
  }, []);

  const invertOwnPlanePoint = useCallback((obj: any, point: Point): Point | null => {
    if (!obj || !point || typeof obj.calcOwnMatrix !== 'function') return null;
    const [a, b, c, d, e, f] = obj.calcOwnMatrix() as [number, number, number, number, number, number];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) <= 0.0000001) return null;
    const nextX = point.x - e;
    const nextY = point.y - f;
    return new Point(
      (d * nextX - c * nextY) / determinant,
      (-b * nextX + a * nextY) / determinant,
    );
  }, []);

  const toPathScenePoint = useCallback((pathObj: any, point: Point): Point | null => {
    if (!pathObj?.pathOffset) return null;
    return getScenePointFromOwnPlanePoint(
      pathObj,
      new Point(point.x - pathObj.pathOffset.x, point.y - pathObj.pathOffset.y),
    );
  }, [getScenePointFromOwnPlanePoint]);

  const toPathCommandPoint = useCallback((pathObj: any, scenePoint: Point): Point | null => {
    if (!pathObj?.pathOffset) return null;
    const ownPlanePoint = invertOwnPlanePoint(pathObj, scenePoint);
    if (!ownPlanePoint) return null;
    return ownPlanePoint.add(pathObj.pathOffset);
  }, [invertOwnPlanePoint]);

  const findClosestPointOnLineSegment = useCallback((point: Point, start: Point, end: Point) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.0000001) {
      return { t: 0, point: new Point(start.x, start.y), distanceSq: distanceSqBetweenPoints(point, start) };
    }
    const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
    const t = Math.max(0, Math.min(1, rawT));
    const nearest = lerpPoint(start, end, t);
    return { t, point: nearest, distanceSq: distanceSqBetweenPoints(point, nearest) };
  }, [distanceSqBetweenPoints, lerpPoint]);

  const evaluateQuadraticPoint = useCallback((p0: Point, p1: Point, p2: Point, t: number) => {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    return lerpPoint(a, b, t);
  }, [lerpPoint]);

  const evaluateCubicPoint = useCallback((p0: Point, p1: Point, p2: Point, p3: Point, t: number) => {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    const c = lerpPoint(p2, p3, t);
    const d = lerpPoint(a, b, t);
    const e = lerpPoint(b, c, t);
    return lerpPoint(d, e, t);
  }, [lerpPoint]);

  const findClosestCurveSample = useCallback((
    point: Point,
    evaluate: (t: number) => Point,
  ) => {
    const coarseSteps = 24;
    let bestT = 0;
    let bestPoint = evaluate(0);
    let bestDistanceSq = distanceSqBetweenPoints(point, bestPoint);

    for (let index = 1; index <= coarseSteps; index += 1) {
      const t = index / coarseSteps;
      const candidate = evaluate(t);
      const candidateDistanceSq = distanceSqBetweenPoints(point, candidate);
      if (candidateDistanceSq < bestDistanceSq) {
        bestT = t;
        bestPoint = candidate;
        bestDistanceSq = candidateDistanceSq;
      }
    }

    let minT = Math.max(0, bestT - 1 / coarseSteps);
    let maxT = Math.min(1, bestT + 1 / coarseSteps);
    for (let refinement = 0; refinement < 5; refinement += 1) {
      const refineSteps = 12;
      for (let index = 0; index <= refineSteps; index += 1) {
        const t = minT + ((maxT - minT) * index) / refineSteps;
        const candidate = evaluate(t);
        const candidateDistanceSq = distanceSqBetweenPoints(point, candidate);
        if (candidateDistanceSq < bestDistanceSq) {
          bestT = t;
          bestPoint = candidate;
          bestDistanceSq = candidateDistanceSq;
        }
      }
      const nextSpan = (maxT - minT) / refineSteps;
      minT = Math.max(0, bestT - nextSpan);
      maxT = Math.min(1, bestT + nextSpan);
    }

    return { t: bestT, point: bestPoint, distanceSq: bestDistanceSq };
  }, [distanceSqBetweenPoints]);

  const toParentPlanePoint = useCallback((pathObj: any, point: Point): Point | null => {
    if (!pathObj || !point || !pathObj.pathOffset || typeof pathObj.calcOwnMatrix !== 'function') return null;
    return new Point(point.x - pathObj.pathOffset.x, point.y - pathObj.pathOffset.y).transform(pathObj.calcOwnMatrix());
  }, []);

  const getPathSegments = useCallback((pathObj: any) => {
    const commands = getPathCommands(pathObj);
    const segments: Array<{
      commandIndex: number;
      type: 'L' | 'Q' | 'C' | 'Z';
      start: Point;
      end: Point;
      control1?: Point;
      control2?: Point;
    }> = [];

    if (commands.length === 0) return segments;

    let subpathStart = getCommandEndpoint(commands[0]);
    let previousPoint = subpathStart;
    for (let commandIndex = 1; commandIndex < commands.length; commandIndex += 1) {
      const command = commands[commandIndex];
      const type = getCommandType(command);
      if (type === 'M') {
        subpathStart = getCommandEndpoint(command);
        previousPoint = subpathStart;
        continue;
      }
      if (!previousPoint) continue;
      if (type === 'L') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({ commandIndex, type: 'L', start: previousPoint, end });
        previousPoint = end;
        continue;
      }
      if (type === 'Q') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({
          commandIndex,
          type: 'Q',
          start: previousPoint,
          control1: new Point(Number(command[1]), Number(command[2])),
          end,
        });
        previousPoint = end;
        continue;
      }
      if (type === 'C') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({
          commandIndex,
          type: 'C',
          start: previousPoint,
          control1: new Point(Number(command[1]), Number(command[2])),
          control2: new Point(Number(command[3]), Number(command[4])),
          end,
        });
        previousPoint = end;
        continue;
      }
      if (type === 'Z' && subpathStart) {
        segments.push({
          commandIndex,
          type: 'Z',
          start: previousPoint,
          end: subpathStart,
        });
        previousPoint = subpathStart;
      }
    }

    return segments;
  }, [getCommandEndpoint, getCommandType, getPathCommands]);

  const buildShiftedPathNodeHandleTypes = useCallback((
    pathObj: any,
    fromIndex: number,
    delta: number,
  ) => {
    const next: Record<string, VectorPathNodeHandleType> = {};
    for (const [key, value] of Object.entries(getPathNodeHandleTypes(pathObj))) {
      const numericKey = Number(key);
      if (!Number.isFinite(numericKey)) continue;
      next[String(numericKey >= fromIndex ? numericKey + delta : numericKey)] = value;
    }
    return next;
  }, [getPathNodeHandleTypes]);

  const buildLinearCubicSegmentCommand = useCallback((start: Point, end: Point) => {
    const control1 = lerpPoint(start, end, 1 / 3);
    const control2 = lerpPoint(start, end, 2 / 3);
    return ['C', control1.x, control1.y, control2.x, control2.y, end.x, end.y] as const;
  }, [lerpPoint]);

  const insertPathPointAtScenePosition = useCallback((pathObj: any, scenePoint: Point): number | null => {
    const commands = getPathCommands(pathObj);
    if (commands.length < 2) return null;

    const sceneScale = Math.max(0.0001, BASE_VIEW_SCALE * zoomRef.current);
    const hitRadius = VECTOR_POINT_INSERTION_HIT_RADIUS_PX / sceneScale;
    const endpointClearance = VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX / sceneScale;
    const hitRadiusSq = hitRadius * hitRadius;
    const endpointClearanceSq = endpointClearance * endpointClearance;

    let bestCandidate: {
      commandIndex: number;
      type: 'L' | 'Q' | 'C' | 'Z';
      t: number;
      scenePoint: Point;
      distanceSq: number;
      start: Point;
      end: Point;
      control1?: Point;
      control2?: Point;
    } | null = null;

    for (const segment of getPathSegments(pathObj)) {
      const startScene = toPathScenePoint(pathObj, segment.start);
      const endScene = toPathScenePoint(pathObj, segment.end);
      if (!startScene || !endScene) continue;

      let candidate: { t: number; point: Point; distanceSq: number } | null = null;
      if (segment.type === 'L' || segment.type === 'Z') {
        candidate = findClosestPointOnLineSegment(scenePoint, startScene, endScene);
      } else if (segment.type === 'Q' && segment.control1) {
        const controlScene = toPathScenePoint(pathObj, segment.control1);
        if (!controlScene) continue;
        candidate = findClosestCurveSample(
          scenePoint,
          (t) => evaluateQuadraticPoint(startScene, controlScene, endScene, t),
        );
      } else if (segment.type === 'C' && segment.control1 && segment.control2) {
        const control1Scene = toPathScenePoint(pathObj, segment.control1);
        const control2Scene = toPathScenePoint(pathObj, segment.control2);
        if (!control1Scene || !control2Scene) continue;
        candidate = findClosestCurveSample(
          scenePoint,
          (t) => evaluateCubicPoint(startScene, control1Scene, control2Scene, endScene, t),
        );
      }

      if (!candidate) continue;
      if (candidate.distanceSq > hitRadiusSq) continue;
      if (candidate.t <= 0.001 || candidate.t >= 0.999) continue;
      if (
        distanceSqBetweenPoints(candidate.point, startScene) <= endpointClearanceSq ||
        distanceSqBetweenPoints(candidate.point, endScene) <= endpointClearanceSq
      ) {
        continue;
      }
      if (!bestCandidate || candidate.distanceSq < bestCandidate.distanceSq) {
        bestCandidate = {
          commandIndex: segment.commandIndex,
          type: segment.type,
          t: candidate.t,
          scenePoint: candidate.point,
          distanceSq: candidate.distanceSq,
          start: segment.start,
          end: segment.end,
          control1: segment.control1,
          control2: segment.control2,
        };
      }
    }

    if (!bestCandidate) return null;

    const insertedCommandPoint = toPathCommandPoint(pathObj, bestCandidate.scenePoint);
    if (!insertedCommandPoint) return null;

    const nextCommands = commands.map((command) => (Array.isArray(command) ? [...command] : command));
    const insertIndex = bestCandidate.commandIndex;
    if (bestCandidate.type === 'L') {
      nextCommands[insertIndex] = [...buildLinearCubicSegmentCommand(bestCandidate.start, insertedCommandPoint)];
      nextCommands.splice(insertIndex + 1, 0, [...buildLinearCubicSegmentCommand(insertedCommandPoint, bestCandidate.end)]);
    } else if (bestCandidate.type === 'Z') {
      nextCommands.splice(
        insertIndex,
        1,
        [...buildLinearCubicSegmentCommand(bestCandidate.start, insertedCommandPoint)],
        [...buildLinearCubicSegmentCommand(insertedCommandPoint, bestCandidate.end)],
        ['Z'],
      );
    } else if (bestCandidate.type === 'Q' && bestCandidate.control1) {
      const firstControl = lerpPoint(bestCandidate.start, bestCandidate.control1, bestCandidate.t);
      const secondControl = lerpPoint(bestCandidate.control1, bestCandidate.end, bestCandidate.t);
      const insertedPoint = lerpPoint(firstControl, secondControl, bestCandidate.t);
      nextCommands[insertIndex] = ['Q', firstControl.x, firstControl.y, insertedPoint.x, insertedPoint.y];
      nextCommands.splice(insertIndex + 1, 0, ['Q', secondControl.x, secondControl.y, bestCandidate.end.x, bestCandidate.end.y]);
    } else if (bestCandidate.type === 'C' && bestCandidate.control1 && bestCandidate.control2) {
      const p01 = lerpPoint(bestCandidate.start, bestCandidate.control1, bestCandidate.t);
      const p12 = lerpPoint(bestCandidate.control1, bestCandidate.control2, bestCandidate.t);
      const p23 = lerpPoint(bestCandidate.control2, bestCandidate.end, bestCandidate.t);
      const p012 = lerpPoint(p01, p12, bestCandidate.t);
      const p123 = lerpPoint(p12, p23, bestCandidate.t);
      const insertedPoint = lerpPoint(p012, p123, bestCandidate.t);
      nextCommands[insertIndex] = ['C', p01.x, p01.y, p012.x, p012.y, insertedPoint.x, insertedPoint.y];
      nextCommands.splice(insertIndex + 1, 0, ['C', p123.x, p123.y, p23.x, p23.y, bestCandidate.end.x, bestCandidate.end.y]);
    } else {
      return null;
    }

    const centerPoint = typeof pathObj.getCenterPoint === 'function'
      ? pathObj.getCenterPoint()
      : null;
    const nextHandleTypes = buildShiftedPathNodeHandleTypes(pathObj, insertIndex, 1);
    nextHandleTypes[String(insertIndex)] = 'smooth';

    pathObj.set?.({
      path: nextCommands,
      nodeHandleTypes: nextHandleTypes,
    });
    pathObj.setDimensions?.();
    if (centerPoint && typeof pathObj.setPositionByOrigin === 'function') {
      pathObj.setPositionByOrigin(centerPoint, 'center', 'center');
    }
    pathObj.set('dirty', true);
    pathObj.setCoords?.();
    activePathAnchorRef.current = { path: pathObj, anchorIndex: insertIndex };
    return insertIndex;
  }, [
    buildLinearCubicSegmentCommand,
    buildShiftedPathNodeHandleTypes,
    distanceSqBetweenPoints,
    evaluateCubicPoint,
    evaluateQuadraticPoint,
    findClosestCurveSample,
    findClosestPointOnLineSegment,
    getPathCommands,
    getPathSegments,
    lerpPoint,
    toPathCommandPoint,
    toPathScenePoint,
  ]);

  const stabilizePathAfterAnchorMutation = useCallback((pathObj: any, anchorPoint: Point) => {
    const anchorBefore = toParentPlanePoint(pathObj, anchorPoint);
    pathObj.setDimensions();
    const anchorAfter = toParentPlanePoint(pathObj, anchorPoint);
    if (anchorBefore && anchorAfter) {
      const diffX = anchorAfter.x - anchorBefore.x;
      const diffY = anchorAfter.y - anchorBefore.y;
      if (Math.abs(diffX) > 0.0001) {
        pathObj.left -= diffX;
      }
      if (Math.abs(diffY) > 0.0001) {
        pathObj.top -= diffY;
      }
    }
    pathObj.set('dirty', true);
    pathObj.setCoords();
  }, [toParentPlanePoint]);

  const movePathAnchorByDelta = useCallback((
    pathObj: any,
    anchorIndex: number,
    deltaX: number,
    deltaY: number,
    dragState?: PathAnchorDragState,
  ) => {
    if (Math.abs(deltaX) <= 0.0001 && Math.abs(deltaY) <= 0.0001) {
      return false;
    }

    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const commands = getPathCommands(pathObj);
    const anchorCommand = commands[normalizedAnchor];
    if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) return false;

    const currentAnchor = getAnchorPointForIndex(pathObj, normalizedAnchor);
    const nextAnchor = dragState?.previousAnchor
      ? new Point(
        dragState.previousAnchor.x + deltaX,
        dragState.previousAnchor.y + deltaY,
      )
      : currentAnchor
        ? new Point(currentAnchor.x + deltaX, currentAnchor.y + deltaY)
        : null;
    if (!nextAnchor) return false;

    anchorCommand[anchorCommand.length - 2] = nextAnchor.x;
    anchorCommand[anchorCommand.length - 1] = nextAnchor.y;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      const incomingBase = dragState?.previousIncoming ?? new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
      incomingCommand[3] = incomingBase.x + deltaX;
      incomingCommand[4] = incomingBase.y + deltaY;
    }

    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      const outgoingBase = dragState?.previousOutgoing ?? new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
      outgoingCommand[1] = outgoingBase.x + deltaX;
      outgoingCommand[2] = outgoingBase.y + deltaY;
    }

    pathObj.set('dirty', true);
    return true;
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
  ]);

  const enforcePathAnchorHandleType = useCallback((
    pathObj: any,
    anchorIndex: number,
    changed: 'anchor' | 'incoming' | 'outgoing' | null,
    dragState?: PathAnchorDragState
  ) => {
    const commands = getPathCommands(pathObj);
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return;

    const handleType = getPathNodeHandleType(pathObj, anchorIndex) ?? 'corner';
    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (changed === 'anchor' && dragState?.previousAnchor) {
      const deltaX = anchorPoint.x - dragState.previousAnchor.x;
      const deltaY = anchorPoint.y - dragState.previousAnchor.y;
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        const baseIncoming = dragState.previousIncoming ?? new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
        incomingCommand[3] = baseIncoming.x + deltaX;
        incomingCommand[4] = baseIncoming.y + deltaY;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        const baseOutgoing = dragState.previousOutgoing ?? new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
        outgoingCommand[1] = baseOutgoing.x + deltaX;
        outgoingCommand[2] = baseOutgoing.y + deltaY;
      }
      if (handleType === 'linear') {
        if (incomingCommand && getCommandType(incomingCommand) === 'C') {
          incomingCommand[3] = anchorPoint.x;
          incomingCommand[4] = anchorPoint.y;
        }
        if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
          outgoingCommand[1] = anchorPoint.x;
          outgoingCommand[2] = anchorPoint.y;
        }
      }
      stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
      return;
    }

    if (handleType === 'corner') return;

    if (handleType === 'linear') {
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        incomingCommand[3] = anchorPoint.x;
        incomingCommand[4] = anchorPoint.y;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        outgoingCommand[1] = anchorPoint.x;
        outgoingCommand[2] = anchorPoint.y;
      }
      stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
      return;
    }

    if (!incomingCommand && !outgoingCommand) {
      return;
    }

    const incomingVec = incomingCommand && getCommandType(incomingCommand) === 'C'
      ? {
          x: Number(incomingCommand[3]) - anchorPoint.x,
          y: Number(incomingCommand[4]) - anchorPoint.y,
        }
      : null;
    const outgoingVec = outgoingCommand && getCommandType(outgoingCommand) === 'C'
      ? {
          x: Number(outgoingCommand[1]) - anchorPoint.x,
          y: Number(outgoingCommand[2]) - anchorPoint.y,
        }
      : null;
    const incomingLength = incomingVec ? Math.hypot(incomingVec.x, incomingVec.y) : 0;
    const outgoingLength = outgoingVec ? Math.hypot(outgoingVec.x, outgoingVec.y) : 0;
    const previousAnchorIndex = findPreviousDrawableCommandIndex(pathObj, normalizedAnchor);
    const nextAnchorIndex = findNextDrawableCommandIndex(pathObj, normalizedAnchor);
    const previousAnchorPoint = previousAnchorIndex !== normalizedAnchor
      ? getAnchorPointForIndex(pathObj, previousAnchorIndex)
      : null;
    const nextAnchorPoint = nextAnchorIndex !== normalizedAnchor
      ? getAnchorPointForIndex(pathObj, nextAnchorIndex)
      : null;
    const previousSegmentVec = previousAnchorPoint
      ? {
          x: previousAnchorPoint.x - anchorPoint.x,
          y: previousAnchorPoint.y - anchorPoint.y,
        }
      : null;
    const nextSegmentVec = nextAnchorPoint
      ? {
          x: nextAnchorPoint.x - anchorPoint.x,
          y: nextAnchorPoint.y - anchorPoint.y,
        }
      : null;
    const previousSegmentLength = previousSegmentVec
      ? Math.hypot(previousSegmentVec.x, previousSegmentVec.y)
      : 0;
    const nextSegmentLength = nextSegmentVec
      ? Math.hypot(nextSegmentVec.x, nextSegmentVec.y)
      : 0;

    let baseDirX = 1;
    let baseDirY = 0;
    if (changed === 'incoming' && incomingLength > 0.0001) {
      baseDirX = incomingVec!.x / incomingLength;
      baseDirY = incomingVec!.y / incomingLength;
    } else if (changed === 'outgoing' && outgoingLength > 0.0001) {
      baseDirX = -outgoingVec!.x / outgoingLength;
      baseDirY = -outgoingVec!.y / outgoingLength;
    } else if (incomingLength > 0.0001) {
      baseDirX = incomingVec!.x / incomingLength;
      baseDirY = incomingVec!.y / incomingLength;
    } else if (outgoingLength > 0.0001) {
      baseDirX = -outgoingVec!.x / outgoingLength;
      baseDirY = -outgoingVec!.y / outgoingLength;
    } else if (previousSegmentLength > 0.0001 && nextSegmentLength > 0.0001) {
      const previousDirX = previousSegmentVec!.x / previousSegmentLength;
      const previousDirY = previousSegmentVec!.y / previousSegmentLength;
      const nextDirX = nextSegmentVec!.x / nextSegmentLength;
      const nextDirY = nextSegmentVec!.y / nextSegmentLength;
      const bisectorX = previousDirX - nextDirX;
      const bisectorY = previousDirY - nextDirY;
      const bisectorLength = Math.hypot(bisectorX, bisectorY);
      if (bisectorLength > 0.0001) {
        baseDirX = bisectorX / bisectorLength;
        baseDirY = bisectorY / bisectorLength;
      } else {
        baseDirX = previousDirX;
        baseDirY = previousDirY;
      }
    } else if (previousSegmentLength > 0.0001) {
      baseDirX = previousSegmentVec!.x / previousSegmentLength;
      baseDirY = previousSegmentVec!.y / previousSegmentLength;
    } else if (nextSegmentLength > 0.0001) {
      baseDirX = -nextSegmentVec!.x / nextSegmentLength;
      baseDirY = -nextSegmentVec!.y / nextSegmentLength;
    }

    let nextIncomingLength = incomingLength;
    let nextOutgoingLength = outgoingLength;
    if (nextIncomingLength <= 0.0001 && previousSegmentLength > 0.0001) {
      nextIncomingLength = previousSegmentLength / 3;
    }
    if (nextOutgoingLength <= 0.0001 && nextSegmentLength > 0.0001) {
      nextOutgoingLength = nextSegmentLength / 3;
    }
    if (handleType === 'symmetric') {
      if (changed === 'incoming') {
        nextOutgoingLength = incomingLength;
      } else if (changed === 'outgoing') {
        nextIncomingLength = outgoingLength;
      } else {
        const maxLength = Math.max(incomingLength, outgoingLength);
        nextIncomingLength = maxLength;
        nextOutgoingLength = maxLength;
      }
    } else {
      if (nextIncomingLength <= 0.0001 && nextOutgoingLength > 0.0001) {
        nextIncomingLength = nextOutgoingLength;
      }
      if (nextOutgoingLength <= 0.0001 && nextIncomingLength > 0.0001) {
        nextOutgoingLength = nextIncomingLength;
      }
    }

    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      incomingCommand[3] = anchorPoint.x + baseDirX * nextIncomingLength;
      incomingCommand[4] = anchorPoint.y + baseDirY * nextIncomingLength;
    }
    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      outgoingCommand[1] = anchorPoint.x - baseDirX * nextOutgoingLength;
      outgoingCommand[2] = anchorPoint.y - baseDirY * nextOutgoingLength;
    }

    stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
  }, [
    findNextDrawableCommandIndex,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    findPreviousDrawableCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    getPathNodeHandleType,
    normalizeAnchorIndex,
    stabilizePathAfterAnchorMutation,
  ]);

  const getPathAnchorDragState = useCallback((pathObj: any, anchorIndex: number): PathAnchorDragState | null => {
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return null;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const commands = getPathCommands(pathObj);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    return {
      previousAnchor: new Point(anchorPoint.x, anchorPoint.y),
      previousIncoming: incomingCommand && getCommandType(incomingCommand) === 'C'
        ? clonePoint(new Point(Number(incomingCommand[3]), Number(incomingCommand[4])))
        : null,
      previousOutgoing: outgoingCommand && getCommandType(outgoingCommand) === 'C'
        ? clonePoint(new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2])))
        : null,
    };
  }, [
    clonePoint,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
  ]);

  const getSelectedPathAnchorTransformSnapshot = useCallback((pathObj: any): PointSelectionTransformSnapshot | null => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return null;

    const selectedAnchorIndices = getSelectedPathAnchorIndices(pathObj);
    if (selectedAnchorIndices.length < 2) return null;
    const selectionKey = getPointSelectionKey(selectedAnchorIndices);

    const commands = getPathCommands(pathObj);
    const anchors: SelectedPathAnchorTransformSnapshot[] = [];
    for (const anchorIndex of selectedAnchorIndices) {
      const anchorPoint = getAnchorPointForIndex(pathObj, anchorIndex);
      const anchorScene = anchorPoint ? toPathScenePoint(pathObj, anchorPoint) : null;
      if (!anchorPoint || !anchorScene) continue;

      const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, anchorIndex);
      const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, anchorIndex);
      const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
      const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;
      const incomingScene = incomingCommand && getCommandType(incomingCommand) === 'C'
        ? toPathScenePoint(pathObj, new Point(Number(incomingCommand[3]), Number(incomingCommand[4])))
        : null;
      const outgoingScene = outgoingCommand && getCommandType(outgoingCommand) === 'C'
        ? toPathScenePoint(pathObj, new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2])))
        : null;

      anchors.push({
        anchorIndex,
        anchorScene,
        incomingScene,
        outgoingScene,
      });
    }

    if (anchors.length < 2) return null;

    const preservedFrame = pointSelectionTransformFrameRef.current;
    const preservedRotation = preservedFrame &&
      preservedFrame.path === pathObj &&
      preservedFrame.selectionKey === selectionKey
      ? preservedFrame.rotationRadians
      : 0;
    const bounds = createPointSelectionTransformBounds(
      anchors.map((anchor) => anchor.anchorScene),
      preservedRotation,
    );
    if (!bounds) {
      return null;
    }

    return {
      path: pathObj,
      selectionKey,
      anchors,
      bounds,
    };
  }, [
    createPointSelectionTransformBounds,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPointSelectionKey,
    getPathCommands,
    getSelectedPathAnchorIndices,
    toPathScenePoint,
  ]);

  const getPointSelectionTransformHandlePoints = useCallback((bounds: PointSelectionTransformBounds) => {
    const rotateOffset = getZoomInvariantMetric(VECTOR_POINT_SELECTION_ROTATE_OFFSET);
    const halfHeight = bounds.height / 2;
    return {
      topCenter: toPointSelectionTransformScenePoint(bounds, new Point(0, -halfHeight)),
      rotate: toPointSelectionTransformScenePoint(bounds, new Point(0, -halfHeight - rotateOffset)),
      scaleTl: bounds.topLeft,
      scaleTr: bounds.topRight,
      scaleBr: bounds.bottomRight,
      scaleBl: bounds.bottomLeft,
    };
  }, [getZoomInvariantMetric, toPointSelectionTransformScenePoint]);

  const hitPointSelectionTransform = useCallback((
    snapshot: PointSelectionTransformSnapshot,
    pointerScene: Point,
  ): PointSelectionTransformMode | null => {
    const handleHalfSize = getZoomInvariantMetric(VECTOR_POINT_SELECTION_HANDLE_SIZE) / 2;
    const hitPadding = getZoomInvariantMetric(VECTOR_POINT_SELECTION_HIT_PADDING);
    const handlePoints = getPointSelectionTransformHandlePoints(snapshot.bounds);

    const isInsideHandle = (point: Point) => (
      Math.abs(pointerScene.x - point.x) <= handleHalfSize &&
      Math.abs(pointerScene.y - point.y) <= handleHalfSize
    );

    if (isInsideHandle(handlePoints.rotate)) return 'rotate';
    if (isInsideHandle(handlePoints.scaleTl)) return 'scale-tl';
    if (isInsideHandle(handlePoints.scaleTr)) return 'scale-tr';
    if (isInsideHandle(handlePoints.scaleBr)) return 'scale-br';
    if (isInsideHandle(handlePoints.scaleBl)) return 'scale-bl';

    const pointerLocal = toPointSelectionTransformLocalPoint(snapshot.bounds, pointerScene);
    if (
      Math.abs(pointerLocal.x) <= snapshot.bounds.width / 2 + hitPadding &&
      Math.abs(pointerLocal.y) <= snapshot.bounds.height / 2 + hitPadding
    ) {
      return 'move';
    }

    return null;
  }, [getPointSelectionTransformHandlePoints, getZoomInvariantMetric, toPointSelectionTransformLocalPoint]);

  const rotateScenePointAround = useCallback((point: Point, center: Point, angleRadians: number) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    return new Point(
      center.x + dx * cos - dy * sin,
      center.y + dx * sin + dy * cos,
    );
  }, []);

  const transformPointSelectionScenePoint = useCallback((
    point: Point,
    session: PointSelectionTransformSession,
    pointerScene: Point,
  ): Point => {
    const { bounds } = session.snapshot;
    if (session.mode === 'move') {
      return new Point(
        point.x + (pointerScene.x - session.startPointerScene.x),
        point.y + (pointerScene.y - session.startPointerScene.y),
      );
    }

    if (session.mode === 'rotate') {
      const startAngle = Math.atan2(
        session.startPointerScene.y - bounds.center.y,
        session.startPointerScene.x - bounds.center.x,
      );
      const nextAngle = Math.atan2(
        pointerScene.y - bounds.center.y,
        pointerScene.x - bounds.center.x,
      );
      return rotateScenePointAround(point, bounds.center, nextAngle - startAngle);
    }

    const minimumSize = getZoomInvariantMetric(VECTOR_POINT_SELECTION_MIN_SIZE);
    const baseWidth = Math.max(bounds.width, minimumSize);
    const baseHeight = Math.max(bounds.height, minimumSize);
    const pointLocal = toPointSelectionTransformLocalPoint(bounds, point);
    const pointerLocal = toPointSelectionTransformLocalPoint(bounds, pointerScene);

    let fixedPointLocal = new Point(-bounds.width / 2, -bounds.height / 2);
    let scaleX = 1;
    let scaleY = 1;
    if (session.mode === 'scale-tl') {
      fixedPointLocal = new Point(bounds.width / 2, bounds.height / 2);
      scaleX = Math.max(minimumSize, fixedPointLocal.x - pointerLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, fixedPointLocal.y - pointerLocal.y) / baseHeight;
    } else if (session.mode === 'scale-tr') {
      fixedPointLocal = new Point(-bounds.width / 2, bounds.height / 2);
      scaleX = Math.max(minimumSize, pointerLocal.x - fixedPointLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, fixedPointLocal.y - pointerLocal.y) / baseHeight;
    } else if (session.mode === 'scale-br') {
      fixedPointLocal = new Point(-bounds.width / 2, -bounds.height / 2);
      scaleX = Math.max(minimumSize, pointerLocal.x - fixedPointLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, pointerLocal.y - fixedPointLocal.y) / baseHeight;
    } else if (session.mode === 'scale-bl') {
      fixedPointLocal = new Point(bounds.width / 2, -bounds.height / 2);
      scaleX = Math.max(minimumSize, fixedPointLocal.x - pointerLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, pointerLocal.y - fixedPointLocal.y) / baseHeight;
    }

    return toPointSelectionTransformScenePoint(
      bounds,
      new Point(
        fixedPointLocal.x + (pointLocal.x - fixedPointLocal.x) * scaleX,
        fixedPointLocal.y + (pointLocal.y - fixedPointLocal.y) * scaleY,
      ),
    );
  }, [
    getZoomInvariantMetric,
    rotateScenePointAround,
    toPointSelectionTransformLocalPoint,
    toPointSelectionTransformScenePoint,
  ]);

  const beginPointSelectionTransformSession = useCallback((
    pathObj: any,
    mode: PointSelectionTransformMode,
    pointerScene: Point,
  ): boolean => {
    const snapshot = getSelectedPathAnchorTransformSnapshot(pathObj);
    if (!snapshot) return false;

    pointSelectionTransformSessionRef.current = {
      path: pathObj,
      mode,
      startPointerScene: new Point(pointerScene.x, pointerScene.y),
      snapshot,
      hasChanged: false,
    };
    return true;
  }, [getSelectedPathAnchorTransformSnapshot]);

  const applyPointSelectionTransformSession = useCallback((
    session: PointSelectionTransformSession,
    pointerScene: Point,
  ): boolean => {
    const { path, snapshot } = session;
    if (!path || getFabricObjectType(path) !== 'path') return false;

    const commands = getPathCommands(path);
    let referenceCommandPoint: Point | null = null;
    let transformedAnyAnchor = false;
    for (const anchorSnapshot of snapshot.anchors) {
      const normalizedAnchorIndex = normalizeAnchorIndex(path, anchorSnapshot.anchorIndex);
      const anchorCommand = commands[normalizedAnchorIndex];
      if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) continue;

      const transformedAnchorScene = transformPointSelectionScenePoint(anchorSnapshot.anchorScene, session, pointerScene);
      const transformedAnchorCommand = toPathCommandPoint(path, transformedAnchorScene);
      if (!transformedAnchorCommand) continue;

      anchorCommand[anchorCommand.length - 2] = transformedAnchorCommand.x;
      anchorCommand[anchorCommand.length - 1] = transformedAnchorCommand.y;
      referenceCommandPoint ??= transformedAnchorCommand;
      transformedAnyAnchor = true;

      const incomingCommandIndex = findIncomingCubicCommandIndex(path, normalizedAnchorIndex);
      if (incomingCommandIndex >= 0 && anchorSnapshot.incomingScene) {
        const incomingCommand = commands[incomingCommandIndex];
        const transformedIncomingScene = transformPointSelectionScenePoint(anchorSnapshot.incomingScene, session, pointerScene);
        const transformedIncomingCommand = toPathCommandPoint(path, transformedIncomingScene);
        if (transformedIncomingCommand && getCommandType(incomingCommand) === 'C') {
          incomingCommand[3] = transformedIncomingCommand.x;
          incomingCommand[4] = transformedIncomingCommand.y;
        }
      }

      const outgoingCommandIndex = findOutgoingCubicCommandIndex(path, normalizedAnchorIndex);
      if (outgoingCommandIndex >= 0 && anchorSnapshot.outgoingScene) {
        const outgoingCommand = commands[outgoingCommandIndex];
        const transformedOutgoingScene = transformPointSelectionScenePoint(anchorSnapshot.outgoingScene, session, pointerScene);
        const transformedOutgoingCommand = toPathCommandPoint(path, transformedOutgoingScene);
        if (transformedOutgoingCommand && getCommandType(outgoingCommand) === 'C') {
          outgoingCommand[1] = transformedOutgoingCommand.x;
          outgoingCommand[2] = transformedOutgoingCommand.y;
        }
      }
    }

    if (!transformedAnyAnchor || !referenceCommandPoint) return false;

    const nextRotation = session.mode === 'rotate'
      ? normalizeRadians(
          snapshot.bounds.rotationRadians +
          (
            Math.atan2(
              pointerScene.y - snapshot.bounds.center.y,
              pointerScene.x - snapshot.bounds.center.x,
            ) -
            Math.atan2(
              session.startPointerScene.y - snapshot.bounds.center.y,
              session.startPointerScene.x - snapshot.bounds.center.x,
            )
          ),
        )
      : snapshot.bounds.rotationRadians;
    pointSelectionTransformFrameRef.current = {
      path,
      selectionKey: snapshot.selectionKey,
      rotationRadians: nextRotation,
    };

    path.set('dirty', true);
    stabilizePathAfterAnchorMutation(path, referenceCommandPoint);
    syncPathAnchorSelectionAppearance(path);
    syncPathControlPointVisibility(path);
    path.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    toPathCommandPoint,
    transformPointSelectionScenePoint,
  ]);

  const applyPointSelectionMarqueeSession = useCallback((session: PointSelectionMarqueeSession) => {
    const { path } = session;
    if (!path || getFabricObjectType(path) !== 'path') return false;

    if (!hasPointSelectionMarqueeExceededThreshold(session)) {
      if (!session.toggleSelection && session.initialSelectedAnchorIndices.length > 0) {
        clearSelectedPathAnchors(path);
        return true;
      }
      return false;
    }

    const marqueeBounds = getSceneRectFromPoints(session.startPointerScene, session.currentPointerScene);
    const hitAnchorIndices = getSelectablePathAnchorIndices(path).filter((anchorIndex) => {
      const anchorPoint = getAnchorPointForIndex(path, anchorIndex);
      const anchorScenePoint = anchorPoint ? toPathScenePoint(path, anchorPoint) : null;
      if (!anchorScenePoint) return false;
      return (
        anchorScenePoint.x >= marqueeBounds.left &&
        anchorScenePoint.x <= marqueeBounds.right &&
        anchorScenePoint.y >= marqueeBounds.top &&
        anchorScenePoint.y <= marqueeBounds.bottom
      );
    });

    let nextSelectedAnchorIndices = hitAnchorIndices;
    if (session.toggleSelection) {
      const nextSelectedAnchorSet = new Set(session.initialSelectedAnchorIndices);
      hitAnchorIndices.forEach((anchorIndex) => {
        if (nextSelectedAnchorSet.has(anchorIndex)) {
          nextSelectedAnchorSet.delete(anchorIndex);
        } else {
          nextSelectedAnchorSet.add(anchorIndex);
        }
      });
      nextSelectedAnchorIndices = Array.from(nextSelectedAnchorSet).sort((a, b) => a - b);
    }

    const primaryAnchorIndex = nextSelectedAnchorIndices.length > 0
      ? nextSelectedAnchorIndices[nextSelectedAnchorIndices.length - 1]
      : null;
    setSelectedPathAnchors(path, nextSelectedAnchorIndices, {
      primaryAnchorIndex,
    });
    return true;
  }, [
    clearSelectedPathAnchors,
    getAnchorPointForIndex,
    getSceneRectFromPoints,
    getSelectablePathAnchorIndices,
    hasPointSelectionMarqueeExceededThreshold,
    setSelectedPathAnchors,
    toPathScenePoint,
  ]);

  const createFourPointEllipsePathData = useCallback((obj: any): string | null => {
    const rx = Math.max(1, typeof obj.rx === 'number' ? obj.rx : ((obj.width || 1) / 2));
    const ry = Math.max(1, typeof obj.ry === 'number' ? obj.ry : ((obj.height || 1) / 2));
    const kx = rx * CIRCLE_CUBIC_KAPPA;
    const ky = ry * CIRCLE_CUBIC_KAPPA;
    const p0 = toCanvasPoint(obj, rx, 0);
    const p1 = toCanvasPoint(obj, 0, ry);
    const p2 = toCanvasPoint(obj, -rx, 0);
    const p3 = toCanvasPoint(obj, 0, -ry);
    const c01a = toCanvasPoint(obj, rx, ky);
    const c01b = toCanvasPoint(obj, kx, ry);
    const c12a = toCanvasPoint(obj, -kx, ry);
    const c12b = toCanvasPoint(obj, -rx, ky);
    const c23a = toCanvasPoint(obj, -rx, -ky);
    const c23b = toCanvasPoint(obj, -kx, -ry);
    const c30a = toCanvasPoint(obj, kx, -ry);
    const c30b = toCanvasPoint(obj, rx, -ky);
    const r = (value: number) => Math.round(value * 1000) / 1000;
    return [
      `M ${r(p0.x)} ${r(p0.y)}`,
      `C ${r(c01a.x)} ${r(c01a.y)} ${r(c01b.x)} ${r(c01b.y)} ${r(p1.x)} ${r(p1.y)}`,
      `C ${r(c12a.x)} ${r(c12a.y)} ${r(c12b.x)} ${r(c12b.y)} ${r(p2.x)} ${r(p2.y)}`,
      `C ${r(c23a.x)} ${r(c23a.y)} ${r(c23b.x)} ${r(c23b.y)} ${r(p3.x)} ${r(p3.y)}`,
      `C ${r(c30a.x)} ${r(c30a.y)} ${r(c30b.x)} ${r(c30b.y)} ${r(p0.x)} ${r(p0.y)}`,
      'Z',
    ].join(' ');
  }, [toCanvasPoint]);

  const buildPathDataFromPoints = useCallback((points: Point[], closed: boolean): string => {
    if (points.length === 0) return '';
    const rounded = (value: number) => Math.round(value * 1000) / 1000;
    const commands = points.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${rounded(pt.x)} ${rounded(pt.y)}`);
    if (closed) {
      commands.push('Z');
    }
    return commands.join(' ');
  }, []);

  const sampleObjectOutlinePoints = useCallback((obj: any): { points: Point[]; closed: boolean } | null => {
    const type = getFabricObjectType(obj);
    if (!type) return null;

    if (type === 'line' && typeof obj.calcLinePoints === 'function') {
      const linePoints = obj.calcLinePoints() as { x1: number; y1: number; x2: number; y2: number };
      return {
        points: [
          toCanvasPoint(obj, linePoints.x1, linePoints.y1),
          toCanvasPoint(obj, linePoints.x2, linePoints.y2),
        ],
        closed: false,
      };
    }

    if ((type === 'polygon' || type === 'polyline') && Array.isArray(obj.points)) {
      const pathOffset = obj.pathOffset ?? { x: 0, y: 0 };
      return {
        points: obj.points.map((point: { x: number; y: number }) => (
          toCanvasPoint(obj, point.x - pathOffset.x, point.y - pathOffset.y)
        )),
        closed: type === 'polygon',
      };
    }

    if (typeof obj.getCoords === 'function') {
      const coords = obj.getCoords() as Array<{ x: number; y: number }> | undefined;
      if (Array.isArray(coords) && coords.length >= 2) {
        return {
          points: coords.map((coord) => new Point(coord.x, coord.y)),
          closed: coords.length >= 3,
        };
      }
    }

    return null;
  }, [toCanvasPoint]);

  const convertObjectToVectorPath = useCallback((obj: any): any | null => {
    if (!obj || !isVectorPointSelectableObject(obj)) return null;
    if (isDirectlyEditablePathObject(obj)) return obj;

    const type = getFabricObjectType(obj);
    let pathData = '';
    let shouldFill = false;
    let initialNodeHandleTypes: Record<string, VectorPathNodeHandleType> = {};
    if (type === 'ellipse' || type === 'circle') {
      pathData = createFourPointEllipsePathData(obj) ?? '';
      shouldFill = true;
      initialNodeHandleTypes = {
        '0': 'symmetric',
        '1': 'symmetric',
        '2': 'symmetric',
        '3': 'symmetric',
      };
    } else {
      const sampled = sampleObjectOutlinePoints(obj);
      if (!sampled || sampled.points.length < 2) return null;
      pathData = buildPathDataFromPoints(sampled.points, sampled.closed);
      shouldFill = sampled.closed;
      if (sampled.closed) {
        for (let i = 0; i < sampled.points.length; i += 1) {
          initialNodeHandleTypes[String(i)] = 'corner';
        }
      } else {
        initialNodeHandleTypes = { '0': 'linear', '1': 'linear' };
      }
    }
    if (!pathData) return null;

    const fillColor = getVectorObjectFillColor(obj) ?? (typeof obj.fill === 'string' ? obj.fill : '#000000');
    const fillTextureId = getVectorObjectFillTextureId(obj);
    const strokeColor = getVectorObjectStrokeColor(obj) ?? fillColor;
    const strokeBrushId = getVectorObjectStrokeBrushId(obj);
    const path = new Path(pathData, {
      fill: shouldFill ? getFabricFillValueForVectorTexture(fillTextureId, fillColor) : null,
      stroke: getFabricStrokeValueForVectorBrush(strokeBrushId, strokeColor),
      strokeWidth: typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
      strokeUniform: true,
      noScaleCache: false,
      strokeLineCap: obj.strokeLineCap,
      strokeLineJoin: obj.strokeLineJoin,
      strokeMiterLimit: obj.strokeMiterLimit,
      strokeDashArray: Array.isArray(obj.strokeDashArray) ? [...obj.strokeDashArray] : null,
      opacity: typeof obj.opacity === 'number' ? obj.opacity : 1,
      globalCompositeOperation: obj.globalCompositeOperation ?? 'source-over',
      fillRule: obj.fillRule,
      paintFirst: obj.paintFirst,
      shadow: obj.shadow ?? null,
      nodeHandleTypes: initialNodeHandleTypes,
      vectorFillTextureId: shouldFill ? fillTextureId : undefined,
      vectorFillColor: shouldFill ? fillColor : undefined,
      vectorStrokeBrushId: strokeBrushId,
      vectorStrokeColor: strokeColor,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
    } as any);
    path.setCoords();
    return path;
  }, [buildPathDataFromPoints, createFourPointEllipsePathData, sampleObjectOutlinePoints]);

  const ensurePathLikeObjectForVectorTool = useCallback((obj: any): any | null => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !obj || !isVectorPointSelectableObject(obj)) return null;
    if (isDirectlyEditablePathObject(obj)) return obj;

    const converted = convertObjectToVectorPath(obj);
    if (!converted) return null;
    if (converted === obj) return obj;

    restoreOriginalControls(obj);
    const stack = fabricCanvas.getObjects();
    const originalObject = obj as any;
    const index = stack.indexOf(originalObject);
    fabricCanvas.remove(originalObject);
    if (index >= 0) {
      fabricCanvas.insertAt(index, converted);
    } else {
      fabricCanvas.add(converted);
    }
    converted.setCoords();
    return converted;
  }, [convertObjectToVectorPath, restoreOriginalControls]);

  const applyVectorPointEditingAppearance = useCallback((obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    obj.hasControls = true;
    obj.hasBorders = false;
    obj.borderColor = VECTOR_SELECTION_COLOR;
    obj.cornerStyle = 'circle';
    obj.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
    obj.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
    obj.cornerSize = getZoomInvariantMetric(HANDLE_SIZE);
    obj.transparentCorners = false;
    obj.padding = 0;
    obj.lockMovementX = true;
    obj.lockMovementY = true;
    obj.lockRotation = true;
    obj.lockScalingX = true;
    obj.lockScalingY = true;
  }, [getZoomInvariantMetric]);

  const traceVectorPointEditingGuidePath = useCallback((ctx: CanvasRenderingContext2D, target: any): boolean => {
    const type = getFabricObjectType(target);
    if (type === 'path' && Array.isArray(target.path)) {
      const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
      const toTransformedPoint = (x: number, y: number) => (
        toCanvasPoint(target, x - pathOffset.x, y - pathOffset.y)
      );
      ctx.beginPath();
      for (const command of target.path as any[]) {
        if (!Array.isArray(command) || typeof command[0] !== 'string') continue;
        switch (command[0].toUpperCase()) {
          case 'M': {
            const point = toTransformedPoint(Number(command[1]), Number(command[2]));
            ctx.moveTo(point.x, point.y);
            break;
          }
          case 'L': {
            const point = toTransformedPoint(Number(command[1]), Number(command[2]));
            ctx.lineTo(point.x, point.y);
            break;
          }
          case 'C': {
            const control1 = toTransformedPoint(Number(command[1]), Number(command[2]));
            const control2 = toTransformedPoint(Number(command[3]), Number(command[4]));
            const point = toTransformedPoint(Number(command[5]), Number(command[6]));
            ctx.bezierCurveTo(
              control1.x,
              control1.y,
              control2.x,
              control2.y,
              point.x,
              point.y,
            );
            break;
          }
          case 'Q': {
            const control = toTransformedPoint(Number(command[1]), Number(command[2]));
            const point = toTransformedPoint(Number(command[3]), Number(command[4]));
            ctx.quadraticCurveTo(
              control.x,
              control.y,
              point.x,
              point.y,
            );
            break;
          }
          case 'Z':
            ctx.closePath();
            break;
        }
      }
      return true;
    }

    if (type !== 'polyline' && type !== 'polygon') {
      return false;
    }

    const points = Array.isArray(target.points) ? target.points : null;
    if (!points || points.length === 0) {
      return false;
    }

    const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
    ctx.beginPath();
    points.forEach((point: { x: number; y: number }, index: number) => {
      const canvasPoint = toCanvasPoint(target, point.x - pathOffset.x, point.y - pathOffset.y);
      const x = canvasPoint.x;
      const y = canvasPoint.y;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (type === 'polygon') {
      ctx.closePath();
    }

    return true;
  }, [toCanvasPoint]);

  const renderVectorPointHandleGuides = useCallback((ctx: CanvasRenderingContext2D, target: any) => {
    if (getFabricObjectType(target) !== 'path' || !Array.isArray(target.path)) return;

    const selectedAnchors = getSelectedPathAnchorIndices(target);
    if (selectedAnchors.length === 0) return;

    const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
    const toTransformedPoint = (point: Point) => (
      toCanvasPoint(target, point.x - pathOffset.x, point.y - pathOffset.y)
    );

    ctx.save();
    try {
      ctx.strokeStyle = VECTOR_POINT_HANDLE_GUIDE_STROKE;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      for (const anchorIndex of selectedAnchors) {
        const handleType = getPathNodeHandleType(target, anchorIndex) ?? 'linear';
        const isCurvedHandleType = handleType === 'smooth' || handleType === 'symmetric' || handleType === 'corner';
        if (!isCurvedHandleType) continue;

        const anchorPoint = getAnchorPointForIndex(target, anchorIndex);
        if (!anchorPoint) continue;
        const anchorCanvasPoint = toTransformedPoint(anchorPoint);

        const incomingCommandIndex = findIncomingCubicCommandIndex(target, anchorIndex);
        if (incomingCommandIndex >= 0) {
          const incomingCommand = target.path[incomingCommandIndex];
          if (getCommandType(incomingCommand) === 'C') {
            const incomingPoint = new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
            const incomingCanvasPoint = toTransformedPoint(incomingPoint);
            ctx.beginPath();
            ctx.moveTo(anchorCanvasPoint.x, anchorCanvasPoint.y);
            ctx.lineTo(incomingCanvasPoint.x, incomingCanvasPoint.y);
            ctx.stroke();
          }
        }

        const outgoingCommandIndex = findOutgoingCubicCommandIndex(target, anchorIndex);
        if (outgoingCommandIndex >= 0) {
          const outgoingCommand = target.path[outgoingCommandIndex];
          if (getCommandType(outgoingCommand) === 'C') {
            const outgoingPoint = new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
            const outgoingCanvasPoint = toTransformedPoint(outgoingPoint);
            ctx.beginPath();
            ctx.moveTo(anchorCanvasPoint.x, anchorCanvasPoint.y);
            ctx.lineTo(outgoingCanvasPoint.x, outgoingCanvasPoint.y);
            ctx.stroke();
          }
        }
      }
    } finally {
      ctx.restore();
    }
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    getZoomInvariantMetric,
    toCanvasPoint,
  ]);

  const renderPointSelectionTransformGuides = useCallback((ctx: CanvasRenderingContext2D, target: any) => {
    if (pointSelectionMarqueeSessionRef.current) return;
    const snapshot = getSelectedPathAnchorTransformSnapshot(target);
    if (!snapshot) return;

    const handlePoints = getPointSelectionTransformHandlePoints(snapshot.bounds);
    const handleSize = getZoomInvariantMetric(VECTOR_POINT_SELECTION_HANDLE_SIZE);
    const handleHalfSize = handleSize / 2;

    ctx.save();
    try {
      ctx.fillStyle = VECTOR_POINT_SELECTION_BOX_FILL;
      ctx.strokeStyle = VECTOR_SELECTION_COLOR;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(snapshot.bounds.topLeft.x, snapshot.bounds.topLeft.y);
      ctx.lineTo(snapshot.bounds.topRight.x, snapshot.bounds.topRight.y);
      ctx.lineTo(snapshot.bounds.bottomRight.x, snapshot.bounds.bottomRight.y);
      ctx.lineTo(snapshot.bounds.bottomLeft.x, snapshot.bounds.bottomLeft.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(handlePoints.topCenter.x, handlePoints.topCenter.y);
      ctx.lineTo(handlePoints.rotate.x, handlePoints.rotate.y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      const scaleHandlePoints = [
        handlePoints.scaleTl,
        handlePoints.scaleTr,
        handlePoints.scaleBr,
        handlePoints.scaleBl,
      ];
      for (const point of scaleHandlePoints) {
        ctx.fillRect(point.x - handleHalfSize, point.y - handleHalfSize, handleSize, handleSize);
        ctx.strokeRect(point.x - handleHalfSize, point.y - handleHalfSize, handleSize, handleSize);
      }

      ctx.beginPath();
      ctx.arc(handlePoints.rotate.x, handlePoints.rotate.y, handleHalfSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }, [
    getPointSelectionTransformHandlePoints,
    getSelectedPathAnchorTransformSnapshot,
    getZoomInvariantMetric,
  ]);

  const renderPointSelectionMarquee = useCallback((ctx: CanvasRenderingContext2D) => {
    const session = pointSelectionMarqueeSessionRef.current;
    if (!session) return;
    if (!hasPointSelectionMarqueeExceededThreshold(session)) return;

    const marqueeBounds = getSceneRectFromPoints(session.startPointerScene, session.currentPointerScene);

    ctx.save();
    try {
      ctx.fillStyle = 'rgba(0, 94, 255, 0.08)';
      ctx.strokeStyle = VECTOR_SELECTION_COLOR;
      ctx.lineWidth = getZoomInvariantMetric(2);
      ctx.setLineDash([
        getZoomInvariantMetric(6),
        getZoomInvariantMetric(4),
      ]);
      ctx.fillRect(
        marqueeBounds.left,
        marqueeBounds.top,
        marqueeBounds.width,
        marqueeBounds.height,
      );
      ctx.strokeRect(
        marqueeBounds.left,
        marqueeBounds.top,
        marqueeBounds.width,
        marqueeBounds.height,
      );
      ctx.setLineDash([]);
    } finally {
      ctx.restore();
    }
  }, [getSceneRectFromPoints, getZoomInvariantMetric, hasPointSelectionMarqueeExceededThreshold]);

  const renderVectorPointEditingGuide = useCallback(() => {
    const ctx = vectorGuideCtxRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    const target = vectorPointEditingTargetRef.current as any;
    if (!fabricCanvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (editorModeRef.current !== 'vector') return;
    if (activeToolRef.current === 'pen') {
      renderPenDraftGuide(ctx);
      return;
    }
    if (activeToolRef.current !== 'select') return;
    if (!target || !fabricCanvas.getObjects().includes(target)) return;

    ctx.save();
    try {
      ctx.strokeStyle = VECTOR_POINT_EDIT_GUIDE_STROKE;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_EDIT_GUIDE_STROKE_WIDTH);
      ctx.lineJoin = target.strokeLineJoin ?? 'round';
      ctx.lineCap = target.strokeLineCap ?? 'round';
      ctx.setLineDash([]);

      if (traceVectorPointEditingGuidePath(ctx, target)) {
        ctx.stroke();
      }

      renderVectorPointHandleGuides(ctx, target);
      renderPointSelectionTransformGuides(ctx, target);
      renderPointSelectionMarquee(ctx);
    } finally {
      ctx.restore();
    }

  }, [getZoomInvariantMetric, renderPenDraftGuide, renderPointSelectionMarquee, renderPointSelectionTransformGuides, renderVectorPointHandleGuides, traceVectorPointEditingGuidePath]);

  const applyVectorPointControls = useCallback((obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    if (isImageObject(obj) || isTextObject(obj)) return false;
    if (isActiveSelectionObject(obj)) return false;
    const type = getFabricObjectType(obj);

    if (!originalControlsRef.current.has(obj)) {
      originalControlsRef.current.set(obj, obj.controls);
    }

    if (type === 'path') {
      const controls = controlsUtils.createPathControls(obj, {
        ...VECTOR_POINT_CONTROL_STYLE,
        pointStyle: {
          controlFill: '#ffffff',
          controlStroke: '#0ea5e9',
        },
        controlPointStyle: {
          controlFill: '#0ea5e9',
          controlStroke: '#ffffff',
        },
      });
      removeDuplicateClosedPathAnchorControl(obj, controls);
      for (const [key, control] of Object.entries(controls)) {
        const originalMouseDownHandler = control.mouseDownHandler;
        control.mouseDownHandler = ((eventData: any, transform: any, x: number, y: number) => {
          const pathObj = transform?.target;
          if (pathObj && getFabricObjectType(pathObj) === 'path') {
            const resolved = resolveAnchorFromPathControlKey(pathObj, key);
            if (resolved) {
              const selectionToggle = isPointSelectionToggleModifierPressed(eventData);
              const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
              if (selectionToggle) {
                if (selectedAnchors.has(resolved.anchorIndex)) {
                  selectedAnchors.delete(resolved.anchorIndex);
                } else {
                  selectedAnchors.add(resolved.anchorIndex);
                }
                setSelectedPathAnchors(pathObj, Array.from(selectedAnchors), {
                  primaryAnchorIndex: selectedAnchors.has(resolved.anchorIndex) ? resolved.anchorIndex : null,
                });
                return false;
              }

              if (!selectedAnchors.has(resolved.anchorIndex) || selectedAnchors.size <= 1) {
                setSelectedPathAnchors(pathObj, [resolved.anchorIndex], {
                  primaryAnchorIndex: resolved.anchorIndex,
                });
              } else {
                setSelectedPathAnchors(pathObj, Array.from(selectedAnchors), {
                  primaryAnchorIndex: resolved.anchorIndex,
                });
              }
              const existingType = getPathNodeHandleType(pathObj, resolved.anchorIndex);
              if (!existingType) {
                setPathNodeHandleType(
                  pathObj,
                  resolved.anchorIndex,
                  vectorHandleModeToPathNodeHandleType(getEditableVectorHandleMode(vectorHandleModeRef.current)),
                );
              }
              syncVectorHandleModeFromSelection();
            }
          }
          if (typeof originalMouseDownHandler === 'function') {
            return originalMouseDownHandler.call(control, eventData, transform, x, y);
          }
          return false;
        }) as any;

        const originalActionHandler = control.actionHandler;
        if (typeof originalActionHandler !== 'function') continue;
        control.actionHandler = ((eventData: any, transform: any, x: number, y: number) => {
          const pathObjBefore = transform?.target;
          const resolvedBefore = pathObjBefore && getFabricObjectType(pathObjBefore) === 'path'
            ? resolveAnchorFromPathControlKey(pathObjBefore, key)
            : null;
          const selectedAnchorsBefore = pathObjBefore && resolvedBefore
            ? getSelectedPathAnchorIndices(pathObjBefore)
            : [];

          let dragState: PathAnchorDragState | undefined;
          const groupedDragStates: Array<{ anchorIndex: number; dragState: PathAnchorDragState }> = [];

          if (pathObjBefore && resolvedBefore) {
            dragState = getPathAnchorDragState(pathObjBefore, resolvedBefore.anchorIndex) ?? undefined;

            if (
              resolvedBefore.changed === 'anchor' &&
              selectedAnchorsBefore.includes(resolvedBefore.anchorIndex) &&
              selectedAnchorsBefore.length > 1
            ) {
              for (const selectedAnchorIndex of selectedAnchorsBefore) {
                if (selectedAnchorIndex === resolvedBefore.anchorIndex) continue;

                const groupedDragState = getPathAnchorDragState(pathObjBefore, selectedAnchorIndex);
                if (!groupedDragState) continue;

                groupedDragStates.push({
                  anchorIndex: selectedAnchorIndex,
                  dragState: groupedDragState,
                });
              }
            }
          }

          const performed = originalActionHandler.call(control, eventData, transform, x, y);
          const pathObj = transform?.target;
          if (!pathObj || getFabricObjectType(pathObj) !== 'path') {
            return performed;
          }
          const resolved = resolveAnchorFromPathControlKey(pathObj, key);
          if (resolved) {
            const existingType = getPathNodeHandleType(pathObj, resolved.anchorIndex);
            if (!existingType) {
              setPathNodeHandleType(
                pathObj,
                resolved.anchorIndex,
                vectorHandleModeToPathNodeHandleType(getEditableVectorHandleMode(vectorHandleModeRef.current)),
              );
            }
            activePathAnchorRef.current = { path: pathObj, anchorIndex: resolved.anchorIndex };
            syncVectorHandleModeFromSelection();
            enforcePathAnchorHandleType(pathObj, resolved.anchorIndex, resolved.changed, dragState);
            if (resolved.changed === 'anchor' && dragState && groupedDragStates.length > 0) {
              const anchorAfter = getAnchorPointForIndex(pathObj, resolved.anchorIndex);
              if (anchorAfter) {
                const deltaX = anchorAfter.x - dragState.previousAnchor.x;
                const deltaY = anchorAfter.y - dragState.previousAnchor.y;
                let movedGroupedAnchors = false;
                for (const groupedDragState of groupedDragStates) {
                  movedGroupedAnchors = movePathAnchorByDelta(
                    pathObj,
                    groupedDragState.anchorIndex,
                    deltaX,
                    deltaY,
                    groupedDragState.dragState,
                  ) || movedGroupedAnchors;
                }

                if (movedGroupedAnchors) {
                  stabilizePathAfterAnchorMutation(pathObj, anchorAfter);
                }
              }
            }
          }
          return performed;
        }) as any;
      }
      obj.controls = controls;
      syncPathAnchorSelectionAppearance(obj);
      syncPathControlPointVisibility(obj);
      if (typeof obj.setControlVisible === 'function') {
        for (const key of Object.keys(obj.controls || {})) {
          const control = (obj.controls || {})[key] as any;
          const isVisible = typeof obj.isControlVisible === 'function'
            ? obj.isControlVisible(key)
            : typeof control?.visible === 'boolean'
              ? control.visible
              : true;
          obj.setControlVisible(key, isVisible);
        }
      }
      if (typeof obj.setCoords === 'function') {
        obj.setCoords();
      }
      return true;
    }

    if ((type === 'polyline' || type === 'polygon') && Array.isArray((obj as any).points) && (obj as any).points.length > 1) {
      obj.controls = controlsUtils.createPolyControls(obj, {
        ...VECTOR_POINT_CONTROL_STYLE,
        cursorStyle: 'crosshair',
      });
      if (typeof obj.setControlVisible === 'function') {
        for (const key of Object.keys(obj.controls || {})) {
          obj.setControlVisible(key, true);
        }
      }
      if (typeof obj.setCoords === 'function') {
        obj.setCoords();
      }
      return true;
    }

    restoreOriginalControls(obj);
    return false;
  }, [
    enforcePathAnchorHandleType,
    getAnchorPointForIndex,
    getPathAnchorDragState,
    getSelectedPathAnchorIndices,
    getPathNodeHandleType,
    isPointSelectionToggleModifierPressed,
    movePathAnchorByDelta,
    removeDuplicateClosedPathAnchorControl,
    resolveAnchorFromPathControlKey,
    restoreOriginalControls,
    setSelectedPathAnchors,
    setPathNodeHandleType,
    stabilizePathAfterAnchorMutation,
    syncPathControlPointVisibility,
    syncVectorHandleModeFromSelection,
    syncPathAnchorSelectionAppearance,
  ]);

  const activateVectorPointEditing = useCallback((target: any, saveConversionToHistory: boolean): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'select') return false;

    let activeObject = target ?? fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (!isVectorPointSelectableObject(activeObject)) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
      return false;
    }

    if (!isDirectlyEditablePathObject(activeObject)) {
      const converted = ensurePathLikeObjectForVectorTool(activeObject);
      if (!converted) {
        fabricCanvas.discardActiveObject();
        fabricCanvas.requestRenderAll();
        return false;
      }
      if (converted !== activeObject) {
        activeObject = converted;
        fabricCanvas.setActiveObject(activeObject);
        if (saveConversionToHistory) {
          saveHistory();
        }
      }
    }

    const applied = applyVectorPointControls(activeObject);
    if (!applied) return false;

    fabricCanvas.setActiveObject(activeObject);
    setVectorPointEditingTarget(activeObject);
    applyVectorPointEditingAppearance(activeObject);
    fabricCanvas.requestRenderAll();
    return true;
  }, [applyVectorPointControls, applyVectorPointEditingAppearance, ensurePathLikeObjectForVectorTool, saveHistory, setVectorPointEditingTarget]);

  const configureCanvasForTool = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;
    const pointEditingTarget = vectorPointEditingTargetRef.current;

    if (pointEditingTarget && !fabricCanvas.getObjects().includes(pointEditingTarget)) {
      setVectorPointEditingTarget(null);
    }
    if (vectorPointEditingTargetRef.current && (mode !== 'vector' || tool !== 'select')) {
      restoreAllOriginalControls();
      setVectorPointEditingTarget(null);
    }

    if (mode === 'vector') {
      normalizeCanvasVectorStrokeUniform();
    }

    const isBitmapBrush = mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    const isVectorPencil = mode === 'vector' && tool === 'brush';
    if (isBitmapBrush) {
      const compositeOperation = getCompositeOperation(tool);
      const brush = bitmapBrushKindRef.current !== 'hard-round'
        ? new BitmapStampBrush(fabricCanvas, {
            brushKind: bitmapBrushKindRef.current,
            brushColor: brushColorRef.current,
            brushSize: brushSizeRef.current,
            compositeOperation,
            onCommit: commitBitmapStampBrushStroke,
          })
        : new CompositePencilBrush(fabricCanvas as any);
      brush.width = brushSizeRef.current;
      brush.color = getBrushPaintColor(tool, brushColorRef.current);
      if (brush instanceof CompositePencilBrush) {
        brush.compositeOperation = compositeOperation;
      }
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else if (isVectorPencil) {
      const brush = new VectorPencilBrush(fabricCanvas, {
        strokeBrushId: vectorStyleRef.current.strokeBrushId,
        strokeColor: vectorStyleRef.current.strokeColor,
        strokeWidth: vectorStyleRef.current.strokeWidth,
      });
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else {
      fabricCanvas.isDrawingMode = false;
      if (fabricCanvas.lowerCanvasEl) {
        fabricCanvas.lowerCanvasEl.style.opacity = '';
      }
      if (fabricCanvas.contextTop) {
        fabricCanvas.contextTop.globalCompositeOperation = 'source-over';
      }
    }

    const isVectorPointMode = mode === 'vector' && tool === 'select' && !!vectorPointEditingTargetRef.current;
    const isVectorSelectionMode = mode === 'vector' && tool === 'select' && !isVectorPointMode;
    const isVectorTextMode = mode === 'vector' && tool === 'text';
    const floatingBitmapObject = bitmapFloatingObjectRef.current;
    const isBitmapFloatingSelectionMode =
      mode === 'bitmap' &&
      tool === 'select' &&
      !!floatingBitmapObject;

    restoreAllOriginalControls();
    fabricCanvas.selection = isVectorSelectionMode;
    fabricCanvas.selectionColor = 'rgba(0, 94, 255, 0.14)';
    fabricCanvas.selectionBorderColor = VECTOR_SELECTION_COLOR;
    fabricCanvas.selectionLineWidth = 2;
    fabricCanvas.selectionDashArray = [];
    fabricCanvas.forEachObject((obj: any) => {
      if (isTextEditableObject(obj)) {
        attachTextEditingContainer(obj, textEditingHostRef.current);
      }

      const isPointEditingTarget = isVectorPointMode && obj === vectorPointEditingTargetRef.current;
      const selectable = isVectorSelectionMode
        ? true
        : isVectorPointMode
          ? isVectorPointSelectableObject(obj)
          : isVectorTextMode
            ? isTextEditableObject(obj)
          : (isBitmapFloatingSelectionMode && obj === floatingBitmapObject);

      obj.selectable = selectable;
      obj.evented = selectable;
      obj.hasControls = selectable;
      obj.hasBorders = selectable;
      obj.lockMovementX = !selectable || isVectorPointMode;
      obj.lockMovementY = !selectable || isVectorPointMode;
      obj.lockRotation = !selectable || isVectorPointMode;
      obj.lockScalingX = !selectable || isVectorPointMode;
      obj.lockScalingY = !selectable || isVectorPointMode;
      obj.borderColor = VECTOR_SELECTION_COLOR;
      obj.borderScaleFactor = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE);
      obj.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
      obj.cornerStyle = 'rect';
      obj.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
      obj.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
      obj.cornerSize = getZoomInvariantMetric(OBJECT_SELECTION_CORNER_SIZE);
      obj.transparentCorners = false;
      obj.padding = getZoomInvariantMetric(OBJECT_SELECTION_PADDING);

      if (isVectorPointMode) {
        if (isPointEditingTarget) {
          const objAny = obj as any;
          applyVectorPointControls(objAny);
          applyVectorPointEditingAppearance(objAny);
        } else {
          restoreOriginalControls(obj);
          const objAny = obj as any;
          objAny.hasControls = false;
          objAny.hasBorders = false;
          objAny.lockMovementX = false;
          objAny.lockMovementY = false;
          objAny.lockRotation = false;
          objAny.lockScalingX = false;
          objAny.lockScalingY = false;
        }
      }
    });

    let activeObject = fabricCanvas.getActiveObject() as any;
    if (
      isVectorPointMode &&
      vectorPointEditingTargetRef.current &&
      activeObject !== vectorPointEditingTargetRef.current
    ) {
      fabricCanvas.setActiveObject(vectorPointEditingTargetRef.current);
      activeObject = vectorPointEditingTargetRef.current;
    }
    if (activeObject) {
      if (isVectorPointMode && !isVectorPointSelectableObject(activeObject)) {
        fabricCanvas.discardActiveObject();
        activeObject = null;
      }
      if (activeObject && !isVectorSelectionMode && !isVectorPointMode && activeObject !== floatingBitmapObject) {
        const keepActiveTextObject = isVectorTextMode && isTextEditableObject(activeObject);
        if (!keepActiveTextObject) {
          fabricCanvas.discardActiveObject();
          activeObject = null;
        }
      }

      if (activeObject && isVectorPointMode && activeObject === vectorPointEditingTargetRef.current) {
        activateVectorPointEditing(activeObject, false);
      }
    }

    let cursor = 'default';
    if (mode === 'bitmap' && (tool === 'brush' || tool === 'eraser')) {
      cursor = 'none';
    } else if (
      tool === 'fill' ||
      tool === 'line' ||
      tool === 'circle' ||
      tool === 'rectangle' ||
      tool === 'triangle' ||
      tool === 'star' ||
      tool === 'pen' ||
      (mode === 'vector' && tool === 'brush')
    ) {
      cursor = 'crosshair';
    } else if (tool === 'text') {
      cursor = 'text';
    } else if (tool === 'collider') {
      cursor = 'move';
    }

    syncBrushCursorOverlay();
    applyCanvasCursor(fabricCanvas, cursor);
    fabricCanvas.requestRenderAll();
    syncSelectionState();
  }, [activateVectorPointEditing, applyVectorPointControls, applyVectorPointEditingAppearance, commitBitmapStampBrushStroke, getZoomInvariantMetric, normalizeCanvasVectorStrokeUniform, restoreAllOriginalControls, restoreOriginalControls, setVectorPointEditingTarget, syncBrushCursorOverlay, syncSelectionState]);

  // Draw collider overlay
  const drawCollider = useCallback((coll: ColliderConfig | null, editable: boolean = false) => {
    const colliderCtx = colliderCtxRef.current;
    if (!colliderCtx) return;

    colliderCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (!coll || coll.type === 'none') return;

    const centerX = CANVAS_SIZE / 2 + coll.offsetX;
    const centerY = CANVAS_SIZE / 2 + coll.offsetY;

    colliderCtx.strokeStyle = '#22c55e';
    colliderCtx.lineWidth = 3;
    colliderCtx.setLineDash(editable ? [] : [8, 8]);

    if (coll.type === 'box') {
      colliderCtx.strokeRect(
        centerX - coll.width / 2,
        centerY - coll.height / 2,
        coll.width,
        coll.height
      );
    } else if (coll.type === 'circle') {
      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, coll.radius, 0, Math.PI * 2);
      colliderCtx.stroke();
    } else if (coll.type === 'capsule') {
      const halfW = coll.width / 2;
      const halfH = coll.height / 2;
      const radius = Math.min(halfW, halfH);

      colliderCtx.beginPath();
      colliderCtx.moveTo(centerX - halfW + radius, centerY - halfH);
      colliderCtx.lineTo(centerX + halfW - radius, centerY - halfH);
      colliderCtx.arc(centerX + halfW - radius, centerY - halfH + radius, radius, -Math.PI / 2, 0);
      colliderCtx.lineTo(centerX + halfW, centerY + halfH - radius);
      colliderCtx.arc(centerX + halfW - radius, centerY + halfH - radius, radius, 0, Math.PI / 2);
      colliderCtx.lineTo(centerX - halfW + radius, centerY + halfH);
      colliderCtx.arc(centerX - halfW + radius, centerY + halfH - radius, radius, Math.PI / 2, Math.PI);
      colliderCtx.lineTo(centerX - halfW, centerY - halfH + radius);
      colliderCtx.arc(centerX - halfW + radius, centerY - halfH + radius, radius, Math.PI, Math.PI * 1.5);
      colliderCtx.stroke();
    }

    colliderCtx.setLineDash([]);

    if (editable) {
      colliderCtx.fillStyle = '#ffffff';
      colliderCtx.strokeStyle = '#22c55e';
      colliderCtx.lineWidth = 2;

      if (coll.type === 'box' || coll.type === 'capsule') {
        const corners = [
          { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
          { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
          { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
          { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
        ];
        corners.forEach((corner) => {
          colliderCtx.fillRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });

        const edges = [
          { x: centerX, y: centerY - coll.height / 2 },
          { x: centerX, y: centerY + coll.height / 2 },
          { x: centerX - coll.width / 2, y: centerY },
          { x: centerX + coll.width / 2, y: centerY },
        ];
        edges.forEach((edge) => {
          colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });
      } else if (coll.type === 'circle') {
        const edges = [
          { x: centerX, y: centerY - coll.radius },
          { x: centerX, y: centerY + coll.radius },
          { x: centerX - coll.radius, y: centerY },
          { x: centerX + coll.radius, y: centerY },
        ];
        edges.forEach((edge) => {
          colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });
      }

      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      colliderCtx.fillStyle = '#22c55e';
      colliderCtx.fill();
      colliderCtx.strokeStyle = '#ffffff';
      colliderCtx.lineWidth = 2;
      colliderCtx.stroke();
    }
  }, []);

  // Initialize fabric canvas once.
  useEffect(() => {
    if (!fabricCanvasElementRef.current || fabricCanvasRef.current) return;

    const fabricCanvas = new FabricCanvas(fabricCanvasElementRef.current, {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      preserveObjectStacking: true,
      selection: false,
    });
    fabricCanvasRef.current = fabricCanvas;

    const onMouseDown = (opt: any) => {
      if (activeToolRef.current === 'collider') return;
      if (!opt.e) return;

      const pointer = fabricCanvas.getScenePoint(opt.e);
      const mode = editorModeRef.current;
      const tool = activeToolRef.current;
      const floatingBitmapObject = bitmapFloatingObjectRef.current;

      if (mode === 'bitmap' && tool === 'select' && floatingBitmapObject) {
        if (!opt.target || opt.target !== floatingBitmapObject) {
          void commitBitmapSelection();
        }
        return;
      }

      if (mode === 'vector' && tool === 'pen') {
        startPenAnchorPlacement(pointer, { cuspMode: opt.e.altKey === true });
        return;
      }

      if (mode === 'vector' && tool === 'select') {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        const clickedTarget = opt.target as any;
        const clickedPointEditingTarget = !!pointEditingTarget && clickedTarget === pointEditingTarget;
        const clickedActivePathControl = clickedPointEditingTarget && typeof clickedTarget?.__corner === 'string' && clickedTarget.__corner.length > 0;
        const pointSelectionToggle = isPointSelectionToggleModifierPressed(opt.e);
        const pointSelectionTransformHit = (
          pointEditingTarget &&
          getFabricObjectType(pointEditingTarget) === 'path' &&
          !clickedActivePathControl
        )
          ? (() => {
              const snapshot = getSelectedPathAnchorTransformSnapshot(pointEditingTarget);
              return snapshot ? hitPointSelectionTransform(snapshot, pointer) : null;
            })()
          : null;

        if (pointEditingTarget && pointSelectionTransformHit) {
          pointSelectionTransformSessionRef.current = null;
          insertedPathAnchorDragSessionRef.current = null;
          if (beginPointSelectionTransformSession(pointEditingTarget, pointSelectionTransformHit, pointer)) {
            fabricCanvas.setActiveObject(pointEditingTarget);
            fabricCanvas.requestRenderAll();
            return;
          }
        }

        if (pointEditingTarget && !clickedPointEditingTarget && opt.e.detail >= 2) {
          clearSelectedPathAnchors(pointEditingTarget);
          restoreAllOriginalControls();
          setVectorPointEditingTarget(null);
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas) return;
            if (!canvas.getObjects().includes(pointEditingTarget)) return;
            canvas.setActiveObject(pointEditingTarget);
            configureCanvasForTool();
          });
          return;
        }

        if (pointEditingTarget && !clickedPointEditingTarget) {
          pointSelectionTransformSessionRef.current = null;
          insertedPathAnchorDragSessionRef.current = null;
          pointSelectionMarqueeSessionRef.current = {
            path: pointEditingTarget,
            startPointerScene: new Point(pointer.x, pointer.y),
            currentPointerScene: new Point(pointer.x, pointer.y),
            initialSelectedAnchorIndices: getSelectedPathAnchorIndices(pointEditingTarget),
            toggleSelection: pointSelectionToggle,
          };
          fabricCanvas.setActiveObject(pointEditingTarget);
          fabricCanvas.requestRenderAll();
          return;
        }

        if (
          pointEditingTarget &&
          clickedPointEditingTarget &&
          !clickedActivePathControl &&
          opt.e.detail === 1 &&
          getFabricObjectType(pointEditingTarget) === 'path'
        ) {
          const insertedAnchorIndex = insertPathPointAtScenePosition(pointEditingTarget, pointer);
          if (insertedAnchorIndex !== null) {
            setSelectedPathAnchors(pointEditingTarget, [insertedAnchorIndex], {
              primaryAnchorIndex: insertedAnchorIndex,
            });
            fabricCanvas.setActiveObject(pointEditingTarget);
            applyVectorPointControls(pointEditingTarget);
            applyVectorPointEditingAppearance(pointEditingTarget);
            syncVectorHandleModeFromSelection();
            syncVectorStyleFromSelection();
            syncSelectionState();
            const dragState = getPathAnchorDragState(pointEditingTarget, insertedAnchorIndex);
            insertedPathAnchorDragSessionRef.current = dragState
              ? {
                  path: pointEditingTarget,
                  anchorIndex: insertedAnchorIndex,
                  dragState,
                }
              : null;
            fabricCanvas.requestRenderAll();
            return;
          }

          clearSelectedPathAnchors(pointEditingTarget);
          return;
        }

        if (opt.e.detail >= 2 && clickedTarget && isVectorPointSelectableObject(clickedTarget)) {
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas) return;
            const vectorTarget = clickedTarget as any;
            if (!canvas.getObjects().includes(vectorTarget)) return;
            canvas.setActiveObject(vectorTarget);
            activateVectorPointEditing(vectorTarget, true);
            configureCanvasForTool();
          });
          return;
        }
      }

      if (tool === 'fill' && mode === 'bitmap') {
        void applyFill(pointer.x, pointer.y);
        return;
      }

      if (tool === 'text' && mode === 'vector') {
        if (opt.target && isTextEditableObject(opt.target)) {
          const textObject = opt.target as any;
          attachTextEditingContainer(textObject, textEditingHostRef.current);
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas) return;
            if (!canvas.getObjects().includes(textObject)) return;
            beginTextEditing(canvas as any, textObject, { event: opt.e });
            syncTextStyleFromSelection();
            syncTextSelectionState();
            syncSelectionState();
          });
          return;
        }

        const textObject = new IText('text', {
          left: pointer.x,
          top: pointer.y,
          fill: brushColorRef.current,
          fontFamily: textStyleRef.current.fontFamily,
          fontSize: textStyleRef.current.fontSize,
          fontWeight: textStyleRef.current.fontWeight,
          fontStyle: textStyleRef.current.fontStyle,
          underline: textStyleRef.current.underline,
          textAlign: textStyleRef.current.textAlign,
          opacity: textStyleRef.current.opacity,
        } as any);
        attachTextEditingContainer(textObject as any, textEditingHostRef.current);
        textObject.on('editing:exited', () => {
          syncTextStyleFromSelection();
          saveHistory();
        });
        fabricCanvas.add(textObject);
        beginTextEditing(fabricCanvas as any, textObject, { selectAll: true });
        syncTextStyleFromSelection();
        syncTextSelectionState();
        syncSelectionState();
        saveHistory();
        return;
      }

      if (tool === 'rectangle' || tool === 'circle' || tool === 'triangle' || tool === 'star' || tool === 'line') {
        const isVectorMode = mode === 'vector';
        const activeShapeStyle = isVectorMode ? vectorStyleRef.current : bitmapShapeStyleRef.current;
        const fillColor = activeShapeStyle.fillColor;
        const strokeColor = activeShapeStyle.strokeColor;
        const strokeWidth = Math.max(0, activeShapeStyle.strokeWidth);
        const vectorRenderFill = isVectorMode
          ? getFabricFillValueForVectorTexture(vectorStyleRef.current.fillTextureId, fillColor)
          : fillColor;
        const vectorRenderStroke = isVectorMode
          ? getFabricStrokeValueForVectorBrush(vectorStyleRef.current.strokeBrushId, strokeColor)
          : strokeColor;
        let object: any;
        if (tool === 'rectangle') {
          const bounds = getStrokedShapeBoundsFromPathBounds(
            pointer.x,
            pointer.y,
            pointer.x,
            pointer.y,
            strokeWidth,
          );
          object = new Rect({
            left: bounds.left,
            top: bounds.top,
            originX: 'left',
            originY: 'top',
            width: 0,
            height: 0,
            fill: vectorRenderFill,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            selectable: false,
            evented: false,
            vectorFillTextureId: isVectorMode ? vectorStyleRef.current.fillTextureId : undefined,
            vectorFillColor: isVectorMode ? fillColor : undefined,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
          } as any);
        } else if (tool === 'circle') {
          const bounds = getStrokedShapeBoundsFromPathBounds(
            pointer.x,
            pointer.y,
            pointer.x,
            pointer.y,
            strokeWidth,
          );
          object = new Ellipse({
            left: bounds.left,
            top: bounds.top,
            rx: 0,
            ry: 0,
            fill: vectorRenderFill,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            originX: 'left',
            originY: 'top',
            selectable: false,
            evented: false,
            vectorFillTextureId: isVectorMode ? vectorStyleRef.current.fillTextureId : undefined,
            vectorFillColor: isVectorMode ? fillColor : undefined,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
          } as any);
        } else if (tool === 'triangle' || tool === 'star') {
          const bounds = getStrokedShapeBoundsFromPathBounds(
            pointer.x,
            pointer.y,
            pointer.x,
            pointer.y,
            strokeWidth,
          );
          const points = tool === 'triangle'
            ? buildTrianglePoints(bounds.width, bounds.height)
            : buildStarPoints(bounds.width, bounds.height);
          object = new Polygon(points, {
            left: bounds.left,
            top: bounds.top,
            originX: 'left',
            originY: 'top',
            fill: vectorRenderFill,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            selectable: false,
            evented: false,
            vectorFillTextureId: isVectorMode ? vectorStyleRef.current.fillTextureId : undefined,
            vectorFillColor: isVectorMode ? fillColor : undefined,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
          } as any);
          object.setBoundingBox?.(true);
        } else {
          object = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            selectable: false,
            evented: false,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
          } as any);
        }
        shapeDraftRef.current = {
          type: tool,
          startX: pointer.x,
          startY: pointer.y,
          object,
        };
        fabricCanvas.add(object);
      }
    };

    const onMouseMove = (opt: any) => {
      if (editorModeRef.current === 'vector' && activeToolRef.current === 'pen' && opt.e) {
        const pointer = fabricCanvas.getScenePoint(opt.e);
        if (penAnchorPlacementSessionRef.current) {
          if (updatePenAnchorPlacement(pointer)) {
            fabricCanvas.requestRenderAll();
          }
          return;
        }

        const draft = penDraftRef.current;
        if (draft) {
          draft.previewPoint = new Point(pointer.x, pointer.y);
          fabricCanvas.requestRenderAll();
          return;
        }
      }

      const pointSelectionTransformSession = pointSelectionTransformSessionRef.current;
      if (pointSelectionTransformSession && opt.e) {
        const pointer = fabricCanvas.getScenePoint(opt.e);
        if (
          editorModeRef.current !== 'vector' ||
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== pointSelectionTransformSession.path ||
          !fabricCanvas.getObjects().includes(pointSelectionTransformSession.path)
        ) {
          pointSelectionTransformSessionRef.current = null;
          return;
        }

        const transformed = applyPointSelectionTransformSession(pointSelectionTransformSession, pointer);
        if (transformed) {
          pointSelectionTransformSession.hasChanged = true;
          fabricCanvas.setActiveObject(pointSelectionTransformSession.path);
          fabricCanvas.requestRenderAll();
        }
        return;
      }

      const pointSelectionMarqueeSession = pointSelectionMarqueeSessionRef.current;
      if (pointSelectionMarqueeSession && opt.e) {
        if (
          editorModeRef.current !== 'vector' ||
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== pointSelectionMarqueeSession.path ||
          !fabricCanvas.getObjects().includes(pointSelectionMarqueeSession.path)
        ) {
          pointSelectionMarqueeSessionRef.current = null;
          return;
        }

        const pointer = fabricCanvas.getScenePoint(opt.e);
        pointSelectionMarqueeSession.currentPointerScene = new Point(pointer.x, pointer.y);
        fabricCanvas.setActiveObject(pointSelectionMarqueeSession.path);
        fabricCanvas.requestRenderAll();
        return;
      }

      const insertedPathAnchorDragSession = insertedPathAnchorDragSessionRef.current;
      if (insertedPathAnchorDragSession && opt.e) {
        const { path, anchorIndex, dragState } = insertedPathAnchorDragSession;
        if (
          editorModeRef.current !== 'vector' ||
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== path ||
          !fabricCanvas.getObjects().includes(path)
        ) {
          insertedPathAnchorDragSessionRef.current = null;
          return;
        }

        const pointer = fabricCanvas.getScenePoint(opt.e);
        const pointerCommandPoint = toPathCommandPoint(path, pointer);
        if (!pointerCommandPoint) return;

        const deltaX = pointerCommandPoint.x - dragState.previousAnchor.x;
        const deltaY = pointerCommandPoint.y - dragState.previousAnchor.y;
        const moved = movePathAnchorByDelta(path, anchorIndex, deltaX, deltaY, dragState);
        if (moved) {
          enforcePathAnchorHandleType(path, anchorIndex, 'anchor', dragState);
          activePathAnchorRef.current = { path, anchorIndex };
          path.setCoords?.();
          fabricCanvas.setActiveObject(path);
          fabricCanvas.requestRenderAll();
        }
        return;
      }

      if (!shapeDraftRef.current || !opt.e) return;
      const pointer = fabricCanvas.getScenePoint(opt.e);
      const draft = shapeDraftRef.current;
      const object = draft.object;

      if (draft.type === 'rectangle') {
        const bounds = getStrokedShapeBoundsFromPathBounds(
          draft.startX,
          draft.startY,
          pointer.x,
          pointer.y,
          typeof object.strokeWidth === 'number' ? object.strokeWidth : 0,
        );
        object.set(bounds);
      } else if (draft.type === 'circle') {
        const bounds = getStrokedShapeBoundsFromPathBounds(
          draft.startX,
          draft.startY,
          pointer.x,
          pointer.y,
          typeof object.strokeWidth === 'number' ? object.strokeWidth : 0,
        );
        const rx = bounds.width / 2;
        const ry = bounds.height / 2;
        object.set({
          left: bounds.left,
          top: bounds.top,
          rx,
          ry,
        });
      } else if (draft.type === 'triangle' || draft.type === 'star') {
        const bounds = getStrokedShapeBoundsFromPathBounds(
          draft.startX,
          draft.startY,
          pointer.x,
          pointer.y,
          typeof object.strokeWidth === 'number' ? object.strokeWidth : 0,
        );
        const points = draft.type === 'triangle'
          ? buildTrianglePoints(bounds.width, bounds.height)
          : buildStarPoints(bounds.width, bounds.height);
        object.set({
          left: bounds.left,
          top: bounds.top,
          points,
        });
        object.setBoundingBox?.(true);
      } else {
        object.set({ x2: pointer.x, y2: pointer.y });
      }

      object.setCoords();
      fabricCanvas.requestRenderAll();
    };

    const onMouseUp = () => {
      if (penAnchorPlacementSessionRef.current) {
        commitCurrentPenPlacement();
        fabricCanvas.requestRenderAll();
        return;
      }

      if (pointSelectionTransformSessionRef.current) {
        const shouldSave = pointSelectionTransformSessionRef.current.hasChanged;
        pointSelectionTransformSessionRef.current = null;
        if (shouldSave) {
          saveHistory();
        }
        return;
      }

      if (pointSelectionMarqueeSessionRef.current) {
        const pointSelectionMarqueeSession = pointSelectionMarqueeSessionRef.current;
        pointSelectionMarqueeSessionRef.current = null;
        applyPointSelectionMarqueeSession(pointSelectionMarqueeSession);
        if (
          vectorPointEditingTargetRef.current === pointSelectionMarqueeSession.path &&
          fabricCanvas.getObjects().includes(pointSelectionMarqueeSession.path)
        ) {
          fabricCanvas.setActiveObject(pointSelectionMarqueeSession.path);
        }
        fabricCanvas.requestRenderAll();
        return;
      }

      if (insertedPathAnchorDragSessionRef.current) {
        insertedPathAnchorDragSessionRef.current = null;
        saveHistory();
        return;
      }

      if (!shapeDraftRef.current) return;
      shapeDraftRef.current = null;
      if (editorModeRef.current === 'bitmap') {
        void (async () => {
          await flattenBitmapLayer();
          configureCanvasForTool();
        })();
      } else {
        saveHistory();
        configureCanvasForTool();
      }
    };

    const onPathCreated = (event: { path?: any }) => {
      if (editorModeRef.current !== 'bitmap') {
        const createdPath = event?.path;
        if (createdPath && editorModeRef.current === 'vector' && activeToolRef.current === 'brush') {
          normalizeVectorObjectRendering(createdPath);
          createdPath.setCoords?.();
          syncVectorStyleFromSelection();
          syncSelectionState();
          fabricCanvas.requestRenderAll();
        }
        saveHistory();
        return;
      }

      void (async () => {
        await flattenBitmapLayer();
      })();
    };

    const onObjectModified = () => {
      if (editorModeRef.current === 'vector') {
        saveHistory();
      }
    };

    const onSelectionChange = () => {
      const activeObject = fabricCanvas.getActiveObject() as any;
      if (
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select' &&
        vectorPointEditingTargetRef.current &&
        activeObject !== vectorPointEditingTargetRef.current
      ) {
        restoreAllOriginalControls();
        setVectorPointEditingTarget(null);
        queueMicrotask(() => {
          configureCanvasForTool();
        });
      }
      syncTextStyleFromSelection();
      syncVectorStyleFromSelection();
      syncTextSelectionState();
      syncSelectionState();
      if (
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select' &&
        vectorPointEditingTargetRef.current &&
        activeObject === vectorPointEditingTargetRef.current
      ) {
        activateVectorPointEditing(activeObject, false);
        configureCanvasForTool();
      }
    };

    const onTextChanged = () => {
      if (editorModeRef.current !== 'vector') return;
      syncTextStyleFromSelection();
      syncTextSelectionState();
      saveHistory();
    };

    const onAfterRender = () => {
      const vectorStrokeCtx = vectorStrokeCtxRef.current;
      if (vectorStrokeCtx) {
        renderVectorBrushStrokeOverlay(vectorStrokeCtx);
      }
      renderVectorPointEditingGuide();
    };

    const onSelectionCleared = () => {
      if (
        editorModeRef.current === 'bitmap' &&
        activeToolRef.current === 'select' &&
        bitmapFloatingObjectRef.current &&
        !bitmapSelectionBusyRef.current &&
        !suppressBitmapSelectionAutoCommitRef.current
      ) {
        void commitBitmapSelection();
        return;
      }
      if (
        vectorPointEditingTargetRef.current &&
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select'
      ) {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        queueMicrotask(() => {
          const canvas = fabricCanvasRef.current;
          if (!canvas) return;
          if (vectorPointEditingTargetRef.current !== pointEditingTarget) return;
          if (!canvas.getObjects().includes(pointEditingTarget)) {
            restoreAllOriginalControls();
            setVectorPointEditingTarget(null);
            configureCanvasForTool();
            return;
          }
          canvas.setActiveObject(pointEditingTarget);
          configureCanvasForTool();
        });
        return;
      }
      if (vectorPointEditingTargetRef.current) {
        restoreAllOriginalControls();
        setVectorPointEditingTarget(null);
        queueMicrotask(() => {
          configureCanvasForTool();
        });
      }
      activePathAnchorRef.current = null;
      onTextSelectionChangeRef.current?.(false);
      syncSelectionState();
    };

    fabricCanvas.on('mouse:down', onMouseDown);
    fabricCanvas.on('mouse:move', onMouseMove);
    fabricCanvas.on('mouse:up', onMouseUp);
    fabricCanvas.on('path:created', onPathCreated);
    fabricCanvas.on('object:modified', onObjectModified);
    fabricCanvas.on('selection:created', onSelectionChange);
    fabricCanvas.on('selection:updated', onSelectionChange);
    fabricCanvas.on('selection:cleared', onSelectionCleared);
    fabricCanvas.on('text:changed', onTextChanged);
    fabricCanvas.on('text:editing:exited', onTextChanged);
    fabricCanvas.on('after:render', onAfterRender);

    const colliderCanvas = colliderCanvasRef.current;
    if (colliderCanvas) {
      colliderCtxRef.current = colliderCanvas.getContext('2d');
    }
    const vectorStrokeCanvas = vectorStrokeCanvasRef.current;
    if (vectorStrokeCanvas) {
      vectorStrokeCtxRef.current = vectorStrokeCanvas.getContext('2d');
    }
    const vectorGuideCanvas = vectorGuideCanvasRef.current;
    if (vectorGuideCanvas) {
      vectorGuideCtxRef.current = vectorGuideCanvas.getContext('2d');
    }
    const bitmapSelectionCanvas = bitmapSelectionCanvasRef.current;
    if (bitmapSelectionCanvas) {
      bitmapSelectionCtxRef.current = bitmapSelectionCanvas.getContext('2d');
      drawBitmapSelectionOverlay();
    }

    historyRef.current = [];
    historyIndexRef.current = -1;
    saveHistory();
    configureCanvasForTool();

    return () => {
      restoreAllOriginalControls();
      fabricCanvas.off('mouse:down', onMouseDown);
      fabricCanvas.off('mouse:move', onMouseMove);
      fabricCanvas.off('mouse:up', onMouseUp);
      fabricCanvas.off('path:created', onPathCreated);
      fabricCanvas.off('object:modified', onObjectModified);
      fabricCanvas.off('selection:created', onSelectionChange);
      fabricCanvas.off('selection:updated', onSelectionChange);
      fabricCanvas.off('selection:cleared', onSelectionCleared);
      fabricCanvas.off('text:changed', onTextChanged);
      fabricCanvas.off('text:editing:exited', onTextChanged);
      fabricCanvas.off('after:render', onAfterRender);
      fabricCanvas.dispose();
      fabricCanvasRef.current = null;
      vectorStrokeCtxRef.current = null;
      vectorGuideCtxRef.current = null;
    };
  }, [activateVectorPointEditing, applyFill, applyPointSelectionMarqueeSession, applyPointSelectionTransformSession, applyVectorPointControls, applyVectorPointEditingAppearance, beginPointSelectionTransformSession, clearSelectedPathAnchors, commitBitmapSelection, commitCurrentPenPlacement, configureCanvasForTool, drawBitmapSelectionOverlay, enforcePathAnchorHandleType, ensurePathLikeObjectForVectorTool, flattenBitmapLayer, getPathAnchorDragState, getSelectedPathAnchorIndices, getSelectedPathAnchorTransformSnapshot, hitPointSelectionTransform, insertPathPointAtScenePosition, isPointSelectionToggleModifierPressed, loadBitmapLayer, movePathAnchorByDelta, renderVectorBrushStrokeOverlay, renderVectorPointEditingGuide, restoreAllOriginalControls, saveHistory, setEditorMode, setSelectedPathAnchors, setVectorPointEditingTarget, startPenAnchorPlacement, syncSelectionState, syncTextSelectionState, syncTextStyleFromSelection, syncVectorHandleModeFromSelection, syncVectorStyleFromSelection, toPathCommandPoint, updatePenAnchorPlacement]);

  // Sync tool behavior.
  useEffect(() => {
    configureCanvasForTool();
  }, [activeTool, bitmapBrushKind, brushColor, brushSize, editorModeState, hasBitmapFloatingSelection, vectorStyle, configureCanvasForTool]);

  useEffect(() => {
    const activeAnchor = activePathAnchorRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    if (!activeAnchor || !fabricCanvas) return;
    if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'select') return;
    if (!vectorPointEditingTargetRef.current) return;

    const pendingSelectionSyncedMode = pendingSelectionSyncedVectorHandleModeRef.current;
    if (pendingSelectionSyncedMode !== null) {
      pendingSelectionSyncedVectorHandleModeRef.current = null;
      if (pendingSelectionSyncedMode === vectorHandleMode) {
        return;
      }
    }

    if (vectorHandleMode === 'multiple') {
      return;
    }

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || activeObject !== activeAnchor.path) return;
    if (getFabricObjectType(activeObject) !== 'path') return;
    const selectedAnchorIndices = getSelectedPathAnchorIndices(activeObject);
    const targetAnchorIndices = selectedAnchorIndices.length > 0
      ? selectedAnchorIndices
      : [activeAnchor.anchorIndex];

    let changed = false;
    for (const anchorIndex of targetAnchorIndices) {
      const currentHandleMode = pathNodeHandleTypeToVectorHandleMode(
        getPathNodeHandleType(activeObject, anchorIndex) ?? 'linear',
      );
      if (currentHandleMode === vectorHandleMode) continue;

      setPathNodeHandleType(
        activeObject,
        anchorIndex,
        vectorHandleModeToPathNodeHandleType(getEditableVectorHandleMode(vectorHandleMode)),
      );
      enforcePathAnchorHandleType(activeObject, anchorIndex, null);
      changed = true;
    }

    if (!changed) return;

    syncPathControlPointVisibility(activeObject);
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [enforcePathAnchorHandleType, getPathNodeHandleType, getSelectedPathAnchorIndices, saveHistory, setPathNodeHandleType, syncPathControlPointVisibility, vectorHandleMode]);

  // Sync selected vector object style when controls change.
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return;

    let changed = false;
    if (isTextObject(activeObject)) {
      const textObject = activeObject as any;
      if (textObject.fill !== brushColor) changed = true;
      if (textObject.fontFamily !== textStyle.fontFamily) changed = true;
      if (textObject.fontSize !== textStyle.fontSize) changed = true;
      if (textObject.fontWeight !== textStyle.fontWeight) changed = true;
      if (textObject.fontStyle !== textStyle.fontStyle) changed = true;
      if (textObject.underline !== textStyle.underline) changed = true;
      if (textObject.textAlign !== textStyle.textAlign) changed = true;
      if (textObject.opacity !== textStyle.opacity) changed = true;
      textObject.set({
        fill: brushColor,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        underline: textStyle.underline,
        textAlign: textStyle.textAlign,
        opacity: textStyle.opacity,
      });
    } else {
      const strokeWidth = Math.max(0, vectorStyle.strokeWidth);
      const vectorTargets = getVectorStyleTargets(activeObject);
      if (!vectorTargets.length) return;

      vectorTargets.forEach((target) => {
        const shouldPreserveCenter =
          target.strokeUniform !== true ||
          target.strokeWidth !== strokeWidth;
        const centerPoint = shouldPreserveCenter && typeof target.getCenterPoint === 'function'
          ? target.getCenterPoint()
          : null;
        const fillChanged = vectorObjectSupportsFill(target)
          ? applyVectorFillStyleToObject(target, {
              fillColor: vectorStyle.fillColor,
              fillTextureId: vectorStyle.fillTextureId,
            })
          : false;
        const strokeChanged = applyVectorStrokeStyleToObject(target, {
          strokeColor: vectorStyle.strokeColor,
          strokeWidth,
          strokeBrushId: vectorStyle.strokeBrushId,
        });
        changed = changed || fillChanged;
        changed = changed || strokeChanged;
        if (strokeChanged && centerPoint && typeof target.setPositionByOrigin === 'function') {
          target.setPositionByOrigin(centerPoint, 'center', 'center');
        }
        target.setCoords?.();
      });
    }

    if (!changed) return;

    activeObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [brushColor, textStyle, vectorStyle, saveHistory]);

  // Draw collider when collider/tool changes.
  useEffect(() => {
    drawCollider(collider, activeTool === 'collider');
  }, [collider, activeTool, drawCollider]);

  // Collider interactions.
  useEffect(() => {
    const colliderCanvas = colliderCanvasRef.current;
    if (!colliderCanvas || activeTool !== 'collider') return;

    const getMousePos = (e: MouseEvent) => {
      const rect = colliderCanvas.getBoundingClientRect();
      const scaleX = CANVAS_SIZE / rect.width;
      const scaleY = CANVAS_SIZE / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const isNearPoint = (px: number, py: number, tx: number, ty: number, threshold = HANDLE_SIZE) => (
      Math.abs(px - tx) <= threshold && Math.abs(py - ty) <= threshold
    );

    const handleMouseDown = (e: MouseEvent) => {
      const coll = colliderRef.current;
      if (!coll || coll.type === 'none') return;
      const pos = getMousePos(e);
      const centerX = CANVAS_SIZE / 2 + coll.offsetX;
      const centerY = CANVAS_SIZE / 2 + coll.offsetY;

      const handles = coll.type === 'circle'
        ? {
            t: { x: centerX, y: centerY - coll.radius },
            b: { x: centerX, y: centerY + coll.radius },
            l: { x: centerX - coll.radius, y: centerY },
            r: { x: centerX + coll.radius, y: centerY },
          }
        : {
            tl: { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
            tr: { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
            bl: { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
            br: { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
            t: { x: centerX, y: centerY - coll.height / 2 },
            b: { x: centerX, y: centerY + coll.height / 2 },
            l: { x: centerX - coll.width / 2, y: centerY },
            r: { x: centerX + coll.width / 2, y: centerY },
          };

      if (coll.type !== 'circle') {
        if (isNearPoint(pos.x, pos.y, handles.tl!.x, handles.tl!.y)) {
          colliderDragModeRef.current = 'resize-tl';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.tr!.x, handles.tr!.y)) {
          colliderDragModeRef.current = 'resize-tr';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.bl!.x, handles.bl!.y)) {
          colliderDragModeRef.current = 'resize-bl';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.br!.x, handles.br!.y)) {
          colliderDragModeRef.current = 'resize-br';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
      }

      if (isNearPoint(pos.x, pos.y, handles.t.x, handles.t.y)) {
        colliderDragModeRef.current = 'resize-t';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.b.x, handles.b.y)) {
        colliderDragModeRef.current = 'resize-b';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.l.x, handles.l.y)) {
        colliderDragModeRef.current = 'resize-l';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.r.x, handles.r.y)) {
        colliderDragModeRef.current = 'resize-r';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }

      let insideCollider = false;
      if (coll.type === 'circle') {
        const dist = Math.hypot(pos.x - centerX, pos.y - centerY);
        insideCollider = dist <= coll.radius;
      } else {
        insideCollider = Math.abs(pos.x - centerX) <= coll.width / 2 &&
          Math.abs(pos.y - centerY) <= coll.height / 2;
      }

      if (insideCollider) {
        colliderDragModeRef.current = 'move';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const mode = colliderDragModeRef.current;
      const dragStart = colliderDragStartRef.current;
      if (mode === 'none' || !dragStart) return;

      const pos = getMousePos(e);
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      const original = dragStart.collider;
      const updated = { ...original };

      if (mode === 'move') {
        updated.offsetX = original.offsetX + dx;
        updated.offsetY = original.offsetY + dy;
      } else if (original.type === 'circle') {
        const centerX = CANVAS_SIZE / 2 + original.offsetX;
        const centerY = CANVAS_SIZE / 2 + original.offsetY;
        updated.radius = Math.max(16, Math.hypot(pos.x - centerX, pos.y - centerY));
      } else {
        if (mode === 'resize-tl') {
          updated.width = Math.max(32, original.width - dx);
          updated.height = Math.max(32, original.height - dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-tr') {
          updated.width = Math.max(32, original.width + dx);
          updated.height = Math.max(32, original.height - dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-bl') {
          updated.width = Math.max(32, original.width - dx);
          updated.height = Math.max(32, original.height + dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-br') {
          updated.width = Math.max(32, original.width + dx);
          updated.height = Math.max(32, original.height + dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-t') {
          updated.height = Math.max(32, original.height - dy);
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-b') {
          updated.height = Math.max(32, original.height + dy);
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-l') {
          updated.width = Math.max(32, original.width - dx);
          updated.offsetX = original.offsetX + dx / 2;
        } else if (mode === 'resize-r') {
          updated.width = Math.max(32, original.width + dx);
          updated.offsetX = original.offsetX + dx / 2;
        }
      }

      onColliderChangeRef.current?.(updated);
      drawCollider(updated, true);
    };

    const handleMouseUp = () => {
      colliderDragModeRef.current = 'none';
      colliderDragStartRef.current = null;
    };

    colliderCanvas.addEventListener('mousedown', handleMouseDown);
    colliderCanvas.addEventListener('mousemove', handleMouseMove);
    colliderCanvas.addEventListener('mouseup', handleMouseUp);
    colliderCanvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      colliderCanvas.removeEventListener('mousedown', handleMouseDown);
      colliderCanvas.removeEventListener('mousemove', handleMouseMove);
      colliderCanvas.removeEventListener('mouseup', handleMouseUp);
      colliderCanvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [activeTool, drawCollider]);

  // Keep viewport size in sync with panel size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewportSize = () => {
      const rect = container.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCameraCenter((prev) => clampCameraCenter(prev));
  }, [clampCameraCenter, viewportSize.height, viewportSize.width]);

  // Stage-like pan behavior: middle/right mouse drag.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1 && event.button !== 2) return;
      if (!container.contains(event.target as Node)) return;
      event.preventDefault();

      const camera = cameraCenterRef.current;
      panSessionRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        cameraStartX: camera.x,
        cameraStartY: camera.y,
      };
      setIsViewportPanning(true);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const pan = panSessionRef.current;
      if (!pan) return;
      event.preventDefault();
      const currentScale = BASE_VIEW_SCALE * zoomRef.current;
      setCameraCenter(
        clampCameraCenter(
          panCameraFromDrag(
            { x: pan.cameraStartX, y: pan.cameraStartY },
            event.clientX - pan.startX,
            event.clientY - pan.startY,
            currentScale,
            'down',
          ),
          zoomRef.current,
        ),
      );
    };

    const endPan = () => {
      if (!panSessionRef.current) return;
      panSessionRef.current = null;
      setIsViewportPanning(false);
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (container.contains(event.target as Node)) {
        event.preventDefault();
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', endPan);
    window.addEventListener('blur', endPan);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', endPan);
      window.removeEventListener('blur', endPan);
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [clampCameraCenter]);

  // Bitmap marquee selection: drag box to extract a floating bitmap object with Fabric transform gizmos.
  useEffect(() => {
    const overlayCanvas = bitmapSelectionCanvasRef.current;
    if (!overlayCanvas) return;
    const isBitmapSelect = editorModeState === 'bitmap' && activeTool === 'select';
    if (!isBitmapSelect || hasBitmapFloatingSelection) {
      drawBitmapSelectionOverlay();
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const pos = getSelectionMousePos(event);
      bitmapSelectionDragModeRef.current = 'marquee';
      bitmapSelectionStartRef.current = pos;
      bitmapMarqueeRectRef.current = {
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
      };
      drawBitmapSelectionOverlay();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const mode = bitmapSelectionDragModeRef.current;
      if (mode === 'none') return;
      const pos = getSelectionMousePos(event);

      const start = bitmapSelectionStartRef.current;
      if (!start) return;
      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const width = Math.abs(pos.x - start.x);
      const height = Math.abs(pos.y - start.y);
      bitmapMarqueeRectRef.current = { x, y, width, height };
      drawBitmapSelectionOverlay();
    };

    const handleMouseUp = async () => {
      const mode = bitmapSelectionDragModeRef.current;
      if (mode === 'none') return;
      bitmapSelectionDragModeRef.current = 'none';

      const marquee = bitmapMarqueeRectRef.current;
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      drawBitmapSelectionOverlay();

      if (!marquee || marquee.width < 1 || marquee.height < 1) {
        return;
      }

      const width = Math.max(1, Math.floor(marquee.width));
      const height = Math.max(1, Math.floor(marquee.height));
      const x = Math.floor(marquee.x);
      const y = Math.floor(marquee.y);

      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || bitmapSelectionBusyRef.current) return;

      bitmapSelectionBusyRef.current = true;
      try {
        const raster = fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) return;

        const selectionImageData = rasterCtx.getImageData(x, y, width, height);
        const visibleSelectionBounds = calculateBoundsFromImageData(selectionImageData, 0);
        if (!visibleSelectionBounds) {
          return;
        }

        rasterCtx.clearRect(x, y, width, height);
        const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
        if (!loaded) return;

        const selectionCanvas = document.createElement('canvas');
        selectionCanvas.width = visibleSelectionBounds.width;
        selectionCanvas.height = visibleSelectionBounds.height;
        const selectionCtx = selectionCanvas.getContext('2d');
        if (!selectionCtx) return;
        selectionCtx.putImageData(
          selectionImageData,
          -visibleSelectionBounds.x,
          -visibleSelectionBounds.y,
        );

        const floatingImage = await FabricImage.fromURL(selectionCanvas.toDataURL('image/png'));
        floatingImage.set({
          left: x + visibleSelectionBounds.x + visibleSelectionBounds.width / 2,
          top: y + visibleSelectionBounds.y + visibleSelectionBounds.height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockMovementX: false,
          lockMovementY: false,
          lockRotation: false,
          lockScalingX: false,
          lockScalingY: false,
        } as any);
        (floatingImage as any).__bitmapFloatingSelection = true;
        floatingImage.borderColor = VECTOR_SELECTION_COLOR;
        floatingImage.borderScaleFactor = VECTOR_SELECTION_BORDER_SCALE;
        floatingImage.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
        floatingImage.cornerStyle = 'rect';
        floatingImage.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
        floatingImage.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
        floatingImage.cornerSize = 12;
        floatingImage.transparentCorners = false;

        fabricCanvas.add(floatingImage);
        fabricCanvas.setActiveObject(floatingImage);
        bitmapFloatingObjectRef.current = floatingImage;
        setHasBitmapFloatingSelection(true);
        syncSelectionState();
        configureCanvasForTool();
        fabricCanvas.requestRenderAll();
        drawBitmapSelectionOverlay();
      } finally {
        bitmapSelectionBusyRef.current = false;
      }
    };

    overlayCanvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      overlayCanvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    activeTool,
    configureCanvasForTool,
    drawBitmapSelectionOverlay,
    editorModeState,
    hasBitmapFloatingSelection,
    getSelectionMousePos,
    loadBitmapLayer,
    syncSelectionState,
  ]);

  // If we leave bitmap select mode with a floating selection, commit it to avoid losing pixels.
  useEffect(() => {
    if (editorModeState === 'bitmap' && activeTool === 'select') {
      return;
    }
    if (bitmapFloatingObjectRef.current) {
      void commitBitmapSelection();
      return;
    }
    drawBitmapSelectionOverlay();
  }, [activeTool, commitBitmapSelection, drawBitmapSelectionOverlay, editorModeState]);

  useEffect(() => {
    if (editorModeState === 'vector' && activeTool === 'pen') {
      return;
    }
    if (penDraftRef.current) {
      finalizePenDraft();
    }
  }, [activeTool, editorModeState, finalizePenDraft]);

  useEffect(() => {
    if (editorModeState !== 'vector' || activeTool !== 'pen') {
      return;
    }
    if (!penDraftRef.current) {
      return;
    }
    fabricCanvasRef.current?.requestRenderAll();
  }, [activeTool, editorModeState, vectorStyle]);

  useEffect(() => {
    const shouldIgnorePenShortcutTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'pen') {
        return;
      }
      if (shouldIgnorePenShortcutTarget(event.target)) {
        return;
      }

      if (event.key === ' ' && penAnchorPlacementSessionRef.current) {
        event.preventDefault();
        if (!penModifierStateRef.current.space) {
          penModifierStateRef.current.space = true;
          if (setPenAnchorMoveMode(true)) {
            fabricCanvasRef.current?.requestRenderAll();
          }
        }
        return;
      }

      if (event.key === 'Alt' && penAnchorPlacementSessionRef.current) {
        event.preventDefault();
        if (!penModifierStateRef.current.alt) {
          penModifierStateRef.current.alt = true;
          if (syncPenPlacementToAltModifier(true)) {
            fabricCanvasRef.current?.requestRenderAll();
          }
        }
        return;
      }

      if (!penDraftRef.current) {
        return;
      }

      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        finalizePenDraft();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        removeLastPenDraftAnchor();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'pen') {
        return;
      }

      if (event.key === ' ') {
        if (!penModifierStateRef.current.space) {
          return;
        }
        event.preventDefault();
        penModifierStateRef.current.space = false;
        if (setPenAnchorMoveMode(false)) {
          fabricCanvasRef.current?.requestRenderAll();
        }
        return;
      }

      if (event.key === 'Alt') {
        if (!penModifierStateRef.current.alt) {
          return;
        }
        penModifierStateRef.current.alt = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [finalizePenDraft, removeLastPenDraftAnchor, setPenAnchorMoveMode, syncPenPlacementToAltModifier]);

  // Expose imperative methods.
  useImperativeHandle(ref, () => ({
    toDataURL: () => {
      const composed = getCanvasElement();
      return composed.toDataURL('image/webp', 0.85);
    },

    toDataURLWithBounds: () => {
      const composed = getCanvasElement();
      return {
        dataUrl: composed.toDataURL('image/webp', 0.85),
        bounds: calculateBoundsFromCanvas(composed),
      };
    },

    loadFromDataURL: async (dataUrl: string, sessionKey?: string | null) => {
      loadedSessionKeyRef.current = null;
      await loadBitmapLayer(dataUrl, false);
      setEditorMode('bitmap');
      loadedSessionKeyRef.current = sessionKey ?? null;
      historyRef.current = [];
      historyIndexRef.current = -1;
      saveHistory();
      markCurrentSnapshotPersisted(sessionKey ?? null);
    },

    loadCostume,

    exportCostumeState,

    hasUnsavedChanges: (sessionKey?: string | null) => {
      if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
        return false;
      }
      return !areHistorySnapshotsEqual(createSnapshot(), persistedSnapshotRef.current);
    },

    markPersisted: (sessionKey?: string | null) => {
      markCurrentSnapshotPersisted(sessionKey);
    },

    setEditorMode: async (mode: CostumeEditorMode) => {
      await switchEditorMode(mode);
      configureCanvasForTool();
    },

    getEditorMode: () => editorModeRef.current,

    getLoadedSessionKey: () => loadedSessionKeyRef.current,

    deleteSelection,

    duplicateSelection,

    moveSelectionOrder,

    flipSelection,

    rotateSelection,

    alignSelection,

    isTextEditing,

    clear: () => {
      void (async () => {
        loadedSessionKeyRef.current = null;
        await loadBitmapLayer('', false);
        setEditorMode('bitmap');
        saveHistory();
      })();
    },

    undo: () => {
      if (historyIndexRef.current <= 0) return;
      historyIndexRef.current -= 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      void applySnapshot(snapshot);
    },

    redo: () => {
      if (historyIndexRef.current >= historyRef.current.length - 1) return;
      historyIndexRef.current += 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      void applySnapshot(snapshot);
    },

    canUndo: () => historyIndexRef.current > 0,
    canRedo: () => historyIndexRef.current < historyRef.current.length - 1,
  }), [
    applySnapshot,
    configureCanvasForTool,
    createSnapshot,
    exportCostumeState,
    getCanvasElement,
    markCurrentSnapshotPersisted,
    loadBitmapLayer,
    loadCostume,
    saveHistory,
    setEditorMode,
    switchEditorMode,
    deleteSelection,
    duplicateSelection,
    moveSelectionOrder,
    flipSelection,
    rotateSelection,
    alignSelection,
    isTextEditing,
  ]);

  // Natural wheel controls (stage-matched):
  // - ctrl/cmd + wheel: zoom at cursor pivot.
  // - plain wheel: pan viewport.
  const handleWheel = useCallback((e: WheelEvent) => {
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      const rect = container.getBoundingClientRect();
      const zoomDelta = -e.deltaY * 0.01;
      const zoomFactor = Math.max(0.01, 1 + zoomDelta);
      const nextZoom = clampZoom(zoomRef.current * zoomFactor);
      setCameraCenter(
        clampCameraCenter(
          zoomCameraAtClientPoint(
            e.clientX,
            e.clientY,
            rect,
            cameraCenterRef.current,
            BASE_VIEW_SCALE * zoomRef.current,
            BASE_VIEW_SCALE * nextZoom,
            'down',
          ),
          nextZoom,
        ),
      );
      setZoom(nextZoom);
      return;
    }

    const currentScale = BASE_VIEW_SCALE * zoomRef.current;
    setCameraCenter((prev) => clampCameraCenter(
      panCameraFromWheel(prev, e.deltaX, e.deltaY, currentScale, 'down'),
    ));
  }, [clampCameraCenter, clampZoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => handleWheel(event);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [handleWheel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      brushCursorPosRef.current = { x, y };
      const overlay = brushCursorOverlayRef.current;
      if (!overlay) return;
      overlay.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (brushCursorEnabledRef.current) {
        overlay.style.opacity = '1';
      }
    };

    const onPointerLeave = () => {
      brushCursorPosRef.current = null;
      const overlay = brushCursorOverlayRef.current;
      if (overlay) {
        overlay.style.opacity = '0';
      }
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);

    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  useEffect(() => {
    syncBrushCursorOverlay();
  }, [activeTool, bitmapBrushKind, brushColor, brushSize, editorModeState, zoom, syncBrushCursorOverlay]);

  useEffect(() => {
    onViewScaleChangeRef.current?.(BASE_VIEW_SCALE * zoom);
  }, [zoom]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const selectionCornerSize = getZoomInvariantMetric(OBJECT_SELECTION_CORNER_SIZE, zoom);
    const selectionBorderScale = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE, zoom);
    const selectionPadding = getZoomInvariantMetric(OBJECT_SELECTION_PADDING, zoom);
    const pointEditingTarget = vectorPointEditingTargetRef.current as any;

    fabricCanvas.forEachObject((obj: any) => {
      obj.borderScaleFactor = selectionBorderScale;
      obj.padding = obj === pointEditingTarget ? 0 : selectionPadding;
      obj.cornerSize = obj === pointEditingTarget
        ? getZoomInvariantMetric(HANDLE_SIZE, zoom)
        : selectionCornerSize;
      obj.setCoords?.();
    });

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (activeObject) {
      activeObject.borderScaleFactor = selectionBorderScale;
      activeObject.padding = activeObject === pointEditingTarget ? 0 : selectionPadding;
      activeObject.cornerSize = activeObject === pointEditingTarget
        ? getZoomInvariantMetric(HANDLE_SIZE, zoom)
        : selectionCornerSize;
    }
    activeObject?.setCoords?.();
    fabricCanvas.requestRenderAll();
    renderVectorPointEditingGuide();
    drawCollider(colliderRef.current, activeToolRef.current === 'collider');
  }, [drawCollider, getZoomInvariantMetric, renderVectorPointEditingGuide, zoom]);

  const setZoomLevel = useCallback((nextZoom: number) => {
    const clampedZoom = clampZoom(nextZoom);
    setZoom(clampedZoom);
    setCameraCenter((prev) => clampCameraCenter(prev, clampedZoom));
  }, [clampCameraCenter, clampZoom]);

  const zoomToBounds = useCallback((
    bounds: { left: number; top: number; width: number; height: number },
    paddingPx = 56,
  ): boolean => {
    const view = viewportSizeRef.current;
    if (view.width <= 0 || view.height <= 0) return false;

    const availableWidth = Math.max(1, view.width - paddingPx * 2);
    const availableHeight = Math.max(1, view.height - paddingPx * 2);
    const targetScale = Math.min(
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
    );
    const targetZoom = clampZoom(targetScale / BASE_VIEW_SCALE);
    const targetCenter = clampCameraCenter({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    }, targetZoom, view);

    setZoom(targetZoom);
    setCameraCenter(targetCenter);
    return true;
  }, [clampCameraCenter, clampZoom]);

  const handleZoomToActualSize = useCallback(() => {
    setZoomLevel(1);
  }, [setZoomLevel]);

  const handleZoomToFit = useCallback(() => {
    zoomToBounds(COSTUME_WORLD_RECT, 48);
  }, [zoomToBounds]);

  const handleZoomToSelection = useCallback(() => {
    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return;
    zoomToBounds(selectionSnapshot.bounds, 72);
  }, [getSelectionBoundsSnapshot, zoomToBounds]);

  const currentViewScale = BASE_VIEW_SCALE * zoom;
  const canvasLeft = viewportSize.width / 2 - cameraCenter.x * currentViewScale;
  const canvasTop = viewportSize.height / 2 - cameraCenter.y * currentViewScale;

  return (
    <div className="relative flex-1 overflow-hidden bg-muted/50">
      <CanvasViewportOverlay
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomOut={() => zoomAroundViewportCenter(zoom - ZOOM_STEP)}
        onZoomIn={() => zoomAroundViewportCenter(zoom + ZOOM_STEP)}
        onZoomToActualSize={handleZoomToActualSize}
        onZoomToFit={handleZoomToFit}
        onZoomToSelection={handleZoomToSelection}
        canZoomToSelection={canZoomToSelection}
      />

      <div
        ref={containerRef}
        tabIndex={-1}
        className="size-full overflow-hidden relative outline-none"
        style={{
          cursor: isViewportPanning ? 'grabbing' : undefined,
          overscrollBehavior: 'contain',
        }}
      >
        <div
          ref={textEditingHostRef}
          aria-hidden="true"
          className="fixed inset-0 overflow-hidden pointer-events-none"
        />

        <div
          className="border shadow-sm absolute top-0 left-0 overflow-hidden checkerboard-bg"
          style={{
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transform: `translate(${canvasLeft}px, ${canvasTop}px) scale(${currentViewScale})`,
            transformOrigin: 'top left',
          }}
        >
          <canvas
            ref={fabricCanvasElementRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />

          <canvas
            ref={vectorStrokeCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              pointerEvents: 'none',
            }}
          />

          <canvas
            ref={vectorGuideCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              pointerEvents: 'none',
            }}
          />

          <canvas
            ref={bitmapSelectionCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              pointerEvents: editorModeState === 'bitmap' && activeTool === 'select' && !hasBitmapFloatingSelection ? 'auto' : 'none',
            }}
          />

          <canvas
            ref={colliderCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              pointerEvents: activeTool === 'collider' ? 'auto' : 'none',
            }}
          />
        </div>
        <div
          ref={brushCursorOverlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 12,
            height: 12,
            borderRadius: '9999px',
            border: '1.5px solid #111111',
            background: 'rgba(255,255,255,0.1)',
            boxShadow: 'none',
            transform: 'translate(-9999px, -9999px)',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 40,
          }}
        />
      </div>
    </div>
  );
});

CostumeCanvas.displayName = 'CostumeCanvas';

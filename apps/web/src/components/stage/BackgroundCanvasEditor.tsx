import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Minimize2 } from '@/components/ui/icons';
import { BitmapBrushCursorOverlay } from '@/components/editors/shared/BitmapBrushCursorOverlay';
import { CanvasViewportOverlay } from '@/components/editors/shared/CanvasViewportOverlay';
import { FloatingToolbarColorControl } from '@/components/editors/shared/FloatingToolbarColorControl';
import { ViewportRecoveryPill } from '@/components/editors/shared/ViewportRecoveryPill';
import { VectorSelectionContextMenu } from '@/components/editors/shared/VectorSelectionContextMenu';
import { OverlayActionButton } from '@/components/ui/overlay-action-button';
import { useBitmapBrushCursorOverlay } from '@/components/editors/shared/useBitmapBrushCursorOverlay';
import { useViewportCenterAnimation } from '@/components/editors/shared/useViewportCenterAnimation';
import { OverlayPill } from '@/components/ui/overlay-pill';
import { useModal } from '@/components/ui/modal-provider';
import {
  computeEditorViewportFitResult,
  EDITOR_VIEWPORT_FIT_PADDING_PX,
  EDITOR_VIEWPORT_SELECTION_PADDING_PX,
  EDITOR_VIEWPORT_ZOOM_STEP,
} from '@/lib/editor/editorViewportPolicy';
import type { BitmapFloatingSelectionBehavior } from '@/lib/editor/interactionSurface';
import { boundsIntersect, getBoundsFromPoints, shouldShowViewportRecovery } from '@/lib/editor/viewportRecovery';
import { hasVectorClipboardContents } from '@/lib/editor/vectorClipboard';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import type {
  BackgroundConfig,
  BackgroundDocument,
  BackgroundLayer,
  BackgroundVectorLayer,
} from '@/types';
import {
  type AlignAction,
  CostumeToolbar,
  type BitmapFillStyle,
  type BitmapShapeStyle,
  type DrawingTool as CostumeDrawingTool,
  type MoveOrderAction,
  type SelectionFlipAxis,
  type TextToolStyle,
  type VectorHandleMode,
  type VectorStyleCapabilities,
  type VectorToolStyleMixedState,
  type VectorToolStyleSelectionSnapshot,
  type VectorToolStyle,
} from '@/components/editors/costume/CostumeToolbar';
import { resolveCostumeToolShortcut } from '@/components/editors/costume/costumeToolShortcuts';
import {
  areVectorToolStylesEqual,
  areVectorToolStyleMixedStatesEqual,
  clearVectorToolStyleMixedState,
} from '@/components/editors/costume/costumeCanvasShared';
import {
  useToolbarSliderCommitBoundary,
  type ToolbarSliderChangeMeta,
} from '@/components/editors/shared/toolbarSliderCommitBoundary';
import {
  DEFAULT_BACKGROUND_CHUNK_SIZE,
  getChunkBoundsFromKeys,
  getChunkKey,
  getChunkRangeForWorldBounds,
  getChunkWorldBounds,
  iterateChunkKeys,
  parseChunkKey,
  projectChunkWorldBoundsToScreenRect,
  worldToChunkLocal,
} from '@/lib/background/chunkMath';
import {
  getCachedBackgroundChunkIndex,
  MutableBackgroundChunkIndex,
} from '@/lib/background/chunkIndex';
import {
  applyRasterPatchToChunkCanvas,
  DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT,
  DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT,
  canCreateChunk,
  createEmptyChunkCanvas,
  evaluateChunkLimits,
  getChunkCanvasContext,
  isChunkCanvasTransparent,
  normalizeChunkDataMap,
  type ChunkDataMap,
} from '@/lib/background/chunkStore';
import {
  getBitmapBrushStampDefinition,
  getBrushPaintColor,
  getCompositeOperation,
  isEraseTool,
  type BitmapBrushKind,
  type BitmapBrushTool,
} from '@/lib/background/brushCore';
import {
  applyBitmapBucketFill,
  DEFAULT_BITMAP_FILL_TEXTURE_ID,
  getBitmapFillTexturePreset,
  type BitmapFillTextureId,
} from '@/lib/background/bitmapFillCore';
import {
  getBackgroundLayerRenderSignature,
  renderBackgroundLayerToChunkData,
} from '@/lib/background/backgroundDocumentRender';
import { getCachedImageSource, loadImageSource } from '@/lib/assets/imageSourceCache';
import {
  cloneBackgroundDocument,
  createBitmapBackgroundLayer,
  createVectorBackgroundLayer,
  duplicateBackgroundLayer,
  ensureBackgroundDocument,
  getActiveBackgroundLayer,
  getActiveBackgroundLayerKind,
  getBackgroundLayerById,
  insertBackgroundLayerAfterActive,
  isBitmapBackgroundLayer,
  isVectorBackgroundLayer,
  reorderBackgroundLayer,
  removeBackgroundLayer,
  setActiveBackgroundLayer,
  setBackgroundLayerVisibility,
  updateBackgroundBitmapLayerChunks,
  updateBackgroundLayer,
  updateBackgroundVectorLayerDocument,
} from '@/lib/background/backgroundDocument';
import { DEFAULT_VECTOR_STROKE_BRUSH_ID, DEFAULT_VECTOR_STROKE_WIGGLE } from '@/lib/vector/vectorStrokeBrushCore';
import { DEFAULT_VECTOR_FILL_TEXTURE_ID } from '@/lib/vector/vectorFillTextureCore';
import {
  clampViewportZoom,
  panCameraFromDrag,
  panCameraFromWheel,
  screenPointToWorldPoint,
  screenToWorldPoint,
  worldPointToViewportScreenPoint,
  zoomCameraAtScreenPoint,
} from '@/lib/viewportNavigation';
import {
  canRedoHistory,
  canUndoHistory,
  redoHistory,
  subscribeToHistoryChanges,
  undoHistory,
} from '@/store/universalHistory';
import { calculateBoundsFromImageData } from '@/utils/imageBounds';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import {
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  computeCornerScaleResult,
  computeEdgeScaleResult,
  getTransformGizmoCornerFromTarget,
  getTransformGizmoCursorForCornerTarget,
  getTransformGizmoEdgeCursor,
  getTransformGizmoEdgeSegments,
  getTransformGizmoHandleFrame,
  hitTransformGizmoCornerTarget,
  isPointNearTransformEdge,
} from '@/lib/editor/unifiedTransformGizmo';
import type { TransformGizmoCorner, TransformGizmoCornerTarget, TransformGizmoSide } from '@/lib/editor/unifiedTransformGizmo';
import {
  renderScreenSpaceTransformOverlay,
  renderSelectionMarqueeOverlay,
} from '@/lib/editor/transformOverlayRenderer';
import {
  handleSelectionClipboardShortcuts,
  handleSelectionDeleteShortcut,
  handleSelectionGroupingShortcuts,
  handleSelectionNudgeShortcut,
  handleToolSwitchShortcut,
} from '@/lib/editor/editorSurfaceShortcuts';
import { BackgroundLayerPanel } from './BackgroundLayerPanel';
import {
  BackgroundVectorCanvas,
  type BackgroundVectorCanvasHandle,
} from './BackgroundVectorCanvas';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 10;
const INITIAL_BRUSH_COLOR = '#101010';
const INITIAL_BRUSH_SIZE = 24;
const INITIAL_SHAPE_STROKE_WIDTH = 6;
const MAX_RASTER_OPERATION_DIMENSION = 8192;
const MAX_RASTER_OPERATION_PIXELS = 36 * 1024 * 1024;
const ZOOM_STEP = EDITOR_VIEWPORT_ZOOM_STEP;

type BackgroundShapeTool = Extract<CostumeDrawingTool, 'line' | 'circle' | 'rectangle' | 'triangle' | 'star'>;
type BackgroundDrawingTool = Extract<
  CostumeDrawingTool,
  'select' | 'pen' | 'brush' | 'eraser' | 'fill' | 'line' | 'circle' | 'rectangle' | 'triangle' | 'star' | 'text'
>;

type MutationSession = {
  touched: Set<string>;
  before: Record<string, string | null>;
  serializedAfter: Record<string, string | null>;
};

type StrokeSession = MutationSession & {
  lastWorld: { x: number; y: number } | null;
};

type PanSession = {
  startX: number;
  startY: number;
  cameraStartX: number;
  cameraStartY: number;
};

type ShapeDraftSession = {
  tool: BackgroundShapeTool;
  startWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
};

type WorldPoint = { x: number; y: number };

type WorldRect = {
  left: number;
  right: number;
  bottom: number;
  top: number;
  width: number;
  height: number;
};

type ScreenPoint = { x: number; y: number };

type BackgroundSelectionMarqueeSession = {
  startWorld: WorldPoint;
  currentWorld: WorldPoint;
};

type BackgroundFloatingSelection = {
  canvas: HTMLCanvasElement;
  centerWorld: WorldPoint;
  scaleX: number;
  scaleY: number;
  rotation: number;
  originalTransform: BackgroundFloatingSelectionTransformState;
  pendingMutationSession: MutationSession;
};

type BackgroundFloatingSelectionTransformState = {
  centerWorld: WorldPoint;
  scaleX: number;
  scaleY: number;
  rotation: number;
};

type BackgroundFloatingSelectionTransformSession =
  | {
      kind: 'move';
      selection: BackgroundFloatingSelection;
      startScreen: ScreenPoint;
      startCenterWorld: WorldPoint;
    }
  | {
      kind: 'rotate';
      selection: BackgroundFloatingSelection;
      centerScreen: ScreenPoint;
      corner: TransformGizmoCorner;
      startPointerAngle: number;
      startRotation: number;
    }
  | {
      kind: 'scale';
      selection: BackgroundFloatingSelection;
      anchorScreen: ScreenPoint;
      centerScreen: ScreenPoint;
      scaleMode: 'corner' | 'edge';
      corner: TransformGizmoCorner | null;
      side: TransformGizmoSide | null;
      handleXSign: -1 | 1 | null;
      handleYSign: -1 | 1 | null;
      edge: 'horizontal' | 'vertical' | null;
      handleSign: -1 | 1 | null;
      rotation: number;
      sourceWidth: number;
      sourceHeight: number;
      startScaleX: number;
      startScaleY: number;
      proportional: boolean;
    };

type BackgroundFloatingSelectionHitTarget =
  | 'body'
  | TransformGizmoCornerTarget
  | 'scale-n'
  | 'scale-e'
  | 'scale-s'
  | 'scale-w'

type BackgroundFloatingSelectionScaleTarget = Exclude<
  BackgroundFloatingSelectionHitTarget,
  'body' | `rotate-${TransformGizmoCorner}`
>;

type BackgroundFloatingSelectionScreenGeometry = {
  centerScreen: ScreenPoint;
  corners: {
    nw: ScreenPoint;
    ne: ScreenPoint;
    se: ScreenPoint;
    sw: ScreenPoint;
  };
  halfWidth: number;
  halfHeight: number;
};

const FLOATING_SELECTION_MIN_SCREEN_SIZE = 8;

const BACKGROUND_TOOLBAR_INITIAL_TEXT_STYLE: TextToolStyle = {
  fontFamily: 'Arial',
  fontSize: 32,
  fontWeight: 'normal',
  fontStyle: 'normal',
  underline: false,
  textAlign: 'left',
  opacity: 1,
};

const BACKGROUND_TOOLBAR_VECTOR_STYLE: VectorToolStyle = {
  fillColor: '#000000',
  fillTextureId: DEFAULT_VECTOR_FILL_TEXTURE_ID,
  fillOpacity: 1,
  strokeColor: '#000000',
  strokeOpacity: 1,
  strokeWidth: 1,
  strokeBrushId: DEFAULT_VECTOR_STROKE_BRUSH_ID,
  strokeWiggle: DEFAULT_VECTOR_STROKE_WIGGLE,
};

const BACKGROUND_TOOLBAR_INITIAL_VECTOR_HANDLE_MODE: VectorHandleMode = 'linear';
const BACKGROUND_TOOLBAR_INITIAL_VECTOR_CAPABILITIES: VectorStyleCapabilities = { supportsFill: true };

function isShapeTool(tool: BackgroundDrawingTool): tool is BackgroundShapeTool {
  return tool === 'line' || tool === 'circle' || tool === 'rectangle' || tool === 'triangle' || tool === 'star';
}

function isBackgroundToolbarTool(tool: CostumeDrawingTool): tool is BackgroundDrawingTool {
  return (
    tool === 'select' ||
    tool === 'pen' ||
    tool === 'brush' ||
    tool === 'eraser' ||
    tool === 'fill' ||
    tool === 'rectangle' ||
    tool === 'circle' ||
    tool === 'triangle' ||
    tool === 'star' ||
    tool === 'line' ||
    tool === 'text'
  );
}

function ensureToolForBackgroundMode(mode: 'bitmap' | 'vector', tool: BackgroundDrawingTool): BackgroundDrawingTool {
  if (mode === 'vector') {
    return tool === 'select' || tool === 'pen' || tool === 'brush' || tool === 'text' || isShapeTool(tool) ? tool : 'select';
  }
  return tool === 'eraser' || tool === 'fill' || tool === 'brush' || tool === 'select' || isShapeTool(tool) ? tool : 'brush';
}

function toSupportedVectorTool(
  tool: BackgroundDrawingTool,
): Extract<BackgroundDrawingTool, 'select' | 'pen' | 'brush' | 'rectangle' | 'circle' | 'triangle' | 'star' | 'line' | 'text'> {
  return ensureToolForBackgroundMode('vector', tool) as Extract<
    BackgroundDrawingTool,
    'select' | 'pen' | 'brush' | 'rectangle' | 'circle' | 'triangle' | 'star' | 'line' | 'text'
  >;
}

function getWorldRectFromPoints(start: WorldPoint, end: WorldPoint): WorldRect {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const bottom = Math.min(start.y, end.y);
  const top = Math.max(start.y, end.y);
  return {
    left,
    right,
    bottom,
    top,
    width: right - left,
    height: top - bottom,
  };
}

function mergeWorldRects(...rects: Array<WorldRect | null | undefined>): WorldRect | null {
  const validRects = rects.filter((rect): rect is WorldRect => !!rect);
  if (validRects.length === 0) {
    return null;
  }

  const left = Math.min(...validRects.map((rect) => rect.left));
  const right = Math.max(...validRects.map((rect) => rect.right));
  const bottom = Math.min(...validRects.map((rect) => rect.bottom));
  const top = Math.max(...validRects.map((rect) => rect.top));
  return {
    left,
    right,
    bottom,
    top,
    width: right - left,
    height: top - bottom,
  };
}

function toWorldRect(
  bounds: { left: number; right: number; bottom: number; top: number } | null | undefined,
): WorldRect | null {
  if (!bounds) {
    return null;
  }

  return {
    left: bounds.left,
    right: bounds.right,
    bottom: bounds.bottom,
    top: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.top - bounds.bottom,
  };
}

function cloneFloatingSelectionTransformState(
  transform: BackgroundFloatingSelectionTransformState,
): BackgroundFloatingSelectionTransformState {
  return {
    centerWorld: {
      x: transform.centerWorld.x,
      y: transform.centerWorld.y,
    },
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
  };
}

function getCurrentFloatingSelectionTransformState(
  selection: BackgroundFloatingSelection,
): BackgroundFloatingSelectionTransformState {
  return {
    centerWorld: {
      x: selection.centerWorld.x,
      y: selection.centerWorld.y,
    },
    scaleX: selection.scaleX,
    scaleY: selection.scaleY,
    rotation: selection.rotation,
  };
}

function isBackgroundFloatingSelectionScaleTarget(
  target: BackgroundFloatingSelectionHitTarget,
): target is BackgroundFloatingSelectionScaleTarget {
  return target.startsWith('scale-');
}

function getShapeWorldBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  strokeWidth: number,
) {
  const halfStroke = Math.max(0, strokeWidth) * 0.5;
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const bottom = Math.min(start.y, end.y);
  const top = Math.max(start.y, end.y);

  return {
    left,
    right,
    bottom,
    top,
    expandedLeft: left - halfStroke,
    expandedRight: right + halfStroke,
    expandedBottom: bottom - halfStroke,
    expandedTop: top + halfStroke,
    width: right - left,
    height: top - bottom,
  };
}

function buildTrianglePoints(width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x: width * 0.5, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function buildStarPoints(width: number, height: number, innerRatio: number = 0.5) {
  const pointCount = 5;
  const outerRadius = Math.min(width, height) * 0.5;
  const innerRadius = outerRadius * innerRatio;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < pointCount * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / pointCount;
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  }

  return points;
}

function rotatePoint(point: ScreenPoint, radians: number): ScreenPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function traceBackgroundShapePath(
  ctx: CanvasRenderingContext2D,
  shapeTool: BackgroundShapeTool,
  start: WorldPoint,
  end: WorldPoint,
  mapWorldPoint: (x: number, y: number) => { x: number; y: number },
) {
  const bounds = getShapeWorldBounds(start, end, 0);
  ctx.beginPath();

  if (shapeTool === 'rectangle') {
    const topLeft = mapWorldPoint(bounds.left, bounds.top);
    ctx.rect(topLeft.x, topLeft.y, bounds.width, bounds.height);
    return;
  }

  if (shapeTool === 'circle') {
    const center = mapWorldPoint((bounds.left + bounds.right) * 0.5, (bounds.top + bounds.bottom) * 0.5);
    ctx.ellipse(center.x, center.y, bounds.width * 0.5, bounds.height * 0.5, 0, 0, Math.PI * 2);
    return;
  }

  if (shapeTool === 'line') {
    const startPoint = mapWorldPoint(start.x, start.y);
    const endPoint = mapWorldPoint(end.x, end.y);
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    return;
  }

  const localPoints = shapeTool === 'triangle'
    ? buildTrianglePoints(bounds.width, bounds.height)
    : buildStarPoints(bounds.width, bounds.height);
  localPoints.forEach((point, index) => {
    const mapped = mapWorldPoint(bounds.left + point.x, bounds.top - point.y);
    if (index === 0) {
      ctx.moveTo(mapped.x, mapped.y);
    } else {
      ctx.lineTo(mapped.x, mapped.y);
    }
  });
  ctx.closePath();
}

function getFloatingSelectionWorldCorners(
  selection: BackgroundFloatingSelection,
  transform: BackgroundFloatingSelectionTransformState = getCurrentFloatingSelectionTransformState(selection),
): Array<WorldPoint> {
  const halfWidth = selection.canvas.width * Math.abs(transform.scaleX) * 0.5;
  const halfHeight = selection.canvas.height * Math.abs(transform.scaleY) * 0.5;
  const localCorners: Array<WorldPoint> = [
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: -halfHeight },
  ];

  return localCorners.map((corner) => {
    const rotated = rotatePoint(corner, transform.rotation);
    return {
      x: transform.centerWorld.x + rotated.x,
      y: transform.centerWorld.y + rotated.y,
    };
  });
}

function getFloatingSelectionWorldBounds(
  selection: BackgroundFloatingSelection,
  transform: BackgroundFloatingSelectionTransformState = getCurrentFloatingSelectionTransformState(selection),
): WorldRect {
  const corners = getFloatingSelectionWorldCorners(selection, transform);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const bottom = Math.min(...ys);
  const top = Math.max(...ys);
  return {
    left,
    right,
    bottom,
    top,
    width: right - left,
    height: top - bottom,
  };
}

function getFloatingSelectionScreenGeometry(
  selection: BackgroundFloatingSelection,
  worldToScreen: (worldX: number, worldY: number) => ScreenPoint,
  zoom: number,
): BackgroundFloatingSelectionScreenGeometry {
  const centerScreen = worldToScreen(selection.centerWorld.x, selection.centerWorld.y);
  const halfWidth = selection.canvas.width * Math.abs(selection.scaleX) * zoom * 0.5;
  const halfHeight = selection.canvas.height * Math.abs(selection.scaleY) * zoom * 0.5;
  const frame = getTransformGizmoHandleFrame(centerScreen, halfWidth * 2, halfHeight * 2, -selection.rotation);

  return {
    centerScreen,
    corners: frame.corners,
    halfWidth,
    halfHeight,
  };
}

function getFallbackColor(background: BackgroundConfig | null | undefined): string {
  const value = background?.value;
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim();
  }
  return '#87CEEB';
}

async function dataUrlToCanvas(dataUrl: string, chunkSize: number): Promise<HTMLCanvasElement | null> {
  try {
    const image = await loadImageSource(dataUrl);
    const canvas = createEmptyChunkCanvas(chunkSize);
    const ctx = getChunkCanvasContext(canvas);
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null;
  }
}

function areRenderedLayerChunkEntriesEqual(
  left: Record<string, ChunkDataMap>,
  right: Record<string, ChunkDataMap>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!(key in right) || left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

export function BackgroundCanvasEditor() {
  const { showAlert } = useModal();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const brushCursorOverlayRef = useRef<HTMLDivElement>(null);
  const vectorCanvasRef = useRef<BackgroundVectorCanvasHandle | null>(null);
  const pointerWorldRef = useRef<{ x: number; y: number } | null>(null);
  const drawingStrokeRef = useRef<StrokeSession | null>(null);
  const shapeDraftRef = useRef<ShapeDraftSession | null>(null);
  const selectionMarqueeRef = useRef<BackgroundSelectionMarqueeSession | null>(null);
  const floatingSelectionRef = useRef<BackgroundFloatingSelection | null>(null);
  const floatingSelectionTransformRef = useRef<BackgroundFloatingSelectionTransformSession | null>(null);
  const floatingSelectionBusyRef = useRef(false);
  const rasterOperationBusyRef = useRef(false);
  const panSessionRef = useRef<PanSession | null>(null);
  const activeChunkDecodePromisesRef = useRef<Map<string, {
    source: string;
    chunkSize: number;
    promise: Promise<HTMLCanvasElement | null>;
  }>>(new Map());
  const chunkCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const chunkDataRef = useRef<ChunkDataMap>({});
  const chunkKeySetRef = useRef<Set<string>>(new Set());
  const activeChunkIndexRef = useRef(new MutableBackgroundChunkIndex<true>());
  const layerChunkCanvasCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const layerChunkDecodePromisesRef = useRef<Map<string, Promise<HTMLCanvasElement | null>>>(new Map());
  const fillTextureCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const fillTexturePromiseRef = useRef<Map<string, Promise<HTMLImageElement | null>>>(new Map());
  const renderedLayerChunksRef = useRef<Record<string, ChunkDataMap>>({});
  const renderedLayerChunkSignaturesRef = useRef<Record<string, string>>({});
  const renderedLayerChunkRequestIdRef = useRef(0);
  const bitmapWorkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bitmapStateEpochRef = useRef(0);
  const didMountRef = useRef(false);
  const initializedSceneIdRef = useRef<string | null>(null);
  const lastCommittedBackgroundRef = useRef<BackgroundConfig | null | undefined>(null);
  const backgroundColorCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialBackgroundColorRef = useRef('#87CEEB');
  const backgroundColorRef = useRef('#87CEEB');
  const backgroundDocumentRef = useRef<BackgroundDocument | null>(null);
  const activeLayerDirtyRef = useRef(false);

  const [tool, setTool] = useState<BackgroundDrawingTool>('brush');
  const [bitmapBrushKind, setBitmapBrushKind] = useState<BitmapBrushKind>('hard-round');
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [backgroundColor, setBackgroundColor] = useState('#87CEEB');
  const [backgroundColorPickerOpen, setBackgroundColorPickerOpen] = useState(false);
  const backgroundColorPickerPreviewActiveRef = useRef(false);
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [bitmapFillStyle, setBitmapFillStyle] = useState<BitmapFillStyle>({
    textureId: DEFAULT_BITMAP_FILL_TEXTURE_ID,
  });
  const [bitmapShapeStyle, setBitmapShapeStyle] = useState<BitmapShapeStyle>({
    fillColor: INITIAL_BRUSH_COLOR,
    strokeColor: INITIAL_BRUSH_COLOR,
    strokeWidth: INITIAL_SHAPE_STROKE_WIDTH,
  });
  const [textStyle, setTextStyle] = useState<TextToolStyle>(BACKGROUND_TOOLBAR_INITIAL_TEXT_STYLE);
  const [vectorStyle, setVectorStyle] = useState<VectorToolStyle>(BACKGROUND_TOOLBAR_VECTOR_STYLE);
  const [vectorStyleChangeRevision, setVectorStyleChangeRevision] = useState(0);
  const [latestVectorStyleUpdates, setLatestVectorStyleUpdates] = useState<Partial<VectorToolStyle>>({});
  const [zoom, setZoom] = useState(0.5);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [activeChunkCount, setActiveChunkCount] = useState(0);
  const [activeBitmapContentBounds, setActiveBitmapContentBounds] = useState<WorldRect | null>(null);
  const [chunkLimitWarning, setChunkLimitWarning] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isRasterOperationBusy, setIsRasterOperationBusy] = useState(false);
  const [hasFloatingSelection, setHasFloatingSelection] = useState(false);
  const [backgroundDocument, setBackgroundDocumentState] = useState<BackgroundDocument | null>(null);
  const [renderedLayerChunks, setRenderedLayerChunks] = useState<Record<string, ChunkDataMap>>({});
  const [hasVectorSelection, setHasVectorSelection] = useState(false);
  const [canGroupVectorSelection, setCanGroupVectorSelection] = useState(false);
  const [canUngroupVectorSelection, setCanUngroupVectorSelection] = useState(false);
  const [vectorContextMenuPosition, setVectorContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [canZoomToVectorSelection, setCanZoomToVectorSelection] = useState(false);
  const [hasVectorTextSelection, setHasVectorTextSelection] = useState(false);
  const [isVectorPointEditing, setIsVectorPointEditing] = useState(false);
  const [hasSelectedVectorPoints, setHasSelectedVectorPoints] = useState(false);
  const [vectorHandleMode, setVectorHandleMode] = useState<VectorHandleMode>(BACKGROUND_TOOLBAR_INITIAL_VECTOR_HANDLE_MODE);
  const [vectorStyleCapabilities, setVectorStyleCapabilities] = useState<VectorStyleCapabilities>(BACKGROUND_TOOLBAR_INITIAL_VECTOR_CAPABILITIES);
  const [vectorStyleMixedState, setVectorStyleMixedState] = useState<VectorToolStyleMixedState>({});
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const {
    registerSliderChangeMeta,
    sliderCommitBoundaryState,
    sliderCommitBoundaryStateRef,
  } = useToolbarSliderCommitBoundary();
  const pendingSliderVectorDocumentCommitRef = useRef(false);
  const previousSliderCommitRevisionRef = useRef(sliderCommitBoundaryState.commitRevision);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const vectorStyleRef = useRef(vectorStyle);
  const vectorStyleMixedStateRef = useRef(vectorStyleMixedState);
  const syncGlobalHistoryFlags = useCallback(() => {
    setCanUndo(canUndoHistory());
    setCanRedo(canRedoHistory());
  }, []);

  useEffect(() => {
    syncGlobalHistoryFlags();
    return subscribeToHistoryChanges(syncGlobalHistoryFlags);
  }, [syncGlobalHistoryFlags]);

  const {
    project,
    updateScene,
  } = useProjectStore();

  const {
    backgroundEditorOpen,
    backgroundEditorSceneId,
    isDarkMode,
    selectedSceneId,
    closeBackgroundEditor,
    registerBackgroundUndo,
  } = useEditorStore();

  const scene = useMemo(() => {
    if (!project) return null;
    const sceneId = backgroundEditorSceneId ?? selectedSceneId;
    if (!sceneId) return null;
    return project.scenes.find((candidate) => candidate.id === sceneId) ?? null;
  }, [backgroundEditorSceneId, project, selectedSceneId]);

  const chunkSize = useMemo(() => {
    const value = backgroundDocument?.chunkSize ?? (scene?.background?.type === 'tiled' ? scene.background.chunkSize : undefined);
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return DEFAULT_BACKGROUND_CHUNK_SIZE;
    return Math.max(32, Math.floor(value as number));
  }, [backgroundDocument?.chunkSize, scene?.background]);

  const softChunkLimit = useMemo(() => {
    const value = backgroundDocument?.softChunkLimit ?? (scene?.background?.type === 'tiled' ? scene.background.softChunkLimit : undefined);
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT;
    return Math.floor(value as number);
  }, [backgroundDocument?.softChunkLimit, scene?.background]);

  const hardChunkLimit = useMemo(() => {
    const value = backgroundDocument?.hardChunkLimit ?? (scene?.background?.type === 'tiled' ? scene.background.hardChunkLimit : undefined);
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT;
    return Math.max(softChunkLimit, Math.floor(value as number));
  }, [backgroundDocument?.hardChunkLimit, scene?.background, softChunkLimit]);

  backgroundDocumentRef.current = backgroundDocument;
  const activeLayer = useMemo(() => getActiveBackgroundLayer(backgroundDocument), [backgroundDocument]);
  const editorMode = useMemo(() => getActiveBackgroundLayerKind(backgroundDocument), [backgroundDocument]);
  const resolveBrushCursorState = useCallback(() => {
    const layerInteractive = !!activeLayer && activeLayer.visible && !activeLayer.locked;
    const enabled = layerInteractive && editorMode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    return {
      brushColor,
      brushKind: bitmapBrushKind,
      brushOpacity,
      brushSize,
      displayScale: zoom,
      enabled,
      tool: enabled ? tool : null,
    };
  }, [activeLayer, bitmapBrushKind, brushColor, brushOpacity, brushSize, editorMode, tool, zoom]);
  const { syncBrushCursorOverlay } = useBitmapBrushCursorOverlay({
    containerRef: hostRef,
    overlayRef: brushCursorOverlayRef,
    resolveCursorState: resolveBrushCursorState,
  });

  useEffect(() => {
    if (editorMode === 'vector') {
      return;
    }
    setHasVectorSelection(false);
    setCanGroupVectorSelection(false);
    setCanUngroupVectorSelection(false);
    setCanZoomToVectorSelection(false);
    setHasVectorTextSelection(false);
    setIsVectorPointEditing(false);
    setHasSelectedVectorPoints(false);
    setVectorHandleMode(BACKGROUND_TOOLBAR_INITIAL_VECTOR_HANDLE_MODE);
    setVectorStyleCapabilities(BACKGROUND_TOOLBAR_INITIAL_VECTOR_CAPABILITIES);
    setVectorStyleMixedState({});
  }, [editorMode, activeLayer?.id]);

  useEffect(() => {
    syncBrushCursorOverlay();
  }, [
    activeLayer?.id,
    activeLayer?.locked,
    activeLayer?.visible,
    bitmapBrushKind,
    brushColor,
    brushOpacity,
    brushSize,
    editorMode,
    syncBrushCursorOverlay,
    tool,
    zoom,
  ]);

  vectorStyleRef.current = vectorStyle;
  vectorStyleMixedStateRef.current = vectorStyleMixedState;

  backgroundColorRef.current = backgroundColor;
  const cameraBounds = useMemo(() => ({
    left: -(project?.settings.canvasWidth ?? 800) / 2,
    right: (project?.settings.canvasWidth ?? 800) / 2,
    bottom: -(project?.settings.canvasHeight ?? 600) / 2,
    top: (project?.settings.canvasHeight ?? 600) / 2,
  }), [project?.settings.canvasHeight, project?.settings.canvasWidth]);
  const vectorAlignmentBounds = useMemo(() => ({
    left: cameraBounds.left,
    top: -cameraBounds.top,
    width: cameraBounds.right - cameraBounds.left,
    height: cameraBounds.top - cameraBounds.bottom,
  }), [cameraBounds.bottom, cameraBounds.left, cameraBounds.right, cameraBounds.top]);
  const overlayPillTone = isDarkMode ? 'dark' : 'light';

  const screenToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const host = hostRef.current;
    if (!host) return camera;
    return screenToWorldPoint(clientX, clientY, host.getBoundingClientRect(), camera, zoom, 'up');
  }, [camera, zoom]);

  const worldToScreen = useCallback((worldX: number, worldY: number): { x: number; y: number } => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    return worldPointToViewportScreenPoint(
      { x: worldX, y: worldY },
      host.getBoundingClientRect(),
      camera,
      zoom,
      'up',
    );
  }, [camera, zoom]);

  const getScreenPoint = useCallback((clientX: number, clientY: number): ScreenPoint => {
    const host = hostRef.current;
    if (!host) {
      return { x: 0, y: 0 };
    }
    const rect = host.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const screenToWorldFromCanvasPoint = useCallback((screenPoint: ScreenPoint): WorldPoint => {
    const host = hostRef.current;
    if (!host) {
      return camera;
    }
    const rect = host.getBoundingClientRect();
    return screenPointToWorldPoint(screenPoint, rect, camera, zoom, 'up');
  }, [camera, zoom]);

  const {
    animateToCenter: animateCameraToCenter,
    cancelAnimation: cancelCameraCenterAnimation,
  } = useViewportCenterAnimation({
    getCurrentCenter: () => cameraRef.current,
    applyCenter: (center) => {
      setCamera({
        x: center.x,
        y: center.y,
      });
    },
  });

  const fitToBounds = useCallback((
    bounds: { left: number; right: number; bottom: number; top: number },
    paddingPx = EDITOR_VIEWPORT_FIT_PADDING_PX,
  ) => {
    cancelCameraCenterAnimation();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const fitResult = computeEditorViewportFitResult({
      bounds,
      viewportSize: rect,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      paddingPx,
    });
    if (!fitResult) {
      return;
    }
    setZoom(fitResult.zoom);
    setCamera({
      x: fitResult.centerX,
      y: fitResult.centerY,
    });
  }, [cancelCameraCenterAnimation]);

  const syncUndoRedoAvailability = useCallback(() => {
    setCanUndo(canUndoHistory());
    setCanRedo(canRedoHistory());
  }, []);

  const syncActiveChunkCount = useCallback(() => {
    setActiveChunkCount(chunkKeySetRef.current.size);
    setActiveBitmapContentBounds(toWorldRect(getChunkBoundsFromKeys(chunkKeySetRef.current, chunkSize)));
  }, [chunkSize]);

  const replaceActiveBitmapLayerState = useCallback((
    nextState: {
      chunkData: ChunkDataMap;
      chunkCanvases: Map<string, HTMLCanvasElement>;
      chunkKeys: Set<string>;
    },
  ) => {
    chunkDataRef.current = nextState.chunkData;
    chunkCanvasesRef.current = nextState.chunkCanvases;
    chunkKeySetRef.current = nextState.chunkKeys;
    activeChunkIndexRef.current.clear();
    for (const key of nextState.chunkKeys) {
      activeChunkIndexRef.current.set(key, true);
    }
    syncActiveChunkCount();
  }, [syncActiveChunkCount]);

  const bitmapContentBounds = useMemo<WorldRect | null>(() => {
    if (!backgroundDocument) {
      return activeBitmapContentBounds;
    }

    return backgroundDocument.layers.reduce<WorldRect | null>((combinedBounds, layer) => {
      const layerBounds = layer.id === backgroundDocument.activeLayerId && isBitmapBackgroundLayer(layer)
        ? activeBitmapContentBounds
        : toWorldRect(getChunkBoundsFromKeys(Object.keys(renderedLayerChunks[layer.id] ?? {}), chunkSize));
      return mergeWorldRects(combinedBounds, layerBounds);
    }, null);
  }, [activeBitmapContentBounds, backgroundDocument, chunkSize, renderedLayerChunks]);

  const worldBoundaryContentBounds = useMemo<WorldRect | null>(() => {
    const bounds = getBoundsFromPoints(scene?.worldBoundary?.enabled ? (scene.worldBoundary.points || []) : []);
    if (!bounds) {
      return null;
    }
    return {
      left: bounds.left,
      right: bounds.right,
      bottom: bounds.bottom,
      top: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.top - bounds.bottom,
    };
  }, [scene?.worldBoundary?.enabled, scene?.worldBoundary?.points]);

  const fitToContent = useCallback(() => {
    const contentBounds = mergeWorldRects(
      bitmapContentBounds,
      toWorldRect(vectorCanvasRef.current?.getDocumentBounds() ?? null),
      worldBoundaryContentBounds,
    );
    if (contentBounds) {
      fitToBounds(contentBounds);
      return;
    }
    fitToBounds(cameraBounds);
  }, [bitmapContentBounds, cameraBounds, fitToBounds, worldBoundaryContentBounds]);

  const showReturnToCenter = useMemo(() => {
    const hasVisibleContent = [
      bitmapContentBounds,
      editorMode === 'vector' ? (vectorCanvasRef.current?.getDocumentBounds() ?? null) : null,
      floatingSelectionRef.current ? getFloatingSelectionWorldBounds(floatingSelectionRef.current) : null,
      worldBoundaryContentBounds,
    ].some((bounds) => !!bounds && boundsIntersect(cameraBounds, bounds));

    return shouldShowViewportRecovery({
      currentCenter: camera,
      homeCenter: { x: 0, y: 0 },
      viewportSize: {
        width: cameraBounds.right - cameraBounds.left,
        height: cameraBounds.top - cameraBounds.bottom,
      },
      hasVisibleContent,
    });
  }, [bitmapContentBounds, camera, cameraBounds, editorMode, worldBoundaryContentBounds]);

  const zoomAtClientPoint = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    cancelCameraCenterAnimation();
    const clampedZoom = clampViewportZoom(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const host = hostRef.current;
    if (!host) {
      setZoom(clampedZoom);
      return;
    }

    const rect = host.getBoundingClientRect();
    setCamera((current) => zoomCameraAtScreenPoint(
      getScreenPoint(clientX, clientY),
      rect,
      current,
      zoom,
      clampedZoom,
      'up',
      ));
    setZoom(clampedZoom);
  }, [cancelCameraCenterAnimation, getScreenPoint, zoom]);

  const zoomAroundViewportCenter = useCallback((nextZoom: number) => {
    const host = hostRef.current;
    if (!host) {
      setZoom(clampViewportZoom(nextZoom, MIN_ZOOM, MAX_ZOOM));
      return;
    }

    const rect = host.getBoundingClientRect();
    zoomAtClientPoint(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5, nextZoom);
  }, [zoomAtClientPoint]);

  const handleZoomToActualSize = useCallback(() => {
    zoomAroundViewportCenter(1);
  }, [zoomAroundViewportCenter]);

  const handleReturnToCenter = useCallback(() => {
    animateCameraToCenter({ x: 0, y: 0 });
  }, [animateCameraToCenter]);

  const handleZoomToSelection = useCallback(() => {
    if (editorMode === 'vector') {
      const selectionBounds = vectorCanvasRef.current?.getSelectionBounds();
      if (!selectionBounds) {
        return;
      }
      fitToBounds(selectionBounds, EDITOR_VIEWPORT_SELECTION_PADDING_PX);
      return;
    }

    const selection = floatingSelectionRef.current;
    if (!selection) return;
    fitToBounds(getFloatingSelectionWorldBounds(selection), EDITOR_VIEWPORT_SELECTION_PADDING_PX);
  }, [editorMode, fitToBounds]);

  const resolveBitmapFillTextureSource = useCallback((textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }

    if (fillTextureCacheRef.current.has(texturePath)) {
      return fillTextureCacheRef.current.get(texturePath) ?? null;
    }

    const cachedImage = getCachedImageSource(texturePath);
    if (cachedImage) {
      fillTextureCacheRef.current.set(texturePath, cachedImage);
      return cachedImage;
    }

    if (!fillTexturePromiseRef.current.has(texturePath)) {
      const loadPromise = loadImageSource(texturePath)
        .then((image) => {
          fillTextureCacheRef.current.set(texturePath, image);
          fillTexturePromiseRef.current.delete(texturePath);
          setRevision((value) => value + 1);
          return image;
        })
        .catch(() => {
          fillTextureCacheRef.current.set(texturePath, null);
          fillTexturePromiseRef.current.delete(texturePath);
          return null;
        });
      fillTexturePromiseRef.current.set(texturePath, loadPromise);
    }

    return null;
  }, []);

  const ensureBitmapFillTextureSource = useCallback(async (textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }

    const cached = resolveBitmapFillTextureSource(textureId);
    if (cached) {
      return cached;
    }

    const pending = fillTexturePromiseRef.current.get(texturePath);
    if (!pending) {
      return null;
    }

    return pending;
  }, [resolveBitmapFillTextureSource]);

  useEffect(() => {
    resolveBitmapFillTextureSource(bitmapFillStyle.textureId);
  }, [bitmapFillStyle.textureId, resolveBitmapFillTextureSource]);

  const replaceBackgroundDocument = useCallback((nextDocument: BackgroundDocument | null) => {
    backgroundDocumentRef.current = nextDocument;
    setBackgroundDocumentState(nextDocument ? cloneBackgroundDocument(nextDocument) : null);
  }, []);

  const createCommittedBackgroundConfig = useCallback((
    nextDocument: BackgroundDocument,
    nextColor: string,
  ): BackgroundConfig => ({
    type: 'tiled',
    value: nextColor,
    scrollFactor: scene?.background?.scrollFactor,
    version: 1,
    chunkSize: nextDocument.chunkSize,
    softChunkLimit: nextDocument.softChunkLimit,
    hardChunkLimit: nextDocument.hardChunkLimit,
    document: cloneBackgroundDocument(nextDocument),
  }), [scene?.background?.scrollFactor]);

  const commitBackgroundDocumentState = useCallback((
    nextDocument: BackgroundDocument,
    nextColor: string,
    source: string,
    options?: { allowMerge?: boolean; mergeWindowMs?: number },
  ) => {
    if (!scene) {
      return;
    }

    replaceBackgroundDocument(nextDocument);
    const nextBackground = createCommittedBackgroundConfig(nextDocument, nextColor);
    lastCommittedBackgroundRef.current = nextBackground;
    updateScene(scene.id, {
      background: nextBackground,
    }, {
      history: {
        source,
        allowMerge: options?.allowMerge ?? false,
        mergeWindowMs: options?.mergeWindowMs,
      },
    });
    activeLayerDirtyRef.current = false;
    setIsDirty(true);
    setRevision((value) => value + 1);
  }, [createCommittedBackgroundConfig, replaceBackgroundDocument, scene, updateScene]);

  const markActiveLayerDirty = useCallback(() => {
    activeLayerDirtyRef.current = true;
    setIsDirty(true);
    setRevision((value) => value + 1);
  }, []);

  const handleVectorHistoryStateChange = useCallback((state: {
    canUndo: boolean;
    canRedo: boolean;
    isDirty: boolean;
  }) => {
    activeLayerDirtyRef.current = state.isDirty;
    setIsDirty(
      state.isDirty ||
      backgroundColorRef.current !== initialBackgroundColorRef.current,
    );
  }, []);

  const decodeActiveChunkCanvas = useCallback((
    key: string,
    serialized: string,
    targetChunkSize: number,
  ): Promise<HTMLCanvasElement | null> => {
    const existing = activeChunkDecodePromisesRef.current.get(key);
    if (existing?.source === serialized && existing.chunkSize === targetChunkSize) {
      return existing.promise;
    }

    const promise = dataUrlToCanvas(serialized, targetChunkSize).finally(() => {
      const latest = activeChunkDecodePromisesRef.current.get(key);
      if (latest?.promise === promise) {
        activeChunkDecodePromisesRef.current.delete(key);
      }
    });
    activeChunkDecodePromisesRef.current.set(key, {
      source: serialized,
      chunkSize: targetChunkSize,
      promise,
    });
    return promise;
  }, []);

  const decodeLayerChunkCanvas = useCallback((
    cacheKey: string,
    dataUrl: string,
  ): Promise<HTMLCanvasElement | null> => {
    const existing = layerChunkDecodePromisesRef.current.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = dataUrlToCanvas(dataUrl, chunkSize).finally(() => {
      const latest = layerChunkDecodePromisesRef.current.get(cacheKey);
      if (latest === promise) {
        layerChunkDecodePromisesRef.current.delete(cacheKey);
      }
    });
    layerChunkDecodePromisesRef.current.set(cacheKey, promise);
    return promise;
  }, [chunkSize]);

  const loadBitmapLayerStateForChunkSize = useCallback(async (
    layer: BackgroundLayer | null,
    nextChunkSize: number,
  ) => {
    bitmapStateEpochRef.current += 1;
    const epoch = bitmapStateEpochRef.current;
    chunkCanvasesRef.current.clear();
    activeChunkDecodePromisesRef.current.clear();
    layerChunkCanvasCacheRef.current.clear();
    layerChunkDecodePromisesRef.current.clear();
    selectionMarqueeRef.current = null;
    floatingSelectionRef.current = null;
    floatingSelectionTransformRef.current = null;
    floatingSelectionBusyRef.current = false;
    setHasFloatingSelection(false);

    const initialChunks = isBitmapBackgroundLayer(layer) ? normalizeChunkDataMap(layer.bitmap.chunks) : {};
    replaceActiveBitmapLayerState({
      chunkData: { ...initialChunks },
      chunkCanvases: new Map(),
      chunkKeys: new Set(Object.keys(initialChunks)),
    });
    const nextChunkCanvases = new Map<string, HTMLCanvasElement>();
    const decodedEntries = await Promise.all(Object.entries(initialChunks).map(async ([key, dataUrl]) => {
      const decoded = await decodeActiveChunkCanvas(key, dataUrl, nextChunkSize);
      return [key, decoded] as const;
    }));

    if (bitmapStateEpochRef.current !== epoch) {
      return;
    }

    for (const [key, decoded] of decodedEntries) {
      if (decoded) {
        nextChunkCanvases.set(key, decoded);
      }
    }

    replaceActiveBitmapLayerState({
      chunkData: { ...initialChunks },
      chunkCanvases: nextChunkCanvases,
      chunkKeys: new Set(Object.keys(initialChunks)),
    });

    setRevision((value) => value + 1);
  }, [decodeActiveChunkCanvas, replaceActiveBitmapLayerState]);

  const loadActiveBitmapLayerState = useCallback(async (layer: BackgroundLayer | null) => {
    await loadBitmapLayerStateForChunkSize(layer, chunkSize);
  }, [chunkSize, loadBitmapLayerStateForChunkSize]);

  const persistActiveLayerIntoDocument = useCallback((document: BackgroundDocument | null): BackgroundDocument | null => {
    if (!document) {
      return null;
    }

    const activeDocumentLayer = getActiveBackgroundLayer(document);
    if (!activeDocumentLayer) {
      return document;
    }

    if (isBitmapBackgroundLayer(activeDocumentLayer)) {
      return updateBackgroundBitmapLayerChunks(document, activeDocumentLayer.id, chunkDataRef.current) ?? document;
    }

    if (isVectorBackgroundLayer(activeDocumentLayer)) {
      const serialized = vectorCanvasRef.current?.serialize();
      if (!serialized) {
        return document;
      }
      return updateBackgroundVectorLayerDocument(document, activeDocumentLayer.id, serialized) ?? document;
    }

    return document;
  }, []);

  const handleVectorDocumentCommit = useCallback(() => {
    if (sliderCommitBoundaryStateRef.current.isPreviewActive) {
      pendingSliderVectorDocumentCommitRef.current = true;
      return;
    }
    const nextDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    if (!nextDocument) {
      return;
    }

    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-vector');
    pendingSliderVectorDocumentCommitRef.current = false;
    vectorCanvasRef.current?.resetHistoryToCurrent();
    syncUndoRedoAvailability();
  }, [commitBackgroundDocumentState, persistActiveLayerIntoDocument, sliderCommitBoundaryStateRef, syncUndoRedoAvailability]);

  useEffect(() => {
    const commitRequested = previousSliderCommitRevisionRef.current !== sliderCommitBoundaryState.commitRevision;
    previousSliderCommitRevisionRef.current = sliderCommitBoundaryState.commitRevision;
    if (!commitRequested || !pendingSliderVectorDocumentCommitRef.current) {
      return;
    }
    handleVectorDocumentCommit();
  }, [handleVectorDocumentCommit, sliderCommitBoundaryState.commitRevision]);

  const applyNextDocumentState = useCallback(async (
    nextDocument: BackgroundDocument,
    options?: { preserveTool?: boolean },
  ) => {
    replaceBackgroundDocument(nextDocument);
    activeLayerDirtyRef.current = false;
    syncUndoRedoAvailability();
    const nextLayer = getActiveBackgroundLayer(nextDocument);
    await loadActiveBitmapLayerState(nextLayer);
    if (!options?.preserveTool) {
      setTool((currentTool) => ensureToolForBackgroundMode(getActiveBackgroundLayerKind(nextDocument), currentTool));
    }
    setHasVectorSelection(false);
    setCanZoomToVectorSelection(false);
    setHasVectorTextSelection(false);
    setIsVectorPointEditing(false);
    setHasSelectedVectorPoints(false);
    setVectorHandleMode(BACKGROUND_TOOLBAR_INITIAL_VECTOR_HANDLE_MODE);
    setVectorStyleCapabilities(BACKGROUND_TOOLBAR_INITIAL_VECTOR_CAPABILITIES);
    setIsDirty(true);
    setRevision((value) => value + 1);
  }, [loadActiveBitmapLayerState, replaceBackgroundDocument, syncUndoRedoAvailability]);

  const hasUnsavedBackgroundChanges = useCallback(() => {
    return (
      isDirty ||
      activeLayerDirtyRef.current ||
      hasFloatingSelection ||
      isDrawing ||
      isRasterOperationBusy ||
      rasterOperationBusyRef.current ||
      !!drawingStrokeRef.current ||
      !!shapeDraftRef.current ||
      !!selectionMarqueeRef.current ||
      !!floatingSelectionRef.current ||
      !!floatingSelectionTransformRef.current
    );
  }, [hasFloatingSelection, isDirty, isDrawing, isRasterOperationBusy]);

  const enqueueBitmapWork = useCallback((
    task: (epoch: number) => Promise<void>,
    options?: { trackRasterBusy?: boolean },
  ) => {
    const epoch = bitmapStateEpochRef.current;
    const run = bitmapWorkQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (options?.trackRasterBusy) {
          rasterOperationBusyRef.current = true;
          setIsRasterOperationBusy(true);
        }
        try {
          if (epoch !== bitmapStateEpochRef.current) {
            return;
          }
          await task(epoch);
        } finally {
          if (options?.trackRasterBusy) {
            rasterOperationBusyRef.current = false;
            setIsRasterOperationBusy(false);
          }
        }
      });

    bitmapWorkQueueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const enqueueRasterOperation = useCallback((task: (epoch: number) => Promise<void>) => {
    return enqueueBitmapWork(task, { trackRasterBusy: true });
  }, [enqueueBitmapWork]);

  const awaitBitmapWork = useCallback(async () => {
    await bitmapWorkQueueRef.current.catch(() => undefined);
  }, []);

  const awaitRasterOperations = useCallback(async () => {
    await awaitBitmapWork();
  }, [awaitBitmapWork]);

  const awaitBitmapStateTasks = useCallback(async () => {
    await awaitBitmapWork();
  }, [awaitBitmapWork]);

  const ensureChunkCanvasLoaded = useCallback(async (key: string): Promise<HTMLCanvasElement | null> => {
    const existing = chunkCanvasesRef.current.get(key);
    if (existing) return existing;
    const epoch = bitmapStateEpochRef.current;
    const serialized = chunkDataRef.current[key];
    if (!serialized) return null;

    const decoded = await decodeActiveChunkCanvas(key, serialized, chunkSize);
    if (!decoded) return null;
    if (epoch !== bitmapStateEpochRef.current || chunkDataRef.current[key] !== serialized) {
      return null;
    }

    const latest = chunkCanvasesRef.current.get(key);
    if (latest) {
      return latest;
    }

    chunkCanvasesRef.current.set(key, decoded);
    setRevision((value) => value + 1);
    return decoded;
  }, [chunkSize, decodeActiveChunkCanvas]);

  const ensureLayerChunkCanvasLoaded = useCallback(async (
    cacheKey: string,
    dataUrl: string,
  ): Promise<HTMLCanvasElement | null> => {
    const existing = layerChunkCanvasCacheRef.current.get(cacheKey);
    if (existing) {
      return existing;
    }
    const decoded = await decodeLayerChunkCanvas(cacheKey, dataUrl);
    if (!decoded) {
      return null;
    }

    const latest = layerChunkCanvasCacheRef.current.get(cacheKey);
    if (latest) {
      return latest;
    }

    layerChunkCanvasCacheRef.current.set(cacheKey, decoded);
    setRevision((value) => value + 1);
    return decoded;
  }, [decodeLayerChunkCanvas]);

  const loadFromBackgroundConfig = useCallback(async () => {
    if (!scene) return;
    setBusy(true);
    setChunkLimitWarning(null);
    setIsDirty(false);
    setHasFloatingSelection(false);
    setCanUndo(false);
    setCanRedo(false);
    chunkCanvasesRef.current.clear();
    activeChunkDecodePromisesRef.current.clear();
    layerChunkCanvasCacheRef.current.clear();
    layerChunkDecodePromisesRef.current.clear();
    selectionMarqueeRef.current = null;
    floatingSelectionRef.current = null;
    floatingSelectionTransformRef.current = null;
    floatingSelectionBusyRef.current = false;
    activeLayerDirtyRef.current = false;

    const initialDocument = ensureBackgroundDocument(scene.background);
    replaceBackgroundDocument(initialDocument);
    lastCommittedBackgroundRef.current = scene.background ?? null;
    const initialBackgroundColor = getFallbackColor(scene.background);
    initialBackgroundColorRef.current = initialBackgroundColor;
    setBackgroundColor(initialBackgroundColor);
    const initialLayer = getActiveBackgroundLayer(initialDocument);
    await loadBitmapLayerStateForChunkSize(initialLayer, initialDocument.chunkSize);
    setTool(getActiveBackgroundLayerKind(initialDocument) === 'vector' ? 'select' : 'brush');

    setBusy(false);
    setRevision((value) => value + 1);
  }, [loadBitmapLayerStateForChunkSize, replaceBackgroundDocument, scene]);

  useEffect(() => {
    if (!scene) {
      return;
    }

    if (initializedSceneIdRef.current !== scene.id) {
      initializedSceneIdRef.current = scene.id;
      void loadFromBackgroundConfig();
      return;
    }

    if (scene.background === lastCommittedBackgroundRef.current) {
      lastCommittedBackgroundRef.current = null;
      initialBackgroundColorRef.current = getFallbackColor(scene.background);
      return;
    }

    void loadFromBackgroundConfig();
  }, [loadFromBackgroundConfig, scene]);

  useEffect(() => {
    if (!backgroundDocument) {
      renderedLayerChunkRequestIdRef.current += 1;
      renderedLayerChunksRef.current = {};
      renderedLayerChunkSignaturesRef.current = {};
      setRenderedLayerChunks((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    let cancelled = false;
    const requestId = renderedLayerChunkRequestIdRef.current + 1;
    renderedLayerChunkRequestIdRef.current = requestId;

    const currentEntries = renderedLayerChunksRef.current;
    const currentSignatures = renderedLayerChunkSignaturesRef.current;
    const nextEntries: Record<string, ChunkDataMap> = {};
    const nextSignatures: Record<string, string> = {};
    const pendingVectorLayers: Array<{
      layer: BackgroundVectorLayer;
      layerId: string;
      signature: string;
    }> = [];

    for (const layer of backgroundDocument.layers) {
      const signature = getBackgroundLayerRenderSignature(layer) ?? `${layer.kind}:empty`;
      const cachedEntry = currentEntries[layer.id];
      if (currentSignatures[layer.id] === signature && cachedEntry) {
        nextEntries[layer.id] = cachedEntry;
        nextSignatures[layer.id] = signature;
        continue;
      }

      if (isBitmapBackgroundLayer(layer)) {
        nextEntries[layer.id] = normalizeChunkDataMap(layer.bitmap.chunks);
        nextSignatures[layer.id] = signature;
        continue;
      }

      if (cachedEntry) {
        nextEntries[layer.id] = cachedEntry;
      }

      if (isVectorBackgroundLayer(layer)) {
        pendingVectorLayers.push({
          layer,
          layerId: layer.id,
          signature,
        });
      }
    }

    const resolvedBaseEntries = areRenderedLayerChunkEntriesEqual(currentEntries, nextEntries)
      ? currentEntries
      : nextEntries;
    renderedLayerChunksRef.current = resolvedBaseEntries;
    renderedLayerChunkSignaturesRef.current = nextSignatures;
    setRenderedLayerChunks((current) => (
      areRenderedLayerChunkEntriesEqual(current, resolvedBaseEntries) ? current : resolvedBaseEntries
    ));

    for (const pendingLayer of pendingVectorLayers) {
      void renderBackgroundLayerToChunkData(pendingLayer.layer, backgroundDocument.chunkSize).then((chunkData) => {
        if (cancelled || renderedLayerChunkRequestIdRef.current !== requestId) {
          return;
        }

        setRenderedLayerChunks((current) => {
          if (cancelled || renderedLayerChunkRequestIdRef.current !== requestId) {
            return current;
          }

          const nextState = current[pendingLayer.layerId] === chunkData
            ? current
            : {
                ...current,
                [pendingLayer.layerId]: chunkData,
              };
          renderedLayerChunksRef.current = nextState;
          if (renderedLayerChunkSignaturesRef.current[pendingLayer.layerId] !== pendingLayer.signature) {
            renderedLayerChunkSignaturesRef.current = {
              ...renderedLayerChunkSignaturesRef.current,
              [pendingLayer.layerId]: pendingLayer.signature,
            };
          }
          return nextState;
        });
      }).catch((error) => {
        if (!cancelled && renderedLayerChunkRequestIdRef.current === requestId) {
          console.warn('Failed to render background layer chunk surface.', error);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [backgroundDocument]);

  useEffect(() => {
    setIsDirty(
      backgroundColor !== initialBackgroundColorRef.current ||
      activeLayerDirtyRef.current,
    );
  }, [backgroundColor]);

  useEffect(() => {
    if (!scene || busy) {
      return;
    }
    if (backgroundColorPickerPreviewActiveRef.current) {
      return;
    }
    if (backgroundColor === initialBackgroundColorRef.current) {
      return;
    }
    if (backgroundColorCommitTimeoutRef.current) {
      clearTimeout(backgroundColorCommitTimeoutRef.current);
    }

    backgroundColorCommitTimeoutRef.current = setTimeout(() => {
      backgroundColorCommitTimeoutRef.current = null;
      const nextDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
      if (!nextDocument) {
        return;
      }
      commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-color', {
        allowMerge: true,
        mergeWindowMs: 150,
      });
      initialBackgroundColorRef.current = backgroundColorRef.current;
    }, 120);

    return () => {
      if (backgroundColorCommitTimeoutRef.current) {
        clearTimeout(backgroundColorCommitTimeoutRef.current);
        backgroundColorCommitTimeoutRef.current = null;
      }
    };
  }, [backgroundColor, busy, commitBackgroundDocumentState, persistActiveLayerIntoDocument, scene]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      setViewport({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const prevHtmlOverscrollX = document.documentElement.style.overscrollBehaviorX;
    const prevBodyOverscrollX = document.body.style.overscrollBehaviorX;
    document.documentElement.style.overscrollBehaviorX = 'none';
    document.body.style.overscrollBehaviorX = 'none';

    const handleWheelCapture = (event: WheelEvent) => {
      const target = event.target as Node | null;
      if (target && root.contains(target)) {
        event.preventDefault();
      }
    };

    window.addEventListener('wheel', handleWheelCapture, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', handleWheelCapture, true);
      document.documentElement.style.overscrollBehaviorX = prevHtmlOverscrollX;
      document.body.style.overscrollBehaviorX = prevBodyOverscrollX;
    };
  }, []);

  useEffect(() => {
    if (!didMountRef.current && !busy) {
      didMountRef.current = true;
      fitToContent();
    }
  }, [busy, fitToContent]);

  const updateWarnings = useCallback(() => {
    const limits = evaluateChunkLimits(chunkKeySetRef.current.size, softChunkLimit, hardChunkLimit);
    setChunkLimitWarning(limits.hardExceeded ? 'Chunk limit exceeded.' : null);
  }, [hardChunkLimit, softChunkLimit]);

  useEffect(() => {
    updateWarnings();
  }, [revision, updateWarnings]);

  useEffect(() => {
    syncUndoRedoAvailability();
  }, [editorMode, revision, syncUndoRedoAvailability]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const targetWidth = viewport.width * dpr;
    const targetHeight = viewport.height * dpr;
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const chunkPixelSize = chunkSize * zoom;
    const safeZoom = Math.max(1e-6, zoom);
    const visibleViewportWorld = {
      left: camera.x - viewport.width / (2 * safeZoom),
      right: camera.x + viewport.width / (2 * safeZoom),
      bottom: camera.y - viewport.height / (2 * safeZoom),
      top: camera.y + viewport.height / (2 * safeZoom),
    };
    const visibleChunkRange = getChunkRangeForWorldBounds(
      visibleViewportWorld.left,
      visibleViewportWorld.right,
      visibleViewportWorld.bottom,
      visibleViewportWorld.top,
      chunkSize,
      1,
    );
    const drawLayerChunks = (
      layer: BackgroundLayer,
      chunks: ChunkDataMap,
      options?: { useActiveBitmapCache?: boolean },
    ) => {
      if (chunkPixelSize < 0.35) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.imageSmoothingEnabled = false;

      if (options?.useActiveBitmapCache) {
        for (const visibleChunk of activeChunkIndexRef.current.query(visibleChunkRange)) {
          const key = visibleChunk.key;
          const bounds = getChunkWorldBounds(visibleChunk.cx, visibleChunk.cy, chunkSize);
          const rect = projectChunkWorldBoundsToScreenRect(
            bounds,
            visibleViewportWorld,
            viewport.width,
            viewport.height,
          );
          if (rect.x + rect.width < 0 || rect.y + rect.height < 0 || rect.x > viewport.width || rect.y > viewport.height) {
            continue;
          }

          const chunkCanvas = chunkCanvasesRef.current.get(key);
          if (chunkCanvas) {
            ctx.drawImage(chunkCanvas, rect.x, rect.y, rect.width, rect.height);
            continue;
          }

          const dataUrl = chunkDataRef.current[key];
          if (dataUrl) {
            void ensureChunkCanvasLoaded(key);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
          }
        }

        ctx.restore();
        return;
      }

      for (const visibleChunk of getCachedBackgroundChunkIndex(chunks).query(visibleChunkRange)) {
        const key = visibleChunk.key;
        const bounds = getChunkWorldBounds(visibleChunk.cx, visibleChunk.cy, chunkSize);
        const rect = projectChunkWorldBoundsToScreenRect(
          bounds,
          visibleViewportWorld,
          viewport.width,
          viewport.height,
        );
        if (rect.x + rect.width < 0 || rect.y + rect.height < 0 || rect.x > viewport.width || rect.y > viewport.height) {
          continue;
        }

        const dataUrl = visibleChunk.value;
        const cacheKey = `${layer.id}:${key}:${chunkSize}:${dataUrl}`;
        const chunkCanvas = layerChunkCanvasCacheRef.current.get(cacheKey);
        if (chunkCanvas) {
          ctx.drawImage(chunkCanvas, rect.x, rect.y, rect.width, rect.height);
          continue;
        }

        void ensureLayerChunkCanvasLoaded(cacheKey, dataUrl);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }

      ctx.restore();
    };

    for (const layer of backgroundDocument?.layers ?? []) {
      if (!layer.visible || layer.opacity <= 0) {
        continue;
      }
      const isActiveBitmapLayer = layer.id === backgroundDocument?.activeLayerId && isBitmapBackgroundLayer(layer);
      const isActiveVectorLayer = layer.id === backgroundDocument?.activeLayerId && isVectorBackgroundLayer(layer);
      if (isActiveVectorLayer) {
        continue;
      }

      const chunks = isActiveBitmapLayer
        ? chunkDataRef.current
        : (renderedLayerChunks[layer.id] ?? {});
      drawLayerChunks(layer, chunks, {
        useActiveBitmapCache: isActiveBitmapLayer,
      });
    }

    const worldBoundaryPoints = scene?.worldBoundary?.enabled ? (scene.worldBoundary.points || []) : [];
    if (worldBoundaryPoints.length >= 2) {
      const first = worldToScreen(worldBoundaryPoints[0].x, worldBoundaryPoints[0].y);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < worldBoundaryPoints.length; index += 1) {
        const point = worldToScreen(worldBoundaryPoints[index].x, worldBoundaryPoints[index].y);
        ctx.lineTo(point.x, point.y);
      }
      if (worldBoundaryPoints.length >= 3) {
        ctx.closePath();
      }
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const cameraTopLeft = worldToScreen(cameraBounds.left, cameraBounds.top);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      cameraTopLeft.x,
      cameraTopLeft.y,
      (cameraBounds.right - cameraBounds.left) * zoom,
      (cameraBounds.top - cameraBounds.bottom) * zoom,
    );

    const shapeDraft = shapeDraftRef.current;
    if (shapeDraft) {
      ctx.save();
      traceBackgroundShapePath(
        ctx,
        shapeDraft.tool,
        shapeDraft.startWorld,
        shapeDraft.currentWorld,
        (worldX, worldY) => worldToScreen(worldX, worldY),
      );
      if (shapeDraft.tool !== 'line') {
        ctx.fillStyle = bitmapShapeStyle.fillColor;
        ctx.globalAlpha = 0.72;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (bitmapShapeStyle.strokeWidth > 0) {
        ctx.strokeStyle = bitmapShapeStyle.strokeColor;
        ctx.lineWidth = Math.max(1, bitmapShapeStyle.strokeWidth * zoom);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    const marqueeSelection = selectionMarqueeRef.current;
    if (editorMode === 'bitmap' && tool === 'select' && marqueeSelection && !floatingSelectionRef.current) {
      const marqueeBounds = getWorldRectFromPoints(marqueeSelection.startWorld, marqueeSelection.currentWorld);
      const topLeft = worldToScreen(marqueeBounds.left, marqueeBounds.top);
      renderSelectionMarqueeOverlay(ctx, {
        x: topLeft.x,
        y: topLeft.y,
        width: marqueeBounds.width * zoom,
        height: marqueeBounds.height * zoom,
      });
    }

    const floatingSelection = floatingSelectionRef.current;
    if (editorMode === 'bitmap' && tool === 'select' && floatingSelection) {
      const geometry = getFloatingSelectionScreenGeometry(floatingSelection, worldToScreen, zoom);
      ctx.save();
      ctx.translate(geometry.centerScreen.x, geometry.centerScreen.y);
      ctx.rotate(-floatingSelection.rotation);
      ctx.scale(floatingSelection.scaleX * zoom, floatingSelection.scaleY * zoom);
      ctx.drawImage(
        floatingSelection.canvas,
        -floatingSelection.canvas.width * 0.5,
        -floatingSelection.canvas.height * 0.5,
        floatingSelection.canvas.width,
        floatingSelection.canvas.height,
      );
      ctx.restore();

      const activeTransform = floatingSelectionTransformRef.current;
      renderScreenSpaceTransformOverlay(ctx, geometry.corners, {
        proportionalGuide: activeTransform?.kind === 'scale' && activeTransform.proportional,
        corner: activeTransform?.kind === 'scale' && activeTransform.proportional && activeTransform.corner
          ? activeTransform.corner
          : null,
      });
    }

    if (pointerWorldRef.current && !isPanning) {
      const pointerScreen = worldToScreen(pointerWorldRef.current.x, pointerWorldRef.current.y);

      if (tool !== 'select' && !(editorMode === 'vector' && (tool === 'brush')) && !(editorMode === 'bitmap' && (tool === 'brush' || tool === 'eraser'))) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pointerScreen.x - 8, pointerScreen.y);
        ctx.lineTo(pointerScreen.x + 8, pointerScreen.y);
        ctx.moveTo(pointerScreen.x, pointerScreen.y - 8);
        ctx.lineTo(pointerScreen.x, pointerScreen.y + 8);
        ctx.stroke();
      }
    }

    if (chunkPixelSize < 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Far zoom LOD active', 12, viewport.height - 12);
    }
  }, [
    backgroundColor,
    backgroundDocument,
    bitmapBrushKind,
    bitmapShapeStyle.fillColor,
    bitmapShapeStyle.strokeColor,
    bitmapShapeStyle.strokeWidth,
    brushColor,
    brushOpacity,
    brushSize,
    camera.x,
    camera.y,
    cameraBounds.bottom,
    cameraBounds.left,
    cameraBounds.right,
    cameraBounds.top,
    chunkSize,
    ensureChunkCanvasLoaded,
    ensureLayerChunkCanvasLoaded,
    editorMode,
    isPanning,
    renderedLayerChunks,
    tool,
    viewport.height,
    viewport.width,
    scene?.worldBoundary?.enabled,
    scene?.worldBoundary?.points,
    worldToScreen,
    zoom,
  ]);

  useEffect(() => {
    render();
  }, [render, revision, camera, zoom, tool, brushColor, brushSize, viewport, isPanning]);

  const getExistingChunkSnapshot = useCallback((key: string): string | null => {
    const serialized = chunkDataRef.current[key];
    if (serialized) {
      return serialized;
    }
    const canvas = chunkCanvasesRef.current.get(key);
    if (canvas) {
      return canvas.toDataURL('image/png');
    }
    return null;
  }, []);

  const beginMutationSession = useCallback((): MutationSession => ({
    touched: new Set(),
    before: {},
    serializedAfter: {},
  }), []);

  const rememberChunkBeforeMutation = useCallback((session: MutationSession, key: string) => {
    if (!(key in session.before)) {
      session.before[key] = getExistingChunkSnapshot(key);
    }
    session.touched.add(key);
  }, [getExistingChunkSnapshot]);

  const getOrCreateChunkCanvas = useCallback((key: string): HTMLCanvasElement | undefined => {
    const existing = chunkCanvasesRef.current.get(key);
    if (existing) return existing;

    const serialized = chunkDataRef.current[key];
    if (serialized) {
      return undefined;
    }

    if (!canCreateChunk(chunkKeySetRef.current.size, softChunkLimit, hardChunkLimit)) {
      return undefined;
    }

    const created = createEmptyChunkCanvas(chunkSize);
    chunkCanvasesRef.current.set(key, created);
    chunkKeySetRef.current.add(key);
    activeChunkIndexRef.current.set(key, true);
    syncActiveChunkCount();
    updateWarnings();
    return created;
  }, [chunkSize, hardChunkLimit, softChunkLimit, syncActiveChunkCount, updateWarnings]);

  const paintHardRoundPoint = useCallback((
    worldX: number,
    worldY: number,
    stroke: MutationSession,
    brushTool: BitmapBrushTool,
  ) => {
    const radius = Math.max(0.5, brushSize * 0.5);
    const center = worldToChunkLocal(worldX, worldY, chunkSize);
    const touchedChunkCoords = [
      { cx: center.cx, cy: center.cy },
      { cx: center.cx - 1, cy: center.cy },
      { cx: center.cx + 1, cy: center.cy },
      { cx: center.cx, cy: center.cy - 1 },
      { cx: center.cx, cy: center.cy + 1 },
      { cx: center.cx - 1, cy: center.cy - 1 },
      { cx: center.cx + 1, cy: center.cy + 1 },
      { cx: center.cx - 1, cy: center.cy + 1 },
      { cx: center.cx + 1, cy: center.cy - 1 },
    ];

    const composite = getCompositeOperation(brushTool);
    const color = getBrushPaintColor(brushTool, brushColor);
    const opacity = brushTool === 'brush' ? brushOpacity : 1;
    let updated = false;

    for (const { cx, cy } of touchedChunkCoords) {
      const key = getChunkKey(cx, cy);
      const localX = worldX - cx * chunkSize;
      const localY = (cy + 1) * chunkSize - worldY;
      const intersects =
        localX + radius > 0 &&
        localX - radius < chunkSize &&
        localY + radius > 0 &&
        localY - radius < chunkSize;
      if (!intersects) continue;

      rememberChunkBeforeMutation(stroke, key);

      let chunkCanvas = chunkCanvasesRef.current.get(key);
      if (!chunkCanvas) {
        if (chunkDataRef.current[key]) {
          continue;
        }
        if (isEraseTool(brushTool)) {
          continue;
        }
        chunkCanvas = getOrCreateChunkCanvas(key);
      }
      if (!chunkCanvas) {
        setChunkLimitWarning('Chunk limit exceeded.');
        continue;
      }

      const ctx = getChunkCanvasContext(chunkCanvas);
      if (!ctx) continue;
      ctx.save();
      ctx.globalCompositeOperation = composite;
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(localX, localY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      updated = true;
    }

    if (updated) {
      setRevision((value) => value + 1);
    }
  }, [brushColor, brushOpacity, brushSize, chunkSize, getOrCreateChunkCanvas, rememberChunkBeforeMutation]);

  const paintStampedPoint = useCallback((
    worldX: number,
    worldY: number,
    stroke: MutationSession,
    stampDefinition: ReturnType<typeof getBitmapBrushStampDefinition>,
    brushTool: BitmapBrushTool,
  ) => {
    const halfStampSize = Math.max(stampDefinition.stamp.width, stampDefinition.stamp.height) * 0.5;
    const scatterPadding = stampDefinition.scatter + halfStampSize * (1 + stampDefinition.scaleJitter) + 2;
    const chunkRange = getChunkRangeForWorldBounds(
      worldX - scatterPadding,
      worldX + scatterPadding,
      worldY - scatterPadding,
      worldY + scatterPadding,
      chunkSize,
      0,
    );

    const scatterAngle = Math.random() * Math.PI * 2;
    const scatterRadius = stampDefinition.scatter > 0 ? Math.random() * stampDefinition.scatter : 0;
    const centerX = worldX + Math.cos(scatterAngle) * scatterRadius;
    const centerY = worldY + Math.sin(scatterAngle) * scatterRadius;
    const rotation = stampDefinition.rotationJitter > 0 ? (Math.random() * 2 - 1) * stampDefinition.rotationJitter : 0;
    const scale = 1 + (stampDefinition.scaleJitter > 0 ? (Math.random() * 2 - 1) * stampDefinition.scaleJitter : 0);
    let updated = false;

    for (const key of iterateChunkKeys(chunkRange)) {
      const parsed = parseChunkKey(key);
      if (!parsed) continue;
      const localX = centerX - parsed.cx * chunkSize;
      const localY = (parsed.cy + 1) * chunkSize - centerY;
      const drawHalfWidth = (stampDefinition.stamp.width * scale) * 0.5;
      const drawHalfHeight = (stampDefinition.stamp.height * scale) * 0.5;
      const intersects =
        localX + drawHalfWidth > 0 &&
        localX - drawHalfWidth < chunkSize &&
        localY + drawHalfHeight > 0 &&
        localY - drawHalfHeight < chunkSize;
      if (!intersects) continue;

      rememberChunkBeforeMutation(stroke, key);

      let chunkCanvas = chunkCanvasesRef.current.get(key);
      if (!chunkCanvas) {
        if (chunkDataRef.current[key]) {
          continue;
        }
        if (isEraseTool(brushTool)) {
          continue;
        }
        chunkCanvas = getOrCreateChunkCanvas(key);
      }
      if (!chunkCanvas) {
        setChunkLimitWarning('Chunk limit exceeded.');
        continue;
      }

      const ctx = getChunkCanvasContext(chunkCanvas);
      if (!ctx) continue;
      ctx.save();
      ctx.globalCompositeOperation = getCompositeOperation(brushTool);
      ctx.globalAlpha = stampDefinition.opacity * (brushTool === 'brush' ? brushOpacity : 1);
      ctx.translate(localX, localY);
      if (rotation !== 0) {
        ctx.rotate(rotation);
      }
      if (scale !== 1) {
        ctx.scale(scale, scale);
      }
      ctx.drawImage(stampDefinition.stamp, -stampDefinition.stamp.width / 2, -stampDefinition.stamp.height / 2);
      ctx.restore();
      updated = true;
    }

    if (updated) {
      setRevision((value) => value + 1);
    }
  }, [brushOpacity, chunkSize, getOrCreateChunkCanvas, rememberChunkBeforeMutation]);

  const paintSegment = useCallback((from: { x: number; y: number }, to: { x: number; y: number }, stroke: StrokeSession) => {
    const brushTool: BitmapBrushTool = tool === 'eraser' ? 'eraser' : 'brush';
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (bitmapBrushKind !== 'hard-round') {
      const stampDefinition = getBitmapBrushStampDefinition(bitmapBrushKind, brushColor, brushSize);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, stampDefinition.spacing)));
      for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        paintStampedPoint(
          from.x + dx * t,
          from.y + dy * t,
          stroke,
          stampDefinition,
          brushTool,
        );
      }
      return;
    }

    const step = Math.max(1, brushSize * 0.25);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      paintHardRoundPoint(
        from.x + dx * t,
        from.y + dy * t,
        stroke,
        brushTool,
      );
    }
  }, [bitmapBrushKind, brushColor, brushSize, paintHardRoundPoint, paintStampedPoint, tool]);

  const commitMutationSession = useCallback((session: MutationSession | null) => {
    if (!session || session.touched.size === 0) {
      return;
    }

    const after: Record<string, string | null> = {};
    const before = session.before;
    const serializedAfter = session.serializedAfter;

    for (const key of session.touched) {
      if (key in serializedAfter) {
        const value = serializedAfter[key] ?? null;
        if (value === null) {
          chunkCanvasesRef.current.delete(key);
          delete chunkDataRef.current[key];
          chunkKeySetRef.current.delete(key);
          activeChunkIndexRef.current.delete(key);
        } else {
          chunkDataRef.current[key] = value;
          chunkKeySetRef.current.add(key);
          activeChunkIndexRef.current.set(key, true);
        }
        after[key] = value;
        continue;
      }

      const canvas = chunkCanvasesRef.current.get(key);
      if (!canvas) {
        const current = chunkDataRef.current[key] ?? null;
        after[key] = current;
        continue;
      }

      if (isChunkCanvasTransparent(canvas)) {
        chunkCanvasesRef.current.delete(key);
        delete chunkDataRef.current[key];
        chunkKeySetRef.current.delete(key);
        activeChunkIndexRef.current.delete(key);
        after[key] = null;
        continue;
      }

      const dataUrl = canvas.toDataURL('image/png');
      chunkDataRef.current[key] = dataUrl;
      chunkKeySetRef.current.add(key);
      activeChunkIndexRef.current.set(key, true);
      after[key] = dataUrl;
    }

    const changedKeys = Object.keys(before).filter((key) => (before[key] ?? null) !== (after[key] ?? null));
    if (changedKeys.length > 0) {
      const nextDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
      if (nextDocument) {
        commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-bitmap');
      }
    }

    syncActiveChunkCount();
    updateWarnings();
  }, [commitBackgroundDocumentState, persistActiveLayerIntoDocument, syncActiveChunkCount, updateWarnings]);

  const finalizeStroke = useCallback(() => {
    const stroke = drawingStrokeRef.current;
    drawingStrokeRef.current = null;
    commitMutationSession(stroke);
  }, [commitMutationSession]);

  const commitShapeDraft = useCallback((draft: ShapeDraftSession) => {
    const shapeStyle = bitmapShapeStyle;
    const shouldFill = draft.tool !== 'line';
    const shouldStroke = Math.max(0, shapeStyle.strokeWidth) > 0;
    if (!shouldFill && !shouldStroke) {
      return;
    }

    const bounds = getShapeWorldBounds(draft.startWorld, draft.currentWorld, shapeStyle.strokeWidth);
    const chunkRange = getChunkRangeForWorldBounds(
      bounds.expandedLeft,
      bounds.expandedRight,
      bounds.expandedBottom,
      bounds.expandedTop,
      chunkSize,
      0,
    );
    const session = beginMutationSession();

    for (const key of iterateChunkKeys(chunkRange)) {
      const parsed = parseChunkKey(key);
      if (!parsed) {
        continue;
      }

      rememberChunkBeforeMutation(session, key);

      let chunkCanvas = chunkCanvasesRef.current.get(key);
      if (!chunkCanvas) {
        if (chunkDataRef.current[key]) {
          continue;
        }
        chunkCanvas = getOrCreateChunkCanvas(key);
      }
      if (!chunkCanvas) {
        setChunkLimitWarning('Chunk limit exceeded.');
        continue;
      }

      const ctx = getChunkCanvasContext(chunkCanvas);
      if (!ctx) {
        continue;
      }

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      traceBackgroundShapePath(
        ctx,
        draft.tool,
        draft.startWorld,
        draft.currentWorld,
        (worldX, worldY) => ({
          x: worldX - parsed.cx * chunkSize,
          y: (parsed.cy + 1) * chunkSize - worldY,
        }),
      );
      if (shouldFill) {
        ctx.fillStyle = shapeStyle.fillColor;
        ctx.fill();
      }
      if (shouldStroke) {
        ctx.strokeStyle = shapeStyle.strokeColor;
        ctx.lineWidth = shapeStyle.strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    commitMutationSession(session);
  }, [beginMutationSession, bitmapShapeStyle, chunkSize, commitMutationSession, getOrCreateChunkCanvas, rememberChunkBeforeMutation]);

  const getFillRasterBounds = useCallback((worldX: number, worldY: number) => {
    const contentBounds = getChunkBoundsFromKeys(chunkKeySetRef.current, chunkSize);
    const left = Math.floor(Math.min(cameraBounds.left, contentBounds?.left ?? worldX, worldX));
    const right = Math.ceil(Math.max(cameraBounds.right, contentBounds?.right ?? worldX + 1, worldX + 1));
    const bottom = Math.floor(Math.min(cameraBounds.bottom, contentBounds?.bottom ?? worldY, worldY));
    const top = Math.ceil(Math.max(cameraBounds.top, contentBounds?.top ?? worldY + 1, worldY + 1));
    return {
      left,
      right,
      bottom,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, top - bottom),
    };
  }, [cameraBounds.bottom, cameraBounds.left, cameraBounds.right, cameraBounds.top, chunkSize]);

  const rasterizeChunksForBounds = useCallback(async (bounds: { left: number; right: number; bottom: number; top: number; width: number; height: number }) => {
    if (
      bounds.width > MAX_RASTER_OPERATION_DIMENSION ||
      bounds.height > MAX_RASTER_OPERATION_DIMENSION ||
      bounds.width * bounds.height > MAX_RASTER_OPERATION_PIXELS
    ) {
      await showAlert({
        title: 'Region Too Large',
        description: 'This fill region is too large to rasterize safely in one pass. Zoom in or reduce the edited area.',
      });
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }

    const range = getChunkRangeForWorldBounds(bounds.left, bounds.right, bounds.bottom, bounds.top, chunkSize, 0);
    for (const key of iterateChunkKeys(range)) {
      let chunkCanvas = chunkCanvasesRef.current.get(key) ?? null;
      if (!chunkCanvas && chunkDataRef.current[key]) {
        chunkCanvas = await ensureChunkCanvasLoaded(key);
      }
      if (!chunkCanvas) {
        continue;
      }
      const parsed = parseChunkKey(key);
      if (!parsed) {
        continue;
      }
      const chunkBounds = getChunkWorldBounds(parsed.cx, parsed.cy, chunkSize);
      ctx.drawImage(
        chunkCanvas,
        chunkBounds.left - bounds.left,
        bounds.top - chunkBounds.top,
        chunkSize,
        chunkSize,
      );
    }

    return { canvas, ctx };
  }, [chunkSize, ensureChunkCanvasLoaded, showAlert]);

  const applyRasterCanvasToChunks = useCallback((
    rasterCanvas: HTMLCanvasElement,
    bounds: { left: number; right: number; bottom: number; top: number },
    session: MutationSession,
  ) => {
    const range = getChunkRangeForWorldBounds(bounds.left, bounds.right, bounds.bottom, bounds.top, chunkSize, 0);
    const nextChunkCanvases = new Map<string, HTMLCanvasElement | null>();
    let projectedChunkCount = chunkKeySetRef.current.size;

    for (const key of iterateChunkKeys(range)) {
      const parsed = parseChunkKey(key);
      if (!parsed) {
        continue;
      }

      rememberChunkBeforeMutation(session, key);
      const chunkBounds = getChunkWorldBounds(parsed.cx, parsed.cy, chunkSize);
      const existingChunkCanvas = chunkCanvasesRef.current.get(key) ?? null;
      const nextCanvas = applyRasterPatchToChunkCanvas({
        chunkSize,
        chunkBounds,
        patchBounds: bounds,
        rasterCanvas,
        existingChunkCanvas,
      });
      if (!nextCanvas) {
        continue;
      }

      const hasExistingChunk = key in chunkDataRef.current || chunkCanvasesRef.current.has(key);
      const isTransparent = isChunkCanvasTransparent(nextCanvas);
      if (isTransparent) {
        nextChunkCanvases.set(key, null);
        if (hasExistingChunk) {
          projectedChunkCount -= 1;
        }
      } else {
        nextChunkCanvases.set(key, nextCanvas);
        if (!hasExistingChunk) {
          projectedChunkCount += 1;
        }
      }
    }

    if (projectedChunkCount > hardChunkLimit) {
      setChunkLimitWarning('Chunk limit exceeded.');
      return false;
    }
    for (const [key, nextCanvas] of nextChunkCanvases) {
      if (!nextCanvas) {
        delete chunkDataRef.current[key];
        chunkCanvasesRef.current.delete(key);
        chunkKeySetRef.current.delete(key);
        activeChunkIndexRef.current.delete(key);
        session.serializedAfter[key] = null;
        continue;
      }

      chunkCanvasesRef.current.set(key, nextCanvas);
      chunkKeySetRef.current.add(key);
      activeChunkIndexRef.current.set(key, true);
      const dataUrl = nextCanvas.toDataURL('image/png');
      chunkDataRef.current[key] = dataUrl;
      session.serializedAfter[key] = dataUrl;
    }

    syncActiveChunkCount();
    return true;
  }, [chunkSize, hardChunkLimit, rememberChunkBeforeMutation, syncActiveChunkCount]);

  const commitRasterCanvasToChunks = useCallback((
    rasterCanvas: HTMLCanvasElement,
    bounds: { left: number; right: number; bottom: number; top: number },
    session: MutationSession,
  ) => {
    const applied = applyRasterCanvasToChunks(rasterCanvas, bounds, session);
    if (!applied) {
      return false;
    }
    commitMutationSession(session);
    return true;
  }, [applyRasterCanvasToChunks, commitMutationSession]);

  const applyFill = useCallback(async (expectedEpoch: number, worldX: number, worldY: number) => {
    if (expectedEpoch !== bitmapStateEpochRef.current) {
      return;
    }
    const bounds = getFillRasterBounds(worldX, worldY);
    const rasterized = await rasterizeChunksForBounds(bounds);
    if (!rasterized || expectedEpoch !== bitmapStateEpochRef.current) {
      return;
    }

    const textureSource = await ensureBitmapFillTextureSource(bitmapFillStyle.textureId);
    if (expectedEpoch !== bitmapStateEpochRef.current) {
      return;
    }

    const startX = Math.floor(worldX - bounds.left);
    const startY = Math.floor(bounds.top - worldY);
    const imageData = rasterized.ctx.getImageData(0, 0, bounds.width, bounds.height);
    const didFill = applyBitmapBucketFill(
      imageData,
      startX,
      startY,
      {
        fillColor: brushColor,
        textureId: bitmapFillStyle.textureId,
      },
      {
        textureSource,
      },
    );
    if (!didFill) {
      return;
    }

    rasterized.ctx.putImageData(imageData, 0, 0);
    const session = beginMutationSession();
    commitRasterCanvasToChunks(rasterized.canvas, bounds, session);
  }, [beginMutationSession, bitmapFillStyle.textureId, brushColor, commitRasterCanvasToChunks, ensureBitmapFillTextureSource, getFillRasterBounds, rasterizeChunksForBounds]);

  const hitTestFloatingSelection = useCallback((
    selection: BackgroundFloatingSelection,
    screenPoint: ScreenPoint,
  ): BackgroundFloatingSelectionHitTarget | null => {
    const geometry = getFloatingSelectionScreenGeometry(selection, worldToScreen, zoom);
    const cornerTarget = hitTransformGizmoCornerTarget(
      screenPoint,
      geometry.corners,
      TRANSFORM_GIZMO_HANDLE_RADIUS + 4,
      TRANSFORM_GIZMO_HANDLE_RADIUS,
      -selection.rotation,
    );
    if (cornerTarget) {
      return cornerTarget;
    }

    const frame = {
      center: geometry.centerScreen,
      corners: geometry.corners,
    };
    const edgeSegments = getTransformGizmoEdgeSegments(frame);
    const edgeTargets: Array<[BackgroundFloatingSelectionHitTarget, TransformGizmoSide]> = [
      ['scale-n', 'n'],
      ['scale-e', 'e'],
      ['scale-s', 's'],
      ['scale-w', 'w'],
    ];
    for (const [target, side] of edgeTargets) {
      const segment = edgeSegments[side];
      if (isPointNearTransformEdge(screenPoint, segment.start, segment.end, TRANSFORM_GIZMO_HANDLE_RADIUS + 4)) {
        return target;
      }
    }

    const local = rotatePoint(
      {
        x: screenPoint.x - geometry.centerScreen.x,
        y: screenPoint.y - geometry.centerScreen.y,
      },
      selection.rotation,
    );
    if (
      local.x >= -geometry.halfWidth &&
      local.x <= geometry.halfWidth &&
      local.y >= -geometry.halfHeight &&
      local.y <= geometry.halfHeight
    ) {
      return 'body';
    }

    return null;
  }, [worldToScreen, zoom]);

  const commitFloatingSelection = useCallback((options?: { behavior?: BitmapFloatingSelectionBehavior }) => {
    const selection = floatingSelectionRef.current;
    if (!selection || floatingSelectionBusyRef.current) {
      return false;
    }

    const transform = options?.behavior === 'revert'
      ? cloneFloatingSelectionTransformState(selection.originalTransform)
      : getCurrentFloatingSelectionTransformState(selection);
    const worldBounds = getFloatingSelectionWorldBounds(selection, transform);
    const bounds = {
      left: Math.floor(worldBounds.left) - 2,
      right: Math.ceil(worldBounds.right) + 2,
      bottom: Math.floor(worldBounds.bottom) - 2,
      top: Math.ceil(worldBounds.top) + 2,
      width: Math.ceil(worldBounds.right) - Math.floor(worldBounds.left) + 4,
      height: Math.ceil(worldBounds.top) - Math.floor(worldBounds.bottom) + 4,
    };

    if (
      bounds.width > MAX_RASTER_OPERATION_DIMENSION ||
      bounds.height > MAX_RASTER_OPERATION_DIMENSION ||
      bounds.width * bounds.height > MAX_RASTER_OPERATION_PIXELS
    ) {
      void showAlert({
        title: 'Selection Too Large',
        description: 'This selection is too large to rasterize safely in one pass.',
      });
      return false;
    }

    const rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = bounds.width;
    rasterCanvas.height = bounds.height;
    const rasterCtx = rasterCanvas.getContext('2d');
    if (!rasterCtx) {
      return false;
    }

    const range = getChunkRangeForWorldBounds(bounds.left, bounds.right, bounds.bottom, bounds.top, chunkSize, 0);
    for (const key of iterateChunkKeys(range)) {
      const parsed = parseChunkKey(key);
      if (!parsed) {
        continue;
      }
      const chunkCanvas = chunkCanvasesRef.current.get(key);
      if (!chunkCanvas) {
        continue;
      }
      const chunkBounds = getChunkWorldBounds(parsed.cx, parsed.cy, chunkSize);
      rasterCtx.drawImage(
        chunkCanvas,
        chunkBounds.left - bounds.left,
        bounds.top - chunkBounds.top,
        chunkSize,
        chunkSize,
      );
    }

    rasterCtx.save();
    rasterCtx.translate(transform.centerWorld.x - bounds.left, bounds.top - transform.centerWorld.y);
    rasterCtx.rotate(-transform.rotation);
    rasterCtx.scale(transform.scaleX, transform.scaleY);
    rasterCtx.drawImage(
      selection.canvas,
      -selection.canvas.width * 0.5,
      -selection.canvas.height * 0.5,
      selection.canvas.width,
      selection.canvas.height,
    );
    rasterCtx.restore();

    floatingSelectionRef.current = null;
    floatingSelectionTransformRef.current = null;
    setHasFloatingSelection(false);
    const didCommit = commitRasterCanvasToChunks(rasterCanvas, bounds, selection.pendingMutationSession);
    if (!didCommit) {
      floatingSelectionRef.current = selection;
      setHasFloatingSelection(true);
      return false;
    }
    setRevision((value) => value + 1);
    return true;
  }, [chunkSize, commitRasterCanvasToChunks, showAlert]);

  const deleteFloatingSelection = useCallback(() => {
    const selection = floatingSelectionRef.current;
    if (!selection || floatingSelectionBusyRef.current) {
      return false;
    }

    floatingSelectionRef.current = null;
    floatingSelectionTransformRef.current = null;
    setHasFloatingSelection(false);
    commitMutationSession(selection.pendingMutationSession);
    setRevision((value) => value + 1);
    return true;
  }, [commitMutationSession]);

  const nudgeFloatingSelection = useCallback((dx: number, dy: number) => {
    const selection = floatingSelectionRef.current;
    if (!selection || floatingSelectionBusyRef.current) {
      return false;
    }

    selection.centerWorld = {
      x: selection.centerWorld.x + dx,
      y: selection.centerWorld.y - dy,
    };
    floatingSelectionTransformRef.current = null;
    setRevision((value) => value + 1);
    return true;
  }, []);

  const extractFloatingSelection = useCallback(async (expectedEpoch: number, bounds: WorldRect) => {
    if (expectedEpoch !== bitmapStateEpochRef.current) {
      return false;
    }
    if (floatingSelectionBusyRef.current) {
      return false;
    }

    const normalizedBounds = {
      left: Math.floor(bounds.left),
      right: Math.ceil(bounds.right),
      bottom: Math.floor(bounds.bottom),
      top: Math.ceil(bounds.top),
      width: Math.max(1, Math.ceil(bounds.right) - Math.floor(bounds.left)),
      height: Math.max(1, Math.ceil(bounds.top) - Math.floor(bounds.bottom)),
    };
    if (normalizedBounds.width < 1 || normalizedBounds.height < 1) {
      return false;
    }

    floatingSelectionBusyRef.current = true;
    try {
      const rasterized = await rasterizeChunksForBounds(normalizedBounds);
      if (!rasterized || expectedEpoch !== bitmapStateEpochRef.current) {
        return false;
      }

      const imageData = rasterized.ctx.getImageData(0, 0, normalizedBounds.width, normalizedBounds.height);
      const visibleBounds = calculateBoundsFromImageData(imageData, 0);
      if (!visibleBounds) {
        return false;
      }

      const selectionCanvas = document.createElement('canvas');
      selectionCanvas.width = visibleBounds.width;
      selectionCanvas.height = visibleBounds.height;
      const selectionCtx = selectionCanvas.getContext('2d');
      if (!selectionCtx) {
        return false;
      }
      selectionCtx.putImageData(imageData, -visibleBounds.x, -visibleBounds.y);

      rasterized.ctx.clearRect(0, 0, normalizedBounds.width, normalizedBounds.height);
      const pendingMutationSession = beginMutationSession();
      const didApplyExtraction = applyRasterCanvasToChunks(rasterized.canvas, normalizedBounds, pendingMutationSession);
      if (!didApplyExtraction || expectedEpoch !== bitmapStateEpochRef.current) {
        return false;
      }

      floatingSelectionRef.current = {
        canvas: selectionCanvas,
        centerWorld: {
          x: normalizedBounds.left + visibleBounds.x + visibleBounds.width * 0.5,
          y: normalizedBounds.top - visibleBounds.y - visibleBounds.height * 0.5,
        },
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        originalTransform: {
          centerWorld: {
            x: normalizedBounds.left + visibleBounds.x + visibleBounds.width * 0.5,
            y: normalizedBounds.top - visibleBounds.y - visibleBounds.height * 0.5,
          },
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        },
        pendingMutationSession,
      };
      floatingSelectionTransformRef.current = null;
      setHasFloatingSelection(true);
      setRevision((value) => value + 1);
      return true;
    } finally {
      floatingSelectionBusyRef.current = false;
    }
  }, [applyRasterCanvasToChunks, beginMutationSession, rasterizeChunksForBounds]);

  const finalizeSelectionMarquee = useCallback(async () => {
    const marqueeSession = selectionMarqueeRef.current;
    if (!marqueeSession) {
      return false;
    }

    selectionMarqueeRef.current = null;
    setIsDrawing(false);
    const marqueeBounds = getWorldRectFromPoints(marqueeSession.startWorld, marqueeSession.currentWorld);
    if (marqueeBounds.width >= 1 && marqueeBounds.height >= 1) {
      await enqueueRasterOperation(async (epoch) => {
        const didExtractSelection = await extractFloatingSelection(epoch, marqueeBounds);
        if (!didExtractSelection) {
          setRevision((value) => value + 1);
        }
      });
      return true;
    }

    setRevision((value) => value + 1);
    return true;
  }, [enqueueRasterOperation, extractFloatingSelection]);

  const flushActiveInteraction = useCallback(async (options?: {
    behavior?: BitmapFloatingSelectionBehavior;
    reportHandled?: boolean;
  }) => {
    let handled = false;

    if (editorMode === 'vector' && isShapeTool(tool) && isDrawing) {
      vectorCanvasRef.current?.commitShape();
      setIsDrawing(false);
      handled = true;
    }

    if (editorMode === 'vector') {
      handled = (vectorCanvasRef.current?.flushPendingEdits() ?? false) || handled;
      await vectorCanvasRef.current?.awaitIdle();
    }

    if (drawingStrokeRef.current) {
      finalizeStroke();
      setIsDrawing(false);
      handled = true;
    }

    if (shapeDraftRef.current) {
      commitShapeDraft(shapeDraftRef.current);
      shapeDraftRef.current = null;
      setIsDrawing(false);
      setRevision((value) => value + 1);
      handled = true;
    }

    if (selectionMarqueeRef.current) {
      handled = (await finalizeSelectionMarquee()) || handled;
    }

    const shouldRevertBitmapSelection = options?.behavior === 'revert' && !!floatingSelectionRef.current;
    if (floatingSelectionTransformRef.current) {
      floatingSelectionTransformRef.current = null;
      setIsDrawing(false);
      handled = true;
    }

    await awaitBitmapStateTasks();
    await awaitRasterOperations();

    if (floatingSelectionRef.current) {
      const didCommitSelection = commitFloatingSelection({
        behavior: shouldRevertBitmapSelection ? 'revert' : 'commit',
      });
      if (!didCommitSelection) {
        return false;
      }
      handled = true;
    }

    return options?.reportHandled ? handled : true;
  }, [awaitBitmapStateTasks, awaitRasterOperations, commitFloatingSelection, commitShapeDraft, editorMode, finalizeSelectionMarquee, finalizeStroke, isDrawing, tool]);

  const performHistoryStep = useCallback((direction: 'undo' | 'redo') => {
    const runStep = async () => {
      const handled = await flushActiveInteraction({
        behavior: direction === 'undo' ? 'revert' : 'commit',
        reportHandled: true,
      });
      if (handled) {
        return true;
      }

      return direction === 'undo' ? undoHistory() : redoHistory();
    };

    void runStep();
  }, [flushActiveInteraction]);

  const handleSelectLayer = useCallback(async (layerId: string) => {
    if (busy || !backgroundDocumentRef.current || backgroundDocumentRef.current.activeLayerId === layerId) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = setActiveBackgroundLayer(persistedDocument, layerId);
    await applyNextDocumentState(nextDocument);
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-select-layer');
  }, [applyNextDocumentState, busy, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleAddBitmapLayer = useCallback(async () => {
    if (busy || !backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = insertBackgroundLayerAfterActive(
      persistedDocument,
      createBitmapBackgroundLayer({ name: `Layer ${persistedDocument.layers.length + 1}` }),
    );
    await applyNextDocumentState(nextDocument, { preserveTool: false });
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-add-layer');
  }, [applyNextDocumentState, busy, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleAddVectorLayer = useCallback(async () => {
    if (busy || !backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = insertBackgroundLayerAfterActive(
      persistedDocument,
      createVectorBackgroundLayer({ name: `Layer ${persistedDocument.layers.length + 1}` }),
    );
    await applyNextDocumentState(nextDocument);
    setTool('select');
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-add-layer');
  }, [applyNextDocumentState, busy, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleDuplicateLayer = useCallback(async (layerId: string) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = duplicateBackgroundLayer(persistedDocument, layerId);
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument);
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-duplicate-layer');
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleDeleteLayer = useCallback(async (layerId: string) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = removeBackgroundLayer(persistedDocument, layerId);
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument);
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-delete-layer');
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleReorderLayer = useCallback(async (layerId: string, targetIndex: number) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = reorderBackgroundLayer(persistedDocument, layerId, targetIndex);
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument, { preserveTool: true });
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-reorder-layer');
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleToggleLayerVisibility = useCallback(async (layerId: string) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const currentLayer = getBackgroundLayerById(persistedDocument, layerId);
    if (!currentLayer) {
      return;
    }
    const nextDocument = setBackgroundLayerVisibility(persistedDocument, layerId, !currentLayer.visible);
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument, { preserveTool: true });
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-toggle-visibility');
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleToggleLayerLocked = useCallback(async (layerId: string) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const currentLayer = getBackgroundLayerById(persistedDocument, layerId);
    if (!currentLayer) {
      return;
    }
    const nextDocument = updateBackgroundLayer(persistedDocument, layerId, { locked: !currentLayer.locked });
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument, { preserveTool: true });
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-toggle-lock');
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleRenameLayer = useCallback(async (layerId: string, name: string) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = updateBackgroundLayer(persistedDocument, layerId, { name });
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument, { preserveTool: true });
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-rename-layer');
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const handleLayerOpacityChange = useCallback(async (layerId: string, opacity: number) => {
    if (!backgroundDocumentRef.current) {
      return;
    }
    const didFlush = await flushActiveInteraction();
    if (!didFlush) {
      return;
    }
    const persistedDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    const nextDocument = updateBackgroundLayer(persistedDocument, layerId, { opacity });
    if (!nextDocument) {
      return;
    }
    await applyNextDocumentState(nextDocument, { preserveTool: true });
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-layer-opacity', {
      allowMerge: true,
      mergeWindowMs: 150,
    });
  }, [applyNextDocumentState, commitBackgroundDocumentState, flushActiveInteraction, persistActiveLayerIntoDocument]);

  const flushPendingBackgroundColorCommit = useCallback(() => {
    if (backgroundColorCommitTimeoutRef.current) {
      clearTimeout(backgroundColorCommitTimeoutRef.current);
      backgroundColorCommitTimeoutRef.current = null;
    }
    if (!scene || backgroundColorRef.current === initialBackgroundColorRef.current) {
      return;
    }
    const nextDocument = persistActiveLayerIntoDocument(backgroundDocumentRef.current) ?? backgroundDocumentRef.current;
    if (!nextDocument) {
      return;
    }
    commitBackgroundDocumentState(nextDocument, backgroundColorRef.current, 'scene:background-color', {
      allowMerge: true,
      mergeWindowMs: 150,
    });
    initialBackgroundColorRef.current = backgroundColorRef.current;
  }, [commitBackgroundDocumentState, persistActiveLayerIntoDocument, scene]);

  const handleExitFullscreen = useCallback(async () => {
    const didFlushActiveInteraction = await flushActiveInteraction();
    if (!didFlushActiveInteraction) {
      return;
    }
    flushPendingBackgroundColorCommit();
    closeBackgroundEditor();
  }, [closeBackgroundEditor, flushActiveInteraction, flushPendingBackgroundColorCommit]);

  useEffect(() => {
    const copySelection = () => editorMode === 'vector' ? (vectorCanvasRef.current?.copySelection() ?? false) : false;
    const cutSelection = () => editorMode === 'vector' ? (vectorCanvasRef.current?.cutSelection() ?? false) : false;
    const duplicateSelection = () => editorMode === 'vector' ? (vectorCanvasRef.current?.duplicateSelection() ?? false) : false;
    const pasteSelection = () => editorMode === 'vector' ? (vectorCanvasRef.current?.pasteSelection() ?? false) : false;
    const groupSelection = () => editorMode === 'vector' ? (vectorCanvasRef.current?.groupSelection() ?? false) : false;
    const ungroupSelection = () => editorMode === 'vector' ? (vectorCanvasRef.current?.ungroupSelection() ?? false) : false;
    const deleteSelection = () => (
      editorMode === 'vector'
        ? (vectorCanvasRef.current?.deleteSelection() ?? false)
        : deleteFloatingSelection()
    );
    const nudgeSelection = (dx: number, dy: number) => (
      editorMode === 'vector'
        ? (vectorCanvasRef.current?.nudgeSelection(dx, dy) ?? false)
        : nudgeFloatingSelection(dx, dy)
    );
    const handler: UndoRedoHandler = {
      undo: () => {
        performHistoryStep('undo');
      },
      redo: () => {
        performHistoryStep('redo');
      },
      canUndo: () => canUndoHistory(),
      canRedo: () => canRedoHistory(),
      copySelection,
      cutSelection,
      duplicateSelection,
      pasteSelection,
      deleteSelection,
      nudgeSelection,
      handleKeyDown: (event) => {
        const plainEscape = event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey;
        const plainEnter = event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
        const isVectorTextEditing = editorMode === 'vector' && (vectorCanvasRef.current?.isTextEditing() ?? false);

        if (plainEscape && isVectorTextEditing) {
          event.preventDefault();
          void flushActiveInteraction({
            behavior: 'commit',
            reportHandled: true,
          });
          return true;
        }

        if (shouldIgnoreGlobalKeyboardEvent(event)) {
          return false;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey) {
          event.preventDefault();
          performHistoryStep('undo');
          return true;
        }

        if (
          ((event.metaKey || event.ctrlKey) && event.key === 'z' && event.shiftKey) ||
          (event.ctrlKey && event.key.toLowerCase() === 'y')
        ) {
          event.preventDefault();
          performHistoryStep('redo');
          return true;
        }

        if (editorMode === 'vector' && handleSelectionClipboardShortcuts(event, {
          duplicateSelection,
          copySelection,
          pasteSelection,
          cutSelection,
        }, 'background')) {
          return true;
        }

        if (editorMode === 'vector' && handleSelectionGroupingShortcuts(event, {
          groupSelection,
          ungroupSelection,
        })) {
          return true;
        }

        if (handleSelectionNudgeShortcut(event, nudgeSelection)) {
          return true;
        }

        if (handleSelectionDeleteShortcut(event, deleteSelection)) {
          return true;
        }

        if (handleToolSwitchShortcut(
          event,
          (key) => {
            const shortcutTool = resolveCostumeToolShortcut(key, editorMode);
            return shortcutTool && isBackgroundToolbarTool(shortcutTool) ? shortcutTool : null;
          },
          (shortcutTool) => {
            setTool(ensureToolForBackgroundMode(editorMode, shortcutTool));
          },
        )) {
          return true;
        }

        if (event.key === '[' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          if (editorMode === 'bitmap') {
            setBrushSize((value) => Math.max(1, value - 2));
          } else {
            setVectorStyle((value) => ({ ...value, strokeWidth: Math.max(1, value.strokeWidth - 1) }));
          }
          return true;
        }
        if (event.key === ']' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          if (editorMode === 'bitmap') {
            setBrushSize((value) => Math.min(256, value + 2));
          } else {
            setVectorStyle((value) => ({ ...value, strokeWidth: Math.min(256, value.strokeWidth + 1) }));
          }
          return true;
        }
        if (plainEscape && editorMode === 'vector' && (vectorCanvasRef.current?.exitAllGroupEditing() ?? false)) {
          event.preventDefault();
          return true;
        }
        if (plainEscape) {
          event.preventDefault();
          void flushActiveInteraction({
            behavior: 'revert',
            reportHandled: true,
          });
          return true;
        }
        if (plainEnter) {
          if (isVectorTextEditing) {
            return false;
          }
          event.preventDefault();
          void flushActiveInteraction({
            behavior: 'commit',
            reportHandled: true,
          });
          return true;
        }
        return false;
      },
    };
    registerBackgroundUndo(handler);
    return () => registerBackgroundUndo(null);
  }, [deleteFloatingSelection, editorMode, flushActiveInteraction, nudgeFloatingSelection, performHistoryStep, registerBackgroundUndo, tool]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedBackgroundChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedBackgroundChanges]);

  useEffect(() => {
    if (editorMode !== 'vector') {
      setVectorContextMenuPosition(null);
    }
  }, [editorMode]);

  const closeVectorContextMenu = useCallback(() => {
    setVectorContextMenuPosition(null);
  }, []);

  const handleBackgroundVectorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (editorMode !== 'vector') {
      return;
    }

    setVectorContextMenuPosition({
      x: event.clientX,
      y: event.clientY,
    });
  }, [editorMode]);

  const handleVectorContextMenuCopy = useCallback(() => {
    closeVectorContextMenu();
    void vectorCanvasRef.current?.copySelection().catch((error) => {
      console.error('Failed to copy background vector selection:', error);
    });
  }, [closeVectorContextMenu]);

  const handleVectorContextMenuCut = useCallback(() => {
    closeVectorContextMenu();
    void vectorCanvasRef.current?.cutSelection().catch((error) => {
      console.error('Failed to cut background vector selection:', error);
    });
  }, [closeVectorContextMenu]);

  const handleVectorContextMenuPaste = useCallback(() => {
    closeVectorContextMenu();
    void vectorCanvasRef.current?.pasteSelection().catch((error) => {
      console.error('Failed to paste background vector selection:', error);
    });
  }, [closeVectorContextMenu]);

  const handleVectorContextMenuDuplicate = useCallback(() => {
    closeVectorContextMenu();
    void vectorCanvasRef.current?.duplicateSelection().catch((error) => {
      console.error('Failed to duplicate background vector selection:', error);
    });
  }, [closeVectorContextMenu]);

  const handleVectorContextMenuGroup = useCallback(() => {
    closeVectorContextMenu();
    vectorCanvasRef.current?.groupSelection();
  }, [closeVectorContextMenu]);

  const handleVectorContextMenuUngroup = useCallback(() => {
    closeVectorContextMenu();
    vectorCanvasRef.current?.ungroupSelection();
  }, [closeVectorContextMenu]);

  const handleVectorContextMenuDelete = useCallback(() => {
    closeVectorContextMenu();
    vectorCanvasRef.current?.deleteSelection();
  }, [closeVectorContextMenu]);

  useEffect(() => {
    if (editorMode === 'vector') {
      return;
    }
    if (tool === 'select') {
      return;
    }
    if (floatingSelectionRef.current) {
      const didCommitSelection = commitFloatingSelection();
      if (!didCommitSelection) {
        setTool('select');
        return;
      }
    }
    if (selectionMarqueeRef.current) {
      selectionMarqueeRef.current = null;
      setRevision((value) => value + 1);
    }
  }, [commitFloatingSelection, editorMode, tool]);

  useEffect(() => {
    if (!backgroundEditorOpen) return;
    if (!scene || !selectedSceneId) return;
    if (scene.id === selectedSceneId) return;
    void handleExitFullscreen();
  }, [backgroundEditorOpen, handleExitFullscreen, scene, selectedSceneId]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    cancelCameraCenterAnimation();
    if (rasterOperationBusyRef.current) {
      event.preventDefault();
      return;
    }

    if (event.button === 0) {
      if (activeLayer?.locked) {
        event.preventDefault();
        return;
      }
      const world = screenToWorld(event.clientX, event.clientY);
      const screen = getScreenPoint(event.clientX, event.clientY);
      pointerWorldRef.current = world;
      if (editorMode === 'vector') {
        if (isShapeTool(tool)) {
          const didStart = vectorCanvasRef.current?.beginShape(tool, world) ?? false;
          if (didStart) {
            setIsDrawing(true);
            (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
            event.preventDefault();
          }
        }
        return;
      }
      if (tool === 'select') {
        const floatingSelection = floatingSelectionRef.current;
        if (floatingSelection) {
          const hitTarget = hitTestFloatingSelection(floatingSelection, screen);
          if (hitTarget) {
            const geometry = getFloatingSelectionScreenGeometry(floatingSelection, worldToScreen, zoom);
            if (hitTarget === 'body') {
              floatingSelectionTransformRef.current = {
                kind: 'move',
                selection: floatingSelection,
                startScreen: screen,
                startCenterWorld: { ...floatingSelection.centerWorld },
              };
            } else if (hitTarget.startsWith('rotate-')) {
              floatingSelectionTransformRef.current = {
                kind: 'rotate',
                selection: floatingSelection,
                centerScreen: geometry.centerScreen,
                corner: getTransformGizmoCornerFromTarget(hitTarget as TransformGizmoCornerTarget) ?? 'nw',
                startPointerAngle: Math.atan2(screen.y - geometry.centerScreen.y, screen.x - geometry.centerScreen.x),
                startRotation: floatingSelection.rotation,
              };
            } else {
              if (!isBackgroundFloatingSelectionScaleTarget(hitTarget)) {
                return;
              }
              const frame = {
                center: geometry.centerScreen,
                corners: geometry.corners,
              };
              const edgeSegments = getTransformGizmoEdgeSegments(frame);
              const handleMap: Record<Exclude<BackgroundFloatingSelectionHitTarget, 'body' | `rotate-${TransformGizmoCorner}`>, {
                anchor: ScreenPoint;
                scaleMode: 'corner' | 'edge';
                corner: TransformGizmoCorner | null;
                side: TransformGizmoSide | null;
                handleXSign: -1 | 1 | null;
                handleYSign: -1 | 1 | null;
                edge: 'horizontal' | 'vertical' | null;
                handleSign: -1 | 1 | null;
              }> = {
                'scale-nw': { anchor: geometry.corners.se, scaleMode: 'corner', corner: 'nw', side: null, handleXSign: -1, handleYSign: -1, edge: null, handleSign: null },
                'scale-ne': { anchor: geometry.corners.sw, scaleMode: 'corner', corner: 'ne', side: null, handleXSign: 1, handleYSign: -1, edge: null, handleSign: null },
                'scale-se': { anchor: geometry.corners.nw, scaleMode: 'corner', corner: 'se', side: null, handleXSign: 1, handleYSign: 1, edge: null, handleSign: null },
                'scale-sw': { anchor: geometry.corners.ne, scaleMode: 'corner', corner: 'sw', side: null, handleXSign: -1, handleYSign: 1, edge: null, handleSign: null },
                'scale-n': { anchor: edgeSegments.s.center, scaleMode: 'edge', corner: null, side: 'n', handleXSign: null, handleYSign: null, edge: edgeSegments.n.edge, handleSign: edgeSegments.n.handleSign },
                'scale-e': { anchor: edgeSegments.w.center, scaleMode: 'edge', corner: null, side: 'e', handleXSign: null, handleYSign: null, edge: edgeSegments.e.edge, handleSign: edgeSegments.e.handleSign },
                'scale-s': { anchor: edgeSegments.n.center, scaleMode: 'edge', corner: null, side: 's', handleXSign: null, handleYSign: null, edge: edgeSegments.s.edge, handleSign: edgeSegments.s.handleSign },
                'scale-w': { anchor: edgeSegments.e.center, scaleMode: 'edge', corner: null, side: 'w', handleXSign: null, handleYSign: null, edge: edgeSegments.w.edge, handleSign: edgeSegments.w.handleSign },
              };
              const handle = handleMap[hitTarget];
              floatingSelectionTransformRef.current = {
                kind: 'scale',
                selection: floatingSelection,
                anchorScreen: handle.anchor,
                centerScreen: geometry.centerScreen,
                scaleMode: handle.scaleMode,
                corner: handle.corner,
                side: handle.side,
                handleXSign: handle.handleXSign,
                handleYSign: handle.handleYSign,
                edge: handle.edge,
                handleSign: handle.handleSign,
                rotation: floatingSelection.rotation,
                sourceWidth: floatingSelection.canvas.width,
                sourceHeight: floatingSelection.canvas.height,
                startScaleX: floatingSelection.scaleX,
                startScaleY: floatingSelection.scaleY,
                proportional: !!event.shiftKey,
              };
            }
            setIsDrawing(true);
            (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
            event.preventDefault();
            return;
          }

          const didCommitSelection = commitFloatingSelection();
          if (!didCommitSelection) {
            event.preventDefault();
            return;
          }
        }

        selectionMarqueeRef.current = {
          startWorld: world,
          currentWorld: world,
        };
        setIsDrawing(true);
        setRevision((value) => value + 1);
        (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      if (tool === 'brush' || tool === 'eraser') {
        drawingStrokeRef.current = {
          ...beginMutationSession(),
          lastWorld: world,
        };
        paintSegment(world, world, drawingStrokeRef.current);
        setIsDrawing(true);
        (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      if (tool === 'fill') {
        void enqueueRasterOperation(async (epoch) => {
          await applyFill(epoch, world.x, world.y);
        });
        event.preventDefault();
        return;
      }

      if (isShapeTool(tool)) {
        shapeDraftRef.current = {
          tool,
          startWorld: world,
          currentWorld: world,
        };
        setIsDrawing(true);
        setRevision((value) => value + 1);
        (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }

    if (event.button === 1 || event.button === 2) {
      panSessionRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        cameraStartX: camera.x,
        cameraStartY: camera.y,
      };
      setIsPanning(true);
      (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }, [
    activeLayer?.locked,
    applyFill,
    beginMutationSession,
    camera.x,
    camera.y,
    cancelCameraCenterAnimation,
    commitFloatingSelection,
    editorMode,
    enqueueRasterOperation,
    getScreenPoint,
    hitTestFloatingSelection,
    paintSegment,
    screenToWorld,
    tool,
    worldToScreen,
    zoom,
  ]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(event.clientX, event.clientY);
    const screen = getScreenPoint(event.clientX, event.clientY);
    pointerWorldRef.current = world;

    const pan = panSessionRef.current;
    if (pan) {
      const dx = (event.clientX - pan.startX) / zoom;
      const dy = (event.clientY - pan.startY) / zoom;
      setCamera(panCameraFromDrag(
        { x: pan.cameraStartX, y: pan.cameraStartY },
        dx * zoom,
        dy * zoom,
        zoom,
        'up',
      ));
      return;
    }

    if (editorMode === 'vector' && isDrawing && isShapeTool(tool)) {
      vectorCanvasRef.current?.updateShape(world);
      return;
    }

    const floatingSelectionTransform = floatingSelectionTransformRef.current;
    if (floatingSelectionTransform) {
      if (floatingSelectionTransform.kind === 'move') {
        const deltaX = (screen.x - floatingSelectionTransform.startScreen.x) / zoom;
        const deltaY = (screen.y - floatingSelectionTransform.startScreen.y) / zoom;
        floatingSelectionTransform.selection.centerWorld = {
          x: floatingSelectionTransform.startCenterWorld.x + deltaX,
          y: floatingSelectionTransform.startCenterWorld.y - deltaY,
        };
      } else if (floatingSelectionTransform.kind === 'rotate') {
        const angle = Math.atan2(
          screen.y - floatingSelectionTransform.centerScreen.y,
          screen.x - floatingSelectionTransform.centerScreen.x,
        );
        floatingSelectionTransform.selection.rotation = (
          floatingSelectionTransform.startRotation -
          (angle - floatingSelectionTransform.startPointerAngle)
        );
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.cursor = getTransformGizmoCursorForCornerTarget(
            `rotate-${floatingSelectionTransform.corner}` as TransformGizmoCornerTarget,
            -floatingSelectionTransform.selection.rotation,
          );
        }
      } else {
        const centered = event.altKey;
        const proportional = !!event.shiftKey;
        floatingSelectionTransform.proportional = proportional;
        const baseWidth = Math.max(1, floatingSelectionTransform.sourceWidth * Math.abs(floatingSelectionTransform.startScaleX) * zoom);
        const baseHeight = Math.max(1, floatingSelectionTransform.sourceHeight * Math.abs(floatingSelectionTransform.startScaleY) * zoom);
        const referencePoint = centered ? floatingSelectionTransform.centerScreen : floatingSelectionTransform.anchorScreen;
        const scaled = floatingSelectionTransform.scaleMode === 'edge'
          ? computeEdgeScaleResult({
            referencePoint,
            pointerPoint: screen,
            edge: floatingSelectionTransform.edge ?? 'horizontal',
            handleSign: floatingSelectionTransform.handleSign ?? 1,
            rotationRadians: floatingSelectionTransform.rotation,
            baseWidth,
            baseHeight,
            minWidth: FLOATING_SELECTION_MIN_SCREEN_SIZE,
            minHeight: FLOATING_SELECTION_MIN_SCREEN_SIZE,
            proportional,
            centered,
          })
          : computeCornerScaleResult({
            referencePoint,
            pointerPoint: screen,
            handleXSign: floatingSelectionTransform.handleXSign ?? 1,
            handleYSign: floatingSelectionTransform.handleYSign ?? 1,
            rotationRadians: floatingSelectionTransform.rotation,
            baseWidth,
            baseHeight,
            minWidth: FLOATING_SELECTION_MIN_SCREEN_SIZE,
            minHeight: FLOATING_SELECTION_MIN_SCREEN_SIZE,
            proportional,
            centered,
          });
        floatingSelectionTransform.selection.centerWorld = screenToWorldFromCanvasPoint(scaled.center);
        floatingSelectionTransform.selection.scaleX = floatingSelectionTransform.startScaleX * (
          scaled.signedWidth / Math.max(baseWidth, 0.0001)
        );
        floatingSelectionTransform.selection.scaleY = floatingSelectionTransform.startScaleY * (
          scaled.signedHeight / Math.max(baseHeight, 0.0001)
        );
      }
      setRevision((value) => value + 1);
      return;
    }

    const canvas = canvasRef.current;
    if (canvas && editorMode === 'bitmap') {
      if (tool === 'select' && floatingSelectionRef.current) {
        const hitTarget = hitTestFloatingSelection(floatingSelectionRef.current, screen);
        const rotationRadians = -floatingSelectionRef.current.rotation;
        if (hitTarget === 'body') {
          canvas.style.cursor = 'move';
        } else if (hitTarget?.startsWith('scale-')) {
          canvas.style.cursor = (
            hitTarget === 'scale-n' || hitTarget === 'scale-s'
              ? getTransformGizmoEdgeCursor('vertical', rotationRadians)
              : hitTarget === 'scale-e' || hitTarget === 'scale-w'
                ? getTransformGizmoEdgeCursor('horizontal', rotationRadians)
                : getTransformGizmoCursorForCornerTarget(hitTarget as TransformGizmoCornerTarget, rotationRadians)
          );
        } else if (hitTarget?.startsWith('rotate-')) {
          canvas.style.cursor = getTransformGizmoCursorForCornerTarget(
            hitTarget as TransformGizmoCornerTarget,
            rotationRadians,
          );
        } else {
          canvas.style.cursor = 'crosshair';
        }
      } else if (tool === 'brush' || tool === 'eraser') {
        canvas.style.cursor = 'none';
      } else if (tool === 'text') {
        canvas.style.cursor = 'text';
      } else if (tool === 'fill' || isShapeTool(tool)) {
        canvas.style.cursor = 'default';
      } else {
        canvas.style.cursor = 'default';
      }
    }

    const selectionMarquee = selectionMarqueeRef.current;
    if (selectionMarquee) {
      selectionMarquee.currentWorld = world;
      setRevision((value) => value + 1);
      return;
    }

    const shapeDraft = shapeDraftRef.current;
    if (shapeDraft) {
      shapeDraft.currentWorld = world;
      setRevision((value) => value + 1);
      return;
    }

    const stroke = drawingStrokeRef.current;
    if (!stroke || !stroke.lastWorld) return;
    paintSegment(stroke.lastWorld, world, stroke);
    stroke.lastWorld = world;
  }, [editorMode, getScreenPoint, hitTestFloatingSelection, isDrawing, paintSegment, screenToWorld, screenToWorldFromCanvasPoint, tool, zoom]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    panSessionRef.current = null;
    setIsPanning(false);
    if (editorMode === 'vector' && isShapeTool(tool) && isDrawing) {
      vectorCanvasRef.current?.commitShape();
      setIsDrawing(false);
      markActiveLayerDirty();
      try {
        (event.currentTarget as HTMLCanvasElement).releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture already released.
      }
      return;
    }
    if (floatingSelectionTransformRef.current) {
      floatingSelectionTransformRef.current = null;
      setIsDrawing(false);
      setRevision((value) => value + 1);
    }
    if (selectionMarqueeRef.current) {
      void finalizeSelectionMarquee();
    }
    if (drawingStrokeRef.current) {
      finalizeStroke();
      setIsDrawing(false);
    }
    if (shapeDraftRef.current) {
      commitShapeDraft(shapeDraftRef.current);
      shapeDraftRef.current = null;
      setIsDrawing(false);
      setRevision((value) => value + 1);
    }
    try {
      (event.currentTarget as HTMLCanvasElement).releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if pointer capture already released.
    }
  }, [commitShapeDraft, editorMode, finalizeSelectionMarquee, finalizeStroke, isDrawing, markActiveLayerDirty, tool]);

  const onPointerLeave = useCallback(() => {
    pointerWorldRef.current = null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'default';
    }
    setRevision((value) => value + 1);
  }, []);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    cancelCameraCenterAnimation();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();

    if (event.ctrlKey || event.metaKey) {
      const zoomDelta = -event.deltaY * 0.01;
      const nextZoom = clampViewportZoom(zoom * (1 + zoomDelta), MIN_ZOOM, MAX_ZOOM);
      setZoom(nextZoom);
      setCamera(zoomCameraAtScreenPoint(
        getScreenPoint(event.clientX, event.clientY),
        rect,
        camera,
        zoom,
        nextZoom,
        'up',
      ));
      return;
    }

    setCamera((current) => panCameraFromWheel(current, event.deltaX, event.deltaY, zoom, 'up'));
  }, [camera, cancelCameraCenterAnimation, getScreenPoint, zoom]);

  const handleToolbarToolChange = useCallback((nextTool: CostumeDrawingTool) => {
    if (busy || !isBackgroundToolbarTool(nextTool)) {
      return;
    }
    setTool(ensureToolForBackgroundMode(editorMode, nextTool));
  }, [busy, editorMode]);

  const handleToolbarMoveOrder = useCallback((action: MoveOrderAction) => {
    if (editorMode !== 'vector') {
      return;
    }
    vectorCanvasRef.current?.moveSelectionOrder(action);
  }, [editorMode]);
  const handleToolbarGroupSelection = useCallback(() => {
    if (editorMode !== 'vector') {
      return;
    }
    vectorCanvasRef.current?.groupSelection();
  }, [editorMode]);
  const handleToolbarUngroupSelection = useCallback(() => {
    if (editorMode !== 'vector') {
      return;
    }
    vectorCanvasRef.current?.ungroupSelection();
  }, [editorMode]);
  const handleToolbarFlipSelection = useCallback((axis: SelectionFlipAxis) => {
    if (editorMode !== 'vector') {
      return;
    }
    vectorCanvasRef.current?.flipSelection(axis);
  }, [editorMode]);
  const handleToolbarRotateSelection = useCallback(() => {
    if (editorMode !== 'vector') {
      return;
    }
    vectorCanvasRef.current?.rotateSelection();
  }, [editorMode]);
  const handleToolbarVectorHandleModeChange = useCallback((mode: Extract<VectorHandleMode, 'linear' | 'corner' | 'smooth' | 'symmetric'>) => {
    setVectorHandleMode(mode);
  }, []);
  const handleToolbarAlign = useCallback((action: AlignAction) => {
    if (editorMode !== 'vector') {
      return;
    }
    vectorCanvasRef.current?.alignSelection(action);
  }, [editorMode]);
  const handleToolbarTextStyleChange = useCallback((updates: Partial<TextToolStyle>, meta?: ToolbarSliderChangeMeta) => {
    registerSliderChangeMeta(meta);
    setTextStyle((previous) => {
      const next = { ...previous, ...updates };
      if (
        next.fontFamily === previous.fontFamily &&
        next.fontSize === previous.fontSize &&
        next.fontWeight === previous.fontWeight &&
        next.fontStyle === previous.fontStyle &&
        next.underline === previous.underline &&
        next.textAlign === previous.textAlign &&
        next.opacity === previous.opacity
      ) {
        return previous;
      }
      return next;
    });
  }, [registerSliderChangeMeta]);
  const handleToolbarVectorStyleChange = useCallback((updates: Partial<VectorToolStyle>, meta?: ToolbarSliderChangeMeta) => {
    registerSliderChangeMeta(meta);
    const next = { ...vectorStyleRef.current, ...updates };
    if (areVectorToolStylesEqual(vectorStyleRef.current, next)) {
      return;
    }
    setLatestVectorStyleUpdates(updates);
    setVectorStyleChangeRevision((revision) => revision + 1);
    setVectorStyleMixedState((prev) => clearVectorToolStyleMixedState(prev, updates));
    setVectorStyle(next);
  }, [registerSliderChangeMeta]);
  const handleVectorSelectionChange = useCallback((hasSelection: boolean) => {
    setHasVectorSelection((previous) => (previous === hasSelection ? previous : hasSelection));
    if (!hasSelection) {
      setVectorStyleMixedState((previous) => (
        Object.keys(previous).length === 0 ? previous : {}
      ));
    }
  }, []);
  const handleVectorGroupingStateChange = useCallback((state: { canGroup: boolean; canUngroup: boolean }) => {
    setCanGroupVectorSelection(state.canGroup);
    setCanUngroupVectorSelection(state.canUngroup);
  }, []);
  const handleVectorTextSelectionChange = useCallback((hasTextSelection: boolean) => {
    setHasVectorTextSelection(hasTextSelection);
  }, []);
  const handleVectorTextStyleSync = useCallback((updates: Partial<TextToolStyle>) => {
    setTextStyle((previous) => ({ ...previous, ...updates }));
  }, []);
  const handleVectorHandleModeSync = useCallback((mode: VectorHandleMode) => {
    setVectorHandleMode(mode);
  }, []);
  const handleVectorPointEditingChange = useCallback((isEditing: boolean) => {
    setIsVectorPointEditing(isEditing);
  }, []);
  const handleVectorPointSelectionChange = useCallback((hasSelectedPoints: boolean) => {
    setHasSelectedVectorPoints(hasSelectedPoints);
  }, []);
  const handleVectorStyleSync = useCallback((snapshot: VectorToolStyleSelectionSnapshot) => {
    const nextStyle = { ...vectorStyleRef.current, ...snapshot.style };
    const didStyleChange = !areVectorToolStylesEqual(vectorStyleRef.current, nextStyle);
    const didMixedStateChange = !areVectorToolStyleMixedStatesEqual(vectorStyleMixedStateRef.current, snapshot.mixed);

    if (!didStyleChange && !didMixedStateChange) {
      return false;
    }

    if (didStyleChange) {
      setVectorStyle(nextStyle);
    }
    if (didMixedStateChange) {
      setVectorStyleMixedState(snapshot.mixed);
    }
    return didStyleChange || didMixedStateChange;
  }, []);
  const handleVectorStyleCapabilitiesSync = useCallback((capabilities: VectorStyleCapabilities) => {
    setVectorStyleCapabilities(capabilities);
  }, []);

  const handleToolbarColorChange = useCallback((color: string, meta?: ToolbarSliderChangeMeta) => {
    if (busy) {
      return;
    }
    registerSliderChangeMeta(meta);
    setBrushColor(color);
  }, [busy, registerSliderChangeMeta]);

  const handleToolbarBrushOpacityChange = useCallback((opacity: number, _meta?: ToolbarSliderChangeMeta) => {
    if (busy) {
      return;
    }
    setBrushOpacity(opacity);
  }, [busy]);

  const handleBackgroundColorControlChange = useCallback((color: string, meta?: ToolbarSliderChangeMeta) => {
    if (busy) {
      return;
    }

    backgroundColorPickerPreviewActiveRef.current = meta?.source === 'picker' && meta.phase === 'preview';
    setBackgroundColor(color);

    if (meta?.source === 'picker' && meta.phase === 'commit') {
      backgroundColorPickerPreviewActiveRef.current = false;
      flushPendingBackgroundColorCommit();
    }
  }, [busy, flushPendingBackgroundColorCommit]);

  const handleBackgroundColorPickerOpenChange = useCallback((open: boolean) => {
    setBackgroundColorPickerOpen(open);
    if (!open && !backgroundColorPickerPreviewActiveRef.current) {
      flushPendingBackgroundColorCommit();
    }
  }, [flushPendingBackgroundColorCommit]);

  const handleToolbarBitmapBrushKindChange = useCallback((kind: BitmapBrushKind) => {
    if (busy) {
      return;
    }
    setBitmapBrushKind(kind);
  }, [busy]);

  const handleToolbarBrushSizeChange = useCallback((size: number, _meta?: ToolbarSliderChangeMeta) => {
    if (busy) {
      return;
    }
    setBrushSize(size);
  }, [busy]);

  const handleToolbarBitmapFillStyleChange = useCallback((updates: Partial<BitmapFillStyle>) => {
    if (busy) {
      return;
    }
    setBitmapFillStyle((prev) => ({ ...prev, ...updates }));
  }, [busy]);

  const handleToolbarBitmapShapeStyleChange = useCallback((updates: Partial<BitmapShapeStyle>, _meta?: ToolbarSliderChangeMeta) => {
    if (busy) {
      return;
    }
    setBitmapShapeStyle((prev) => ({ ...prev, ...updates }));
  }, [busy]);

  if (!scene) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100050] bg-background flex flex-col overscroll-none"
      data-testid="background-editor-root"
      data-chunk-count={activeChunkCount}
    >
      {chunkLimitWarning && (
        <div className="px-3 py-2 text-xs bg-amber-50 text-amber-900 border-b border-amber-200">
          {chunkLimitWarning}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div
          ref={hostRef}
          className="relative flex-1 min-h-0 overflow-hidden bg-[#060a14]"
          onWheel={onWheel}
          onContextMenu={handleBackgroundVectorContextMenu}
        >
          <CanvasViewportOverlay
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => performHistoryStep('undo')}
            onRedo={() => performHistoryStep('redo')}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onZoomOut={() => zoomAroundViewportCenter(zoom - ZOOM_STEP)}
            onZoomIn={() => zoomAroundViewportCenter(zoom + ZOOM_STEP)}
            onZoomToActualSize={handleZoomToActualSize}
            onZoomToFit={fitToContent}
            onZoomToSelection={handleZoomToSelection}
            canZoomToSelection={editorMode === 'bitmap' ? hasFloatingSelection : canZoomToVectorSelection}
            rightAccessory={(
              <OverlayPill tone={overlayPillTone} size="compact">
                <OverlayActionButton
                  disabled={busy}
                  label="Exit fullscreen"
                  onClick={() => {
                    void handleExitFullscreen();
                  }}
                  pressed
                  selected
                  size="compact"
                  title="Exit fullscreen"
                  tone={overlayPillTone}
                >
                  <Minimize2 className="size-3.5" />
                </OverlayActionButton>
              </OverlayPill>
            )}
          />
          <ViewportRecoveryPill
            visible={showReturnToCenter}
            onClick={handleReturnToCenter}
            dataTestId="background-return-to-center"
          />
          <CostumeToolbar
            editorMode={editorMode}
            activeTool={tool}
            hasActiveSelection={editorMode === 'bitmap' ? hasFloatingSelection : hasVectorSelection}
            toolVisibility={{
              showSelectTool: true,
              showPenTool: true,
              showTextTool: true,
              showShapeTools: true,
            }}
            showModeSwitcher={false}
            selectionActionsEnabled={editorMode === 'vector'}
            showTextControls={editorMode === 'vector' && (tool === 'text' || hasVectorTextSelection)}
            isVectorPointEditing={isVectorPointEditing}
            hasSelectedVectorPoints={hasSelectedVectorPoints}
            bitmapBrushKind={bitmapBrushKind}
            brushColor={brushColor}
            brushOpacity={brushOpacity}
            brushSize={brushSize}
            bitmapFillStyle={bitmapFillStyle}
            bitmapShapeStyle={bitmapShapeStyle}
            textStyle={textStyle}
            vectorStyle={vectorStyle}
            vectorStyleMixedState={vectorStyleMixedState}
            vectorStyleCapabilities={vectorStyleCapabilities}
            previewScale={zoom}
            onToolChange={handleToolbarToolChange}
            onMoveOrder={handleToolbarMoveOrder}
            canGroupSelection={canGroupVectorSelection}
            canUngroupSelection={canUngroupVectorSelection}
            onGroupSelection={handleToolbarGroupSelection}
            onFlipSelection={handleToolbarFlipSelection}
            onRotateSelection={handleToolbarRotateSelection}
            onUngroupSelection={handleToolbarUngroupSelection}
            vectorHandleMode={vectorHandleMode}
            onVectorHandleModeChange={handleToolbarVectorHandleModeChange}
            onAlign={handleToolbarAlign}
            alignDisabled={editorMode !== 'vector' || !hasVectorSelection}
            onColorChange={handleToolbarColorChange}
            onBrushOpacityChange={handleToolbarBrushOpacityChange}
            onBitmapBrushKindChange={handleToolbarBitmapBrushKindChange}
            onBrushSizeChange={handleToolbarBrushSizeChange}
            onBitmapFillStyleChange={handleToolbarBitmapFillStyleChange}
            onBitmapShapeStyleChange={handleToolbarBitmapShapeStyleChange}
            onTextStyleChange={handleToolbarTextStyleChange}
            onVectorStyleChange={handleToolbarVectorStyleChange}
            toolAccessory={(
              <FloatingToolbarColorControl
                label="BG"
                value={backgroundColor}
                open={backgroundColorPickerOpen}
                onOpenChange={handleBackgroundColorPickerOpenChange}
                onColorChange={handleBackgroundColorControlChange}
                disabled={busy}
              />
            )}
          />
          <canvas
            ref={canvasRef}
            data-testid="background-editor-canvas"
            className="absolute inset-0 size-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
          />
          <BitmapBrushCursorOverlay
            ref={brushCursorOverlayRef}
            testId="background-brush-cursor-overlay"
          />
          {isVectorBackgroundLayer(activeLayer) ? (
            <BackgroundVectorCanvas
              ref={vectorCanvasRef}
              alignmentBounds={vectorAlignmentBounds}
              layer={activeLayer as BackgroundVectorLayer}
              viewport={viewport}
              camera={camera}
              zoom={zoom}
              activeTool={toSupportedVectorTool(tool)}
              brushColor={brushColor}
              textStyle={textStyle}
              vectorStyle={vectorStyle}
              vectorStyleChangeRevision={vectorStyleChangeRevision}
              latestVectorStyleUpdates={latestVectorStyleUpdates}
              sliderCommitBoundaryState={sliderCommitBoundaryState}
              sliderCommitBoundaryStateRef={sliderCommitBoundaryStateRef}
              interactive={editorMode === 'vector'}
              onDirty={handleVectorDocumentCommit}
              onHistoryStateChange={handleVectorHistoryStateChange}
              onSelectionChange={handleVectorSelectionChange}
              onVectorGroupingStateChange={handleVectorGroupingStateChange}
              onTextSelectionChange={handleVectorTextSelectionChange}
              onTextStyleSync={handleVectorTextStyleSync}
              vectorHandleMode={vectorHandleMode}
              onVectorHandleModeSync={handleVectorHandleModeSync}
              onVectorPointEditingChange={handleVectorPointEditingChange}
              onVectorPointSelectionChange={handleVectorPointSelectionChange}
              onVectorStyleSync={handleVectorStyleSync}
              onVectorStyleCapabilitiesSync={handleVectorStyleCapabilitiesSync}
              onCanZoomToSelectionChange={setCanZoomToVectorSelection}
              onCanvasContextMenu={(event) => {
                event.preventDefault();
                if (editorMode !== 'vector') {
                  return;
                }
                setVectorContextMenuPosition({
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            />
          ) : null}
          {backgroundDocument ? (
            <BackgroundLayerPanel
              document={backgroundDocument}
              activeLayer={activeLayer}
              onSelectLayer={handleSelectLayer}
              onAddBitmapLayer={handleAddBitmapLayer}
              onAddVectorLayer={handleAddVectorLayer}
              onDuplicateLayer={handleDuplicateLayer}
              onDeleteLayer={handleDeleteLayer}
              onReorderLayer={handleReorderLayer}
              onToggleVisibility={handleToggleLayerVisibility}
              onToggleLocked={handleToggleLayerLocked}
              onRenameLayer={handleRenameLayer}
              onOpacityChange={handleLayerOpacityChange}
            />
          ) : null}
        </div>
      </div>
      {vectorContextMenuPosition ? (
        <VectorSelectionContextMenu
          canCopy={hasVectorSelection}
          canDelete={hasVectorSelection}
          canGroup={canGroupVectorSelection}
          canPaste={hasVectorClipboardContents()}
          canUngroup={canUngroupVectorSelection}
          onClose={closeVectorContextMenu}
          onCopy={handleVectorContextMenuCopy}
          onCut={handleVectorContextMenuCut}
          onDelete={handleVectorContextMenuDelete}
          onDuplicate={handleVectorContextMenuDuplicate}
          onGroup={handleVectorContextMenuGroup}
          onPaste={handleVectorContextMenuPaste}
          onUngroup={handleVectorContextMenuUngroup}
          position={vectorContextMenuPosition}
        />
      ) : null}
    </div>
  );
}

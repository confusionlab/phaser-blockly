import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Check, LocateFixed, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CanvasViewportOverlay } from '@/components/editors/shared/CanvasViewportOverlay';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import type { BackgroundConfig } from '@/types';
import {
  CostumeToolbar,
  type BitmapFillStyle,
  type BitmapShapeStyle,
  type DrawingTool as CostumeDrawingTool,
  type SelectionFlipAxis,
  type TextToolStyle,
  type VectorHandleMode,
  type VectorStyleCapabilities,
  type VectorToolStyle,
} from '@/components/editors/costume/CostumeToolbar';
import {
  DEFAULT_BACKGROUND_CHUNK_SIZE,
  getChunkBoundsFromKeys,
  getChunkKey,
  getChunkRangeForWorldBounds,
  getChunkWorldBounds,
  iterateChunkKeys,
  parseChunkKey,
  worldToChunkLocal,
} from '@/lib/background/chunkMath';
import {
  DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT,
  DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT,
  buildTiledBackgroundConfig,
  canCreateChunk,
  createEmptyChunkCanvas,
  estimateSerializedChunkBytes,
  evaluateChunkLimits,
  isChunkCanvasTransparent,
  normalizeChunkDataMap,
  type ChunkDataMap,
} from '@/lib/background/chunkStore';
import {
  getBitmapBrushCursorStyle,
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
import { DEFAULT_VECTOR_STROKE_BRUSH_ID } from '@/lib/vector/vectorStrokeBrushCore';
import { DEFAULT_VECTOR_FILL_TEXTURE_ID } from '@/lib/vector/vectorFillTextureCore';
import {
  clampViewportZoom,
  panCameraFromDrag,
  panCameraFromWheel,
  screenToWorldPoint,
  worldToScreenPoint,
  zoomCameraAtClientPoint,
} from '@/lib/viewportNavigation';
import { runInHistoryTransaction } from '@/store/universalHistory';
import { calculateBoundsFromImageData } from '@/utils/imageBounds';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 10;
const INITIAL_BRUSH_COLOR = '#101010';
const INITIAL_BRUSH_SIZE = 24;
const MAX_UNDO_STEPS = 50;
const LARGE_PAYLOAD_WARNING_BYTES = 15 * 1024 * 1024;
const INITIAL_SHAPE_STROKE_WIDTH = 6;
const MAX_RASTER_OPERATION_DIMENSION = 8192;
const MAX_RASTER_OPERATION_PIXELS = 36 * 1024 * 1024;
const ZOOM_STEP = 0.1;

type ChunkDelta = {
  before: Record<string, string | null>;
  after: Record<string, string | null>;
};

type BackgroundShapeTool = Extract<CostumeDrawingTool, 'line' | 'circle' | 'rectangle' | 'triangle' | 'star'>;
type BackgroundDrawingTool = Extract<CostumeDrawingTool, 'select' | 'brush' | 'eraser' | 'fill' | 'line' | 'circle' | 'rectangle' | 'triangle' | 'star'>;

type MutationSession = {
  touched: Set<string>;
  before: Record<string, string | null>;
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
  pendingMutationSession: MutationSession;
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
      startPointerAngle: number;
      startRotation: number;
    }
  | {
      kind: 'scale';
      selection: BackgroundFloatingSelection;
      anchorScreen: ScreenPoint;
      handleXSign: -1 | 1;
      handleYSign: -1 | 1;
      rotation: number;
      sourceWidth: number;
      sourceHeight: number;
    };

type BackgroundFloatingSelectionHitTarget =
  | 'body'
  | 'rotate'
  | 'scale-nw'
  | 'scale-ne'
  | 'scale-se'
  | 'scale-sw';

type BackgroundFloatingSelectionScreenGeometry = {
  centerScreen: ScreenPoint;
  corners: {
    nw: ScreenPoint;
    ne: ScreenPoint;
    se: ScreenPoint;
    sw: ScreenPoint;
  };
  rotateHandle: ScreenPoint;
  topCenter: ScreenPoint;
  halfWidth: number;
  halfHeight: number;
};

const FLOATING_SELECTION_HANDLE_RADIUS = 7;
const FLOATING_SELECTION_ROTATE_HANDLE_OFFSET = 26;
const FLOATING_SELECTION_MIN_SCREEN_SIZE = 8;
const FLOATING_SELECTION_BORDER_COLOR = '#0ea5e9';
const FLOATING_SELECTION_BORDER_FILL = 'rgba(14, 165, 233, 0.08)';

const BACKGROUND_TOOLBAR_TEXT_STYLE: TextToolStyle = {
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
  strokeColor: '#000000',
  strokeWidth: 1,
  strokeBrushId: DEFAULT_VECTOR_STROKE_BRUSH_ID,
};

const BACKGROUND_TOOLBAR_VECTOR_HANDLE_MODE: VectorHandleMode = 'linear';
const BACKGROUND_TOOLBAR_VECTOR_CAPABILITIES: VectorStyleCapabilities = { supportsFill: false };

function isShapeTool(tool: BackgroundDrawingTool): tool is BackgroundShapeTool {
  return tool === 'line' || tool === 'circle' || tool === 'rectangle' || tool === 'triangle' || tool === 'star';
}

function isBackgroundToolbarTool(tool: CostumeDrawingTool): tool is BackgroundDrawingTool {
  return (
    tool === 'select' ||
    tool === 'brush' ||
    tool === 'eraser' ||
    tool === 'fill' ||
    tool === 'rectangle' ||
    tool === 'circle' ||
    tool === 'triangle' ||
    tool === 'star' ||
    tool === 'line'
  );
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

function getFloatingSelectionWorldCorners(selection: BackgroundFloatingSelection): Array<WorldPoint> {
  const halfWidth = selection.canvas.width * selection.scaleX * 0.5;
  const halfHeight = selection.canvas.height * selection.scaleY * 0.5;
  const localCorners: Array<WorldPoint> = [
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: -halfHeight },
  ];

  return localCorners.map((corner) => {
    const rotated = rotatePoint(corner, selection.rotation);
    return {
      x: selection.centerWorld.x + rotated.x,
      y: selection.centerWorld.y + rotated.y,
    };
  });
}

function getFloatingSelectionWorldBounds(selection: BackgroundFloatingSelection): WorldRect {
  const corners = getFloatingSelectionWorldCorners(selection);
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
  const halfWidth = selection.canvas.width * selection.scaleX * zoom * 0.5;
  const halfHeight = selection.canvas.height * selection.scaleY * zoom * 0.5;
  const screenRotation = -selection.rotation;
  const mapLocal = (x: number, y: number): ScreenPoint => {
    const rotated = rotatePoint({ x, y }, screenRotation);
    return {
      x: centerScreen.x + rotated.x,
      y: centerScreen.y + rotated.y,
    };
  };

  return {
    centerScreen,
    corners: {
      nw: mapLocal(-halfWidth, -halfHeight),
      ne: mapLocal(halfWidth, -halfHeight),
      se: mapLocal(halfWidth, halfHeight),
      sw: mapLocal(-halfWidth, halfHeight),
    },
    topCenter: mapLocal(0, -halfHeight),
    rotateHandle: mapLocal(0, -halfHeight - FLOATING_SELECTION_ROTATE_HANDLE_OFFSET),
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

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode chunk image.'));
    image.src = dataUrl;
  });
}

async function dataUrlToCanvas(dataUrl: string, chunkSize: number): Promise<HTMLCanvasElement | null> {
  try {
    const image = await loadImage(dataUrl);
    const canvas = createEmptyChunkCanvas(chunkSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null;
  }
}

export function BackgroundCanvasEditor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerWorldRef = useRef<{ x: number; y: number } | null>(null);
  const drawingStrokeRef = useRef<StrokeSession | null>(null);
  const shapeDraftRef = useRef<ShapeDraftSession | null>(null);
  const selectionMarqueeRef = useRef<BackgroundSelectionMarqueeSession | null>(null);
  const floatingSelectionRef = useRef<BackgroundFloatingSelection | null>(null);
  const floatingSelectionTransformRef = useRef<BackgroundFloatingSelectionTransformSession | null>(null);
  const floatingSelectionBusyRef = useRef(false);
  const rasterOperationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const rasterOperationBusyRef = useRef(false);
  const panSessionRef = useRef<PanSession | null>(null);
  const loadingChunkKeysRef = useRef<Set<string>>(new Set());
  const chunkCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const chunkDataRef = useRef<ChunkDataMap>({});
  const chunkKeySetRef = useRef<Set<string>>(new Set());
  const fillTextureCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const fillTexturePromiseRef = useRef<Map<string, Promise<HTMLImageElement | null>>>(new Map());
  const undoStackRef = useRef<ChunkDelta[]>([]);
  const redoStackRef = useRef<ChunkDelta[]>([]);
  const didMountRef = useRef(false);
  const initialBackgroundColorRef = useRef('#87CEEB');
  const backgroundColorRef = useRef('#87CEEB');

  const [tool, setTool] = useState<BackgroundDrawingTool>('brush');
  const [bitmapBrushKind, setBitmapBrushKind] = useState<BitmapBrushKind>('hard-round');
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [backgroundColor, setBackgroundColor] = useState('#87CEEB');
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [bitmapFillStyle, setBitmapFillStyle] = useState<BitmapFillStyle>({
    textureId: DEFAULT_BITMAP_FILL_TEXTURE_ID,
  });
  const [bitmapShapeStyle, setBitmapShapeStyle] = useState<BitmapShapeStyle>({
    fillColor: INITIAL_BRUSH_COLOR,
    strokeColor: INITIAL_BRUSH_COLOR,
    strokeWidth: INITIAL_SHAPE_STROKE_WIDTH,
  });
  const [zoom, setZoom] = useState(0.5);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [chunkLimitWarning, setChunkLimitWarning] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isRasterOperationBusy, setIsRasterOperationBusy] = useState(false);
  const [hasFloatingSelection, setHasFloatingSelection] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);

  const {
    project,
    updateScene,
  } = useProjectStore();

  const {
    backgroundEditorOpen,
    backgroundEditorSceneId,
    selectedSceneId,
    closeBackgroundEditor,
    registerBackgroundUndo,
    registerBackgroundShortcutHandler,
  } = useEditorStore();

  const scene = useMemo(() => {
    if (!project) return null;
    const sceneId = backgroundEditorSceneId ?? selectedSceneId;
    if (!sceneId) return null;
    return project.scenes.find((candidate) => candidate.id === sceneId) ?? null;
  }, [backgroundEditorSceneId, project, selectedSceneId]);

  const chunkSize = useMemo(() => {
    const value = scene?.background?.type === 'tiled' ? scene.background.chunkSize : undefined;
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return DEFAULT_BACKGROUND_CHUNK_SIZE;
    return Math.max(32, Math.floor(value as number));
  }, [scene?.background]);

  const softChunkLimit = useMemo(() => {
    const value = scene?.background?.type === 'tiled' ? scene.background.softChunkLimit : undefined;
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT;
    return Math.floor(value as number);
  }, [scene?.background]);

  const hardChunkLimit = useMemo(() => {
    const value = scene?.background?.type === 'tiled' ? scene.background.hardChunkLimit : undefined;
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT;
    return Math.max(softChunkLimit, Math.floor(value as number));
  }, [scene?.background, softChunkLimit]);

  backgroundColorRef.current = backgroundColor;
  const cameraBounds = useMemo(() => ({
    left: -(project?.settings.canvasWidth ?? 800) / 2,
    right: (project?.settings.canvasWidth ?? 800) / 2,
    bottom: -(project?.settings.canvasHeight ?? 600) / 2,
    top: (project?.settings.canvasHeight ?? 600) / 2,
  }), [project?.settings.canvasHeight, project?.settings.canvasWidth]);

  const screenToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const host = hostRef.current;
    if (!host) return camera;
    return screenToWorldPoint(clientX, clientY, host.getBoundingClientRect(), camera, zoom, 'up');
  }, [camera, zoom]);

  const worldToScreen = useCallback((worldX: number, worldY: number): { x: number; y: number } => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    return worldToScreenPoint(worldX, worldY, host.getBoundingClientRect(), camera, zoom, 'up');
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
    return screenToWorldPoint(rect.left + screenPoint.x, rect.top + screenPoint.y, rect, camera, zoom, 'up');
  }, [camera, zoom]);

  const fitToBounds = useCallback((bounds: { left: number; right: number; bottom: number; top: number }) => {
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.top - bounds.bottom);
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const nextZoom = clampViewportZoom(Math.min(rect.width / width, rect.height / height) * 0.9, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setCamera({
      x: (bounds.left + bounds.right) * 0.5,
      y: (bounds.top + bounds.bottom) * 0.5,
    });
  }, []);

  const syncUndoRedoAvailability = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const fitToContent = useCallback(() => {
    const contentBounds = getChunkBoundsFromKeys(chunkKeySetRef.current, chunkSize);
    if (contentBounds) {
      fitToBounds(contentBounds);
      return;
    }
    fitToBounds(cameraBounds);
  }, [cameraBounds, chunkSize, fitToBounds]);

  const zoomAtClientPoint = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const clampedZoom = clampViewportZoom(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const host = hostRef.current;
    if (!host) {
      setZoom(clampedZoom);
      return;
    }

    const rect = host.getBoundingClientRect();
    setCamera((current) => zoomCameraAtClientPoint(
      clientX,
      clientY,
      rect,
      current,
      zoom,
      clampedZoom,
      'up',
    ));
    setZoom(clampedZoom);
  }, [zoom]);

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

  const handleZoomToSelection = useCallback(() => {
    const selection = floatingSelectionRef.current;
    if (!selection) return;
    fitToBounds(getFloatingSelectionWorldBounds(selection));
  }, [fitToBounds]);

  const resolveBitmapFillTextureSource = useCallback((textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }

    if (fillTextureCacheRef.current.has(texturePath)) {
      return fillTextureCacheRef.current.get(texturePath) ?? null;
    }

    if (!fillTexturePromiseRef.current.has(texturePath)) {
      const loadPromise = new Promise<HTMLImageElement | null>((resolve) => {
        const image = new Image();
        image.onload = () => {
          fillTextureCacheRef.current.set(texturePath, image);
          fillTexturePromiseRef.current.delete(texturePath);
          setRevision((value) => value + 1);
          resolve(image);
        };
        image.onerror = () => {
          fillTextureCacheRef.current.set(texturePath, null);
          fillTexturePromiseRef.current.delete(texturePath);
          resolve(null);
        };
        image.src = texturePath;
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

  const hasUnsavedBackgroundChanges = useCallback(() => {
    return (
      isDirty ||
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

  const enqueueRasterOperation = useCallback((operation: () => Promise<void>) => {
    const run = rasterOperationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        rasterOperationBusyRef.current = true;
        setIsRasterOperationBusy(true);
        try {
          await operation();
        } finally {
          rasterOperationBusyRef.current = false;
          setIsRasterOperationBusy(false);
        }
      });

    rasterOperationQueueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const awaitRasterOperations = useCallback(async () => {
    await rasterOperationQueueRef.current.catch(() => undefined);
  }, []);

  const ensureChunkCanvasLoaded = useCallback(async (key: string): Promise<HTMLCanvasElement | null> => {
    const existing = chunkCanvasesRef.current.get(key);
    if (existing) return existing;
    const serialized = chunkDataRef.current[key];
    if (!serialized) return null;
    if (loadingChunkKeysRef.current.has(key)) return null;

    loadingChunkKeysRef.current.add(key);
    const decoded = await dataUrlToCanvas(serialized, chunkSize);
    loadingChunkKeysRef.current.delete(key);
    if (!decoded) return null;

    chunkCanvasesRef.current.set(key, decoded);
    setRevision((value) => value + 1);
    return decoded;
  }, [chunkSize]);

  const loadFromBackgroundConfig = useCallback(async () => {
    if (!scene) return;
    setBusy(true);
    setChunkLimitWarning(null);
    setIsDirty(false);
    setHasFloatingSelection(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncUndoRedoAvailability();
    chunkCanvasesRef.current.clear();
    loadingChunkKeysRef.current.clear();
    selectionMarqueeRef.current = null;
    floatingSelectionRef.current = null;
    floatingSelectionTransformRef.current = null;
    floatingSelectionBusyRef.current = false;

    const initialChunks = normalizeChunkDataMap(scene.background?.type === 'tiled' ? scene.background.chunks : {});
    chunkDataRef.current = { ...initialChunks };
    chunkKeySetRef.current = new Set(Object.keys(initialChunks));
    const initialBackgroundColor = getFallbackColor(scene.background);
    initialBackgroundColorRef.current = initialBackgroundColor;
    setBackgroundColor(initialBackgroundColor);

    const entries = Object.entries(initialChunks);
    for (const [key, dataUrl] of entries) {
      const decoded = await dataUrlToCanvas(dataUrl, chunkSize);
      if (decoded) {
        chunkCanvasesRef.current.set(key, decoded);
      }
    }

    setBusy(false);
    setRevision((value) => value + 1);
  }, [chunkSize, scene, syncUndoRedoAvailability]);

  useEffect(() => {
    if (!scene) return;
    void loadFromBackgroundConfig();
  }, [loadFromBackgroundConfig, scene]);

  useEffect(() => {
    setIsDirty(
      undoStackRef.current.length > 0 ||
      backgroundColor !== initialBackgroundColorRef.current,
    );
  }, [backgroundColor]);

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
    const keys = Array.from(chunkKeySetRef.current);
    for (const key of keys) {
      const parsed = parseChunkKey(key);
      if (!parsed) continue;
      const bounds = getChunkWorldBounds(parsed.cx, parsed.cy, chunkSize);
      const topLeft = worldToScreen(bounds.left, bounds.top);
      const width = chunkSize * zoom;
      const height = chunkSize * zoom;

      if (width < 0.35 || height < 0.35) continue;
      if (topLeft.x + width < 0 || topLeft.y + height < 0 || topLeft.x > viewport.width || topLeft.y > viewport.height) {
        continue;
      }

      const chunkCanvas = chunkCanvasesRef.current.get(key);
      if (chunkCanvas) {
        ctx.drawImage(chunkCanvas, topLeft.x, topLeft.y, width, height);
      } else if (chunkDataRef.current[key]) {
        void ensureChunkCanvasLoaded(key);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(topLeft.x, topLeft.y, width, height);
      }
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
    if (tool === 'select' && marqueeSelection && !floatingSelectionRef.current) {
      const marqueeBounds = getWorldRectFromPoints(marqueeSelection.startWorld, marqueeSelection.currentWorld);
      const topLeft = worldToScreen(marqueeBounds.left, marqueeBounds.top);
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.fillStyle = FLOATING_SELECTION_BORDER_FILL;
      ctx.strokeStyle = FLOATING_SELECTION_BORDER_COLOR;
      ctx.lineWidth = 1.5;
      ctx.fillRect(topLeft.x, topLeft.y, marqueeBounds.width * zoom, marqueeBounds.height * zoom);
      ctx.strokeRect(topLeft.x, topLeft.y, marqueeBounds.width * zoom, marqueeBounds.height * zoom);
      ctx.restore();
    }

    const floatingSelection = floatingSelectionRef.current;
    if (tool === 'select' && floatingSelection) {
      const geometry = getFloatingSelectionScreenGeometry(floatingSelection, worldToScreen, zoom);
      ctx.save();
      ctx.translate(geometry.centerScreen.x, geometry.centerScreen.y);
      ctx.rotate(-floatingSelection.rotation);
      ctx.scale(floatingSelection.scaleX * zoom, floatingSelection.scaleY * zoom);
      ctx.drawImage(
        floatingSelection.canvas,
        -floatingSelection.canvas.width * 0.5,
        -floatingSelection.canvas.height * 0.5,
      );
      ctx.restore();

      ctx.save();
      ctx.fillStyle = FLOATING_SELECTION_BORDER_FILL;
      ctx.strokeStyle = FLOATING_SELECTION_BORDER_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(geometry.corners.nw.x, geometry.corners.nw.y);
      ctx.lineTo(geometry.corners.ne.x, geometry.corners.ne.y);
      ctx.lineTo(geometry.corners.se.x, geometry.corners.se.y);
      ctx.lineTo(geometry.corners.sw.x, geometry.corners.sw.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(geometry.topCenter.x, geometry.topCenter.y);
      ctx.lineTo(geometry.rotateHandle.x, geometry.rotateHandle.y);
      ctx.stroke();

      const drawHandle = (point: ScreenPoint, fillStyle: string = '#ffffff', strokeStyle: string = FLOATING_SELECTION_BORDER_COLOR) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, FLOATING_SELECTION_HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
      };

      drawHandle(geometry.corners.nw);
      drawHandle(geometry.corners.ne);
      drawHandle(geometry.corners.se);
      drawHandle(geometry.corners.sw);
      drawHandle(geometry.rotateHandle, FLOATING_SELECTION_BORDER_COLOR, '#ffffff');
      ctx.restore();
    }

    if (pointerWorldRef.current && !isPanning) {
      const pointerScreen = worldToScreen(pointerWorldRef.current.x, pointerWorldRef.current.y);

      if (tool === 'brush' || tool === 'eraser') {
        const cursor = getBitmapBrushCursorStyle(tool, bitmapBrushKind, brushColor, brushSize, zoom);
        ctx.beginPath();
        ctx.arc(pointerScreen.x, pointerScreen.y, cursor.diameter * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = cursor.fill;
        ctx.strokeStyle = cursor.stroke;
        ctx.lineWidth = cursor.borderWidth;
        ctx.fill();
        ctx.stroke();
      } else if (tool !== 'select') {
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
    bitmapBrushKind,
    bitmapShapeStyle.fillColor,
    bitmapShapeStyle.strokeColor,
    bitmapShapeStyle.strokeWidth,
    brushColor,
    brushSize,
    cameraBounds.bottom,
    cameraBounds.left,
    cameraBounds.right,
    cameraBounds.top,
    chunkSize,
    ensureChunkCanvasLoaded,
    isPanning,
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
    const canvas = chunkCanvasesRef.current.get(key);
    if (canvas) {
      return canvas.toDataURL('image/png');
    }
    return chunkDataRef.current[key] ?? null;
  }, []);

  const beginMutationSession = useCallback((): MutationSession => ({
    touched: new Set(),
    before: {},
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
    updateWarnings();
    return created;
  }, [chunkSize, hardChunkLimit, softChunkLimit, updateWarnings]);

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

      const ctx = chunkCanvas.getContext('2d');
      if (!ctx) continue;
      ctx.save();
      ctx.globalCompositeOperation = composite;
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
  }, [brushColor, brushSize, chunkSize, getOrCreateChunkCanvas, hardChunkLimit, rememberChunkBeforeMutation]);

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

      const ctx = chunkCanvas.getContext('2d');
      if (!ctx) continue;
      ctx.save();
      ctx.globalCompositeOperation = getCompositeOperation(brushTool);
      ctx.globalAlpha = stampDefinition.opacity;
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
  }, [chunkSize, getOrCreateChunkCanvas, hardChunkLimit, rememberChunkBeforeMutation]);

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

    for (const key of session.touched) {
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
        after[key] = null;
        continue;
      }

      const dataUrl = canvas.toDataURL('image/png');
      chunkDataRef.current[key] = dataUrl;
      chunkKeySetRef.current.add(key);
      after[key] = dataUrl;
    }

    const changedKeys = Object.keys(before).filter((key) => (before[key] ?? null) !== (after[key] ?? null));
    if (changedKeys.length > 0) {
      const delta: ChunkDelta = {
        before: {},
        after: {},
      };
      changedKeys.forEach((key) => {
        delta.before[key] = before[key] ?? null;
        delta.after[key] = after[key] ?? null;
      });
      undoStackRef.current.push(delta);
      if (undoStackRef.current.length > MAX_UNDO_STEPS) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
      syncUndoRedoAvailability();
      setIsDirty(
        undoStackRef.current.length > 0 ||
        backgroundColorRef.current !== initialBackgroundColorRef.current,
      );
    }

    updateWarnings();
    setRevision((value) => value + 1);
  }, [syncUndoRedoAvailability, updateWarnings]);

  const finalizeStroke = useCallback(() => {
    const stroke = drawingStrokeRef.current;
    drawingStrokeRef.current = null;
    commitMutationSession(stroke);
  }, [commitMutationSession]);

  const applyDeltaRecord = useCallback(async (record: Record<string, string | null>) => {
    for (const [key, value] of Object.entries(record)) {
      if (!value) {
        delete chunkDataRef.current[key];
        chunkCanvasesRef.current.delete(key);
        chunkKeySetRef.current.delete(key);
        continue;
      }

      chunkDataRef.current[key] = value;
      chunkKeySetRef.current.add(key);
      const decoded = await dataUrlToCanvas(value, chunkSize);
      if (decoded) {
        chunkCanvasesRef.current.set(key, decoded);
      } else {
        chunkCanvasesRef.current.delete(key);
      }
    }

    updateWarnings();
    setRevision((value) => value + 1);
  }, [chunkSize, updateWarnings]);

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

      const ctx = chunkCanvas.getContext('2d');
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
  }, [beginMutationSession, bitmapShapeStyle, chunkSize, commitMutationSession, getOrCreateChunkCanvas, hardChunkLimit, rememberChunkBeforeMutation]);

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
      window.alert('This fill region is too large to rasterize safely in one pass. Zoom in or reduce the edited area.');
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
  }, [chunkSize, ensureChunkCanvasLoaded]);

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

      const nextCanvas = createEmptyChunkCanvas(chunkSize);
      const nextCtx = nextCanvas.getContext('2d');
      if (!nextCtx) {
        continue;
      }

      const chunkBounds = getChunkWorldBounds(parsed.cx, parsed.cy, chunkSize);
      nextCtx.drawImage(
        rasterCanvas,
        chunkBounds.left - bounds.left,
        bounds.top - chunkBounds.top,
        chunkSize,
        chunkSize,
        0,
        0,
        chunkSize,
        chunkSize,
      );

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
        continue;
      }

      chunkCanvasesRef.current.set(key, nextCanvas);
      chunkDataRef.current[key] = nextCanvas.toDataURL('image/png');
      chunkKeySetRef.current.add(key);
    }

    return true;
  }, [chunkSize, hardChunkLimit, rememberChunkBeforeMutation]);

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

  const applyFill = useCallback(async (worldX: number, worldY: number) => {
    const bounds = getFillRasterBounds(worldX, worldY);
    const rasterized = await rasterizeChunksForBounds(bounds);
    if (!rasterized) {
      return;
    }

    const textureSource = await ensureBitmapFillTextureSource(bitmapFillStyle.textureId);

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
    const handleRadius = FLOATING_SELECTION_HANDLE_RADIUS + 4;

    const handleTargets: Array<[BackgroundFloatingSelectionHitTarget, ScreenPoint]> = [
      ['scale-nw', geometry.corners.nw],
      ['scale-ne', geometry.corners.ne],
      ['scale-se', geometry.corners.se],
      ['scale-sw', geometry.corners.sw],
      ['rotate', geometry.rotateHandle],
    ];

    for (const [target, point] of handleTargets) {
      const dx = screenPoint.x - point.x;
      const dy = screenPoint.y - point.y;
      if (Math.hypot(dx, dy) <= handleRadius) {
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

  const commitFloatingSelection = useCallback(() => {
    const selection = floatingSelectionRef.current;
    if (!selection || floatingSelectionBusyRef.current) {
      return false;
    }

    const worldBounds = getFloatingSelectionWorldBounds(selection);
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
      window.alert('This selection is too large to rasterize safely in one pass.');
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
    rasterCtx.translate(selection.centerWorld.x - bounds.left, bounds.top - selection.centerWorld.y);
    rasterCtx.rotate(-selection.rotation);
    rasterCtx.scale(selection.scaleX, selection.scaleY);
    rasterCtx.drawImage(
      selection.canvas,
      -selection.canvas.width * 0.5,
      -selection.canvas.height * 0.5,
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
  }, [chunkSize, commitRasterCanvasToChunks]);

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

  const extractFloatingSelection = useCallback(async (bounds: WorldRect) => {
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
      if (!rasterized) {
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
      if (!didApplyExtraction) {
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

  const undo = useCallback(() => {
    if (floatingSelectionRef.current) {
      const didCommitSelection = commitFloatingSelection();
      if (!didCommitSelection) {
        return;
      }
    }
    const delta = undoStackRef.current.pop();
    if (!delta) return;
    redoStackRef.current.push(delta);
    syncUndoRedoAvailability();
    void applyDeltaRecord(delta.before);
    setIsDirty(
      undoStackRef.current.length > 0 ||
      backgroundColorRef.current !== initialBackgroundColorRef.current,
    );
  }, [applyDeltaRecord, commitFloatingSelection, syncUndoRedoAvailability]);

  const redo = useCallback(() => {
    if (floatingSelectionRef.current) {
      const didCommitSelection = commitFloatingSelection();
      if (!didCommitSelection) {
        return;
      }
    }
    const delta = redoStackRef.current.pop();
    if (!delta) return;
    undoStackRef.current.push(delta);
    syncUndoRedoAvailability();
    void applyDeltaRecord(delta.after);
    setIsDirty(
      undoStackRef.current.length > 0 ||
      backgroundColorRef.current !== initialBackgroundColorRef.current,
    );
  }, [applyDeltaRecord, commitFloatingSelection, syncUndoRedoAvailability]);

  const flushActiveInteraction = useCallback(async () => {
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

    if (selectionMarqueeRef.current) {
      selectionMarqueeRef.current = null;
      setIsDrawing(false);
      setRevision((value) => value + 1);
    }

    if (floatingSelectionTransformRef.current) {
      floatingSelectionTransformRef.current = null;
      setIsDrawing(false);
    }

    await awaitRasterOperations();

    if (floatingSelectionRef.current) {
      const didCommitSelection = commitFloatingSelection();
      if (!didCommitSelection) {
        return false;
      }
    }

    return true;
  }, [awaitRasterOperations, commitFloatingSelection, commitShapeDraft, finalizeStroke]);

  const handleDone = useCallback(async () => {
    if (!scene) {
      closeBackgroundEditor();
      return;
    }

    const didFlushActiveInteraction = await flushActiveInteraction();
    if (!didFlushActiveInteraction) {
      return;
    }

    const chunks = { ...chunkDataRef.current };
    const payloadSize = estimateSerializedChunkBytes(chunks);
    if (payloadSize > LARGE_PAYLOAD_WARNING_BYTES) {
      const proceed = window.confirm('Background payload is large and may affect project size. Save anyway?');
      if (!proceed) {
        return;
      }
    }

    runInHistoryTransaction('scene:background-paint', () => {
      if (Object.keys(chunks).length === 0) {
        updateScene(scene.id, {
          background: {
            type: 'color',
            value: backgroundColor,
          },
        });
        return;
      }

      updateScene(scene.id, {
        background: buildTiledBackgroundConfig(chunks, {
          chunkSize,
          softChunkLimit,
          hardChunkLimit,
          baseColor: backgroundColor,
        }),
      });
    });

    closeBackgroundEditor();
  }, [backgroundColor, chunkSize, closeBackgroundEditor, flushActiveInteraction, hardChunkLimit, scene, softChunkLimit, updateScene]);

  const handleCancel = useCallback(() => {
    if (rasterOperationBusyRef.current) {
      window.alert('Please wait for the current bitmap operation to finish.');
      return;
    }
    if (hasUnsavedBackgroundChanges()) {
      const confirmed = window.confirm('Discard unsaved background edits?');
      if (!confirmed) return;
    }
    closeBackgroundEditor();
  }, [closeBackgroundEditor, hasUnsavedBackgroundChanges]);

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo,
      redo,
      canUndo: () => undoStackRef.current.length > 0,
      canRedo: () => redoStackRef.current.length > 0,
    };
    registerBackgroundUndo(handler);
    return () => registerBackgroundUndo(null);
  }, [redo, registerBackgroundUndo, undo]);

  useEffect(() => {
    const shortcutHandler = (event: KeyboardEvent): boolean => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return true;
      }

      if (event.key.toLowerCase() === 'b' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('brush');
        return true;
      }
      if (event.key.toLowerCase() === 'v' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('select');
        return true;
      }
      if (event.key.toLowerCase() === 'e' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('eraser');
        return true;
      }
      if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('fill');
        return true;
      }
      if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('rectangle');
        return true;
      }
      if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('circle');
        return true;
      }
      if (event.key.toLowerCase() === 'g' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('triangle');
        return true;
      }
      if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('star');
        return true;
      }
      if (event.key.toLowerCase() === 'l' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('line');
        return true;
      }
      if (event.key === '[' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setBrushSize((value) => Math.max(1, value - 2));
        return true;
      }
      if (event.key === ']' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setBrushSize((value) => Math.min(256, value + 2));
        return true;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (deleteFloatingSelection()) {
          event.preventDefault();
          return true;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (selectionMarqueeRef.current) {
          selectionMarqueeRef.current = null;
          setIsDrawing(false);
          setRevision((value) => value + 1);
          return true;
        }
        if (floatingSelectionRef.current) {
          commitFloatingSelection();
          return true;
        }
        if (shapeDraftRef.current) {
          shapeDraftRef.current = null;
          setIsDrawing(false);
          setRevision((value) => value + 1);
          return true;
        }
        handleCancel();
        return true;
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        handleDone();
        return true;
      }
      return false;
    };

    registerBackgroundShortcutHandler(shortcutHandler);
    return () => registerBackgroundShortcutHandler(null);
  }, [commitFloatingSelection, deleteFloatingSelection, handleCancel, handleDone, redo, registerBackgroundShortcutHandler, undo]);

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
  }, [commitFloatingSelection, tool]);

  useEffect(() => {
    if (!backgroundEditorOpen) return;
    if (!scene || !selectedSceneId) return;
    if (scene.id === selectedSceneId) return;
    const save = window.confirm('Save background changes before switching scenes?');
    if (save) {
      void handleDone();
    } else {
      handleCancel();
    }
  }, [backgroundEditorOpen, handleCancel, handleDone, scene, selectedSceneId]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (rasterOperationBusyRef.current) {
      event.preventDefault();
      return;
    }

    if (event.button === 0) {
      const world = screenToWorld(event.clientX, event.clientY);
      const screen = getScreenPoint(event.clientX, event.clientY);
      pointerWorldRef.current = world;
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
            } else if (hitTarget === 'rotate') {
              floatingSelectionTransformRef.current = {
                kind: 'rotate',
                selection: floatingSelection,
                centerScreen: geometry.centerScreen,
                startPointerAngle: Math.atan2(screen.y - geometry.centerScreen.y, screen.x - geometry.centerScreen.x),
                startRotation: floatingSelection.rotation,
              };
            } else {
              const handleMap: Record<Exclude<BackgroundFloatingSelectionHitTarget, 'body' | 'rotate'>, {
                anchor: ScreenPoint;
                handleXSign: -1 | 1;
                handleYSign: -1 | 1;
              }> = {
                'scale-nw': { anchor: geometry.corners.se, handleXSign: -1, handleYSign: -1 },
                'scale-ne': { anchor: geometry.corners.sw, handleXSign: 1, handleYSign: -1 },
                'scale-se': { anchor: geometry.corners.nw, handleXSign: 1, handleYSign: 1 },
                'scale-sw': { anchor: geometry.corners.ne, handleXSign: -1, handleYSign: 1 },
              };
              const handle = handleMap[hitTarget];
              floatingSelectionTransformRef.current = {
                kind: 'scale',
                selection: floatingSelection,
                anchorScreen: handle.anchor,
                handleXSign: handle.handleXSign,
                handleYSign: handle.handleYSign,
                rotation: floatingSelection.rotation,
                sourceWidth: floatingSelection.canvas.width,
                sourceHeight: floatingSelection.canvas.height,
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
        void enqueueRasterOperation(async () => {
          await applyFill(world.x, world.y);
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
    applyFill,
    beginMutationSession,
    camera.x,
    camera.y,
    commitFloatingSelection,
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
      } else {
        const rotatedPointer = rotatePoint(
          {
            x: screen.x - floatingSelectionTransform.anchorScreen.x,
            y: screen.y - floatingSelectionTransform.anchorScreen.y,
          },
          floatingSelectionTransform.rotation,
        );
        const width = Math.max(
          FLOATING_SELECTION_MIN_SCREEN_SIZE,
          floatingSelectionTransform.handleXSign * rotatedPointer.x,
        );
        const height = Math.max(
          FLOATING_SELECTION_MIN_SCREEN_SIZE,
          floatingSelectionTransform.handleYSign * rotatedPointer.y,
        );
        const centerScreen = {
          x: floatingSelectionTransform.anchorScreen.x + rotatePoint({
            x: floatingSelectionTransform.handleXSign * width * 0.5,
            y: floatingSelectionTransform.handleYSign * height * 0.5,
          }, -floatingSelectionTransform.rotation).x,
          y: floatingSelectionTransform.anchorScreen.y + rotatePoint({
            x: floatingSelectionTransform.handleXSign * width * 0.5,
            y: floatingSelectionTransform.handleYSign * height * 0.5,
          }, -floatingSelectionTransform.rotation).y,
        };
        floatingSelectionTransform.selection.centerWorld = screenToWorldFromCanvasPoint(centerScreen);
        floatingSelectionTransform.selection.scaleX = width / Math.max(1, floatingSelectionTransform.sourceWidth * zoom);
        floatingSelectionTransform.selection.scaleY = height / Math.max(1, floatingSelectionTransform.sourceHeight * zoom);
      }
      setRevision((value) => value + 1);
      return;
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
  }, [getScreenPoint, paintSegment, screenToWorld, screenToWorldFromCanvasPoint, zoom]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    panSessionRef.current = null;
    setIsPanning(false);
    if (floatingSelectionTransformRef.current) {
      floatingSelectionTransformRef.current = null;
      setIsDrawing(false);
      setRevision((value) => value + 1);
    }
    if (selectionMarqueeRef.current) {
      const marqueeSession = selectionMarqueeRef.current;
      selectionMarqueeRef.current = null;
      setIsDrawing(false);
      const marqueeBounds = getWorldRectFromPoints(marqueeSession.startWorld, marqueeSession.currentWorld);
      if (marqueeBounds.width >= 1 && marqueeBounds.height >= 1) {
        void enqueueRasterOperation(async () => {
          await extractFloatingSelection(marqueeBounds);
        });
      } else {
        setRevision((value) => value + 1);
      }
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
  }, [commitShapeDraft, enqueueRasterOperation, extractFloatingSelection, finalizeStroke]);

  const onPointerLeave = useCallback(() => {
    pointerWorldRef.current = null;
    setRevision((value) => value + 1);
  }, []);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();

    if (event.ctrlKey || event.metaKey) {
      const zoomDelta = -event.deltaY * 0.01;
      const nextZoom = clampViewportZoom(zoom * (1 + zoomDelta), MIN_ZOOM, MAX_ZOOM);
      setZoom(nextZoom);
      setCamera(zoomCameraAtClientPoint(
        event.clientX,
        event.clientY,
        rect,
        camera,
        zoom,
        nextZoom,
        'up',
      ));
      return;
    }

    setCamera((current) => panCameraFromWheel(current, event.deltaX, event.deltaY, zoom, 'up'));
  }, [camera, zoom]);

  const handleToolbarModeChange = useCallback(() => {
    // Background drawing is bitmap-only, so the shared toolbar mode switcher is hidden.
  }, []);

  const handleToolbarToolChange = useCallback((nextTool: CostumeDrawingTool) => {
    if (busy || !isBackgroundToolbarTool(nextTool)) {
      return;
    }
    setTool(nextTool);
  }, [busy]);

  const handleToolbarMoveOrder = useCallback(() => {}, []);
  const handleToolbarFlipSelection = useCallback((_axis: SelectionFlipAxis) => {}, []);
  const handleToolbarRotateSelection = useCallback(() => {}, []);
  const handleToolbarVectorHandleModeChange = useCallback(() => {}, []);
  const handleToolbarAlign = useCallback(() => {}, []);
  const handleToolbarTextStyleChange = useCallback(() => {}, []);
  const handleToolbarVectorStyleChange = useCallback(() => {}, []);

  const handleToolbarColorChange = useCallback((color: string) => {
    if (busy) {
      return;
    }
    setBrushColor(color);
  }, [busy]);

  const handleToolbarBitmapBrushKindChange = useCallback((kind: BitmapBrushKind) => {
    if (busy) {
      return;
    }
    setBitmapBrushKind(kind);
  }, [busy]);

  const handleToolbarBrushSizeChange = useCallback((size: number) => {
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

  const handleToolbarBitmapShapeStyleChange = useCallback((updates: Partial<BitmapShapeStyle>) => {
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
      data-chunk-count={chunkKeySetRef.current.size}
    >
      <div className="h-12 border-b bg-card px-3 flex items-center gap-2">
        <Button variant="default" size="sm" onClick={handleDone} disabled={busy}>
          <Check className="size-4" />
          Done
        </Button>
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={busy}>
          <X className="size-4" />
          Cancel
        </Button>
        <div className="app-divider-x app-divider-fill h-6 mx-1" />
        <label className="text-xs text-muted-foreground">BG</label>
        <input
          type="color"
          value={backgroundColor}
          onChange={(event) => setBackgroundColor(event.target.value)}
          className="h-8 w-10 rounded border bg-background"
          title="Background color"
          disabled={busy}
        />
        <Button variant="outline" size="sm" onClick={fitToContent} disabled={busy}>
          <LocateFixed className="size-4" />
          Fit
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {isRasterOperationBusy && <span>Processing</span>}
          {hasFloatingSelection && <span>Selection</span>}
          {isPanning && <span>Panning</span>}
        </div>
      </div>

      {chunkLimitWarning && (
        <div className="px-3 py-2 text-xs bg-amber-50 text-amber-900 border-b border-amber-200">
          {chunkLimitWarning}
        </div>
      )}

      <div ref={hostRef} className="flex-1 min-h-0 relative overflow-hidden bg-[#060a14]">
        <CanvasViewportOverlay
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onZoomOut={() => zoomAroundViewportCenter(zoom - ZOOM_STEP)}
          onZoomIn={() => zoomAroundViewportCenter(zoom + ZOOM_STEP)}
          onZoomToActualSize={handleZoomToActualSize}
          onZoomToFit={fitToContent}
          onZoomToSelection={handleZoomToSelection}
          canZoomToSelection={hasFloatingSelection}
        />
        <CostumeToolbar
          editorMode="bitmap"
          activeTool={tool}
          hasActiveSelection={hasFloatingSelection}
          showModeSwitcher={false}
          selectionActionsEnabled={false}
          showTextControls={false}
          isVectorPointEditing={false}
          hasSelectedVectorPoints={false}
          bitmapBrushKind={bitmapBrushKind}
          brushColor={brushColor}
          brushSize={brushSize}
          bitmapFillStyle={bitmapFillStyle}
          bitmapShapeStyle={bitmapShapeStyle}
          textStyle={BACKGROUND_TOOLBAR_TEXT_STYLE}
          vectorStyle={BACKGROUND_TOOLBAR_VECTOR_STYLE}
          vectorStyleCapabilities={BACKGROUND_TOOLBAR_VECTOR_CAPABILITIES}
          previewScale={zoom}
          onEditorModeChange={handleToolbarModeChange}
          onToolChange={handleToolbarToolChange}
          onMoveOrder={handleToolbarMoveOrder}
          onFlipSelection={handleToolbarFlipSelection}
          onRotateSelection={handleToolbarRotateSelection}
          vectorHandleMode={BACKGROUND_TOOLBAR_VECTOR_HANDLE_MODE}
          onVectorHandleModeChange={handleToolbarVectorHandleModeChange}
          onAlign={handleToolbarAlign}
          alignDisabled
          onColorChange={handleToolbarColorChange}
          onBitmapBrushKindChange={handleToolbarBitmapBrushKindChange}
          onBrushSizeChange={handleToolbarBrushSizeChange}
          onBitmapFillStyleChange={handleToolbarBitmapFillStyleChange}
          onBitmapShapeStyleChange={handleToolbarBitmapShapeStyleChange}
          onTextStyleChange={handleToolbarTextStyleChange}
          onVectorStyleChange={handleToolbarVectorStyleChange}
        />
        <canvas
          ref={canvasRef}
          data-testid="background-editor-canvas"
          className="w-full h-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
    </div>
  );
}

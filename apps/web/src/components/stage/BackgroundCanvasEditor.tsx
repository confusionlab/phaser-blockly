import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Check, Eraser, LocateFixed, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import type { BackgroundConfig } from '@/types';
import {
  DEFAULT_BACKGROUND_CHUNK_SIZE,
  getChunkBoundsFromKeys,
  getChunkKey,
  getChunkWorldBounds,
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
  getBrushCursorStyle,
  getBrushPaintColor,
  getCompositeOperation,
  isEraseTool,
  type BitmapBrushTool,
} from '@/lib/background/brushCore';
import {
  clampViewportZoom,
  panCameraFromDrag,
  panCameraFromWheel,
  screenToWorldPoint,
  worldToScreenPoint,
  zoomCameraAtClientPoint,
} from '@/lib/viewportNavigation';
import { runInHistoryTransaction } from '@/store/universalHistory';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 10;
const INITIAL_BRUSH_COLOR = '#101010';
const INITIAL_BRUSH_SIZE = 24;
const MAX_UNDO_STEPS = 50;
const LARGE_PAYLOAD_WARNING_BYTES = 15 * 1024 * 1024;

type ChunkDelta = {
  before: Record<string, string | null>;
  after: Record<string, string | null>;
};

type StrokeSession = {
  touched: Set<string>;
  before: Record<string, string | null>;
  lastWorld: { x: number; y: number } | null;
};

type PanSession = {
  startX: number;
  startY: number;
  cameraStartX: number;
  cameraStartY: number;
};

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
  const panSessionRef = useRef<PanSession | null>(null);
  const loadingChunkKeysRef = useRef<Set<string>>(new Set());
  const chunkCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const chunkDataRef = useRef<ChunkDataMap>({});
  const chunkKeySetRef = useRef<Set<string>>(new Set());
  const undoStackRef = useRef<ChunkDelta[]>([]);
  const redoStackRef = useRef<ChunkDelta[]>([]);
  const didMountRef = useRef(false);
  const initialBackgroundColorRef = useRef('#87CEEB');
  const backgroundColorRef = useRef('#87CEEB');

  const [tool, setTool] = useState<BitmapBrushTool>('brush');
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [backgroundColor, setBackgroundColor] = useState('#87CEEB');
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [zoom, setZoom] = useState(0.5);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [softLimitWarning, setSoftLimitWarning] = useState<string | null>(null);
  const [hardLimitWarning, setHardLimitWarning] = useState<string | null>(null);
  const [payloadWarning, setPayloadWarning] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
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

  const fitToContent = useCallback(() => {
    const contentBounds = getChunkBoundsFromKeys(chunkKeySetRef.current, chunkSize);
    if (contentBounds) {
      fitToBounds(contentBounds);
      return;
    }
    fitToBounds(cameraBounds);
  }, [cameraBounds, chunkSize, fitToBounds]);

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
    setSoftLimitWarning(null);
    setHardLimitWarning(null);
    setPayloadWarning(null);
    setIsDirty(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    chunkCanvasesRef.current.clear();
    loadingChunkKeysRef.current.clear();

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
  }, [chunkSize, scene]);

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
    setSoftLimitWarning(
      limits.softExceeded && !limits.hardExceeded
        ? `Soft chunk limit reached (${limits.count}/${limits.softLimit}).`
        : null,
    );
    setHardLimitWarning(
      limits.hardExceeded
        ? `Hard chunk limit reached (${limits.count}/${limits.hardLimit}). Erase some areas before adding more chunks.`
        : null,
    );
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
        ctx.fillStyle = 'rgba(96, 165, 250, 0.12)';
        ctx.fill();
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

    if (pointerWorldRef.current && !isPanning) {
      const pointerScreen = worldToScreen(pointerWorldRef.current.x, pointerWorldRef.current.y);
      const cursor = getBrushCursorStyle(tool, brushColor, brushSize, zoom);
      ctx.beginPath();
      ctx.arc(pointerScreen.x, pointerScreen.y, cursor.diameter * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = cursor.fill;
      ctx.strokeStyle = cursor.stroke;
      ctx.lineWidth = cursor.borderWidth;
      ctx.fill();
      ctx.stroke();
    }

    if (chunkPixelSize < 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Far zoom LOD active', 12, viewport.height - 12);
    }
  }, [
    backgroundColor,
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

  const paintPoint = useCallback((worldX: number, worldY: number, stroke: StrokeSession) => {
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

    const composite = getCompositeOperation(tool);
    const color = getBrushPaintColor(tool, brushColor);
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

      if (!(key in stroke.before)) {
        stroke.before[key] = getExistingChunkSnapshot(key);
      }
      stroke.touched.add(key);

      let chunkCanvas = chunkCanvasesRef.current.get(key);
      if (!chunkCanvas) {
        if (chunkDataRef.current[key]) {
          // Existing serialized chunk not decoded yet.
          continue;
        }
        if (isEraseTool(tool)) {
          continue;
        }
        chunkCanvas = getOrCreateChunkCanvas(key);
      }
      if (!chunkCanvas) {
        setHardLimitWarning(`Hard chunk limit reached (${chunkKeySetRef.current.size}/${hardChunkLimit}).`);
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
  }, [brushColor, brushSize, chunkSize, getExistingChunkSnapshot, getOrCreateChunkCanvas, hardChunkLimit, tool]);

  const paintSegment = useCallback((from: { x: number; y: number }, to: { x: number; y: number }, stroke: StrokeSession) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, brushSize * 0.25);
    const steps = Math.max(1, Math.ceil(distance / step));

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = from.x + dx * t;
      const y = from.y + dy * t;
      paintPoint(x, y, stroke);
    }
  }, [brushSize, paintPoint]);

  const finalizeStroke = useCallback(() => {
    const stroke = drawingStrokeRef.current;
    drawingStrokeRef.current = null;
    if (!stroke) return;
    if (stroke.touched.size === 0) return;

    const after: Record<string, string | null> = {};
    const before = stroke.before;

    for (const key of stroke.touched) {
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
      setIsDirty(
        undoStackRef.current.length > 0 ||
        backgroundColorRef.current !== initialBackgroundColorRef.current,
      );
    }

    updateWarnings();
    setRevision((value) => value + 1);
  }, [updateWarnings]);

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

  const undo = useCallback(() => {
    const delta = undoStackRef.current.pop();
    if (!delta) return;
    redoStackRef.current.push(delta);
    void applyDeltaRecord(delta.before);
    setIsDirty(
      undoStackRef.current.length > 0 ||
      backgroundColorRef.current !== initialBackgroundColorRef.current,
    );
  }, [applyDeltaRecord]);

  const redo = useCallback(() => {
    const delta = redoStackRef.current.pop();
    if (!delta) return;
    undoStackRef.current.push(delta);
    void applyDeltaRecord(delta.after);
    setIsDirty(
      undoStackRef.current.length > 0 ||
      backgroundColorRef.current !== initialBackgroundColorRef.current,
    );
  }, [applyDeltaRecord]);

  const handleDone = useCallback(() => {
    if (!scene) {
      closeBackgroundEditor();
      return;
    }

    const chunks = { ...chunkDataRef.current };
    const payloadSize = estimateSerializedChunkBytes(chunks);
    if (payloadSize > LARGE_PAYLOAD_WARNING_BYTES) {
      setPayloadWarning(`Background data is large (${(payloadSize / (1024 * 1024)).toFixed(1)} MB).`);
      const proceed = window.confirm('Background payload is large and may affect project size. Save anyway?');
      if (!proceed) {
        return;
      }
    } else {
      setPayloadWarning(null);
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
  }, [backgroundColor, chunkSize, closeBackgroundEditor, hardChunkLimit, scene, softChunkLimit, updateScene]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm('Discard unsaved background edits?');
      if (!confirmed) return;
    }
    closeBackgroundEditor();
  }, [closeBackgroundEditor, isDirty]);

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
      if (event.key.toLowerCase() === 'e' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTool('eraser');
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
      if (event.key === 'Escape') {
        event.preventDefault();
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
  }, [handleCancel, handleDone, redo, registerBackgroundShortcutHandler, undo]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!backgroundEditorOpen) return;
    if (!scene || !selectedSceneId) return;
    if (scene.id === selectedSceneId) return;
    const save = window.confirm('Save background changes before switching scenes?');
    if (save) {
      handleDone();
    } else {
      handleCancel();
    }
  }, [backgroundEditorOpen, handleCancel, handleDone, scene, selectedSceneId]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button === 0) {
      const world = screenToWorld(event.clientX, event.clientY);
      pointerWorldRef.current = world;
      drawingStrokeRef.current = {
        touched: new Set(),
        before: {},
        lastWorld: world,
      };
      paintSegment(world, world, drawingStrokeRef.current);
      setIsDrawing(true);
      (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
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
  }, [camera.x, camera.y, paintSegment, screenToWorld]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(event.clientX, event.clientY);
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

    const stroke = drawingStrokeRef.current;
    if (!stroke || !stroke.lastWorld) return;
    paintSegment(stroke.lastWorld, world, stroke);
    stroke.lastWorld = world;
  }, [paintSegment, screenToWorld, zoom]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    panSessionRef.current = null;
    setIsPanning(false);
    if (drawingStrokeRef.current) {
      finalizeStroke();
      setIsDrawing(false);
    }
    try {
      (event.currentTarget as HTMLCanvasElement).releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if pointer capture already released.
    }
  }, [finalizeStroke]);

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

  if (!scene) {
    return null;
  }

  const chunkCount = chunkKeySetRef.current.size;
  const limits = evaluateChunkLimits(chunkCount, softChunkLimit, hardChunkLimit);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100050] bg-background flex flex-col overscroll-none"
      data-testid="background-editor-root"
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
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          variant={tool === 'brush' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTool('brush')}
          disabled={busy}
          title="Brush (B)"
        >
          <Pencil className="size-4" />
          Brush
        </Button>
        <Button
          variant={tool === 'eraser' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTool('eraser')}
          disabled={busy}
          title="Eraser (E)"
        >
          <Eraser className="size-4" />
          Eraser
        </Button>
        <input
          type="color"
          value={brushColor}
          onChange={(event) => setBrushColor(event.target.value)}
          className="h-8 w-10 rounded border bg-background"
          title="Brush color"
          disabled={busy}
        />
        <label className="text-xs text-muted-foreground">BG</label>
        <input
          type="color"
          value={backgroundColor}
          onChange={(event) => setBackgroundColor(event.target.value)}
          className="h-8 w-10 rounded border bg-background"
          title="Background color"
          disabled={busy}
        />
        <label className="text-xs text-muted-foreground">Size</label>
        <input
          type="range"
          min={1}
          max={256}
          step={1}
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
          className="w-36"
          disabled={busy}
        />
        <span className="text-xs w-10 text-right tabular-nums">{brushSize}</span>
        <Button variant="outline" size="sm" onClick={fitToContent} disabled={busy}>
          <LocateFixed className="size-4" />
          Fit
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>Zoom: {(zoom * 100).toFixed(0)}%</span>
          <span data-testid="background-editor-chunk-count">Chunks: {limits.count}/{limits.hardLimit}</span>
          {isDrawing && <span>Drawing</span>}
          {isPanning && <span>Panning</span>}
        </div>
      </div>

      {(softLimitWarning || hardLimitWarning || payloadWarning) && (
        <div className="px-3 py-2 text-xs bg-amber-50 text-amber-900 border-b border-amber-200">
          {hardLimitWarning || softLimitWarning || payloadWarning}
        </div>
      )}

      <div ref={hostRef} className="flex-1 min-h-0 relative overflow-hidden bg-[#060a14]">
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

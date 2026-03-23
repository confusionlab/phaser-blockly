import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { runInHistoryTransaction } from '@/store/universalHistory';
import type { BackgroundConfig, WorldPoint } from '@/types';
import { DEFAULT_BACKGROUND_CHUNK_SIZE, getChunkWorldBounds, parseChunkKey } from '@/lib/background/chunkMath';
import {
  clampViewportZoom,
} from '@/lib/viewportNavigation';

const WORLD_BOUNDARY_EDITOR_PADDING = 160;
const WORLD_BOUNDARY_EDITOR_MIN_ZOOM = 0.15;
const WORLD_BOUNDARY_EDITOR_MAX_ZOOM = 4;

interface WorldBoundaryEditorView {
  centerX: number;
  centerY: number;
  zoom: number;
}

function getFallbackBackgroundColor(background: BackgroundConfig | null | undefined): string {
  const value = background?.value;
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim();
  }
  return '#87CEEB';
}

function userToCanvas(point: WorldPoint, canvasWidth: number, canvasHeight: number) {
  return {
    x: point.x + canvasWidth / 2,
    y: canvasHeight / 2 - point.y,
  };
}

function canvasToUser(x: number, y: number, canvasWidth: number, canvasHeight: number): WorldPoint {
  return {
    x: x - canvasWidth / 2,
    y: canvasHeight / 2 - y,
  };
}

function getViewBox(view: WorldBoundaryEditorView, canvasWidth: number, canvasHeight: number) {
  const width = canvasWidth / view.zoom;
  const height = canvasHeight / view.zoom;
  return {
    minX: view.centerX - width / 2,
    minY: view.centerY - height / 2,
    width,
    height,
  };
}

function getInitialView(points: WorldPoint[], canvasWidth: number, canvasHeight: number): WorldBoundaryEditorView {
  const canvasPoints = points.map((point) => userToCanvas(point, canvasWidth, canvasHeight));
  const xs = [0, canvasWidth, ...canvasPoints.map((point) => point.x)];
  const ys = [0, canvasHeight, ...canvasPoints.map((point) => point.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const aspect = canvasWidth / canvasHeight;

  let width = Math.max(1, maxX - minX + WORLD_BOUNDARY_EDITOR_PADDING * 2);
  let height = Math.max(1, maxY - minY + WORLD_BOUNDARY_EDITOR_PADDING * 2);

  if (width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    zoom: Math.max(
      WORLD_BOUNDARY_EDITOR_MIN_ZOOM,
      Math.min(WORLD_BOUNDARY_EDITOR_MAX_ZOOM, canvasWidth / width),
    ),
  };
}

function clientToCanvasPoint(
  clientX: number,
  clientY: number,
  stage: SVGSVGElement,
  view: WorldBoundaryEditorView,
  canvasWidth: number,
  canvasHeight: number,
) {
  const rect = stage.getBoundingClientRect();
  const viewBox = getViewBox(view, canvasWidth, canvasHeight);
  const normalizedX = (clientX - rect.left) / rect.width;
  const normalizedY = (clientY - rect.top) / rect.height;
  return {
    x: viewBox.minX + normalizedX * viewBox.width,
    y: viewBox.minY + normalizedY * viewBox.height,
  };
}

export function WorldBoundaryEditor() {
  const { project, updateScene } = useProjectStore();
  const { worldBoundaryEditorSceneId, selectedSceneId, closeWorldBoundaryEditor } = useEditorStore();
  const scene = useMemo(() => {
    const sceneId = worldBoundaryEditorSceneId ?? selectedSceneId;
    if (!project || !sceneId) return null;
    return project.scenes.find((candidate) => candidate.id === sceneId) ?? null;
  }, [project, selectedSceneId, worldBoundaryEditorSceneId]);

  const canvasWidth = project?.settings.canvasWidth ?? 800;
  const canvasHeight = project?.settings.canvasHeight ?? 600;

  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState<WorldPoint[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [view, setView] = useState<WorldBoundaryEditorView>(() => getInitialView([], canvasWidth, canvasHeight));
  const [panState, setPanState] = useState<{
    startClientX: number;
    startClientY: number;
    startCenterX: number;
    startCenterY: number;
  } | null>(null);
  const stageRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (!scene) return;
    setEnabled(!!scene.worldBoundary?.enabled);
    const nextPoints = (scene.worldBoundary?.points || []).map((point) => ({ ...point }));
    setPoints(nextPoints);
    setView(getInitialView(nextPoints, canvasWidth, canvasHeight));
  }, [canvasHeight, canvasWidth, scene]);

  useEffect(() => {
    if (dragIndex === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const nextPoint = clientToCanvasPoint(
        event.clientX,
        event.clientY,
        stage,
        viewRef.current,
        canvasWidth,
        canvasHeight,
      );
      setPoints((current) => current.map((point, index) => (
        index === dragIndex ? canvasToUser(nextPoint.x, nextPoint.y, canvasWidth, canvasHeight) : point
      )));
    };

    const handlePointerUp = () => {
      setDragIndex(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [canvasHeight, canvasWidth, dragIndex]);

  useEffect(() => {
    if (!panState) return;

    const handlePointerMove = (event: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const viewBox = getViewBox(viewRef.current, canvasWidth, canvasHeight);
      const rect = stage.getBoundingClientRect();
      const scaleX = rect.width / viewBox.width;
      const scaleY = rect.height / viewBox.height;
      setView((current) => ({
        ...current,
        centerX: panState.startCenterX - (event.clientX - panState.startClientX) / scaleX,
        centerY: panState.startCenterY - (event.clientY - panState.startClientY) / scaleY,
      }));
    };

    const handlePointerUp = () => {
      setPanState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [canvasHeight, canvasWidth, panState]);

  if (!scene) {
    return null;
  }

  const polygonPoints = points
    .map((point) => {
      const canvasPoint = userToCanvas(point, canvasWidth, canvasHeight);
      return `${canvasPoint.x},${canvasPoint.y}`;
    })
    .join(' ');

  const viewBox = getViewBox(view, canvasWidth, canvasHeight);

  const handleStagePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      setPanState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCenterX: viewRef.current.centerX,
        startCenterY: viewRef.current.centerY,
      });
      return;
    }

    if (event.button !== 0 || dragIndex !== null) return;

    const nextPoint = clientToCanvasPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
      viewRef.current,
      canvasWidth,
      canvasHeight,
    );
    setPoints((current) => [...current, canvasToUser(nextPoint.x, nextPoint.y, canvasWidth, canvasHeight)]);
  };

  const handleStageWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const currentViewBox = getViewBox(viewRef.current, canvasWidth, canvasHeight);
    const normalizedX = (event.clientX - rect.left) / rect.width;
    const normalizedY = (event.clientY - rect.top) / rect.height;

    if (event.ctrlKey || event.metaKey) {
      const worldBefore = clientToCanvasPoint(
        event.clientX,
        event.clientY,
        event.currentTarget,
        viewRef.current,
        canvasWidth,
        canvasHeight,
      );
      const zoomDelta = -event.deltaY * 0.01;
      const zoomFactor = Math.max(0.01, 1 + zoomDelta);
      const nextZoom = clampViewportZoom(
        viewRef.current.zoom * zoomFactor,
        WORLD_BOUNDARY_EDITOR_MIN_ZOOM,
        WORLD_BOUNDARY_EDITOR_MAX_ZOOM,
      );
      const nextViewBox = getViewBox(
        { ...viewRef.current, zoom: nextZoom },
        canvasWidth,
        canvasHeight,
      );
      setView({
        centerX: worldBefore.x - (normalizedX - 0.5) * nextViewBox.width,
        centerY: worldBefore.y - (normalizedY - 0.5) * nextViewBox.height,
        zoom: nextZoom,
      });
      return;
    }

    const scaleX = rect.width / currentViewBox.width;
    const scaleY = rect.height / currentViewBox.height;
    setView((current) => ({
      ...current,
      centerX: viewRef.current.centerX + event.deltaX / scaleX,
      centerY: viewRef.current.centerY + event.deltaY / scaleY,
    }));
  };

  const handleSave = () => {
    runInHistoryTransaction('scene:world-boundary', () => {
      updateScene(scene.id, {
        worldBoundary: {
          enabled,
          points,
        },
      });
    });
    closeWorldBoundaryEditor();
  };

  const backgroundBaseColor = getFallbackBackgroundColor(scene.background);
  const tiledBackgroundChunks = scene.background?.type === 'tiled' && scene.background.chunks
    ? Object.entries(scene.background.chunks)
    : [];
  const backgroundChunkSize = scene.background?.type === 'tiled' && Number.isFinite(scene.background.chunkSize)
    ? Math.max(32, Math.floor(scene.background.chunkSize as number))
    : DEFAULT_BACKGROUND_CHUNK_SIZE;

  return (
    <div className="fixed inset-0 z-[100001] bg-background flex flex-col overscroll-none">
      <div className="h-12 border-b bg-card px-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">World Boundary</div>
          <div className="text-xs text-muted-foreground">
            Click to add points. Drag points to move them. Wheel to zoom. Right or middle drag to pan.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="world-boundary-enabled"
              checked={enabled}
              onCheckedChange={(checked) => setEnabled(!!checked)}
            />
            <Label htmlFor="world-boundary-enabled" className="text-xs text-muted-foreground cursor-pointer">
              Enabled
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPoints([])}>
            <Trash2 className="size-4" />
            Clear
          </Button>
          <Button variant="outline" size="sm" onClick={closeWorldBoundaryEditor}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Check className="size-4" />
            Done
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative overflow-hidden bg-[#060a14]">
        <svg
          id="world-boundary-editor-stage"
          ref={stageRef}
          viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerDown={handleStagePointerDown}
          onWheel={handleStageWheel}
          onContextMenu={(event) => event.preventDefault()}
        >
          <rect x={viewBox.minX} y={viewBox.minY} width={viewBox.width} height={viewBox.height} fill={backgroundBaseColor} />
          {scene.background?.type === 'image' && scene.background.value ? (
            <image
              href={scene.background.value}
              x={0}
              y={0}
              width={canvasWidth}
              height={canvasHeight}
              preserveAspectRatio="none"
            />
          ) : null}
          {tiledBackgroundChunks.map(([key, dataUrl]) => {
            if (!dataUrl) return null;
            const parsed = parseChunkKey(key);
            if (!parsed) return null;
            const bounds = getChunkWorldBounds(parsed.cx, parsed.cy, backgroundChunkSize);
            const topLeft = userToCanvas({ x: bounds.left, y: bounds.top }, canvasWidth, canvasHeight);
            return (
              <image
                key={key}
                href={dataUrl}
                x={topLeft.x}
                y={topLeft.y}
                width={backgroundChunkSize}
                height={backgroundChunkSize}
                preserveAspectRatio="none"
              />
            );
          })}
          <rect
            x="1"
            y="1"
            width={Math.max(0, canvasWidth - 2)}
            height={Math.max(0, canvasHeight - 2)}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="2"
            strokeDasharray="16 10"
          />
          {points.length >= 2 && (
            <polyline
              points={polygonPoints}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          )}
          {points.length >= 3 && (
            <polygon
              points={polygonPoints}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          )}
          {points.map((point, index) => {
            const canvasPoint = userToCanvas(point, canvasWidth, canvasHeight);
            return (
              <g key={`${index}-${point.x}-${point.y}`}>
                <circle
                  cx={canvasPoint.x}
                  cy={canvasPoint.y}
                  r="10"
                  fill="#f8fafc"
                  stroke="#2563eb"
                  strokeWidth="4"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    setDragIndex(index);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setPoints((current) => current.filter((_, pointIndex) => pointIndex !== index));
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

interface BoundaryInsertionHandle {
  insertIndex: number;
  midpoint: WorldPoint;
}

const MIDPOINT_HOVER_RADIUS_PX = 100;

function getFallbackBackgroundColor(background: BackgroundConfig | null | undefined): string {
  const value = background?.value;
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim();
  }
  return '#87CEEB';
}

function getDefaultBoundaryPoints(canvasWidth: number, canvasHeight: number): WorldPoint[] {
  const halfWidth = canvasWidth / 2;
  const halfHeight = canvasHeight / 2;
  return [
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: -halfHeight },
  ];
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

function canvasToStagePoint(
  canvasX: number,
  canvasY: number,
  stage: SVGSVGElement,
  view: WorldBoundaryEditorView,
  canvasWidth: number,
  canvasHeight: number,
) {
  const rect = stage.getBoundingClientRect();
  const viewBox = getViewBox(view, canvasWidth, canvasHeight);
  return {
    x: ((canvasX - viewBox.minX) / viewBox.width) * rect.width,
    y: ((canvasY - viewBox.minY) / viewBox.height) * rect.height,
  };
}

function getBoundaryInsertionHandle(
  clientX: number,
  clientY: number,
  stage: SVGSVGElement,
  view: WorldBoundaryEditorView,
  points: WorldPoint[],
  canvasWidth: number,
  canvasHeight: number,
): BoundaryInsertionHandle | null {
  if (points.length < 2) {
    return null;
  }

  const rect = stage.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const segments: Array<{ startIndex: number; endIndex: number; insertIndex: number }> = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({ startIndex: index, endIndex: index + 1, insertIndex: index + 1 });
  }
  if (points.length >= 3) {
    segments.push({ startIndex: points.length - 1, endIndex: 0, insertIndex: points.length });
  }

  let best: { distance: number; handle: BoundaryInsertionHandle } | null = null;
  for (const segment of segments) {
    const midpoint = {
      x: (points[segment.startIndex].x + points[segment.endIndex].x) * 0.5,
      y: (points[segment.startIndex].y + points[segment.endIndex].y) * 0.5,
    };
    const midpointCanvas = userToCanvas(midpoint, canvasWidth, canvasHeight);
    const midpointStage = canvasToStagePoint(
      midpointCanvas.x,
      midpointCanvas.y,
      stage,
      view,
      canvasWidth,
      canvasHeight,
    );
    const distance = Math.hypot(pointerX - midpointStage.x, pointerY - midpointStage.y);
    if (distance > MIDPOINT_HOVER_RADIUS_PX) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = {
        distance,
        handle: {
          insertIndex: segment.insertIndex,
          midpoint,
        },
      };
    }
  }

  return best?.handle ?? null;
}

function getScreenSpaceEllipseRadii(
  screenRadius: number,
  stageWidth: number,
  stageHeight: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
) {
  return {
    rx: screenRadius * (viewBoxWidth / Math.max(stageWidth, 1)),
    ry: screenRadius * (viewBoxHeight / Math.max(stageHeight, 1)),
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
  const [hoveredInsertionHandle, setHoveredInsertionHandle] = useState<BoundaryInsertionHandle | null>(null);
  const [view, setView] = useState<WorldBoundaryEditorView>(() => getInitialView([], canvasWidth, canvasHeight));
  const [stageSize, setStageSize] = useState(() => ({
    width: canvasWidth,
    height: canvasHeight,
  }));
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
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({
        width: rect.width || canvasWidth,
        height: rect.height || canvasHeight,
      });
    };

    updateStageSize();

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [canvasHeight, canvasWidth]);

  useEffect(() => {
    if (!scene) return;
    setEnabled(!!scene.worldBoundary?.enabled);
    const savedPoints = (scene.worldBoundary?.points || []).map((point) => ({ ...point }));
    const nextPoints = savedPoints.length > 0 ? savedPoints : getDefaultBoundaryPoints(canvasWidth, canvasHeight);
    setPoints(nextPoints);
    setHoveredInsertionHandle(null);
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
    if (dragIndex !== null || panState) {
      setHoveredInsertionHandle(null);
    }
  }, [dragIndex, panState]);

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
  const insertionHandles = useMemo(() => {
    if (points.length < 2) {
      return [] as BoundaryInsertionHandle[];
    }

    const handles: BoundaryInsertionHandle[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      handles.push({
        insertIndex: index + 1,
        midpoint: {
          x: (points[index].x + points[index + 1].x) * 0.5,
          y: (points[index].y + points[index + 1].y) * 0.5,
        },
      });
    }
    if (points.length >= 3) {
      handles.push({
        insertIndex: points.length,
        midpoint: {
          x: (points[points.length - 1].x + points[0].x) * 0.5,
          y: (points[points.length - 1].y + points[0].y) * 0.5,
        },
      });
    }
    return handles;
  }, [points]);

  const viewBox = getViewBox(view, canvasWidth, canvasHeight);
  const pointHandleRadii = getScreenSpaceEllipseRadii(10, stageSize.width, stageSize.height, viewBox.width, viewBox.height);
  const pointHitRadii = getScreenSpaceEllipseRadii(16, stageSize.width, stageSize.height, viewBox.width, viewBox.height);
  const insertionHandleRadii = getScreenSpaceEllipseRadii(6, stageSize.width, stageSize.height, viewBox.width, viewBox.height);
  const insertionHitRadii = getScreenSpaceEllipseRadii(16, stageSize.width, stageSize.height, viewBox.width, viewBox.height);

  const handleStagePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      setHoveredInsertionHandle(null);
      setPanState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCenterX: viewRef.current.centerX,
        startCenterY: viewRef.current.centerY,
      });
      return;
    }

    if (event.button !== 0 || dragIndex !== null) return;

    if (points.length < 2) {
      const nextPoint = clientToCanvasPoint(
        event.clientX,
        event.clientY,
        event.currentTarget,
        viewRef.current,
        canvasWidth,
        canvasHeight,
      );
      setPoints((current) => [...current, canvasToUser(nextPoint.x, nextPoint.y, canvasWidth, canvasHeight)]);
    }
  };

  const handleStagePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragIndex !== null || panState) {
      return;
    }

    const nextHandle = getBoundaryInsertionHandle(
      event.clientX,
      event.clientY,
      event.currentTarget,
      viewRef.current,
      points,
      canvasWidth,
      canvasHeight,
    );
    setHoveredInsertionHandle((current) => {
      if (!current && !nextHandle) return current;
      if (
        current &&
        nextHandle &&
        current.insertIndex === nextHandle.insertIndex &&
        Math.abs(current.midpoint.x - nextHandle.midpoint.x) < 0.001 &&
        Math.abs(current.midpoint.y - nextHandle.midpoint.y) < 0.001
      ) {
        return current;
      }
      return nextHandle;
    });
  };

  const handleInsertionHandlePointerDown = (event: ReactPointerEvent<SVGEllipseElement>) => {
    if (event.button !== 0 || !hoveredInsertionHandle) {
      return;
    }

    event.stopPropagation();
    const { insertIndex, midpoint } = hoveredInsertionHandle;
    setHoveredInsertionHandle(null);
    setPoints((current) => [
      ...current.slice(0, insertIndex),
      midpoint,
      ...current.slice(insertIndex),
    ]);
    setDragIndex(insertIndex);
  };

  const handlePointDoubleClick = (index: number, event: ReactMouseEvent<SVGEllipseElement>) => {
    event.stopPropagation();
    setPoints((current) => {
      if (current.length <= 3) {
        return current;
      }
      return current.filter((_, pointIndex) => pointIndex !== index);
    });
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
            Click to place the first points. Hover a segment to insert a midpoint. Drag points to move them. Wheel to pan. Ctrl or Cmd plus wheel to zoom. Right or middle drag to pan.
          </div>
        </div>
        <div className="flex items-center gap-3">
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
          onPointerMove={handleStagePointerMove}
          onPointerLeave={() => setHoveredInsertionHandle(null)}
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
          {insertionHandles.map((handle) => {
            const midpointCanvas = userToCanvas(handle.midpoint, canvasWidth, canvasHeight);
            const isVisible = hoveredInsertionHandle?.insertIndex === handle.insertIndex;
            return (
              <g
                key={`insert-${handle.insertIndex}-${handle.midpoint.x}-${handle.midpoint.y}`}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  pointerEvents: isVisible ? 'auto' : 'none',
                }}
              >
                <ellipse
                  cx={midpointCanvas.x}
                  cy={midpointCanvas.y}
                  rx={insertionHitRadii.rx}
                  ry={insertionHitRadii.ry}
                  fill="transparent"
                  onPointerDown={handleInsertionHandlePointerDown}
                />
                <ellipse
                  cx={midpointCanvas.x}
                  cy={midpointCanvas.y}
                  rx={insertionHandleRadii.rx}
                  ry={insertionHandleRadii.ry}
                  fill="#60a5fa"
                  stroke="#eff6ff"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={handleInsertionHandlePointerDown}
                />
              </g>
            );
          })}
          {points.map((point, index) => {
            const canvasPoint = userToCanvas(point, canvasWidth, canvasHeight);
            return (
              <g key={`${index}-${point.x}-${point.y}`}>
                <ellipse
                  cx={canvasPoint.x}
                  cy={canvasPoint.y}
                  rx={pointHitRadii.rx}
                  ry={pointHitRadii.ry}
                  fill="transparent"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    setDragIndex(index);
                  }}
                  onDoubleClick={(event) => handlePointDoubleClick(index, event)}
                />
                <ellipse
                  cx={canvasPoint.x}
                  cy={canvasPoint.y}
                  rx={pointHandleRadii.rx}
                  ry={pointHandleRadii.ry}
                  fill="#f8fafc"
                  stroke="#2563eb"
                  strokeWidth="4"
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    setDragIndex(index);
                  }}
                  onDoubleClick={(event) => handlePointDoubleClick(index, event)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

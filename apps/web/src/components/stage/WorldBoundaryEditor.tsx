import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Minimize2, Trash2 } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { CanvasViewportOverlay } from '@/components/editors/shared/CanvasViewportOverlay';
import { ViewportRecoveryPill } from '@/components/editors/shared/ViewportRecoveryPill';
import { useViewportCenterAnimation } from '@/components/editors/shared/useViewportCenterAnimation';
import { HoverHelp } from '@/components/ui/hover-help';
import { OverlayActionButton } from '@/components/ui/overlay-action-button';
import { OverlayPill } from '@/components/ui/overlay-pill';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import {
  redoHistory,
  undoHistory,
} from '@/store/universalHistory';
import type { WorldPoint } from '@/types';
import {
  getSceneBackgroundBaseColor,
  getVisibleTiledBackgroundScreenChunks,
  getUserSpaceViewportFromCanvasViewBox,
  TiledBackgroundCanvasCompositor,
} from '@/lib/background/compositor';
import { EDITOR_VIEWPORT_ZOOM_STEP } from '@/lib/editor/editorViewportPolicy';
import { boundsIntersect, getBoundsFromPoints, shouldShowViewportRecovery } from '@/lib/editor/viewportRecovery';
import {
  clampViewportZoom,
} from '@/lib/viewportNavigation';

const WORLD_BOUNDARY_EDITOR_PADDING = 160;
const WORLD_BOUNDARY_EDITOR_MIN_ZOOM = 0.15;
const WORLD_BOUNDARY_EDITOR_MAX_ZOOM = 4;
const WORLD_BOUNDARY_EDITOR_ZOOM_STEP = EDITOR_VIEWPORT_ZOOM_STEP;
const POINT_DRAG_ACTIVATION_DISTANCE_PX = 4;
const WORLD_BOUNDARY_HELP_TEXT = 'Click to place the first points. Hover a segment to insert a midpoint. Drag points to move them. Wheel to pan. Ctrl or Cmd plus wheel to zoom. Right or middle drag to pan.';

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

function cloneBoundaryPoints(points: WorldPoint[]): WorldPoint[] {
  return points.map((point) => ({ ...point }));
}

function areBoundaryPointsEqual(a: WorldPoint[], b: WorldPoint[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index].x !== b[index].x || a[index].y !== b[index].y) {
      return false;
    }
  }

  return true;
}

export function WorldBoundaryEditor() {
  const { project, updateScene } = useProjectStore();
  const { isDarkMode, worldBoundaryEditorSceneId, selectedSceneId, closeWorldBoundaryEditor } = useEditorStore();
  const scene = useMemo(() => {
    const sceneId = worldBoundaryEditorSceneId ?? selectedSceneId;
    if (!project || !sceneId) return null;
    return project.scenes.find((candidate) => candidate.id === sceneId) ?? null;
  }, [project, selectedSceneId, worldBoundaryEditorSceneId]);
  const editorSurfaceColor = getSceneBackgroundBaseColor(scene?.background);
  const overlayPillTone = isDarkMode ? 'dark' : 'light';

  const canvasWidth = project?.settings.canvasWidth ?? 800;
  const canvasHeight = project?.settings.canvasHeight ?? 600;

  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState<WorldPoint[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pendingPointDrag, setPendingPointDrag] = useState<{
    index: number;
    startClientX: number;
    startClientY: number;
  } | null>(null);
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
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundCompositorRef = useRef<TiledBackgroundCanvasCompositor | null>(null);
  const pointsRef = useRef<WorldPoint[]>([]);
  const enabledRef = useRef(false);
  const dragStartPointsRef = useRef<WorldPoint[] | null>(null);
  const dragHistorySourceRef = useRef('scene:world-boundary:drag-point');
  const initializedSceneIdRef = useRef<string | null>(null);
  const viewRef = useRef(view);
  const [backgroundRenderRevision, setBackgroundRenderRevision] = useState(0);

  if (!backgroundCompositorRef.current) {
    backgroundCompositorRef.current = new TiledBackgroundCanvasCompositor({
      onChange: () => {
        setBackgroundRenderRevision((current) => current + 1);
      },
    });
  }

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const {
    animateToCenter: animateViewCenter,
    cancelAnimation: cancelViewCenterAnimation,
  } = useViewportCenterAnimation({
    getCurrentCenter: () => ({
      x: viewRef.current.centerX,
      y: viewRef.current.centerY,
    }),
    applyCenter: (center) => {
      setView((current) => ({
        ...current,
        centerX: center.x,
        centerY: center.y,
      }));
    },
  });

  useEffect(() => (
    () => {
      backgroundCompositorRef.current?.dispose();
      backgroundCompositorRef.current = null;
    }
  ), []);

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
    const savedPoints = cloneBoundaryPoints(scene.worldBoundary?.points || []);
    const nextPoints = savedPoints.length > 0 ? savedPoints : getDefaultBoundaryPoints(canvasWidth, canvasHeight);
    setPoints(nextPoints);
    setHoveredInsertionHandle(null);
    if (initializedSceneIdRef.current !== scene.id) {
      initializedSceneIdRef.current = scene.id;
      setView(getInitialView(nextPoints, canvasWidth, canvasHeight));
    }
  }, [canvasHeight, canvasWidth, scene]);

  const commitWorldBoundaryState = useCallback((nextEnabled: boolean, nextPoints: WorldPoint[], source: string) => {
    if (!scene) {
      return;
    }

    updateScene(scene.id, {
      worldBoundary: {
        enabled: nextEnabled,
        points: cloneBoundaryPoints(nextPoints),
      },
    }, {
      history: {
        source,
        allowMerge: false,
      },
    });
  }, [scene, updateScene]);

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
      const startPoints = dragStartPointsRef.current;
      const nextPoints = cloneBoundaryPoints(pointsRef.current);
      setDragIndex(null);
      dragStartPointsRef.current = null;
      if (startPoints && !areBoundaryPointsEqual(startPoints, nextPoints)) {
        commitWorldBoundaryState(enabledRef.current, nextPoints, dragHistorySourceRef.current);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [canvasHeight, canvasWidth, commitWorldBoundaryState, dragIndex]);

  useEffect(() => {
    if (dragIndex !== null || pendingPointDrag || panState) {
      setHoveredInsertionHandle(null);
    }
  }, [dragIndex, pendingPointDrag, panState]);

  useEffect(() => {
    if (!pendingPointDrag || dragIndex !== null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const distance = Math.hypot(
        event.clientX - pendingPointDrag.startClientX,
        event.clientY - pendingPointDrag.startClientY,
      );
      if (distance < POINT_DRAG_ACTIVATION_DISTANCE_PX) {
        return;
      }

      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const nextPoint = clientToCanvasPoint(
        event.clientX,
        event.clientY,
        stage,
        viewRef.current,
        canvasWidth,
        canvasHeight,
      );
      setPendingPointDrag(null);
      dragStartPointsRef.current = cloneBoundaryPoints(pointsRef.current);
      dragHistorySourceRef.current = 'scene:world-boundary:drag-point';
      setDragIndex(pendingPointDrag.index);
      setPoints((current) => current.map((point, index) => (
        index === pendingPointDrag.index ? canvasToUser(nextPoint.x, nextPoint.y, canvasWidth, canvasHeight) : point
      )));
    };

    const handlePointerUp = () => {
      setPendingPointDrag(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [canvasHeight, canvasWidth, dragIndex, pendingPointDrag]);

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

  const viewBox = getViewBox(view, canvasWidth, canvasHeight);
  const userViewport = useMemo(() => {
    return getUserSpaceViewportFromCanvasViewBox(viewBox, canvasWidth, canvasHeight);
  }, [canvasHeight, canvasWidth, viewBox]);

  const handleExitFullscreen = useCallback(() => {
    closeWorldBoundaryEditor();
  }, [closeWorldBoundaryEditor]);

  const finishInnerInteraction = useCallback((mode: 'commit' | 'revert') => {
    let handled = false;
    if (pendingPointDrag) {
      setPendingPointDrag(null);
      handled = true;
    }
    if (dragIndex !== null) {
      const startPoints = dragStartPointsRef.current;
      const nextPoints = cloneBoundaryPoints(pointsRef.current);
      if (mode === 'revert' && startPoints) {
        setPoints(cloneBoundaryPoints(startPoints));
      } else if (mode === 'commit' && startPoints && !areBoundaryPointsEqual(startPoints, nextPoints)) {
        commitWorldBoundaryState(enabledRef.current, nextPoints, dragHistorySourceRef.current);
      }
      dragStartPointsRef.current = null;
      setDragIndex(null);
      handled = true;
    }
    if (panState) {
      setPanState(null);
      handled = true;
    }
    return handled;
  }, [commitWorldBoundaryState, dragIndex, panState, pendingPointDrag]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUndoShortcut = (event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey;
      const isRedoShortcut =
        ((event.metaKey || event.ctrlKey) && event.key === 'z' && event.shiftKey) ||
        (event.ctrlKey && event.key.toLowerCase() === 'y');
      const plainEscape = event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey;
      const plainEnter = event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (isUndoShortcut || isRedoShortcut) {
        event.preventDefault();
        if (finishInnerInteraction(isUndoShortcut ? 'revert' : 'commit')) {
          return;
        }
        if (isUndoShortcut) {
          undoHistory();
        } else {
          redoHistory();
        }
        return;
      }
      if (!plainEscape && !plainEnter) {
        return;
      }

      event.preventDefault();
      finishInnerInteraction(plainEscape ? 'revert' : 'commit');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [finishInnerInteraction]);

  const showReturnToCenter = useMemo(() => {
    const stageBounds = {
      left: -canvasWidth / 2,
      right: canvasWidth / 2,
      bottom: -canvasHeight / 2,
      top: canvasHeight / 2,
    };
    const backgroundVisible = scene?.background?.type === 'tiled'
      ? getVisibleTiledBackgroundScreenChunks(
          scene.background,
          userViewport,
          Math.max(1, Math.round(stageSize.width)),
          Math.max(1, Math.round(stageSize.height)),
          1,
        ).length > 0
      : boundsIntersect(userViewport, stageBounds);
    const boundaryBounds = getBoundsFromPoints(points);
    const boundaryVisible = !!boundaryBounds && boundsIntersect(userViewport, boundaryBounds);

    return shouldShowViewportRecovery({
      currentCenter: { x: view.centerX, y: view.centerY },
      homeCenter: { x: canvasWidth / 2, y: canvasHeight / 2 },
      viewportSize: { width: viewBox.width, height: viewBox.height },
      hasVisibleContent: backgroundVisible || boundaryVisible,
    });
  }, [canvasHeight, canvasWidth, points, scene?.background, stageSize.height, stageSize.width, userViewport, view.centerX, view.centerY, viewBox.height, viewBox.width]);

  useEffect(() => {
    const canvas = backgroundCanvasRef.current;
    const compositor = backgroundCompositorRef.current;
    if (!canvas || !compositor || !scene) {
      return;
    }

    compositor.render({
      canvas,
      background: scene.background ?? null,
      viewport: userViewport,
      pixelWidth: Math.max(1, Math.round(stageSize.width)),
      pixelHeight: Math.max(1, Math.round(stageSize.height)),
    });
  }, [backgroundRenderRevision, scene, stageSize.height, stageSize.width, userViewport]);

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

  const handleReturnToCenter = useCallback(() => {
    animateViewCenter({
      x: canvasWidth / 2,
      y: canvasHeight / 2,
    });
  }, [animateViewCenter, canvasHeight, canvasWidth]);

  const setZoomAroundViewportCenter = useCallback((nextZoom: number) => {
    cancelViewCenterAnimation();
    setView((current) => ({
      ...current,
      zoom: clampViewportZoom(
        nextZoom,
        WORLD_BOUNDARY_EDITOR_MIN_ZOOM,
        WORLD_BOUNDARY_EDITOR_MAX_ZOOM,
      ),
    }));
  }, [cancelViewCenterAnimation]);

  const handleZoomToActualSize = useCallback(() => {
    setZoomAroundViewportCenter(1);
  }, [setZoomAroundViewportCenter]);

  const handleZoomToFit = useCallback(() => {
    cancelViewCenterAnimation();
    setView(getInitialView(pointsRef.current, canvasWidth, canvasHeight));
  }, [cancelViewCenterAnimation, canvasHeight, canvasWidth]);

  if (!scene) {
    return null;
  }

  const pointHandleRadii = getScreenSpaceEllipseRadii(10, stageSize.width, stageSize.height, viewBox.width, viewBox.height);
  const pointHitRadii = getScreenSpaceEllipseRadii(16, stageSize.width, stageSize.height, viewBox.width, viewBox.height);
  const insertionHandleRadii = getScreenSpaceEllipseRadii(6, stageSize.width, stageSize.height, viewBox.width, viewBox.height);
  const insertionHitRadii = getScreenSpaceEllipseRadii(16, stageSize.width, stageSize.height, viewBox.width, viewBox.height);

  const handleStagePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    cancelViewCenterAnimation();
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
      const nextPoints = [
        ...cloneBoundaryPoints(pointsRef.current),
        canvasToUser(nextPoint.x, nextPoint.y, canvasWidth, canvasHeight),
      ];
      setPoints(nextPoints);
      commitWorldBoundaryState(enabledRef.current, nextPoints, 'scene:world-boundary:add-point');
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
    dragStartPointsRef.current = cloneBoundaryPoints(pointsRef.current);
    dragHistorySourceRef.current = 'scene:world-boundary:insert-point';
    setPoints((current) => [
      ...current.slice(0, insertIndex),
      midpoint,
      ...current.slice(insertIndex),
    ]);
    setDragIndex(insertIndex);
  };

  const handlePointDoubleClick = (index: number, event: ReactMouseEvent<SVGEllipseElement>) => {
    event.stopPropagation();
    setPendingPointDrag(null);
    const nextPoints = cloneBoundaryPoints(pointsRef.current);
    if (nextPoints.length <= 3) {
      return;
    }
    nextPoints.splice(index, 1);
    setPoints(nextPoints);
    commitWorldBoundaryState(enabledRef.current, nextPoints, 'scene:world-boundary:remove-point');
  };

  const handlePointPointerDown = (index: number, event: ReactPointerEvent<SVGEllipseElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    dragStartPointsRef.current = cloneBoundaryPoints(pointsRef.current);
    dragHistorySourceRef.current = 'scene:world-boundary:drag-point';
    setPendingPointDrag({
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
    });
  };

  const handleStageWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    cancelViewCenterAnimation();
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

  return (
    <div className="fixed inset-0 z-[100001] bg-background flex flex-col overscroll-none" data-testid="world-boundary-editor-root">
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        style={{ backgroundColor: editorSurfaceColor }}
      >
        <CanvasViewportOverlay
          canUndo={false}
          canRedo={false}
          onUndo={() => {}}
          onRedo={() => {}}
          zoom={view.zoom}
          minZoom={WORLD_BOUNDARY_EDITOR_MIN_ZOOM}
          maxZoom={WORLD_BOUNDARY_EDITOR_MAX_ZOOM}
          onZoomOut={() => setZoomAroundViewportCenter(viewRef.current.zoom - WORLD_BOUNDARY_EDITOR_ZOOM_STEP)}
          onZoomIn={() => setZoomAroundViewportCenter(viewRef.current.zoom + WORLD_BOUNDARY_EDITOR_ZOOM_STEP)}
          onZoomToActualSize={handleZoomToActualSize}
          onZoomToFit={handleZoomToFit}
          rightAccessory={(
            <>
              <HoverHelp
                align="start"
                label="Boundary help"
                panelClassName="max-w-[320px]"
                triggerClassName="text-foreground/78 hover:bg-transparent hover:text-foreground"
              >
                {WORLD_BOUNDARY_HELP_TEXT}
              </HoverHelp>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-foreground/78 hover:!bg-transparent hover:text-foreground"
                aria-label="Clear boundary"
                title="Clear boundary"
                onClick={() => {
                  setHoveredInsertionHandle(null);
                  const nextPoints = getDefaultBoundaryPoints(canvasWidth, canvasHeight);
                  setPoints(nextPoints);
                  commitWorldBoundaryState(enabledRef.current, nextPoints, 'scene:world-boundary:clear');
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <OverlayPill tone={overlayPillTone} size="compact">
                <OverlayActionButton
                  label="Exit fullscreen"
                  onClick={handleExitFullscreen}
                  pressed
                  selected
                  size="compact"
                  title="Exit fullscreen"
                  tone={overlayPillTone}
                >
                  <Minimize2 className="size-3.5" />
                </OverlayActionButton>
              </OverlayPill>
            </>
          )}
        />
        <ViewportRecoveryPill
          visible={showReturnToCenter}
          onClick={handleReturnToCenter}
          dataTestId="world-boundary-return-to-center"
        />

        <canvas
          ref={backgroundCanvasRef}
          className="absolute inset-0 h-full w-full pointer-events-none"
          aria-hidden="true"
        />
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
                  onPointerDown={(event) => handlePointPointerDown(index, event)}
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
                  onPointerDown={(event) => handlePointPointerDown(index, event)}
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

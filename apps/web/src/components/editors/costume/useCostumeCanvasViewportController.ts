import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { getBitmapBrushCursorStyle, type BitmapBrushKind } from '@/lib/background/brushCore';
import {
  clampCameraToWorldRect,
  clampViewportZoom,
  panCameraFromDrag,
  panCameraFromWheel,
  zoomCameraAtClientPoint,
} from '@/lib/viewportNavigation';
import type { CostumeEditorMode } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import {
  BASE_VIEW_SCALE,
  COSTUME_WORLD_RECT,
  MAX_PAN_OVERSCROLL_PX,
  MAX_ZOOM,
  MIN_ZOOM,
  getZoomInvariantCanvasMetric,
} from './costumeCanvasShared';

interface UseCostumeCanvasViewportControllerOptions {
  activeTool: DrawingTool;
  activeToolRef: MutableRefObject<DrawingTool>;
  activeLayerLockedRef: MutableRefObject<boolean>;
  activeLayerVisibleRef: MutableRefObject<boolean>;
  bitmapBrushKind: BitmapBrushKind;
  bitmapBrushKindRef: MutableRefObject<BitmapBrushKind>;
  brushColor: string;
  brushColorRef: MutableRefObject<string>;
  brushOpacity: number;
  brushOpacityRef: MutableRefObject<number>;
  brushCursorOverlayRef: RefObject<HTMLDivElement | null>;
  brushSize: number;
  brushSizeRef: MutableRefObject<number>;
  containerRef: RefObject<HTMLDivElement | null>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  editorModeState: CostumeEditorMode;
  isVisible: boolean;
  onViewScaleChange?: (scale: number) => void;
}

export function useCostumeCanvasViewportController({
  activeTool,
  activeToolRef,
  activeLayerLockedRef,
  activeLayerVisibleRef,
  bitmapBrushKind,
  bitmapBrushKindRef,
  brushColor,
  brushColorRef,
  brushOpacity,
  brushOpacityRef,
  brushCursorOverlayRef,
  brushSize,
  brushSizeRef,
  containerRef,
  editorModeRef,
  editorModeState,
  isVisible,
  onViewScaleChange,
}: UseCostumeCanvasViewportControllerOptions) {
  const [zoom, setZoom] = useState(1);
  const [cameraCenter, setCameraCenter] = useState({ x: COSTUME_WORLD_RECT.width / 2, y: COSTUME_WORLD_RECT.height / 2 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [isViewportPanning, setIsViewportPanning] = useState(false);

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
  const brushCursorEnabledRef = useRef(false);
  const brushCursorPosRef = useRef<{ x: number; y: number } | null>(null);

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

  const updateViewportSize = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    setViewportSize({
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    });
  }, [containerRef]);

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

  const syncBrushCursorOverlay = useCallback(() => {
    const overlay = brushCursorOverlayRef.current;
    if (!overlay) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;
    const layerInteractive = activeLayerVisibleRef.current && !activeLayerLockedRef.current;
    const isBitmapBrushTool = layerInteractive && mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
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
      tool === 'brush' ? brushOpacityRef.current : 1,
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
  }, [
    activeLayerLockedRef,
    activeLayerVisibleRef,
    activeToolRef,
    bitmapBrushKindRef,
    brushColorRef,
    brushCursorOverlayRef,
    brushSizeRef,
    editorModeRef,
  ]);

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

  const handleWheel = useCallback((event: WheelEvent) => {
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.ctrlKey || event.metaKey) {
      const rect = container.getBoundingClientRect();
      const zoomDelta = -event.deltaY * 0.01;
      const zoomFactor = Math.max(0.01, 1 + zoomDelta);
      const nextZoom = clampZoom(zoomRef.current * zoomFactor);
      setCameraCenter(
        clampCameraCenter(
          zoomCameraAtClientPoint(
            event.clientX,
            event.clientY,
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
      panCameraFromWheel(prev, event.deltaX, event.deltaY, currentScale, 'down'),
    ));
  }, [clampCameraCenter, clampZoom, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, updateViewportSize]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      updateViewportSize();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isVisible, updateViewportSize]);

  useEffect(() => {
    setCameraCenter((prev) => clampCameraCenter(prev));
  }, [clampCameraCenter, viewportSize.height, viewportSize.width]);

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
  }, [clampCameraCenter, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => handleWheel(event);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [containerRef, handleWheel]);

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
  }, [brushCursorOverlayRef, containerRef]);

  useEffect(() => {
    syncBrushCursorOverlay();
  }, [activeTool, bitmapBrushKind, brushColor, brushOpacity, brushSize, editorModeState, syncBrushCursorOverlay, zoom]);

  useEffect(() => {
    onViewScaleChange?.(BASE_VIEW_SCALE * zoom);
  }, [onViewScaleChange, zoom]);

  return {
    cameraCenter,
    clampCameraCenter,
    clampZoom,
    getZoomInvariantMetric,
    isViewportPanning,
    refreshViewportSize: updateViewportSize,
    setZoomLevel,
    syncBrushCursorOverlay,
    viewportSize,
    zoom,
    zoomAroundViewportCenter,
    zoomRef,
    zoomToBounds,
  };
}

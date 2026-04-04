import {
  panCameraFromDrag,
  panCameraFromWheel,
  screenPointToWorldPoint,
  zoomCameraAtScreenPoint,
} from '@/lib/viewportNavigation';

export type StageViewMode = 'camera-masked' | 'camera-viewport' | 'editor';

export interface StageSize {
  width: number;
  height: number;
}

export interface StageEditorViewport {
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StageProjection {
  mode: StageViewMode;
  hostSize: StageSize;
  surfaceSize: StageSize;
  visibleRect: StageRect;
  cameraViewport: StageRect;
  cameraZoom: number;
  scrollX: number;
  scrollY: number;
}

export interface StageScreenPoint {
  x: number;
  y: number;
}

export const DEFAULT_STAGE_EDITOR_ZOOM = 0.5;
export const MIN_STAGE_EDITOR_ZOOM = 0.1;
export const MAX_STAGE_EDITOR_ZOOM = 10;
const MIN_STAGE_EDITOR_SOFT_BOUND_EXTENT = 250_000;
const STAGE_EDITOR_SOFT_BOUND_MULTIPLIER = 512;

function sanitizeStageSize(size: StageSize): StageSize {
  return {
    width: Math.max(1, Number.isFinite(size.width) ? size.width : 1),
    height: Math.max(1, Number.isFinite(size.height) ? size.height : 1),
  };
}

function createCenteredRect(outer: StageSize, inner: StageSize): StageRect {
  return {
    x: Math.floor((outer.width - inner.width) / 2),
    y: Math.floor((outer.height - inner.height) / 2),
    width: inner.width,
    height: inner.height,
  };
}

function clampStageEditorZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAGE_EDITOR_ZOOM;
  }
  return Math.max(MIN_STAGE_EDITOR_ZOOM, Math.min(MAX_STAGE_EDITOR_ZOOM, value));
}

export function createDefaultStageEditorViewport(canvasSize: StageSize): StageEditorViewport {
  const safeCanvasSize = sanitizeStageSize(canvasSize);
  return {
    centerX: safeCanvasSize.width / 2,
    centerY: safeCanvasSize.height / 2,
    zoom: DEFAULT_STAGE_EDITOR_ZOOM,
  };
}

export function normalizeStageEditorViewport(
  viewport: StageEditorViewport | null | undefined,
  canvasSize: StageSize,
): StageEditorViewport {
  const safeCanvasSize = sanitizeStageSize(canvasSize);
  const fallback = createDefaultStageEditorViewport(safeCanvasSize);
  if (!viewport) {
    return fallback;
  }

  const maxOffsetX = Math.max(
    MIN_STAGE_EDITOR_SOFT_BOUND_EXTENT,
    safeCanvasSize.width * STAGE_EDITOR_SOFT_BOUND_MULTIPLIER,
  );
  const maxOffsetY = Math.max(
    MIN_STAGE_EDITOR_SOFT_BOUND_EXTENT,
    safeCanvasSize.height * STAGE_EDITOR_SOFT_BOUND_MULTIPLIER,
  );

  return {
    centerX: Number.isFinite(viewport.centerX)
      ? Math.max(fallback.centerX - maxOffsetX, Math.min(fallback.centerX + maxOffsetX, viewport.centerX))
      : fallback.centerX,
    centerY: Number.isFinite(viewport.centerY)
      ? Math.max(fallback.centerY - maxOffsetY, Math.min(fallback.centerY + maxOffsetY, viewport.centerY))
      : fallback.centerY,
    zoom: clampStageEditorZoom(viewport.zoom),
  };
}

export function panStageEditorViewport(
  viewport: StageEditorViewport,
  deltaScreenX: number,
  deltaScreenY: number,
): StageEditorViewport {
  const zoom = clampStageEditorZoom(viewport.zoom);
  const camera = panCameraFromDrag(
    { x: viewport.centerX, y: viewport.centerY },
    deltaScreenX,
    deltaScreenY,
    zoom,
    'down',
  );
  return {
    centerX: camera.x,
    centerY: camera.y,
    zoom,
  };
}

export function scrollStageEditorViewport(
  viewport: StageEditorViewport,
  deltaScreenX: number,
  deltaScreenY: number,
): StageEditorViewport {
  const zoom = clampStageEditorZoom(viewport.zoom);
  const camera = panCameraFromWheel(
    { x: viewport.centerX, y: viewport.centerY },
    deltaScreenX,
    deltaScreenY,
    zoom,
    'down',
  );
  return {
    centerX: camera.x,
    centerY: camera.y,
    zoom,
  };
}

export function getStageEditorViewportWorldPoint(
  viewport: StageEditorViewport,
  hostSize: StageSize,
  screenPoint: StageScreenPoint,
): StageScreenPoint {
  const safeHostSize = sanitizeStageSize(hostSize);
  const zoom = clampStageEditorZoom(viewport.zoom);
  return screenPointToWorldPoint(
    screenPoint,
    safeHostSize,
    { x: viewport.centerX, y: viewport.centerY },
    zoom,
    'down',
  );
}

export function zoomStageEditorViewportAtScreenPoint(
  viewport: StageEditorViewport,
  hostSize: StageSize,
  screenPoint: StageScreenPoint,
  nextZoom: number,
): StageEditorViewport {
  const safeHostSize = sanitizeStageSize(hostSize);
  const clampedNextZoom = clampStageEditorZoom(nextZoom);
  const camera = zoomCameraAtScreenPoint(
    screenPoint,
    safeHostSize,
    { x: viewport.centerX, y: viewport.centerY },
    clampStageEditorZoom(viewport.zoom),
    clampedNextZoom,
    'down',
  );

  return {
    centerX: camera.x,
    centerY: camera.y,
    zoom: clampedNextZoom,
  };
}

export function buildStageProjection(params: {
  mode: StageViewMode;
  hostSize: StageSize;
  surfaceSize: StageSize;
  canvasSize: StageSize;
  editorViewport: StageEditorViewport;
}): StageProjection {
  const hostSize = sanitizeStageSize(params.hostSize);
  const surfaceSize = sanitizeStageSize({
    width: Math.max(params.surfaceSize.width, hostSize.width),
    height: Math.max(params.surfaceSize.height, hostSize.height),
  });
  const canvasSize = sanitizeStageSize(params.canvasSize);
  const editorViewport = normalizeStageEditorViewport(params.editorViewport, canvasSize);
  const visibleRect = createCenteredRect(surfaceSize, hostSize);

  if (params.mode === 'editor') {
    return {
      mode: params.mode,
      hostSize,
      surfaceSize,
      visibleRect,
      cameraViewport: visibleRect,
      cameraZoom: editorViewport.zoom,
      scrollX: editorViewport.centerX - hostSize.width / 2,
      scrollY: editorViewport.centerY - hostSize.height / 2,
    };
  }

  const scaleX = hostSize.width / canvasSize.width;
  const scaleY = hostSize.height / canvasSize.height;
  const scale = Math.max(
    MIN_STAGE_EDITOR_ZOOM,
    params.mode === 'camera-viewport'
      ? Math.min(scaleX, scaleY)
      : Math.max(scaleX, scaleY),
  );
  const viewportWidth = params.mode === 'camera-viewport'
    ? Math.floor(canvasSize.width * scale)
    : hostSize.width;
  const viewportHeight = params.mode === 'camera-viewport'
    ? Math.floor(canvasSize.height * scale)
    : hostSize.height;
  const viewportX = params.mode === 'camera-viewport'
    ? visibleRect.x + Math.floor((hostSize.width - viewportWidth) / 2)
    : visibleRect.x;
  const viewportY = params.mode === 'camera-viewport'
    ? visibleRect.y + Math.floor((hostSize.height - viewportHeight) / 2)
    : visibleRect.y;
  return {
    mode: params.mode,
    hostSize,
    surfaceSize,
    visibleRect,
    cameraViewport: {
      x: viewportX,
      y: viewportY,
      width: viewportWidth,
      height: viewportHeight,
    },
    cameraZoom: scale,
    scrollX: canvasSize.width / 2 - viewportWidth / 2,
    scrollY: canvasSize.height / 2 - viewportHeight / 2,
  };
}

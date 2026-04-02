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

export interface StageProjection {
  mode: StageViewMode;
  hostSize: StageSize;
  cameraViewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
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

function sanitizeStageSize(size: StageSize): StageSize {
  return {
    width: Math.max(1, Number.isFinite(size.width) ? size.width : 1),
    height: Math.max(1, Number.isFinite(size.height) ? size.height : 1),
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
  const fallback = createDefaultStageEditorViewport(canvasSize);
  if (!viewport) {
    return fallback;
  }

  return {
    centerX: Number.isFinite(viewport.centerX) ? viewport.centerX : fallback.centerX,
    centerY: Number.isFinite(viewport.centerY) ? viewport.centerY : fallback.centerY,
    zoom: clampStageEditorZoom(viewport.zoom),
  };
}

export function panStageEditorViewport(
  viewport: StageEditorViewport,
  deltaScreenX: number,
  deltaScreenY: number,
): StageEditorViewport {
  const zoom = clampStageEditorZoom(viewport.zoom);
  return {
    centerX: viewport.centerX - deltaScreenX / zoom,
    centerY: viewport.centerY - deltaScreenY / zoom,
    zoom,
  };
}

export function scrollStageEditorViewport(
  viewport: StageEditorViewport,
  deltaScreenX: number,
  deltaScreenY: number,
): StageEditorViewport {
  const zoom = clampStageEditorZoom(viewport.zoom);
  return {
    centerX: viewport.centerX + deltaScreenX / zoom,
    centerY: viewport.centerY + deltaScreenY / zoom,
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
  const halfWidth = safeHostSize.width / 2;
  const halfHeight = safeHostSize.height / 2;

  return {
    x: viewport.centerX + (screenPoint.x - halfWidth) / zoom,
    y: viewport.centerY + (screenPoint.y - halfHeight) / zoom,
  };
}

export function zoomStageEditorViewportAtScreenPoint(
  viewport: StageEditorViewport,
  hostSize: StageSize,
  screenPoint: StageScreenPoint,
  nextZoom: number,
): StageEditorViewport {
  const safeHostSize = sanitizeStageSize(hostSize);
  const clampedNextZoom = clampStageEditorZoom(nextZoom);
  const worldPoint = getStageEditorViewportWorldPoint(viewport, safeHostSize, screenPoint);
  const halfWidth = safeHostSize.width / 2;
  const halfHeight = safeHostSize.height / 2;

  return {
    centerX: worldPoint.x - (screenPoint.x - halfWidth) / clampedNextZoom,
    centerY: worldPoint.y - (screenPoint.y - halfHeight) / clampedNextZoom,
    zoom: clampedNextZoom,
  };
}

export function buildStageProjection(params: {
  mode: StageViewMode;
  hostSize: StageSize;
  canvasSize: StageSize;
  editorViewport: StageEditorViewport;
}): StageProjection {
  const hostSize = sanitizeStageSize(params.hostSize);
  const canvasSize = sanitizeStageSize(params.canvasSize);
  const editorViewport = normalizeStageEditorViewport(params.editorViewport, canvasSize);

  if (params.mode === 'editor') {
    return {
      mode: params.mode,
      hostSize,
      cameraViewport: {
        x: 0,
        y: 0,
        width: hostSize.width,
        height: hostSize.height,
      },
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
    ? Math.floor((hostSize.width - viewportWidth) / 2)
    : 0;
  const viewportY = params.mode === 'camera-viewport'
    ? Math.floor((hostSize.height - viewportHeight) / 2)
    : 0;
  return {
    mode: params.mode,
    hostSize,
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

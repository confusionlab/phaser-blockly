import { clampViewportZoom } from '@/lib/viewportNavigation';

export const EDITOR_VIEWPORT_ZOOM_STEP = 0.1;
export const EDITOR_VIEWPORT_FIT_PADDING_PX = 48;
export const EDITOR_VIEWPORT_SELECTION_PADDING_PX = 72;

export type ViewportSize = {
  width: number;
  height: number;
};

export type ViewportEdgeBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ViewportRectBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type EditorViewportFitBounds = ViewportEdgeBounds | ViewportRectBounds;

export type NormalizedEditorViewportFitBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type EditorViewportFitResult = {
  centerX: number;
  centerY: number;
  zoom: number;
  bounds: NormalizedEditorViewportFitBounds;
};

type ComputeEditorViewportFitOptions = {
  bounds: EditorViewportFitBounds | null | undefined;
  viewportSize: ViewportSize;
  minZoom: number;
  maxZoom: number;
  paddingPx?: number;
  pixelsPerWorldUnitAtZoom1?: number;
};

function hasRectDimensions(bounds: EditorViewportFitBounds): bounds is ViewportRectBounds {
  return 'width' in bounds && 'height' in bounds;
}

export function normalizeEditorViewportFitBounds(
  bounds: EditorViewportFitBounds | null | undefined,
): NormalizedEditorViewportFitBounds | null {
  if (!bounds) {
    return null;
  }

  const rawLeft = bounds.left;
  const rawRight = hasRectDimensions(bounds) ? bounds.left + bounds.width : bounds.right;
  const rawTop = bounds.top;
  const rawBottom = hasRectDimensions(bounds) ? bounds.top + bounds.height : bounds.bottom;

  if (
    !Number.isFinite(rawLeft)
    || !Number.isFinite(rawRight)
    || !Number.isFinite(rawTop)
    || !Number.isFinite(rawBottom)
  ) {
    return null;
  }

  const minX = Math.min(rawLeft, rawRight);
  const maxX = Math.max(rawLeft, rawRight);
  const minY = Math.min(rawTop, rawBottom);
  const maxY = Math.max(rawTop, rawBottom);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: minX + (width / 2),
    centerY: minY + (height / 2),
  };
}

export function computeEditorViewportFitResult({
  bounds,
  viewportSize,
  minZoom,
  maxZoom,
  paddingPx = 0,
  pixelsPerWorldUnitAtZoom1 = 1,
}: ComputeEditorViewportFitOptions): EditorViewportFitResult | null {
  const normalizedBounds = normalizeEditorViewportFitBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  const safeViewportWidth = Math.max(1, Number.isFinite(viewportSize.width) ? viewportSize.width : 1);
  const safeViewportHeight = Math.max(1, Number.isFinite(viewportSize.height) ? viewportSize.height : 1);
  const availableWidth = Math.max(1, safeViewportWidth - (Math.max(0, paddingPx) * 2));
  const availableHeight = Math.max(1, safeViewportHeight - (Math.max(0, paddingPx) * 2));
  const targetPixelsPerWorldUnit = Math.min(
    availableWidth / normalizedBounds.width,
    availableHeight / normalizedBounds.height,
  );
  const zoom = clampViewportZoom(
    targetPixelsPerWorldUnit / Math.max(pixelsPerWorldUnitAtZoom1, 1e-6),
    minZoom,
    maxZoom,
  );

  return {
    centerX: normalizedBounds.centerX,
    centerY: normalizedBounds.centerY,
    zoom,
    bounds: normalizedBounds,
  };
}

import type { Canvas as FabricCanvas } from 'fabric';
import {
  HANDLE_SIZE,
  OBJECT_SELECTION_CORNER_SIZE,
  OBJECT_SELECTION_PADDING,
  VECTOR_SELECTION_BORDER_SCALE,
} from './costumeCanvasShared';

interface SyncCanvasSelectionGizmoAppearanceOptions {
  fabricCanvas: FabricCanvas;
  getZoomInvariantMetric: (metric: number, zoom?: number) => number;
  pointEditingTarget: any | null;
  renderVectorPointEditingGuide: () => void;
  zoom: number;
}

export function syncCanvasSelectionGizmoAppearance({
  fabricCanvas,
  getZoomInvariantMetric,
  pointEditingTarget,
  renderVectorPointEditingGuide,
  zoom,
}: SyncCanvasSelectionGizmoAppearanceOptions) {
  const selectionCornerSize = getZoomInvariantMetric(OBJECT_SELECTION_CORNER_SIZE, zoom);
  const selectionBorderScale = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE, zoom);
  const selectionPadding = getZoomInvariantMetric(OBJECT_SELECTION_PADDING, zoom);

  fabricCanvas.forEachObject((obj: any) => {
    obj.borderScaleFactor = selectionBorderScale;
    obj.padding = obj === pointEditingTarget ? 0 : selectionPadding;
    obj.cornerSize = obj === pointEditingTarget
      ? getZoomInvariantMetric(HANDLE_SIZE, zoom)
      : selectionCornerSize;
    obj.setCoords?.();
  });

  const activeObject = fabricCanvas.getActiveObject() as any;
  if (activeObject) {
    activeObject.borderScaleFactor = selectionBorderScale;
    activeObject.padding = activeObject === pointEditingTarget ? 0 : selectionPadding;
    activeObject.cornerSize = activeObject === pointEditingTarget
      ? getZoomInvariantMetric(HANDLE_SIZE, zoom)
      : selectionCornerSize;
    activeObject.setCoords?.();
  }

  fabricCanvas.requestRenderAll();
  renderVectorPointEditingGuide();
}

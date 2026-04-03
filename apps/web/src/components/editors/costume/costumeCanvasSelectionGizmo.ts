import type { Canvas as FabricCanvas } from 'fabric';
import {
  HANDLE_SIZE,
  OBJECT_SELECTION_CORNER_SIZE,
  OBJECT_SELECTION_PADDING,
  VECTOR_SELECTION_BORDER_SCALE,
} from './costumeCanvasShared';
import { applyUnifiedObjectTransformGizmoAppearance } from './costumeCanvasObjectTransformGizmo';

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
    if (obj === pointEditingTarget) {
      obj.borderScaleFactor = selectionBorderScale;
      obj.padding = 0;
      obj.cornerSize = getZoomInvariantMetric(HANDLE_SIZE, zoom);
    } else {
      applyUnifiedObjectTransformGizmoAppearance(obj, getZoomInvariantMetric, zoom);
      obj.padding = selectionPadding;
      obj.cornerSize = selectionCornerSize;
    }
    obj.setCoords?.();
  });

  const activeObject = fabricCanvas.getActiveObject() as any;
  if (activeObject) {
    if (activeObject === pointEditingTarget) {
      activeObject.borderScaleFactor = selectionBorderScale;
      activeObject.padding = 0;
      activeObject.cornerSize = getZoomInvariantMetric(HANDLE_SIZE, zoom);
    } else {
      applyUnifiedObjectTransformGizmoAppearance(activeObject, getZoomInvariantMetric, zoom);
      activeObject.padding = selectionPadding;
      activeObject.cornerSize = selectionCornerSize;
    }
    activeObject.setCoords?.();
  }

  fabricCanvas.requestRenderAll();
  renderVectorPointEditingGuide();
}

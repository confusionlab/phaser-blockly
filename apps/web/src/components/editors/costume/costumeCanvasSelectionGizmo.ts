import type { Canvas as FabricCanvas } from 'fabric';
import {
  HANDLE_SIZE,
  OBJECT_SELECTION_CORNER_SIZE,
  OBJECT_SELECTION_PADDING,
  VECTOR_SELECTION_BORDER_SCALE,
} from './costumeCanvasShared';
import {
  applyUnifiedObjectTransformGizmoAppearance,
  resolveTransformGizmoMetric,
  type TransformGizmoRenderSpace,
} from './costumeCanvasObjectTransformGizmo';

interface SyncCanvasSelectionGizmoAppearanceOptions {
  fabricCanvas: FabricCanvas;
  getZoomInvariantMetric: (metric: number, zoom?: number) => number;
  pointEditingTarget: any | null;
  renderVectorPointEditingGuide: () => void;
  renderSpace?: TransformGizmoRenderSpace;
  zoom: number;
}

export function syncCanvasSelectionGizmoAppearance({
  fabricCanvas,
  getZoomInvariantMetric,
  pointEditingTarget,
  renderVectorPointEditingGuide,
  renderSpace = 'external-scale',
  zoom,
}: SyncCanvasSelectionGizmoAppearanceOptions) {
  const selectionCornerSize = resolveTransformGizmoMetric(
    OBJECT_SELECTION_CORNER_SIZE,
    getZoomInvariantMetric,
    zoom,
    renderSpace,
  );
  const selectionBorderScale = resolveTransformGizmoMetric(
    VECTOR_SELECTION_BORDER_SCALE,
    getZoomInvariantMetric,
    zoom,
    renderSpace,
  );
  const selectionPadding = resolveTransformGizmoMetric(
    OBJECT_SELECTION_PADDING,
    getZoomInvariantMetric,
    zoom,
    renderSpace,
  );

  fabricCanvas.forEachObject((obj: any) => {
    if (obj === pointEditingTarget) {
      obj.borderScaleFactor = selectionBorderScale;
      obj.padding = 0;
      obj.cornerSize = resolveTransformGizmoMetric(
        HANDLE_SIZE,
        getZoomInvariantMetric,
        zoom,
        renderSpace,
      );
    } else {
      applyUnifiedObjectTransformGizmoAppearance(obj, getZoomInvariantMetric, zoom, renderSpace);
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
      activeObject.cornerSize = resolveTransformGizmoMetric(
        HANDLE_SIZE,
        getZoomInvariantMetric,
        zoom,
        renderSpace,
      );
    } else {
      applyUnifiedObjectTransformGizmoAppearance(activeObject, getZoomInvariantMetric, zoom, renderSpace);
      activeObject.padding = selectionPadding;
      activeObject.cornerSize = selectionCornerSize;
    }
    activeObject.setCoords?.();
  }

  fabricCanvas.requestRenderAll();
  renderVectorPointEditingGuide();
}

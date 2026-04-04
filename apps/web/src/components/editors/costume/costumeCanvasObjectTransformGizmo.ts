import { Control, Point, controlsUtils, type Canvas as FabricCanvas } from 'fabric';
import {
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  computeCornerScaleResult,
  computeEdgeScaleResult,
  drawTransformProportionalGuide,
  getTransformCornerDiagonal,
  getTransformGizmoCornerCursor,
  getTransformGizmoEdgeCursor,
  getTransformGizmoEdgeSegments,
  getOppositeTransformGizmoSide,
  getTransformGizmoRotateCursor,
  isPointNearTransformEdge,
  isPointInsideTransformHandle,
  isPointInsideTransformRotateRing,
} from '@/lib/editor/unifiedTransformGizmo';
import type { TransformGizmoCorner, TransformGizmoSide } from '@/lib/editor/unifiedTransformGizmo';
import {
  OBJECT_SELECTION_PADDING,
  VECTOR_SELECTION_BORDER_OPACITY,
  VECTOR_SELECTION_BORDER_SCALE,
} from './costumeCanvasShared';
import { applyCanvasCursor } from './costumeCanvasBitmapRuntime';

type FabricTransformGuideState = {
  corner: TransformGizmoCorner | null;
  proportional: boolean;
  target: any | null;
};

type FabricCanvasWithTransformGuide = FabricCanvas & {
  __unifiedTransformGuide?: FabricTransformGuideState | null;
  __manageUnifiedTransformGuideTopLayer?: boolean;
  contextTopDirty?: boolean;
  renderTop?: () => void;
};

type FabricObjectWithTransformGizmo = {
  borderColor?: string;
  borderOpacityWhenMoving?: number;
  borderScaleFactor?: number;
  controls?: Record<string, Control>;
  cornerColor?: string;
  cornerSize?: number;
  cornerStrokeColor?: string;
  cornerStyle?: string;
  padding?: number;
  selectionBackgroundColor?: string;
  setCoords?: () => void;
  touchCornerSize?: number;
  transparentCorners?: boolean;
};

const TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER: Record<string, TransformGizmoCorner> = {
  tl: 'nw',
  tr: 'ne',
  br: 'se',
  bl: 'sw',
};
const HIDDEN_SELECTION_COLOR = 'rgba(0, 0, 0, 0)';

const EDGE_CONTROL_KEY_TO_SIDE: Record<string, TransformGizmoSide> = {
  mt: 'n',
  mr: 'e',
  mb: 's',
  ml: 'w',
};

function getControlCenterFromCoords({
  tl,
  tr,
  br,
  bl,
}: {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}) {
  return {
    x: (tl.x + tr.x + br.x + bl.x) * 0.25,
    y: (tl.y + tr.y + br.y + bl.y) * 0.25,
  };
}

function getCornerRadius(fabricObject: any) {
  return Math.max(TRANSFORM_GIZMO_HANDLE_RADIUS, Number(fabricObject?.cornerSize) * 0.5 || 0);
}

function getObjectTransformFrame(fabricObject: any) {
  const coords = fabricObject?.oCoords;
  if (!coords?.tl || !coords?.tr || !coords?.br || !coords?.bl) {
    return null;
  }
  return {
    center: {
      x: (coords.tl.x + coords.tr.x + coords.br.x + coords.bl.x) * 0.25,
      y: (coords.tl.y + coords.tr.y + coords.br.y + coords.bl.y) * 0.25,
    },
    corners: {
      nw: coords.tl,
      ne: coords.tr,
      se: coords.br,
      sw: coords.bl,
    },
  };
}

function getFabricObjectRotationRadians(fabricObject: any) {
  const rotationDegrees = typeof fabricObject?.getTotalAngle === 'function'
    ? fabricObject.getTotalAngle()
    : (Number(fabricObject?.angle) || 0);
  return rotationDegrees * (Math.PI / 180);
}

function getTransformStartScale(fabricObject: any, transform: any, axis: 'scaleX' | 'scaleY') {
  const fromTransform = Number(transform?.original?.[axis]);
  if (Number.isFinite(fromTransform) && Math.abs(fromTransform) > 0.0001) {
    return fromTransform;
  }

  const fromObject = Number(fabricObject?.[axis]);
  if (Number.isFinite(fromObject) && Math.abs(fromObject) > 0.0001) {
    return fromObject;
  }

  return 1;
}

function getTransformStartDimensions(fabricObject: any, transform: any) {
  const dim = fabricObject?._getTransformedDimensions?.();
  const currentWidth = Math.max(Number(dim?.x) || 0, 0.0001);
  const currentHeight = Math.max(Number(dim?.y) || 0, 0.0001);
  const currentScaleX = Math.max(Math.abs(Number(fabricObject?.scaleX) || 0), 0.0001);
  const currentScaleY = Math.max(Math.abs(Number(fabricObject?.scaleY) || 0), 0.0001);
  const originalScaleX = getTransformStartScale(fabricObject, transform, 'scaleX');
  const originalScaleY = getTransformStartScale(fabricObject, transform, 'scaleY');

  return {
    baseWidth: currentWidth * (Math.abs(originalScaleX) / currentScaleX),
    baseHeight: currentHeight * (Math.abs(originalScaleY) / currentScaleY),
    originalScaleX,
    originalScaleY,
  };
}

function getTransformMinimumDimension(fabricObject: any) {
  const zoom = Math.max(Number(fabricObject?.canvas?.getZoom?.()) || 1, 0.0001);
  return 8 / zoom;
}

function applyFabricScaleResult(
  fabricObject: any,
  scaled: { center: { x: number; y: number }; signedWidth: number; signedHeight: number },
  startDimensions: { baseWidth: number; baseHeight: number; originalScaleX: number; originalScaleY: number },
) {
  const previousScaleX = fabricObject.scaleX;
  const previousScaleY = fabricObject.scaleY;
  const nextScaleX = startDimensions.originalScaleX * (
    scaled.signedWidth / Math.max(startDimensions.baseWidth, 0.0001)
  );
  const nextScaleY = startDimensions.originalScaleY * (
    scaled.signedHeight / Math.max(startDimensions.baseHeight, 0.0001)
  );

  if (!fabricObject.lockScalingX) {
    fabricObject.set('scaleX', nextScaleX);
  }
  if (!fabricObject.lockScalingY) {
    fabricObject.set('scaleY', nextScaleY);
  }
  if (typeof fabricObject.setPositionByOrigin === 'function') {
    fabricObject.setPositionByOrigin(new Point(scaled.center.x, scaled.center.y), 'center', 'center');
  }
  fabricObject.setCoords?.();

  return previousScaleX !== fabricObject.scaleX || previousScaleY !== fabricObject.scaleY;
}

function shouldActivateScaleControl(
  controlKey: string,
  fabricObject: any,
  pointer: { x: number; y: number },
  coords: { tl: { x: number; y: number }; tr: { x: number; y: number }; br: { x: number; y: number }; bl: { x: number; y: number } },
) {
  if (fabricObject.canvas?.getActiveObject() !== fabricObject) {
    return false;
  }
  if (!fabricObject.isControlVisible(controlKey)) {
    return false;
  }
  return isPointInsideTransformHandle(pointer, getControlCenterFromCoords(coords), getCornerRadius(fabricObject));
}

function shouldActivateEdgeScaleControl(
  controlKey: string,
  fabricObject: any,
  pointer: { x: number; y: number },
) {
  if (fabricObject.canvas?.getActiveObject() !== fabricObject) {
    return false;
  }
  if (!fabricObject.isControlVisible(controlKey)) {
    return false;
  }

  const side = EDGE_CONTROL_KEY_TO_SIDE[controlKey];
  if (!side) {
    return false;
  }

  const frame = getObjectTransformFrame(fabricObject);
  if (!frame) {
    return false;
  }

  const edgeSegments = getTransformGizmoEdgeSegments(frame);
  const edgeSegment = edgeSegments[side];
  const cornerRadius = getCornerRadius(fabricObject);
  const adjacentCorners = side === 'n'
    ? [frame.corners.nw, frame.corners.ne]
    : side === 'e'
      ? [frame.corners.ne, frame.corners.se]
      : side === 's'
        ? [frame.corners.sw, frame.corners.se]
        : [frame.corners.nw, frame.corners.sw];
  if (adjacentCorners.some((cornerPoint) => isPointInsideTransformHandle(pointer, cornerPoint, cornerRadius))) {
    return false;
  }

  return isPointNearTransformEdge(pointer, edgeSegment.start, edgeSegment.end, cornerRadius);
}

function shouldActivateRotateControl(
  controlKey: string,
  fabricObject: any,
  pointer: { x: number; y: number },
  coords: { tl: { x: number; y: number }; tr: { x: number; y: number }; br: { x: number; y: number }; bl: { x: number; y: number } },
) {
  if (fabricObject.canvas?.getActiveObject() !== fabricObject) {
    return false;
  }
  if (!fabricObject.isControlVisible(controlKey)) {
    return false;
  }
  const cornerKey = controlKey.replace('_rotate', '') as keyof typeof TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER;
  const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[cornerKey];
  const rotationDegrees = typeof fabricObject?.getTotalAngle === 'function'
    ? fabricObject.getTotalAngle()
    : (Number(fabricObject?.angle) || 0);
  return isPointInsideTransformRotateRing(
    pointer,
    getControlCenterFromCoords(coords),
    getCornerRadius(fabricObject),
    corner,
    rotationDegrees * (Math.PI / 180),
  );
}

function isProportionalScale(eventData: Record<string, any>, target: any) {
  const canvas = target?.canvas as FabricCanvas | null;
  const uniformKey = canvas?.uniScaleKey ?? 'shiftKey';
  return !!eventData?.[uniformKey];
}

function isCenteredScale(eventData: Record<string, any>, target: any) {
  const canvas = target?.canvas as FabricCanvas | null;
  const centeredKey = canvas?.centeredKey ?? 'altKey';
  return !!eventData?.[centeredKey];
}

function clearFabricTransformGuide(target: any) {
  const canvas = target?.canvas as FabricCanvasWithTransformGuide | null;
  if (canvas) {
    setUnifiedCanvasTransformGuide(canvas, null);
  }
}

function setUnifiedCanvasTransformGuide(
  fabricCanvas: FabricCanvasWithTransformGuide | null,
  guide: FabricTransformGuideState | null,
) {
  if (!fabricCanvas) {
    return;
  }

  fabricCanvas.__unifiedTransformGuide = guide;
  if (fabricCanvas.__manageUnifiedTransformGuideTopLayer) {
    fabricCanvas.contextTopDirty = true;
  }
}

const unifiedCornerScaleActionHandler = controlsUtils.wrapWithFireEvent(
  'scaling',
  ((eventData: Record<string, any>, transform: any, x: number, y: number) => {
    const target = transform?.target as any;
    if (!target) {
      return false;
    }

    const centered = isCenteredScale(eventData, target);
    const scaleProportionally = isProportionalScale(eventData, target);
    const forbidScaling = (
      (target.lockScalingX && target.lockScalingY) ||
      ((!transform?.corner || scaleProportionally) && (target.lockScalingX || target.lockScalingY))
    );
    if (forbidScaling) {
      return false;
    }
    const frame = getObjectTransformFrame(target);
    if (!frame) {
      return false;
    }

    const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[transform?.corner] ?? 'se';
    const cornerConfig: Record<TransformGizmoCorner, {
      anchor: { x: number; y: number };
      handleXSign: -1 | 1;
      handleYSign: -1 | 1;
    }> = {
      nw: { anchor: frame.corners.se, handleXSign: -1, handleYSign: -1 },
      ne: { anchor: frame.corners.sw, handleXSign: 1, handleYSign: -1 },
      se: { anchor: frame.corners.nw, handleXSign: 1, handleYSign: 1 },
      sw: { anchor: frame.corners.ne, handleXSign: -1, handleYSign: 1 },
    };
    const startDimensions = getTransformStartDimensions(target, transform);
    const scaled = computeCornerScaleResult({
      referencePoint: centered ? frame.center : cornerConfig[corner].anchor,
      pointerPoint: { x, y },
      handleXSign: cornerConfig[corner].handleXSign,
      handleYSign: cornerConfig[corner].handleYSign,
      rotationRadians: -getFabricObjectRotationRadians(target),
      baseWidth: Math.max(startDimensions.baseWidth, 1),
      baseHeight: Math.max(startDimensions.baseHeight, 1),
      minWidth: getTransformMinimumDimension(target),
      minHeight: getTransformMinimumDimension(target),
      proportional: scaleProportionally,
      centered,
    });
    const changed = applyFabricScaleResult(target, scaled, startDimensions);

    const canvas = target.canvas as FabricCanvasWithTransformGuide | null;
    if (canvas) {
      setUnifiedCanvasTransformGuide(canvas, {
        corner,
        proportional: scaleProportionally,
        target,
      });
    }
    return changed;
  }) as any,
);

const rotateControlActionHandler = ((eventData: Record<string, any>, transform: any, x: number, y: number) => {
  clearFabricTransformGuide(transform?.target);
  const rotated = controlsUtils.rotationWithSnapping(eventData as any, transform, x, y);
  const target = transform?.target;
  const canvas = target?.canvas;
  const cornerKey = String(transform?.corner ?? '').replace(/_rotate$/, '');
  const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[cornerKey];
  if (rotated && canvas && corner) {
    applyCanvasCursor(canvas, getTransformGizmoRotateCursor(getFabricObjectRotationRadians(target), corner));
  }
  return rotated;
}) as any;

const unifiedEdgeScaleActionHandler = ((eventData: Record<string, any>, transform: any, x: number, y: number) => {
  const target = transform?.target as any;
  if (!target) {
    return false;
  }

  const centered = isCenteredScale(eventData, target);
  const scaleProportionally = isProportionalScale(eventData, target);
  const canvas = target?.canvas as FabricCanvasWithTransformGuide | null;
  if (canvas) {
    setUnifiedCanvasTransformGuide(canvas, {
      corner: null,
      proportional: scaleProportionally,
      target,
    });
  }
  const side = EDGE_CONTROL_KEY_TO_SIDE[transform?.corner ?? ''];
  if (!side) {
    return false;
  }

  if (scaleProportionally) {
    if (target.lockScalingX || target.lockScalingY) {
      return false;
    }
  } else if ((side === 'e' || side === 'w') && target.lockScalingX) {
    return false;
  } else if ((side === 'n' || side === 's') && target.lockScalingY) {
    return false;
  }

  const frame = getObjectTransformFrame(target);
  if (!frame) {
    return false;
  }

  const edgeSegments = getTransformGizmoEdgeSegments(frame);
  const edgeSegment = edgeSegments[side];
  const startDimensions = getTransformStartDimensions(target, transform);
  const scaled = computeEdgeScaleResult({
    referencePoint: centered ? frame.center : edgeSegments[getOppositeTransformGizmoSide(side)].center,
    pointerPoint: { x, y },
    edge: edgeSegment.edge,
    handleSign: edgeSegment.handleSign,
    rotationRadians: -getFabricObjectRotationRadians(target),
    baseWidth: Math.max(startDimensions.baseWidth, 1),
    baseHeight: Math.max(startDimensions.baseHeight, 1),
    minWidth: getTransformMinimumDimension(target),
    minHeight: getTransformMinimumDimension(target),
    proportional: scaleProportionally,
    centered,
  });
  return applyFabricScaleResult(target, scaled, startDimensions);
}) as any;

function createUnifiedScaleControl(cornerKey: keyof typeof TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER, x: number, y: number) {
  const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[cornerKey];
  return new Control({
    x,
    y,
    actionName: 'scale',
    actionHandler: unifiedCornerScaleActionHandler as any,
    cursorStyleHandler: (_eventData, _control, fabricObject) => (
      getTransformGizmoCornerCursor(corner, getFabricObjectRotationRadians(fabricObject))
    ),
    render: controlsUtils.renderCircleControl,
    shouldActivate: ((controlKey: string, fabricObject: any, pointer: any, coords: any) => (
      shouldActivateScaleControl(controlKey, fabricObject, pointer, coords)
    )) as any,
  });
}

function createUnifiedRotateControl(cornerKey: keyof typeof TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER, x: number, y: number) {
  const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[cornerKey];
  return new Control({
    x,
    y,
    actionName: 'rotate',
    actionHandler: rotateControlActionHandler,
    cursorStyleHandler: (_eventData, _control, fabricObject) => (
      getTransformGizmoRotateCursor(getFabricObjectRotationRadians(fabricObject), corner)
    ),
    render: () => undefined,
    shouldActivate: ((controlKey: string, fabricObject: any, pointer: any, coords: any) => (
      shouldActivateRotateControl(controlKey, fabricObject, pointer, coords)
    )) as any,
  });
}

function createUnifiedEdgeScaleControl(controlKey: keyof typeof EDGE_CONTROL_KEY_TO_SIDE, x: number, y: number) {
  const side = EDGE_CONTROL_KEY_TO_SIDE[controlKey];
  return new Control({
    x,
    y,
    actionName: 'scale',
    actionHandler: unifiedEdgeScaleActionHandler,
    cursorStyleHandler: (_eventData, _control, fabricObject) => (
      getTransformGizmoEdgeCursor(side === 'n' || side === 's' ? 'vertical' : 'horizontal', getFabricObjectRotationRadians(fabricObject))
    ),
    render: () => undefined,
    shouldActivate: ((controlName: string, fabricObject: any, pointer: any) => (
      shouldActivateEdgeScaleControl(controlName, fabricObject, pointer)
    )) as any,
  });
}

export function createUnifiedObjectTransformControls() {
  return {
    tl: createUnifiedScaleControl('tl', -0.5, -0.5),
    tr: createUnifiedScaleControl('tr', 0.5, -0.5),
    br: createUnifiedScaleControl('br', 0.5, 0.5),
    bl: createUnifiedScaleControl('bl', -0.5, 0.5),
    mt: createUnifiedEdgeScaleControl('mt', 0, -0.5),
    mr: createUnifiedEdgeScaleControl('mr', 0.5, 0),
    mb: createUnifiedEdgeScaleControl('mb', 0, 0.5),
    ml: createUnifiedEdgeScaleControl('ml', -0.5, 0),
    tl_rotate: createUnifiedRotateControl('tl', -0.5, -0.5),
    tr_rotate: createUnifiedRotateControl('tr', 0.5, -0.5),
    br_rotate: createUnifiedRotateControl('br', 0.5, 0.5),
    bl_rotate: createUnifiedRotateControl('bl', -0.5, 0.5),
  } satisfies Record<string, Control>;
}

export function applyUnifiedFabricTransformCanvasOptions(fabricCanvas: FabricCanvas) {
  fabricCanvas.uniformScaling = false;
  fabricCanvas.uniScaleKey = 'shiftKey';
  fabricCanvas.centeredScaling = false;
  fabricCanvas.centeredKey = 'altKey';
}

export function applyUnifiedObjectTransformGizmoAppearance(
  object: FabricObjectWithTransformGizmo | null | undefined,
  getZoomInvariantMetric: (metric: number, zoom?: number) => number,
  zoom: number,
) {
  if (!object) {
    return;
  }

  object.borderColor = HIDDEN_SELECTION_COLOR;
  object.borderScaleFactor = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE, zoom);
  object.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
  object.cornerStyle = 'circle';
  object.cornerColor = HIDDEN_SELECTION_COLOR;
  object.cornerStrokeColor = HIDDEN_SELECTION_COLOR;
  object.cornerSize = getZoomInvariantMetric(TRANSFORM_GIZMO_HANDLE_RADIUS * 2, zoom);
  object.touchCornerSize = getZoomInvariantMetric((TRANSFORM_GIZMO_HANDLE_RADIUS + 16) * 2, zoom);
  object.transparentCorners = false;
  object.padding = getZoomInvariantMetric(OBJECT_SELECTION_PADDING, zoom);
  object.selectionBackgroundColor = 'transparent';
  object.controls = createUnifiedObjectTransformControls();
  object.setCoords?.();
}

export function clearUnifiedCanvasTransformGuide(fabricCanvas: FabricCanvas | null, renderTop: boolean = false) {
  const instrumentedCanvas = fabricCanvas as FabricCanvasWithTransformGuide | null;
  if (!instrumentedCanvas) {
    return;
  }

  setUnifiedCanvasTransformGuide(instrumentedCanvas, null);
  if (renderTop && instrumentedCanvas.__manageUnifiedTransformGuideTopLayer) {
    instrumentedCanvas.renderTop?.();
  }
}

export function renderUnifiedCanvasTransformGuide(fabricCanvas: FabricCanvas | null) {
  const instrumentedCanvas = fabricCanvas as FabricCanvasWithTransformGuide | null;
  const guide = instrumentedCanvas?.__unifiedTransformGuide;
  const ctx = fabricCanvas?.contextTop;
  if (!ctx || !guide?.proportional || !guide.target?.oCoords) {
    return;
  }

  const corners = {
    nw: guide.target.oCoords.tl,
    ne: guide.target.oCoords.tr,
    se: guide.target.oCoords.br,
    sw: guide.target.oCoords.bl,
  };
  const diagonal = getTransformCornerDiagonal(corners, guide.corner ?? 'nw');
  drawTransformProportionalGuide(ctx, diagonal.start, diagonal.end);
}

export function syncUnifiedCanvasTransformGuideFromEvent(fabricCanvas: FabricCanvas | null, eventData: Record<string, any> | null | undefined) {
  const activeObject = fabricCanvas?.getActiveObject() as any;
  if (!activeObject) {
    clearUnifiedCanvasTransformGuide(fabricCanvas);
    return;
  }

  const currentTransform = (fabricCanvas as any)?._currentTransform;
  if (!currentTransform) {
    clearUnifiedCanvasTransformGuide(fabricCanvas);
    return;
  }

  const cornerKey = currentTransform.corner;
  const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[cornerKey];
  const isEdgeScale = Boolean(EDGE_CONTROL_KEY_TO_SIDE[cornerKey]);
  if (!corner && !isEdgeScale) {
    clearUnifiedCanvasTransformGuide(fabricCanvas);
    return;
  }

  setUnifiedCanvasTransformGuide(fabricCanvas as FabricCanvasWithTransformGuide, {
    corner: corner ?? null,
    proportional: isProportionalScale(eventData ?? {}, activeObject),
    target: activeObject,
  });
}

export function configureUnifiedObjectTransformForGesture(
  fabricCanvas: FabricCanvas | null,
  eventData: Record<string, any> | null | undefined,
) {
  const activeObject = fabricCanvas?.getActiveObject() as any;
  if (!activeObject) {
    return;
  }
  activeObject.centeredScaling = isCenteredScale(eventData ?? {}, activeObject);
}

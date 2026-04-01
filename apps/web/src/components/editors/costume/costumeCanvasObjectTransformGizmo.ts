import { Control, controlsUtils, type Canvas as FabricCanvas } from 'fabric';
import {
  TRANSFORM_GIZMO_BORDER_COLOR,
  TRANSFORM_GIZMO_HANDLE_FILL,
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  TRANSFORM_GIZMO_HANDLE_STROKE,
  drawTransformProportionalGuide,
  getTransformCornerDiagonal,
  getTransformGizmoCornerCursor,
  getTransformGizmoEdgeCursor,
  getTransformGizmoEdgeSegments,
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
  corner: TransformGizmoCorner;
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

const EDGE_CONTROL_KEY_TO_SIDE: Record<string, TransformGizmoSide> = {
  mt: 'n',
  mr: 'e',
  mb: 's',
  ml: 'w',
};

function invertTransformOrigin(origin: unknown) {
  switch (origin) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    default:
      return origin;
  }
}

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

function isTransformCentered(transform: { originX?: string; originY?: string }) {
  return transform.originX === 'center' && transform.originY === 'center';
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
  controlsUtils.wrapWithFixedAnchor((eventData: Record<string, any>, transform: any, x: number, y: number) => {
    const target = transform?.target as any;
    if (!target) {
      return false;
    }

    const scaleProportionally = isProportionalScale(eventData, target);
    const forbidScaling = (
      (target.lockScalingX && target.lockScalingY) ||
      ((!transform?.corner || scaleProportionally) && (target.lockScalingX || target.lockScalingY))
    );
    if (forbidScaling) {
      return false;
    }

    const newPoint = controlsUtils.getLocalPoint(transform, transform.originX, transform.originY, x, y);
    const signX = Math.sign(newPoint.x || transform.signX || 1);
    const signY = Math.sign(newPoint.y || transform.signY || 1);
    if (!transform.signX) {
      transform.signX = signX;
    }
    if (!transform.signY) {
      transform.signY = signY;
    }

    if (
      target.lockScalingFlip &&
      (transform.signX !== signX || transform.signY !== signY)
    ) {
      return false;
    }

    const dim = target._getTransformedDimensions();
    const original = transform.original;
    let scaleX = Math.abs((newPoint.x * target.scaleX) / dim.x);
    let scaleY = Math.abs((newPoint.y * target.scaleY) / dim.y);

    if (scaleProportionally) {
      const distance = Math.abs(newPoint.x) + Math.abs(newPoint.y);
      const originalDistance = (
        Math.abs((dim.x * original.scaleX) / target.scaleX) +
        Math.abs((dim.y * original.scaleY) / target.scaleY)
      );
      const scale = distance / Math.max(originalDistance, 0.0001);
      scaleX = original.scaleX * scale;
      scaleY = original.scaleY * scale;
    }

    if (isTransformCentered(transform)) {
      scaleX *= 2;
      scaleY *= 2;
    }

    if (transform.signX !== signX) {
      transform.originX = invertTransformOrigin(transform.originX);
      scaleX *= -1;
      transform.signX = signX;
    }
    if (transform.signY !== signY) {
      transform.originY = invertTransformOrigin(transform.originY);
      scaleY *= -1;
      transform.signY = signY;
    }

    const previousScaleX = target.scaleX;
    const previousScaleY = target.scaleY;
    if (!target.lockScalingX) {
      target.set('scaleX', scaleX);
    }
    if (!target.lockScalingY) {
      target.set('scaleY', scaleY);
    }

    const corner = TRANSFORM_CORNER_KEY_TO_GIZMO_CORNER[transform.corner] ?? 'se';
    const canvas = target.canvas as FabricCanvasWithTransformGuide | null;
    if (canvas) {
      setUnifiedCanvasTransformGuide(canvas, {
        corner,
        proportional: scaleProportionally,
        target,
      });
    }
    return previousScaleX !== target.scaleX || previousScaleY !== target.scaleY;
  }),
);

const rotateControlActionHandler = ((eventData: Record<string, any>, transform: any, x: number, y: number) => {
  clearFabricTransformGuide(transform?.target);
  const rotated = controlsUtils.rotationWithSnapping(eventData, transform, x, y);
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
  clearFabricTransformGuide(transform?.target);
  const side = EDGE_CONTROL_KEY_TO_SIDE[transform?.corner ?? ''];
  if (!side) {
    return false;
  }
  if (isProportionalScale(eventData, transform?.target)) {
    return controlsUtils.scalingEqually(eventData, transform, x, y);
  }
  return side === 'e' || side === 'w'
    ? controlsUtils.scalingX(eventData, transform, x, y)
    : controlsUtils.scalingY(eventData, transform, x, y);
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

  object.borderColor = TRANSFORM_GIZMO_BORDER_COLOR;
  object.borderScaleFactor = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE, zoom);
  object.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
  object.cornerStyle = 'circle';
  object.cornerColor = TRANSFORM_GIZMO_HANDLE_FILL;
  object.cornerStrokeColor = TRANSFORM_GIZMO_HANDLE_STROKE;
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
  const diagonal = getTransformCornerDiagonal(corners, guide.corner);
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
  if (!corner) {
    clearUnifiedCanvasTransformGuide(fabricCanvas);
    return;
  }

  setUnifiedCanvasTransformGuide(fabricCanvas as FabricCanvasWithTransformGuide, {
    corner,
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

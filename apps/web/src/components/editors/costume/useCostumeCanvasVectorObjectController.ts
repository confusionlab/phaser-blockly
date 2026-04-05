import { useCallback, type MutableRefObject } from 'react';
import { Path, Point, controlsUtils, type Canvas as FabricCanvas, type Control } from 'fabric';
import type { CostumeEditorMode } from '@/types';
import { fabricCanvasContainsObject } from '@/lib/editor/fabricVectorSelection';
import {
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  type TransformGizmoCorner,
} from '@/lib/editor/unifiedTransformGizmo';
import type { DrawingTool, VectorHandleMode, VectorPathNodeHandleType } from './CostumeToolbar';
import { vectorHandleModeToPathNodeHandleType } from './CostumeToolbar';
import { renderScreenSpaceTransformOverlay } from '@/lib/editor/transformOverlayRenderer';
import {
  HANDLE_SIZE,
  type MirroredPathAnchorDragSession,
  type MirroredPathAnchorHandleRole,
  VECTOR_POINT_EDIT_GUIDE_STROKE,
  VECTOR_POINT_EDIT_GUIDE_STROKE_WIDTH,
  VECTOR_POINT_HANDLE_GUIDE_STROKE,
  VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH,
  VECTOR_SELECTION_BORDER_SCALE,
  VECTOR_SELECTION_CORNER_COLOR,
  VECTOR_SELECTION_CORNER_STROKE,
  VECTOR_SELECTION_COLOR,
  getEditableVectorHandleMode,
  resolvePathNodeHandleTypeForControlDrag,
} from './costumeCanvasShared';
import {
  getFabricFillValueForVectorTexture,
  getFabricObjectType,
  getFabricStrokeValueForVectorBrush,
  getVectorObjectFillColor,
  getVectorObjectFillOpacity,
  getVectorObjectFillTextureId,
  getVectorObjectStrokeBrushId,
  getVectorObjectStrokeColor,
  getVectorObjectStrokeOpacity,
  isActiveSelectionObject,
  isDirectlyEditablePathObject,
  isImageObject,
  isTextObject,
  isVectorPointSelectableObject,
  VECTOR_POINT_CONTROL_STYLE,
} from './costumeCanvasVectorRuntime';
import { getResolvedEditorSelectionTokens } from '@/lib/ui/editorSelectionTokens';

interface UseCostumeCanvasVectorObjectControllerOptions {
  activePathAnchorRef: MutableRefObject<{ path: any; anchorIndex: number } | null>;
  activeToolRef: MutableRefObject<DrawingTool>;
  applyOverlaySceneTransform: (ctx: CanvasRenderingContext2D, fabricCanvas: FabricCanvas) => void;
  applyMirroredPathAnchorCurveDragSession: (
    session: MirroredPathAnchorDragSession,
    pointerScene: Point,
  ) => boolean;
  buildPathDataFromPoints: (points: Point[], closed: boolean) => string;
  createFourPointEllipsePathData: (obj: any) => string | null;
  clearOverlayContext: (ctx: CanvasRenderingContext2D) => void;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  enforcePathAnchorHandleType: (pathObj: any, anchorIndex: number, changed: any, dragState?: any) => void;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  findIncomingCubicCommandIndex: (pathObj: any, anchorIndex: number) => number;
  findOutgoingCubicCommandIndex: (pathObj: any, anchorIndex: number) => number;
  getAnchorPointForIndex: (pathObj: any, anchorIndex: number) => Point | null;
  getCommandType: (command: any) => string;
  getPathAnchorDragState: (pathObj: any, anchorIndex: number) => any;
  getPathNodeHandleType: (pathObj: any, anchorIndex: number) => VectorPathNodeHandleType | null;
  getPointSelectionTransformHandlePoints: (bounds: any) => any;
  getSceneRectFromPoints: (startPoint: Point, endPoint: Point) => { left: number; top: number; width: number; height: number };
  getSelectedPathAnchorIndices: (pathObj: any) => number[];
  getSelectedPathAnchorTransformSnapshot: (pathObj: any) => any;
  getZoomInvariantMetric: (value: number, zoom?: number) => number;
  hasPointSelectionMarqueeExceededThreshold: (session: any) => boolean;
  isPathCurveDragModifierPressed: (eventData: any) => boolean;
  isPointSelectionToggleModifierPressed: (eventData: any) => boolean;
  mapFabricOverlayPoint: (point: Point) => Point;
  movePathAnchorByDelta: (pathObj: any, anchorIndex: number, deltaX: number, deltaY: number, dragState?: any) => boolean;
  mirroredPathAnchorDragSessionRef: MutableRefObject<MirroredPathAnchorDragSession | null>;
  originalControlsRef: MutableRefObject<WeakMap<object, Record<string, Control> | undefined>>;
  pointSelectionMarqueeSessionRef: MutableRefObject<any>;
  pointSelectionTransformSessionRef?: MutableRefObject<any>;
  removeDuplicateClosedPathAnchorControl: (pathObj: any, controls: Record<string, Control>) => void;
  renderPenDraftGuide: (ctx: CanvasRenderingContext2D) => void;
  resolveMirroredPathAnchorHandleRole: (
    pathObj: any,
    anchorIndex: number,
    changed: 'anchor' | 'incoming' | 'outgoing',
  ) => MirroredPathAnchorHandleRole;
  resolveAnchorFromPathControlKey: (pathObj: any, key: string) => { anchorIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null;
  restoreOriginalControls: (obj: any) => void;
  setPathNodeHandleType: (pathObj: any, anchorIndex: number, type: VectorPathNodeHandleType) => void;
  setSelectedPathAnchors: (pathObj: any, anchorIndices: number[], options?: { primaryAnchorIndex?: number | null }) => void;
  stabilizePathAfterAnchorMutation: (pathObj: any, anchorPoint: Point) => void;
  syncPathAnchorSelectionAppearance: (pathObj: any) => void;
  syncPathControlPointVisibility: (pathObj: any) => void;
  syncVectorHandleModeFromSelection: () => void;
  toCanvasPoint: (obj: any, x: number, y: number) => Point;
  vectorGuideCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  vectorHandleModeRef: MutableRefObject<VectorHandleMode>;
  hoveredVectorTargetRef?: MutableRefObject<any | null>;
  vectorPointEditingTargetRef: MutableRefObject<any | null>;
}

export function useCostumeCanvasVectorObjectController({
  activePathAnchorRef,
  activeToolRef,
  applyOverlaySceneTransform,
  applyMirroredPathAnchorCurveDragSession,
  buildPathDataFromPoints,
  createFourPointEllipsePathData,
  clearOverlayContext,
  editorModeRef,
  enforcePathAnchorHandleType,
  fabricCanvasRef,
  findIncomingCubicCommandIndex,
  findOutgoingCubicCommandIndex,
  getAnchorPointForIndex,
  getCommandType,
  getPathAnchorDragState,
  getPathNodeHandleType,
  getPointSelectionTransformHandlePoints,
  getSceneRectFromPoints,
  getSelectedPathAnchorIndices,
  getSelectedPathAnchorTransformSnapshot,
  getZoomInvariantMetric,
  hasPointSelectionMarqueeExceededThreshold,
  isPathCurveDragModifierPressed,
  isPointSelectionToggleModifierPressed,
  mapFabricOverlayPoint,
  movePathAnchorByDelta,
  mirroredPathAnchorDragSessionRef,
  originalControlsRef,
  pointSelectionMarqueeSessionRef,
  pointSelectionTransformSessionRef,
  removeDuplicateClosedPathAnchorControl,
  renderPenDraftGuide,
  resolveMirroredPathAnchorHandleRole,
  resolveAnchorFromPathControlKey,
  restoreOriginalControls,
  setPathNodeHandleType,
  setSelectedPathAnchors,
  stabilizePathAfterAnchorMutation,
  syncPathAnchorSelectionAppearance,
  syncPathControlPointVisibility,
  syncVectorHandleModeFromSelection,
  toCanvasPoint,
  vectorGuideCtxRef,
  vectorHandleModeRef,
  hoveredVectorTargetRef,
  vectorPointEditingTargetRef,
}: UseCostumeCanvasVectorObjectControllerOptions) {
  const isVectorHandleIndependenceModifierPressed = useCallback((eventData: any) => {
    const source = eventData?.e ?? eventData;
    return !!source?.altKey;
  }, []);

  const sampleObjectOutlinePoints = useCallback((obj: any): { points: Point[]; closed: boolean } | null => {
    const type = getFabricObjectType(obj);
    if (!type) return null;

    if (type === 'line' && typeof obj.calcLinePoints === 'function') {
      const linePoints = obj.calcLinePoints() as { x1: number; y1: number; x2: number; y2: number };
      return {
        points: [
          toCanvasPoint(obj, linePoints.x1, linePoints.y1),
          toCanvasPoint(obj, linePoints.x2, linePoints.y2),
        ],
        closed: false,
      };
    }

    if ((type === 'polygon' || type === 'polyline') && Array.isArray(obj.points)) {
      const pathOffset = obj.pathOffset ?? { x: 0, y: 0 };
      return {
        points: obj.points.map((point: { x: number; y: number }) => (
          toCanvasPoint(obj, point.x - pathOffset.x, point.y - pathOffset.y)
        )),
        closed: type === 'polygon',
      };
    }

    if (typeof obj.getCoords === 'function') {
      const coords = obj.getCoords() as Array<{ x: number; y: number }> | undefined;
      if (Array.isArray(coords) && coords.length >= 2) {
        return {
          points: coords.map((coord) => new Point(coord.x, coord.y)),
          closed: coords.length >= 3,
        };
      }
    }

    return null;
  }, [toCanvasPoint]);

  const convertObjectToVectorPath = useCallback((obj: any): any | null => {
    if (!obj || !isVectorPointSelectableObject(obj)) return null;
    if (isDirectlyEditablePathObject(obj)) return obj;

    const type = getFabricObjectType(obj);
    let pathData = '';
    let shouldFill = false;
    let initialNodeHandleTypes: Record<string, VectorPathNodeHandleType> = {};
    if (type === 'ellipse' || type === 'circle') {
      pathData = createFourPointEllipsePathData(obj) ?? '';
      shouldFill = true;
      initialNodeHandleTypes = {
        '0': 'symmetric',
        '1': 'symmetric',
        '2': 'symmetric',
        '3': 'symmetric',
      };
    } else {
      const sampled = sampleObjectOutlinePoints(obj);
      if (!sampled || sampled.points.length < 2) return null;
      pathData = buildPathDataFromPoints(sampled.points, sampled.closed);
      shouldFill = sampled.closed;
      if (sampled.closed) {
        for (let i = 0; i < sampled.points.length; i += 1) {
          initialNodeHandleTypes[String(i)] = 'corner';
        }
      } else {
        initialNodeHandleTypes = { '0': 'linear', '1': 'linear' };
      }
    }
    if (!pathData) return null;

    const fillColor = getVectorObjectFillColor(obj) ?? (typeof obj.fill === 'string' ? obj.fill : '#000000');
    const fillOpacity = getVectorObjectFillOpacity(obj) ?? 1;
    const fillTextureId = getVectorObjectFillTextureId(obj);
    const strokeColor = getVectorObjectStrokeColor(obj) ?? fillColor;
    const strokeOpacity = getVectorObjectStrokeOpacity(obj) ?? 1;
    const strokeBrushId = getVectorObjectStrokeBrushId(obj);
    const path = new Path(pathData, {
      fill: shouldFill ? getFabricFillValueForVectorTexture(fillTextureId, fillColor, fillOpacity) : null,
      stroke: getFabricStrokeValueForVectorBrush(strokeBrushId, strokeColor, strokeOpacity),
      strokeWidth: typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
      strokeUniform: true,
      noScaleCache: false,
      strokeLineCap: obj.strokeLineCap,
      strokeLineJoin: obj.strokeLineJoin,
      strokeMiterLimit: obj.strokeMiterLimit,
      strokeDashArray: Array.isArray(obj.strokeDashArray) ? [...obj.strokeDashArray] : null,
      opacity: 1,
      globalCompositeOperation: obj.globalCompositeOperation ?? 'source-over',
      fillRule: obj.fillRule,
      paintFirst: obj.paintFirst,
      shadow: obj.shadow ?? null,
      nodeHandleTypes: initialNodeHandleTypes,
      vectorFillTextureId: shouldFill ? fillTextureId : undefined,
      vectorFillColor: shouldFill ? fillColor : undefined,
      vectorFillOpacity: shouldFill ? fillOpacity : undefined,
      vectorStrokeBrushId: strokeBrushId,
      vectorStrokeColor: strokeColor,
      vectorStrokeOpacity: strokeOpacity,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
    } as any);
    path.setCoords();
    return path;
  }, [buildPathDataFromPoints, createFourPointEllipsePathData, sampleObjectOutlinePoints]);

  const ensurePathLikeObjectForVectorTool = useCallback((obj: any): any | null => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !obj || !isVectorPointSelectableObject(obj)) return null;
    if (isDirectlyEditablePathObject(obj)) return obj;

    const converted = convertObjectToVectorPath(obj);
    if (!converted) return null;
    if (converted === obj) return obj;

    restoreOriginalControls(obj);
    const stack = fabricCanvas.getObjects();
    const originalObject = obj as any;
    const index = stack.indexOf(originalObject);
    fabricCanvas.remove(originalObject);
    if (index >= 0) {
      fabricCanvas.insertAt(index, converted);
    } else {
      fabricCanvas.add(converted);
    }
    converted.setCoords();
    return converted;
  }, [convertObjectToVectorPath, fabricCanvasRef, restoreOriginalControls]);

  const applyVectorPointEditingAppearance = useCallback((obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    obj.hasControls = true;
    obj.hasBorders = false;
    obj.borderColor = 'rgba(0, 0, 0, 0)';
    obj.cornerStyle = 'circle';
    obj.cornerColor = 'rgba(0, 0, 0, 0)';
    obj.cornerStrokeColor = 'rgba(0, 0, 0, 0)';
    obj.cornerSize = getZoomInvariantMetric(HANDLE_SIZE);
    obj.transparentCorners = false;
    obj.padding = 0;
    obj.lockMovementX = true;
    obj.lockMovementY = true;
    obj.lockRotation = true;
    obj.lockScalingX = true;
    obj.lockScalingY = true;
  }, [getZoomInvariantMetric]);

  const traceVectorPointEditingGuidePath = useCallback((ctx: CanvasRenderingContext2D, target: any): boolean => {
    const type = getFabricObjectType(target);
    if (type === 'path' && Array.isArray(target.path)) {
      const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
      const toTransformedPoint = (x: number, y: number) => (
        toCanvasPoint(target, x - pathOffset.x, y - pathOffset.y)
      );
      ctx.beginPath();
      for (const command of target.path as any[]) {
        if (!Array.isArray(command) || typeof command[0] !== 'string') continue;
        switch (command[0].toUpperCase()) {
          case 'M': {
            const point = toTransformedPoint(Number(command[1]), Number(command[2]));
            ctx.moveTo(point.x, point.y);
            break;
          }
          case 'L': {
            const point = toTransformedPoint(Number(command[1]), Number(command[2]));
            ctx.lineTo(point.x, point.y);
            break;
          }
          case 'C': {
            const control1 = toTransformedPoint(Number(command[1]), Number(command[2]));
            const control2 = toTransformedPoint(Number(command[3]), Number(command[4]));
            const point = toTransformedPoint(Number(command[5]), Number(command[6]));
            ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, point.x, point.y);
            break;
          }
          case 'Q': {
            const control = toTransformedPoint(Number(command[1]), Number(command[2]));
            const point = toTransformedPoint(Number(command[3]), Number(command[4]));
            ctx.quadraticCurveTo(control.x, control.y, point.x, point.y);
            break;
          }
          case 'Z':
            ctx.closePath();
            break;
        }
      }
      return true;
    }

    if (type !== 'polyline' && type !== 'polygon') {
      return false;
    }

    const points = Array.isArray(target.points) ? target.points : null;
    if (!points || points.length === 0) {
      return false;
    }

    const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
    ctx.beginPath();
    points.forEach((point: { x: number; y: number }, index: number) => {
      const canvasPoint = toCanvasPoint(target, point.x - pathOffset.x, point.y - pathOffset.y);
      if (index === 0) {
        ctx.moveTo(canvasPoint.x, canvasPoint.y);
      } else {
        ctx.lineTo(canvasPoint.x, canvasPoint.y);
      }
    });
    if (type === 'polygon') {
      ctx.closePath();
    }

    return true;
  }, [toCanvasPoint]);

  const renderVectorPointHandleGuides = useCallback((ctx: CanvasRenderingContext2D, target: any) => {
    if (getFabricObjectType(target) !== 'path' || !Array.isArray(target.path)) return;

    const selectedAnchors = getSelectedPathAnchorIndices(target);
    if (selectedAnchors.length === 0) return;

    const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
    const toTransformedPoint = (point: Point) => (
      toCanvasPoint(target, point.x - pathOffset.x, point.y - pathOffset.y)
    );

    ctx.save();
    try {
      ctx.strokeStyle = VECTOR_POINT_HANDLE_GUIDE_STROKE;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      for (const anchorIndex of selectedAnchors) {
        const handleType = getPathNodeHandleType(target, anchorIndex) ?? 'linear';
        const isCurvedHandleType = handleType === 'smooth' || handleType === 'symmetric' || handleType === 'corner';
        if (!isCurvedHandleType) continue;

        const anchorPoint = getAnchorPointForIndex(target, anchorIndex);
        if (!anchorPoint) continue;
        const anchorCanvasPoint = toTransformedPoint(anchorPoint);

        const incomingCommandIndex = findIncomingCubicCommandIndex(target, anchorIndex);
        if (incomingCommandIndex >= 0) {
          const incomingCommand = target.path[incomingCommandIndex];
          if (getCommandType(incomingCommand) === 'C') {
            const incomingPoint = new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
            const incomingCanvasPoint = toTransformedPoint(incomingPoint);
            ctx.beginPath();
            ctx.moveTo(anchorCanvasPoint.x, anchorCanvasPoint.y);
            ctx.lineTo(incomingCanvasPoint.x, incomingCanvasPoint.y);
            ctx.stroke();
          }
        }

        const outgoingCommandIndex = findOutgoingCubicCommandIndex(target, anchorIndex);
        if (outgoingCommandIndex >= 0) {
          const outgoingCommand = target.path[outgoingCommandIndex];
          if (getCommandType(outgoingCommand) === 'C') {
            const outgoingPoint = new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
            const outgoingCanvasPoint = toTransformedPoint(outgoingPoint);
            ctx.beginPath();
            ctx.moveTo(anchorCanvasPoint.x, anchorCanvasPoint.y);
            ctx.lineTo(outgoingCanvasPoint.x, outgoingCanvasPoint.y);
            ctx.stroke();
          }
        }
      }
    } finally {
      ctx.restore();
    }
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    getZoomInvariantMetric,
    toCanvasPoint,
  ]);

  const renderPointSelectionTransformGuides = useCallback((ctx: CanvasRenderingContext2D, target: any) => {
    if (pointSelectionMarqueeSessionRef.current) return;
    const snapshot = getSelectedPathAnchorTransformSnapshot(target);
    if (!snapshot) return;

    const handlePoints = getPointSelectionTransformHandlePoints(snapshot.bounds);
    const activeTransform = pointSelectionTransformSessionRef?.current;
    const proportionalCorner = (
      activeTransform?.path === target &&
      activeTransform.corner &&
      activeTransform.proportional
    ) ? activeTransform.corner : null;
    const proportionalGuide = !!(
      activeTransform?.path === target &&
      activeTransform.proportional
    );

    renderScreenSpaceTransformOverlay(ctx, handlePoints.corners, {
      proportionalGuide,
      corner: proportionalCorner,
      handleRadius: getZoomInvariantMetric(TRANSFORM_GIZMO_HANDLE_RADIUS),
      showFill: false,
      strokeWidth: getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE),
    });
  }, [
    getPointSelectionTransformHandlePoints,
    getSelectedPathAnchorTransformSnapshot,
    getZoomInvariantMetric,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformSessionRef,
  ]);

  const renderPointSelectionMarquee = useCallback((ctx: CanvasRenderingContext2D) => {
    const session = pointSelectionMarqueeSessionRef.current;
    if (!session) return;
    if (!hasPointSelectionMarqueeExceededThreshold(session)) return;

    const marqueeBounds = getSceneRectFromPoints(session.startPointerScene, session.currentPointerScene);
    const selectionTokens = getResolvedEditorSelectionTokens();

    ctx.save();
    try {
      ctx.fillStyle = selectionTokens.fill;
      ctx.strokeStyle = selectionTokens.accent;
      ctx.lineWidth = getZoomInvariantMetric(2);
      ctx.setLineDash([getZoomInvariantMetric(6), getZoomInvariantMetric(4)]);
      ctx.fillRect(marqueeBounds.left, marqueeBounds.top, marqueeBounds.width, marqueeBounds.height);
      ctx.strokeRect(marqueeBounds.left, marqueeBounds.top, marqueeBounds.width, marqueeBounds.height);
      ctx.setLineDash([]);
    } finally {
      ctx.restore();
    }
  }, [
    getSceneRectFromPoints,
    getZoomInvariantMetric,
    hasPointSelectionMarqueeExceededThreshold,
    pointSelectionMarqueeSessionRef,
  ]);

  const renderVectorPointControlOverlay = useCallback((ctx: CanvasRenderingContext2D, target: any) => {
    if (getFabricObjectType(target) !== 'path' || !target.controls) return;

    const pathOffset = target.pathOffset ?? { x: 0, y: 0 };
    const toTransformedPoint = (point: Point) => (
      toCanvasPoint(target, point.x - pathOffset.x, point.y - pathOffset.y)
    );
    const handleRadius = getZoomInvariantMetric(HANDLE_SIZE) * 0.5;

    ctx.save();
    try {
      for (const key of Object.keys(target.controls as Record<string, Control>)) {
        const resolved = resolveAnchorFromPathControlKey(target, key);
        if (!resolved) continue;
        const isVisible = typeof target.isControlVisible === 'function'
          ? target.isControlVisible(key)
          : (target.controls as Record<string, Control>)[key]?.visible !== false;
        if (!isVisible) continue;

        let point: Point | null = null;
        if (resolved.changed === 'anchor') {
          point = getAnchorPointForIndex(target, resolved.anchorIndex);
          if (point) {
            ctx.fillStyle = VECTOR_SELECTION_CORNER_COLOR;
            ctx.strokeStyle = VECTOR_SELECTION_CORNER_STROKE;
          }
        } else if (resolved.changed === 'incoming') {
          const incomingCommandIndex = findIncomingCubicCommandIndex(target, resolved.anchorIndex);
          const incomingCommand = incomingCommandIndex >= 0 ? target.path?.[incomingCommandIndex] : null;
          if (incomingCommand && getCommandType(incomingCommand) === 'C') {
            point = new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
            ctx.fillStyle = VECTOR_SELECTION_COLOR;
            ctx.strokeStyle = VECTOR_SELECTION_CORNER_COLOR;
          }
        } else if (resolved.changed === 'outgoing') {
          const outgoingCommandIndex = findOutgoingCubicCommandIndex(target, resolved.anchorIndex);
          const outgoingCommand = outgoingCommandIndex >= 0 ? target.path?.[outgoingCommandIndex] : null;
          if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
            point = new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
            ctx.fillStyle = VECTOR_SELECTION_COLOR;
            ctx.strokeStyle = VECTOR_SELECTION_CORNER_COLOR;
          }
        }

        if (!point) continue;
        const canvasPoint = toTransformedPoint(point);
        ctx.lineWidth = getZoomInvariantMetric(2);
        ctx.beginPath();
        ctx.arc(canvasPoint.x, canvasPoint.y, handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getZoomInvariantMetric,
    resolveAnchorFromPathControlKey,
    toCanvasPoint,
  ]);

  const renderActiveObjectTransformOverlay = useCallback((ctx: CanvasRenderingContext2D, fabricCanvas: FabricCanvas) => {
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || activeObject === vectorPointEditingTargetRef.current) {
      return;
    }

    const coords = activeObject.oCoords;
    if (!coords?.tl || !coords?.tr || !coords?.br || !coords?.bl) {
      return;
    }

    const guideState = (fabricCanvas as FabricCanvas & {
      __unifiedTransformGuide?: {
        corner: TransformGizmoCorner | null;
        proportional: boolean;
        target: any | null;
      } | null;
    }).__unifiedTransformGuide;

    renderScreenSpaceTransformOverlay(ctx, {
      nw: mapFabricOverlayPoint(new Point(coords.tl.x, coords.tl.y)),
      ne: mapFabricOverlayPoint(new Point(coords.tr.x, coords.tr.y)),
      se: mapFabricOverlayPoint(new Point(coords.br.x, coords.br.y)),
      sw: mapFabricOverlayPoint(new Point(coords.bl.x, coords.bl.y)),
    }, {
      proportionalGuide: !!guideState?.proportional && guideState.target === activeObject,
      corner: guideState?.proportional && guideState.target === activeObject ? guideState.corner : null,
    });
  }, [mapFabricOverlayPoint, vectorPointEditingTargetRef]);

  const renderHoveredObjectOutline = useCallback((ctx: CanvasRenderingContext2D, fabricCanvas: FabricCanvas) => {
    const hoveredTarget = hoveredVectorTargetRef?.current as any;
    if (!hoveredTarget || hoveredTarget === vectorPointEditingTargetRef.current) {
      return;
    }
    if (!fabricCanvasContainsObject(fabricCanvas, hoveredTarget)) {
      return;
    }

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (activeObject === hoveredTarget) {
      return;
    }
    if (isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function') {
      const selectedObjects = activeObject.getObjects() as any[];
      if (selectedObjects.includes(hoveredTarget)) {
        return;
      }
    }

    const coords = typeof hoveredTarget.getCoords === 'function'
      ? hoveredTarget.getCoords() as Array<{ x: number; y: number }> | undefined
      : null;
    if (!Array.isArray(coords) || coords.length < 4) {
      return;
    }

    renderScreenSpaceTransformOverlay(ctx, {
      nw: mapFabricOverlayPoint(new Point(coords[0].x, coords[0].y)),
      ne: mapFabricOverlayPoint(new Point(coords[1].x, coords[1].y)),
      se: mapFabricOverlayPoint(new Point(coords[2].x, coords[2].y)),
      sw: mapFabricOverlayPoint(new Point(coords[3].x, coords[3].y)),
    }, {
      showFill: false,
      showHandles: false,
      strokeWidth: getZoomInvariantMetric(1.5),
    });
  }, [
    getZoomInvariantMetric,
    hoveredVectorTargetRef,
    mapFabricOverlayPoint,
    vectorPointEditingTargetRef,
  ]);

  const renderVectorPointEditingGuide = useCallback(() => {
    const ctx = vectorGuideCtxRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    const target = vectorPointEditingTargetRef.current as any;
    if (!fabricCanvas || !ctx) return;
    clearOverlayContext(ctx);
    if (editorModeRef.current === 'bitmap') {
      renderActiveObjectTransformOverlay(ctx, fabricCanvas);
      renderHoveredObjectOutline(ctx, fabricCanvas);
      return;
    }
    if (editorModeRef.current !== 'vector') return;
    if (activeToolRef.current === 'pen') {
      ctx.save();
      try {
        applyOverlaySceneTransform(ctx, fabricCanvas);
        renderPenDraftGuide(ctx);
      } finally {
        ctx.restore();
      }
      return;
    }
    if (activeToolRef.current === 'select' && target && fabricCanvasContainsObject(fabricCanvas, target)) {
      ctx.save();
      try {
        applyOverlaySceneTransform(ctx, fabricCanvas);
        ctx.strokeStyle = VECTOR_POINT_EDIT_GUIDE_STROKE;
        ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_EDIT_GUIDE_STROKE_WIDTH);
        ctx.lineJoin = target.strokeLineJoin ?? 'round';
        ctx.lineCap = target.strokeLineCap ?? 'round';
        ctx.setLineDash([]);

        if (traceVectorPointEditingGuidePath(ctx, target)) {
          ctx.stroke();
        }

        renderVectorPointHandleGuides(ctx, target);
        renderPointSelectionTransformGuides(ctx, target);
        renderPointSelectionMarquee(ctx);
        renderVectorPointControlOverlay(ctx, target);
      } finally {
        ctx.restore();
      }
    }

    renderActiveObjectTransformOverlay(ctx, fabricCanvas);
    renderHoveredObjectOutline(ctx, fabricCanvas);
  }, [
    activeToolRef,
    applyOverlaySceneTransform,
    clearOverlayContext,
    editorModeRef,
    fabricCanvasRef,
    getZoomInvariantMetric,
    renderPenDraftGuide,
    renderActiveObjectTransformOverlay,
    renderHoveredObjectOutline,
    renderVectorPointControlOverlay,
    renderPointSelectionMarquee,
    renderPointSelectionTransformGuides,
    renderVectorPointHandleGuides,
    traceVectorPointEditingGuidePath,
    vectorGuideCtxRef,
    vectorPointEditingTargetRef,
  ]);

  const applyVectorPointControls = useCallback((obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    if (isImageObject(obj) || isTextObject(obj)) return false;
    if (isActiveSelectionObject(obj)) return false;
    const type = getFabricObjectType(obj);

    if (!originalControlsRef.current.has(obj)) {
      originalControlsRef.current.set(obj, obj.controls);
    }

    if (type === 'path') {
      const controls = controlsUtils.createPathControls(obj, {
        ...VECTOR_POINT_CONTROL_STYLE,
        pointStyle: {
          controlFill: 'rgba(0, 0, 0, 0)',
          controlStroke: 'rgba(0, 0, 0, 0)',
        },
        controlPointStyle: {
          controlFill: 'rgba(0, 0, 0, 0)',
          controlStroke: 'rgba(0, 0, 0, 0)',
        },
      });
      removeDuplicateClosedPathAnchorControl(obj, controls);
      for (const [key, control] of Object.entries(controls)) {
        const originalMouseDownHandler = control.mouseDownHandler;
        control.mouseDownHandler = ((eventData: any, transform: any, x: number, y: number) => {
          const pathObj = transform?.target;
          if (pathObj && getFabricObjectType(pathObj) === 'path') {
            const resolved = resolveAnchorFromPathControlKey(pathObj, key);
            if (resolved) {
              const curveDrag = (
                isPathCurveDragModifierPressed(eventData)
              );
              if (curveDrag) {
                const dragState = getPathAnchorDragState(pathObj, resolved.anchorIndex);
                const pointerScene = fabricCanvasRef.current && eventData?.e
                  ? fabricCanvasRef.current.getScenePoint(eventData.e)
                  : new Point(x, y);
                const handleRole = resolveMirroredPathAnchorHandleRole(
                  pathObj,
                  resolved.anchorIndex,
                  resolved.changed,
                );
                mirroredPathAnchorDragSessionRef.current = {
                  path: pathObj,
                  anchorIndex: resolved.anchorIndex,
                  handleRole,
                  dragState,
                  currentPointerScene: new Point(pointerScene.x, pointerScene.y),
                  hasChanged: false,
                  moveAnchorMode: false,
                  moveAnchorStartCommandPoint: null,
                  moveAnchorSnapshot: null,
                  controlsHydrated: false,
                };
                setPathNodeHandleType(pathObj, resolved.anchorIndex, 'symmetric');
                if (
                  mirroredPathAnchorDragSessionRef.current &&
                  applyMirroredPathAnchorCurveDragSession(
                    mirroredPathAnchorDragSessionRef.current,
                    pointerScene,
                  )
                ) {
                  applyVectorPointControls(pathObj);
                  mirroredPathAnchorDragSessionRef.current.controlsHydrated = true;
                }
              } else {
                mirroredPathAnchorDragSessionRef.current = null;
              }

              const selectionToggle = isPointSelectionToggleModifierPressed(eventData);
              const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
              if (selectionToggle && !curveDrag) {
                if (selectedAnchors.has(resolved.anchorIndex)) {
                  selectedAnchors.delete(resolved.anchorIndex);
                } else {
                  selectedAnchors.add(resolved.anchorIndex);
                }
                setSelectedPathAnchors(pathObj, Array.from(selectedAnchors), {
                  primaryAnchorIndex: selectedAnchors.has(resolved.anchorIndex) ? resolved.anchorIndex : null,
                });
                return false;
              }

              if (curveDrag || !selectedAnchors.has(resolved.anchorIndex) || selectedAnchors.size <= 1) {
                setSelectedPathAnchors(pathObj, [resolved.anchorIndex], {
                  primaryAnchorIndex: resolved.anchorIndex,
                });
              } else {
                setSelectedPathAnchors(pathObj, Array.from(selectedAnchors), {
                  primaryAnchorIndex: resolved.anchorIndex,
                });
              }
              const existingType = getPathNodeHandleType(pathObj, resolved.anchorIndex);
              if (!existingType) {
                setPathNodeHandleType(
                  pathObj,
                  resolved.anchorIndex,
                  vectorHandleModeToPathNodeHandleType(getEditableVectorHandleMode(vectorHandleModeRef.current)),
                );
              }
              syncVectorHandleModeFromSelection();
              if (curveDrag) {
                // Mirrored handle drags own the full gesture so Fabric doesn't also
                // start the default anchor drag underneath and move the center point.
                return true;
              }
            }
          }
          if (typeof originalMouseDownHandler === 'function') {
            return originalMouseDownHandler.call(control, eventData, transform, x, y);
          }
          return false;
        }) as any;

        const originalActionHandler = control.actionHandler;
        if (typeof originalActionHandler !== 'function') continue;
        control.actionHandler = ((eventData: any, transform: any, x: number, y: number) => {
          const pathObjBefore = transform?.target;
          const resolvedBefore = pathObjBefore && getFabricObjectType(pathObjBefore) === 'path'
            ? resolveAnchorFromPathControlKey(pathObjBefore, key)
            : null;
          const mirroredCurveDragSession = (
            resolvedBefore &&
            mirroredPathAnchorDragSessionRef.current?.path === pathObjBefore &&
            mirroredPathAnchorDragSessionRef.current?.anchorIndex === resolvedBefore.anchorIndex
          )
            ? mirroredPathAnchorDragSessionRef.current
            : null;
          const selectedAnchorsBefore = pathObjBefore && resolvedBefore
            ? getSelectedPathAnchorIndices(pathObjBefore)
            : [];

          let dragState: any;
          const groupedDragStates: Array<{ anchorIndex: number; dragState: any }> = [];

          if (pathObjBefore && resolvedBefore) {
            dragState = getPathAnchorDragState(pathObjBefore, resolvedBefore.anchorIndex) ?? undefined;

            if (
              resolvedBefore.changed === 'anchor' &&
              selectedAnchorsBefore.includes(resolvedBefore.anchorIndex) &&
              selectedAnchorsBefore.length > 1
            ) {
              for (const selectedAnchorIndex of selectedAnchorsBefore) {
                if (selectedAnchorIndex === resolvedBefore.anchorIndex) continue;

                const groupedDragState = getPathAnchorDragState(pathObjBefore, selectedAnchorIndex);
                if (!groupedDragState) continue;

                groupedDragStates.push({
                  anchorIndex: selectedAnchorIndex,
                  dragState: groupedDragState,
                });
              }
            }
          }

          if (pathObjBefore && resolvedBefore && mirroredCurveDragSession) {
            const fabricCanvas = fabricCanvasRef.current;
            const pointerScene = fabricCanvas && eventData?.e
              ? fabricCanvas.getScenePoint(eventData.e)
              : new Point(x, y);
            const appliedMirroredDrag = applyMirroredPathAnchorCurveDragSession(
              mirroredCurveDragSession,
              pointerScene,
            );
            if (appliedMirroredDrag) {
              if (!mirroredCurveDragSession.controlsHydrated) {
                applyVectorPointControls(pathObjBefore);
                mirroredCurveDragSession.controlsHydrated = true;
              }
              activePathAnchorRef.current = { path: pathObjBefore, anchorIndex: resolvedBefore.anchorIndex };
              syncVectorHandleModeFromSelection();
              mirroredCurveDragSession.hasChanged = true;
            }
            // Mirrored curve drags should never fall back to Fabric's default
            // anchor action handler, or the center point can start moving.
            return appliedMirroredDrag;
          }

          const performed = originalActionHandler.call(control, eventData, transform, x, y);
          const pathObj = transform?.target;
          if (!pathObj || getFabricObjectType(pathObj) !== 'path') {
            return performed;
          }
          const resolved = resolveAnchorFromPathControlKey(pathObj, key);
          if (resolved) {
            const existingType = getPathNodeHandleType(pathObj, resolved.anchorIndex);
            const resolvedHandleType = resolvePathNodeHandleTypeForControlDrag({
              breakMirroring: isVectorHandleIndependenceModifierPressed(eventData),
              changed: resolved.changed,
              currentType: existingType,
              fallbackType: vectorHandleModeToPathNodeHandleType(
                getEditableVectorHandleMode(vectorHandleModeRef.current),
              ),
            });
            if (existingType !== resolvedHandleType) {
              setPathNodeHandleType(
                pathObj,
                resolved.anchorIndex,
                resolvedHandleType,
              );
            }
            activePathAnchorRef.current = { path: pathObj, anchorIndex: resolved.anchorIndex };
            syncVectorHandleModeFromSelection();
            enforcePathAnchorHandleType(pathObj, resolved.anchorIndex, resolved.changed, dragState);
            if (resolved.changed === 'anchor' && dragState && groupedDragStates.length > 0) {
              const anchorAfter = getAnchorPointForIndex(pathObj, resolved.anchorIndex);
              if (anchorAfter) {
                const deltaX = anchorAfter.x - dragState.previousAnchor.x;
                const deltaY = anchorAfter.y - dragState.previousAnchor.y;
                let movedGroupedAnchors = false;
                for (const groupedDragState of groupedDragStates) {
                  movedGroupedAnchors = movePathAnchorByDelta(
                    pathObj,
                    groupedDragState.anchorIndex,
                    deltaX,
                    deltaY,
                    groupedDragState.dragState,
                  ) || movedGroupedAnchors;
                }

                if (movedGroupedAnchors) {
                  stabilizePathAfterAnchorMutation(pathObj, anchorAfter);
                }
              }
            }
          }
          return performed;
        }) as any;
      }
      obj.controls = controls;
      syncPathAnchorSelectionAppearance(obj);
      syncPathControlPointVisibility(obj);
      if (typeof obj.setControlVisible === 'function') {
        for (const key of Object.keys(obj.controls || {})) {
          const control = (obj.controls || {})[key] as any;
          const isVisible = typeof obj.isControlVisible === 'function'
            ? obj.isControlVisible(key)
            : typeof control?.visible === 'boolean'
              ? control.visible
              : true;
          obj.setControlVisible(key, isVisible);
        }
      }
      if (typeof obj.setCoords === 'function') {
        obj.setCoords();
      }
      return true;
    }

    if ((type === 'polyline' || type === 'polygon') && Array.isArray((obj as any).points) && (obj as any).points.length > 1) {
      obj.controls = controlsUtils.createPolyControls(obj, {
        ...VECTOR_POINT_CONTROL_STYLE,
        cursorStyle: 'crosshair',
      });
      if (typeof obj.setControlVisible === 'function') {
        for (const key of Object.keys(obj.controls || {})) {
          obj.setControlVisible(key, true);
        }
      }
      if (typeof obj.setCoords === 'function') {
        obj.setCoords();
      }
      return true;
    }

    restoreOriginalControls(obj);
    return false;
  }, [
    activePathAnchorRef,
    applyMirroredPathAnchorCurveDragSession,
    enforcePathAnchorHandleType,
    fabricCanvasRef,
    getAnchorPointForIndex,
    getPathAnchorDragState,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    isPathCurveDragModifierPressed,
    isVectorHandleIndependenceModifierPressed,
    isPointSelectionToggleModifierPressed,
    mirroredPathAnchorDragSessionRef,
    movePathAnchorByDelta,
    originalControlsRef,
    removeDuplicateClosedPathAnchorControl,
    resolveMirroredPathAnchorHandleRole,
    resolveAnchorFromPathControlKey,
    restoreOriginalControls,
    setPathNodeHandleType,
    setSelectedPathAnchors,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    syncVectorHandleModeFromSelection,
    vectorHandleModeRef,
  ]);

  return {
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    ensurePathLikeObjectForVectorTool,
    renderVectorPointEditingGuide,
  };
}

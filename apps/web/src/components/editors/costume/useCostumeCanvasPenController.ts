import { useCallback, useRef, type MutableRefObject } from 'react';
import { Path, Point, type Canvas as FabricCanvas } from 'fabric';
import {
  HANDLE_SIZE,
  PEN_TOOL_DRAG_THRESHOLD_PX,
  VECTOR_POINT_HANDLE_GUIDE_STROKE,
  VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH,
  VECTOR_SELECTION_COLOR,
  VECTOR_SELECTION_CORNER_COLOR,
  buildPenDraftPathData,
  buildPenDraftNodeHandleTypes,
  buildPenDraftPathCommands,
  clonePenDraftAnchor,
  cloneScenePoint,
  createPenDraftAnchor,
  getPenToolCloseHitRadiusPx,
  mirrorPointAcrossAnchor,
  type PenDraftAnchor,
} from './costumeCanvasShared';
import {
  createVectorTexturePreviewPathObject,
  getFabricFillValueForVectorTexture,
  getFabricStrokeValueForVectorBrush,
} from './costumeCanvasVectorRuntime';
import type { DrawingTool, VectorPathNodeHandleType } from './CostumeToolbar';

interface UseCostumeCanvasPenControllerOptions {
  activeToolRef: MutableRefObject<DrawingTool>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getZoomInvariantMetric: (value: number, zoom?: number) => number;
  saveHistory: () => void;
  syncSelectionState: () => void;
  vectorStyleRef: MutableRefObject<any>;
}

export function useCostumeCanvasPenController({
  activeToolRef,
  fabricCanvasRef,
  getZoomInvariantMetric,
  saveHistory,
  syncSelectionState,
  vectorStyleRef,
}: UseCostumeCanvasPenControllerOptions) {
  const penDraftRef = useRef<{
    anchors: PenDraftAnchor[];
    previewPoint: Point | null;
  } | null>(null);
  const penAnchorPlacementSessionRef = useRef<any>(null);
  const penModifierStateRef = useRef({ alt: false, space: false });

  const translateScenePoint = useCallback((point: Point | null, deltaX: number, deltaY: number) => {
    if (!point) return null;
    return new Point(point.x + deltaX, point.y + deltaY);
  }, []);

  const resolvePenDraftAnchorHandleType = useCallback((anchor: PenDraftAnchor): VectorPathNodeHandleType => {
    const hasIncoming = !!anchor.incoming;
    const hasOutgoing = !!anchor.outgoing;
    if (!hasIncoming && !hasOutgoing) {
      return 'linear';
    }
    if (!hasIncoming || !hasOutgoing) {
      return 'corner';
    }

    const incoming = anchor.incoming!;
    const outgoing = anchor.outgoing!;
    const mirrored = (
      Math.abs(incoming.x + outgoing.x - anchor.point.x * 2) <= 0.0001 &&
      Math.abs(incoming.y + outgoing.y - anchor.point.y * 2) <= 0.0001
    );
    return mirrored ? 'symmetric' : 'corner';
  }, []);

  const commitCurrentPenPlacement = useCallback(() => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) {
      penAnchorPlacementSessionRef.current = null;
      return false;
    }

    if (!session.hasDragged) {
      anchor.incoming = null;
      anchor.outgoing = null;
      anchor.handleType = 'linear';
    } else {
      anchor.handleType = resolvePenDraftAnchorHandleType(anchor);
    }

    draft.previewPoint = cloneScenePoint(session.currentPointerScene);
    penAnchorPlacementSessionRef.current = null;
    return true;
  }, [resolvePenDraftAnchorHandleType]);

  const updatePenAnchorPlacement = useCallback((pointer: Point) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;

    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) return false;

    const nextPointer = new Point(pointer.x, pointer.y);
    session.currentPointerScene = nextPointer;

    const dragThreshold = getZoomInvariantMetric(PEN_TOOL_DRAG_THRESHOLD_PX);
    if (
      Math.hypot(
        nextPointer.x - session.startPointerScene.x,
        nextPointer.y - session.startPointerScene.y,
      ) >= dragThreshold
    ) {
      session.hasDragged = true;
    }

    if (session.moveAnchorMode && session.moveAnchorSnapshot && session.moveAnchorStartPointerScene) {
      const deltaX = nextPointer.x - session.moveAnchorStartPointerScene.x;
      const deltaY = nextPointer.y - session.moveAnchorStartPointerScene.y;
      anchor.point = new Point(
        session.moveAnchorSnapshot.point.x + deltaX,
        session.moveAnchorSnapshot.point.y + deltaY,
      );
      anchor.incoming = translateScenePoint(session.moveAnchorSnapshot.incoming, deltaX, deltaY);
      anchor.outgoing = translateScenePoint(session.moveAnchorSnapshot.outgoing, deltaX, deltaY);
      anchor.handleType = resolvePenDraftAnchorHandleType(anchor);
      return true;
    }

    if (session.handleRole === 'incoming') {
      anchor.incoming = nextPointer;
      anchor.outgoing = session.cuspMode
        ? cloneScenePoint(session.cuspFixedOpposite)
        : mirrorPointAcrossAnchor(anchor.point, nextPointer);
    } else {
      anchor.outgoing = nextPointer;
      anchor.incoming = session.cuspMode
        ? cloneScenePoint(session.cuspFixedOpposite)
        : mirrorPointAcrossAnchor(anchor.point, nextPointer);
    }
    anchor.handleType = session.cuspMode ? 'corner' : 'symmetric';
    draft.previewPoint = nextPointer;
    return true;
  }, [getZoomInvariantMetric, resolvePenDraftAnchorHandleType, translateScenePoint]);

  const setPenAnchorMoveMode = useCallback((enabled: boolean) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    if (enabled === session.moveAnchorMode) return false;

    if (enabled) {
      const anchor = draft.anchors[session.anchorIndex];
      if (!anchor) return false;
      session.moveAnchorMode = true;
      session.moveAnchorStartPointerScene = cloneScenePoint(session.currentPointerScene);
      session.moveAnchorSnapshot = clonePenDraftAnchor(anchor);
      return true;
    }

    session.moveAnchorMode = false;
    session.moveAnchorStartPointerScene = null;
    session.moveAnchorSnapshot = null;
    return true;
  }, []);

  const setPenAnchorCuspMode = useCallback((enabled: boolean) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    if (enabled === session.cuspMode) return false;

    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) return false;

    session.cuspMode = enabled;
    if (enabled) {
      session.cuspFixedOpposite = cloneScenePoint(
        session.handleRole === 'incoming' ? anchor.outgoing : anchor.incoming,
      );
    } else {
      session.cuspFixedOpposite = null;
    }

    if (!session.moveAnchorMode) {
      updatePenAnchorPlacement(session.currentPointerScene);
    }
    return true;
  }, [updatePenAnchorPlacement]);

  const syncPenPlacementToAltModifier = useCallback((enabled: boolean) => {
    const session = penAnchorPlacementSessionRef.current;
    if (!session) {
      return false;
    }
    if (enabled) {
      return setPenAnchorCuspMode(true);
    }
    return false;
  }, [setPenAnchorCuspMode]);

  const discardPenDraft = useCallback(() => {
    penDraftRef.current = null;
    penAnchorPlacementSessionRef.current = null;
    penModifierStateRef.current.alt = false;
    penModifierStateRef.current.space = false;
    fabricCanvasRef.current?.requestRenderAll();
    syncSelectionState();
  }, [fabricCanvasRef, syncSelectionState]);

  const getPenDraftPreviewObject = useCallback(() => {
    const draft = penDraftRef.current;
    if (!draft || draft.anchors.length === 0) {
      return null;
    }

    const strokeWidth = Math.max(0, vectorStyleRef.current.strokeWidth);
    if (strokeWidth <= 0 || vectorStyleRef.current.strokeBrushId === 'solid') {
      return null;
    }

    const previewAnchors = [...draft.anchors];
    if (!penAnchorPlacementSessionRef.current && draft.previewPoint) {
      previewAnchors.push(createPenDraftAnchor(draft.previewPoint));
    }
    if (previewAnchors.length < 2) {
      return null;
    }

    const pathCommands = buildPenDraftPathCommands(previewAnchors, false);
    if (pathCommands.length === 0) {
      return null;
    }

    return createVectorTexturePreviewPathObject({
      path: pathCommands,
      strokeBrushId: vectorStyleRef.current.strokeBrushId,
      strokeColor: vectorStyleRef.current.strokeColor,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      strokeWiggle: vectorStyleRef.current.strokeWiggle,
      strokeOpacity: vectorStyleRef.current.strokeOpacity,
      strokeWidth,
    });
  }, [vectorStyleRef]);

  const finalizePenDraft = useCallback((options: { close?: boolean } = {}): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const draft = penDraftRef.current;
    if (!fabricCanvas || !draft) return false;

    commitCurrentPenPlacement();

    if (draft.anchors.length < 2) {
      discardPenDraft();
      return false;
    }

    const shouldClose = options.close === true;
    const pathData = buildPenDraftPathData(draft.anchors, shouldClose);
    if (!pathData) {
      discardPenDraft();
      return false;
    }

    const strokeWidth = Math.max(0, vectorStyleRef.current.strokeWidth);
    const path = new Path(pathData, {
      fill: shouldClose
        ? getFabricFillValueForVectorTexture(
            vectorStyleRef.current.fillTextureId,
            vectorStyleRef.current.fillColor,
            vectorStyleRef.current.fillOpacity,
          )
        : null,
      opacity: 1,
      stroke: getFabricStrokeValueForVectorBrush(
        vectorStyleRef.current.strokeBrushId,
        vectorStyleRef.current.strokeColor,
        vectorStyleRef.current.strokeOpacity,
      ),
      strokeWidth,
      strokeUniform: true,
      noScaleCache: false,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      nodeHandleTypes: buildPenDraftNodeHandleTypes(draft.anchors),
      vectorFillTextureId: shouldClose ? vectorStyleRef.current.fillTextureId : undefined,
      vectorFillColor: shouldClose ? vectorStyleRef.current.fillColor : undefined,
      vectorFillOpacity: shouldClose ? vectorStyleRef.current.fillOpacity : undefined,
      vectorStrokeBrushId: vectorStyleRef.current.strokeBrushId,
      vectorStrokeColor: vectorStyleRef.current.strokeColor,
      vectorStrokeOpacity: vectorStyleRef.current.strokeOpacity,
      vectorStrokeWiggle: vectorStyleRef.current.strokeWiggle,
    } as any);

    path.setCoords?.();
    fabricCanvas.add(path);
    if (activeToolRef.current === 'pen') {
      fabricCanvas.discardActiveObject();
    } else {
      fabricCanvas.setActiveObject(path);
    }

    penDraftRef.current = null;
    penAnchorPlacementSessionRef.current = null;
    penModifierStateRef.current.alt = false;
    penModifierStateRef.current.space = false;
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [activeToolRef, commitCurrentPenPlacement, discardPenDraft, fabricCanvasRef, saveHistory, syncSelectionState, vectorStyleRef]);

  const removeLastPenDraftAnchor = useCallback(() => {
    const draft = penDraftRef.current;
    if (!draft) return false;

    penAnchorPlacementSessionRef.current = null;
    draft.anchors.pop();
    if (draft.anchors.length === 0) {
      discardPenDraft();
      return true;
    }

    draft.previewPoint = cloneScenePoint(draft.anchors[draft.anchors.length - 1]?.point ?? null);
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [discardPenDraft, fabricCanvasRef]);

  const startPenAnchorPlacement = useCallback((pointer: Point, options: { cuspMode?: boolean } = {}) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    let draft = penDraftRef.current;
    if (!draft) {
      draft = {
        anchors: [],
        previewPoint: null,
      };
      penDraftRef.current = draft;
    }

    if (draft.anchors.length >= 2) {
      const firstAnchor = draft.anchors[0]?.point ?? null;
      const closeRadius = getZoomInvariantMetric(getPenToolCloseHitRadiusPx());
      if (
        firstAnchor &&
        Math.hypot(pointer.x - firstAnchor.x, pointer.y - firstAnchor.y) <= closeRadius
      ) {
        return finalizePenDraft({ close: true });
      }
    }

    const anchor = createPenDraftAnchor(pointer);
    const anchorIndex = draft.anchors.length;
    draft.anchors.push(anchor);
    draft.previewPoint = cloneScenePoint(pointer);
    penAnchorPlacementSessionRef.current = {
      anchorIndex,
      handleRole: 'outgoing',
      startPointerScene: cloneScenePoint(pointer) ?? new Point(pointer.x, pointer.y),
      currentPointerScene: cloneScenePoint(pointer) ?? new Point(pointer.x, pointer.y),
      hasDragged: false,
      moveAnchorMode: false,
      moveAnchorStartPointerScene: null,
      moveAnchorSnapshot: null,
      cuspMode: options.cuspMode === true,
      cuspFixedOpposite: null,
    };
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    return true;
  }, [fabricCanvasRef, finalizePenDraft, getZoomInvariantMetric, syncSelectionState]);

  const renderPenDraftGuide = useCallback((ctx: CanvasRenderingContext2D) => {
    const draft = penDraftRef.current;
    if (!draft || draft.anchors.length === 0) return false;

    const activeAnchorIndex = penAnchorPlacementSessionRef.current?.anchorIndex ?? (draft.anchors.length - 1);
    const previewPoint = penAnchorPlacementSessionRef.current ? null : draft.previewPoint;
    const previewStrokeWidth = Math.max(1, vectorStyleRef.current.strokeWidth);
    const texturedPreviewObject = getPenDraftPreviewObject();

    ctx.save();
    try {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(draft.anchors[0].point.x, draft.anchors[0].point.y);
      for (let index = 1; index < draft.anchors.length; index += 1) {
        const previousAnchor = draft.anchors[index - 1];
        const currentAnchor = draft.anchors[index];
        if (previousAnchor.outgoing || currentAnchor.incoming) {
          const control1 = previousAnchor.outgoing ?? previousAnchor.point;
          const control2 = currentAnchor.incoming ?? currentAnchor.point;
          ctx.bezierCurveTo(
            control1.x,
            control1.y,
            control2.x,
            control2.y,
            currentAnchor.point.x,
            currentAnchor.point.y,
          );
        } else {
          ctx.lineTo(currentAnchor.point.x, currentAnchor.point.y);
        }
      }
      if (previewPoint && draft.anchors.length > 0) {
        const lastAnchor = draft.anchors[draft.anchors.length - 1];
        if (lastAnchor.outgoing) {
          ctx.bezierCurveTo(
            lastAnchor.outgoing.x,
            lastAnchor.outgoing.y,
            previewPoint.x,
            previewPoint.y,
            previewPoint.x,
            previewPoint.y,
          );
        } else {
          ctx.lineTo(previewPoint.x, previewPoint.y);
        }
      }
      if (!texturedPreviewObject) {
        ctx.strokeStyle = getFabricStrokeValueForVectorBrush(
          vectorStyleRef.current.strokeBrushId,
          vectorStyleRef.current.strokeColor,
          vectorStyleRef.current.strokeOpacity,
        );
        ctx.lineWidth = previewStrokeWidth;
        ctx.stroke();
      }

      ctx.strokeStyle = VECTOR_POINT_HANDLE_GUIDE_STROKE;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH);
      draft.anchors.forEach((anchor) => {
        if (anchor.incoming) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.incoming.x, anchor.incoming.y);
          ctx.stroke();
        }
        if (anchor.outgoing) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.outgoing.x, anchor.outgoing.y);
          ctx.stroke();
        }
      });

      const handleRadius = getZoomInvariantMetric(HANDLE_SIZE * 0.42);
      draft.anchors.forEach((anchor, anchorIndex) => {
        const isActive = anchorIndex === activeAnchorIndex;
        const drawHandle = (handlePoint: Point | null) => {
          if (!handlePoint) return;
          ctx.beginPath();
          ctx.arc(handlePoint.x, handlePoint.y, handleRadius, 0, Math.PI * 2);
          ctx.fillStyle = VECTOR_SELECTION_CORNER_COLOR;
          ctx.fill();
          ctx.lineWidth = getZoomInvariantMetric(2);
          ctx.strokeStyle = VECTOR_SELECTION_COLOR;
          ctx.stroke();
        };

        drawHandle(anchor.incoming);
        drawHandle(anchor.outgoing);

        ctx.beginPath();
        ctx.arc(anchor.point.x, anchor.point.y, getZoomInvariantMetric(HANDLE_SIZE / 2), 0, Math.PI * 2);
        ctx.fillStyle = isActive ? VECTOR_SELECTION_COLOR : VECTOR_SELECTION_CORNER_COLOR;
        ctx.fill();
        ctx.lineWidth = getZoomInvariantMetric(2);
        ctx.strokeStyle = isActive ? VECTOR_SELECTION_CORNER_COLOR : VECTOR_SELECTION_COLOR;
        ctx.stroke();
      });
    } finally {
      ctx.restore();
    }

    return true;
  }, [getPenDraftPreviewObject, getZoomInvariantMetric, vectorStyleRef]);

  return {
    commitCurrentPenPlacement,
    discardPenDraft,
    finalizePenDraft,
    getPenDraftPreviewObject,
    penAnchorPlacementSessionRef,
    penDraftRef,
    penModifierStateRef,
    removeLastPenDraftAnchor,
    renderPenDraftGuide,
    setPenAnchorMoveMode,
    startPenAnchorPlacement,
    syncPenPlacementToAltModifier,
    updatePenAnchorPlacement,
  };
}

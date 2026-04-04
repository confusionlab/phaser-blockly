import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  Canvas as FabricCanvas,
  Ellipse,
  IText,
  Line,
  Point,
  Polygon,
  Rect,
} from 'fabric';
import type { BitmapFloatingSelectionBehavior } from '@/lib/editor/interactionSurface';
import { attachTextEditingContainer, beginTextEditing, isTextEditableObject } from './costumeTextCommands';
import { applyCanvasCursor } from './costumeCanvasBitmapRuntime';
import {
  applyUnifiedFabricTransformCanvasOptions,
  clearUnifiedCanvasTransformGuide,
  configureUnifiedObjectTransformForGesture,
  syncUnifiedCanvasTransformGuideFromEvent,
} from './costumeCanvasObjectTransformGizmo';
import {
  getTransformGizmoCursorForCornerTarget,
} from '@/lib/editor/unifiedTransformGizmo';
import {
  CANVAS_SIZE,
  buildPolygonShapeDraft,
  getStrokedShapeBoundsFromPathBounds,
  isSpaceKeyEvent,
  resolveShapeDraft,
  translateShapeDraftResolution,
  type ShapeDraftSession,
} from './costumeCanvasShared';
import {
  getFabricFillValueForVectorTexture,
  getFabricObjectType,
  getFabricStrokeValueForVectorBrush,
  isVectorPointSelectableObject,
  normalizeVectorObjectRendering,
} from './costumeCanvasVectorRuntime';
import type { DrawingTool } from './CostumeToolbar';
import type { CostumeAssetFrame, CostumeEditorMode } from '@/types';

type FabricCanvasHostRuntime = FabricCanvas & {
  calcOffset?: () => void;
  lowerCanvasEl?: HTMLCanvasElement;
  requestRenderAll: () => void;
  upperCanvasEl?: HTMLCanvasElement;
  wrapperEl?: HTMLDivElement;
};

function resolveFabricCanvasRootElement(
  fabricCanvas: FabricCanvasHostRuntime,
  fabricCanvasElement: HTMLCanvasElement | null,
) {
  return fabricCanvas.wrapperEl
    ?? fabricCanvas.upperCanvasEl?.parentElement
    ?? fabricCanvas.lowerCanvasEl?.parentElement
    ?? fabricCanvasElement;
}

function attachFabricCanvasToHost(
  host: HTMLDivElement,
  fabricCanvas: FabricCanvasHostRuntime,
  fabricCanvasElement: HTMLCanvasElement | null,
) {
  const rootElement = resolveFabricCanvasRootElement(fabricCanvas, fabricCanvasElement);
  if (!rootElement) {
    return;
  }

  if (rootElement.parentElement !== host || host.childNodes.length !== 1 || host.firstChild !== rootElement) {
    host.replaceChildren(rootElement);
  }
}

interface UseCostumeCanvasFabricHostControllerOptions {
  activeLayerLockedRef: MutableRefObject<boolean>;
  activeLayerVisibleRef: MutableRefObject<boolean>;
  activePathAnchorRef: MutableRefObject<any>;
  activeToolRef: MutableRefObject<DrawingTool>;
  bitmapFloatingObjectRef: MutableRefObject<any | null>;
  bitmapSelectionBusyRef: MutableRefObject<boolean>;
  bitmapSelectionCanvasRef: RefObject<HTMLCanvasElement | null>;
  bitmapSelectionCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  brushColorRef: MutableRefObject<string>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasElementRef: MutableRefObject<HTMLCanvasElement | null>;
  fabricCanvasHostElement: HTMLDivElement | null;
  fabricCanvasHostRef: MutableRefObject<HTMLDivElement | null>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  insertedPathAnchorDragSessionRef: MutableRefObject<any>;
  mirroredPathAnchorDragSessionRef: MutableRefObject<any>;
  penAnchorPlacementSessionRef: MutableRefObject<any>;
  penDraftRef: MutableRefObject<any>;
  pointSelectionMarqueeSessionRef: MutableRefObject<any>;
  pointSelectionTransformSessionRef: MutableRefObject<any>;
  shapeDraftRef: MutableRefObject<ShapeDraftSession | null>;
  suppressBitmapSelectionAutoCommitRef: MutableRefObject<boolean>;
  textEditingHostRef: RefObject<HTMLDivElement | null>;
  textStyleRef: MutableRefObject<any>;
  vectorGuideCanvasRef: RefObject<HTMLCanvasElement | null>;
  vectorGuideCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  vectorPointEditingTargetRef: MutableRefObject<any | null>;
  vectorStrokeCanvasRef: RefObject<HTMLCanvasElement | null>;
  vectorStrokeCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  vectorStyleRef: MutableRefObject<any>;
  bitmapShapeStyleRef: MutableRefObject<any>;
  onFabricCanvasReady: () => void;
  onFabricCanvasAfterRender: () => void;
  activateVectorPointEditing: (target: any, saveConversionToHistory: boolean) => boolean;
  applyFill: (x: number, y: number) => void | Promise<void>;
  applyPointSelectionMarqueeSession: (session: any) => boolean;
  applyPointSelectionTransformSession: (session: any, pointer: Point, eventData?: Record<string, any> | null) => boolean;
  applyVectorPointControls: (target: any) => boolean;
  applyVectorPointEditingAppearance: (target: any) => void;
  beginPointSelectionTransformSession: (target: any, hit: any, pointer: Point, eventData?: Record<string, any> | null) => boolean;
  clearSelectedPathAnchors: (target?: any) => void;
  commitBitmapSelection: (options?: { behavior?: BitmapFloatingSelectionBehavior }) => Promise<boolean>;
  commitCurrentPenPlacement: () => void;
  configureCanvasForTool: () => void;
  drawBitmapSelectionOverlay: () => void;
  enforcePathAnchorHandleType: (path: any, anchorIndex: number, changed: any, dragState?: any) => void;
  flattenBitmapLayer: (commitObject?: any) => Promise<void>;
  getPathAnchorDragState: (path: any, anchorIndex: number) => any;
  getSelectedPathAnchorIndices: (path: any) => number[];
  getSelectedPathAnchorTransformSnapshot: (target: any) => any;
  hitPointSelectionTransform: (snapshot: any, pointer: Point) => any;
  insertPathPointAtScenePosition: (path: any, point: Point) => number | null;
  isPointSelectionToggleModifierPressed: (eventData: any) => boolean;
  loadBitmapLayer: (
    dataUrl: string,
    selectable: boolean,
    requestId?: number,
    options?: { assetFrame?: CostumeAssetFrame | null },
  ) => Promise<boolean>;
  movePathAnchorByDelta: (path: any, anchorIndex: number, deltaX: number, deltaY: number, dragState?: any) => boolean;
  renderVectorBrushStrokeOverlay: (ctx: CanvasRenderingContext2D, options?: { clear?: boolean }) => void;
  renderVectorPointEditingGuide: () => void;
  restoreAllOriginalControls: () => void;
  saveHistory: () => void;
  setSelectedPathAnchors: (path: any, anchorIndices: number[], options?: { primaryAnchorIndex?: number | null }) => void;
  setVectorPointEditingTarget: (target: any | null) => void;
  startPenAnchorPlacement: (pointer: Point, options?: { cuspMode?: boolean }) => void;
  syncActiveLayerCanvasVisibility: () => void;
  syncSelectionState: () => void;
  syncTextSelectionState: () => void;
  syncTextStyleFromSelection: () => void;
  syncVectorHandleModeFromSelection: () => void;
  syncVectorStyleFromSelection: () => void;
  toPathCommandPoint: (path: any, point: Point) => Point | null;
  updatePenAnchorPlacement: (pointer: Point) => boolean;
}

export function useCostumeCanvasFabricHostController(options: UseCostumeCanvasFabricHostControllerOptions) {
  const callbacksRef = useRef(options);
  callbacksRef.current = options;
  const disposeFabricCanvasRef = useRef<(() => void) | null>(null);
  const hostElement = options.fabricCanvasHostElement;

  useEffect(() => {
    const {
      fabricCanvasHostRef,
      fabricCanvasRef,
      onFabricCanvasReady,
      fabricCanvasElementRef,
      vectorStrokeCanvasRef,
      vectorStrokeCtxRef,
      vectorGuideCanvasRef,
      vectorGuideCtxRef,
      bitmapSelectionCanvasRef,
      bitmapSelectionCtxRef,
      textEditingHostRef,
      activeToolRef,
      editorModeRef,
      activeLayerVisibleRef,
      activeLayerLockedRef,
      bitmapFloatingObjectRef,
      vectorPointEditingTargetRef,
      pointSelectionTransformSessionRef,
      insertedPathAnchorDragSessionRef,
      mirroredPathAnchorDragSessionRef,
      pointSelectionMarqueeSessionRef,
      penAnchorPlacementSessionRef,
      penDraftRef,
      shapeDraftRef,
      brushColorRef,
      textStyleRef,
      bitmapShapeStyleRef,
      vectorStyleRef,
      bitmapSelectionBusyRef,
      suppressBitmapSelectionAutoCommitRef,
      activePathAnchorRef,
    } = callbacksRef.current;

    const fabricCanvasHost = fabricCanvasHostRef.current;
    if (!fabricCanvasHost) {
      return;
    }

    const existingFabricCanvas = fabricCanvasRef.current as FabricCanvasHostRuntime | null;
    if (existingFabricCanvas) {
      attachFabricCanvasToHost(fabricCanvasHost, existingFabricCanvas, fabricCanvasElementRef.current);
      onFabricCanvasReady();
      callbacksRef.current.syncActiveLayerCanvasVisibility();
      callbacksRef.current.configureCanvasForTool();
      return;
    }

    fabricCanvasHost.replaceChildren();
    const fabricCanvasElement = document.createElement('canvas');
    fabricCanvasElement.width = CANVAS_SIZE;
    fabricCanvasElement.height = CANVAS_SIZE;
    fabricCanvasElement.style.position = 'absolute';
    fabricCanvasElement.style.top = '0';
    fabricCanvasElement.style.left = '0';
    fabricCanvasElement.style.width = `${CANVAS_SIZE}px`;
    fabricCanvasElement.style.height = `${CANVAS_SIZE}px`;
    fabricCanvasHost.appendChild(fabricCanvasElement);
    fabricCanvasElementRef.current = fabricCanvasElement;

    const fabricCanvas = new FabricCanvas(fabricCanvasElement, {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selection: false,
    });
    (fabricCanvas as any).__manageUnifiedTransformGuideTopLayer = true;
    applyUnifiedFabricTransformCanvasOptions(fabricCanvas);
    fabricCanvasRef.current = fabricCanvas;
    onFabricCanvasReady();

    const shapeDraftModifierState = {
      alt: false,
      shift: false,
      space: false,
    };

    const shouldIgnoreShapeShortcutTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const applyResolvedShapeDraftToObject = (draft: ShapeDraftSession, start: Point, end: Point) => {
      const object = draft.object;

      if (draft.type === 'rectangle') {
        const bounds = getStrokedShapeBoundsFromPathBounds(
          start.x,
          start.y,
          end.x,
          end.y,
          typeof object.strokeWidth === 'number' ? object.strokeWidth : 0,
        );
        object.set(bounds);
        return;
      }

      if (draft.type === 'circle') {
        const bounds = getStrokedShapeBoundsFromPathBounds(
          start.x,
          start.y,
          end.x,
          end.y,
          typeof object.strokeWidth === 'number' ? object.strokeWidth : 0,
        );
        object.set({
          left: bounds.left,
          top: bounds.top,
          rx: bounds.width / 2,
          ry: bounds.height / 2,
        });
        return;
      }

      if (draft.type === 'triangle' || draft.type === 'star') {
        const polygonDraft = buildPolygonShapeDraft(draft.type, start, end);
        object.set({
          points: polygonDraft.points,
        });
        object.setDimensions?.();
        object.set({
          left: polygonDraft.left,
          top: polygonDraft.top,
        });
        return;
      }

      object.set({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
      });
    };

    const renderActiveShapeDraft = (pointerOverride?: Point) => {
      const draft = shapeDraftRef.current;
      if (!draft) {
        return false;
      }

      if (pointerOverride) {
        draft.currentPointer = { x: pointerOverride.x, y: pointerOverride.y };
      }

      const rawPointer = new Point(draft.currentPointer.x, draft.currentPointer.y);
      const resolution = draft.moveSession
        ? translateShapeDraftResolution(draft.moveSession.originResolution, {
            x: rawPointer.x - draft.moveSession.originPointer.x,
            y: rawPointer.y - draft.moveSession.originPointer.y,
          })
        : resolveShapeDraft(
            draft.type,
            draft.anchor,
            draft.currentPointer,
            {
              centered: shapeDraftModifierState.alt,
              proportional: shapeDraftModifierState.shift,
            },
          );

      applyResolvedShapeDraftToObject(
        draft,
        new Point(resolution.start.x, resolution.start.y),
        new Point(resolution.end.x, resolution.end.y),
      );
      draft.object.setCoords();
      fabricCanvas.requestRenderAll();
      return true;
    };

    const setShapeDraftMoveMode = (enabled: boolean) => {
      const draft = shapeDraftRef.current;
      if (!draft) {
        return false;
      }

      if (enabled) {
        if (draft.moveSession) {
          return false;
        }
        draft.moveSession = {
          originPointer: { ...draft.currentPointer },
          originAnchor: { ...draft.anchor },
          originResolution: resolveShapeDraft(
            draft.type,
            draft.anchor,
            draft.currentPointer,
            {
              centered: shapeDraftModifierState.alt,
              proportional: shapeDraftModifierState.shift,
            },
          ),
        };
        return renderActiveShapeDraft();
      }

      if (!draft.moveSession) {
        return false;
      }

      const { originAnchor, originPointer } = draft.moveSession;
      draft.anchor = {
        x: originAnchor.x + (draft.currentPointer.x - originPointer.x),
        y: originAnchor.y + (draft.currentPointer.y - originPointer.y),
      };
      draft.moveSession = null;
      return renderActiveShapeDraft();
    };

    const handleShapeModifierKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShapeShortcutTarget(event.target) || !shapeDraftRef.current) {
        return;
      }

      if (isSpaceKeyEvent(event)) {
        event.preventDefault();
        if (shapeDraftModifierState.space) {
          return;
        }
        shapeDraftModifierState.space = true;
        setShapeDraftMoveMode(true);
        return;
      }

      if (event.key === 'Alt') {
        event.preventDefault();
        if (shapeDraftModifierState.alt) {
          return;
        }
        shapeDraftModifierState.alt = true;
        if (!shapeDraftRef.current.moveSession) {
          renderActiveShapeDraft();
        }
        return;
      }

      if (event.key === 'Shift') {
        event.preventDefault();
        if (shapeDraftModifierState.shift) {
          return;
        }
        shapeDraftModifierState.shift = true;
        if (!shapeDraftRef.current.moveSession) {
          renderActiveShapeDraft();
        }
      }
    };

    const handleShapeModifierKeyUp = (event: KeyboardEvent) => {
      if (!shapeDraftRef.current) {
        return;
      }

      if (isSpaceKeyEvent(event)) {
        if (!shapeDraftModifierState.space) {
          return;
        }
        event.preventDefault();
        shapeDraftModifierState.space = false;
        setShapeDraftMoveMode(false);
        return;
      }

      if (event.key === 'Alt') {
        if (!shapeDraftModifierState.alt) {
          return;
        }
        event.preventDefault();
        shapeDraftModifierState.alt = false;
        if (!shapeDraftRef.current.moveSession) {
          renderActiveShapeDraft();
        }
        return;
      }

      if (event.key === 'Shift') {
        if (!shapeDraftModifierState.shift) {
          return;
        }
        event.preventDefault();
        shapeDraftModifierState.shift = false;
        if (!shapeDraftRef.current.moveSession) {
          renderActiveShapeDraft();
        }
      }
    };

    const onMouseDown = (opt: any) => {
      const callbacks = callbacksRef.current;
      if (activeToolRef.current === 'collider') return;
      if (!opt.e) return;

      const pointer = fabricCanvas.getScenePoint(opt.e);
      const mode = editorModeRef.current;
      const tool = activeToolRef.current;
      const layerInteractive = activeLayerVisibleRef.current && !activeLayerLockedRef.current;
      const floatingBitmapObject = bitmapFloatingObjectRef.current;

      if (!layerInteractive) {
        return;
      }

      configureUnifiedObjectTransformForGesture(fabricCanvas, opt.e);
      syncUnifiedCanvasTransformGuideFromEvent(fabricCanvas, opt.e);

      if (mode === 'bitmap' && tool === 'select' && floatingBitmapObject) {
        if (!opt.target || opt.target !== floatingBitmapObject) {
          void callbacks.commitBitmapSelection();
        }
        return;
      }

      if (mode === 'vector' && tool === 'pen') {
        callbacks.startPenAnchorPlacement(pointer, { cuspMode: opt.e.altKey === true });
        return;
      }

      if (mode === 'vector' && tool === 'select') {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        const clickedTarget = opt.target as any;
        const clickedPointEditingTarget = !!pointEditingTarget && clickedTarget === pointEditingTarget;
        const clickedActivePathControl = clickedPointEditingTarget && typeof clickedTarget?.__corner === 'string' && clickedTarget.__corner.length > 0;
        const pointSelectionToggle = callbacks.isPointSelectionToggleModifierPressed(opt.e);
        const pointSelectionTransformHit = (
          pointEditingTarget &&
          getFabricObjectType(pointEditingTarget) === 'path' &&
          !clickedActivePathControl
        )
          ? (() => {
              const snapshot = callbacks.getSelectedPathAnchorTransformSnapshot(pointEditingTarget);
              return snapshot ? callbacks.hitPointSelectionTransform(snapshot, pointer) : null;
            })()
          : null;

        if (pointEditingTarget && pointSelectionTransformHit) {
          pointSelectionTransformSessionRef.current = null;
          insertedPathAnchorDragSessionRef.current = null;
          if (callbacks.beginPointSelectionTransformSession(pointEditingTarget, pointSelectionTransformHit, pointer, opt.e)) {
            fabricCanvas.setActiveObject(pointEditingTarget);
            fabricCanvas.requestRenderAll();
            return;
          }
        }

        if (pointEditingTarget && !clickedPointEditingTarget && opt.e.detail >= 2) {
          callbacks.clearSelectedPathAnchors(pointEditingTarget);
          callbacks.restoreAllOriginalControls();
          callbacks.setVectorPointEditingTarget(null);
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas) return;
            if (!canvas.getObjects().includes(pointEditingTarget)) return;
            canvas.setActiveObject(pointEditingTarget);
            callbacksRef.current.configureCanvasForTool();
          });
          return;
        }

        if (pointEditingTarget && !clickedPointEditingTarget) {
          pointSelectionTransformSessionRef.current = null;
          insertedPathAnchorDragSessionRef.current = null;
          pointSelectionMarqueeSessionRef.current = {
            path: pointEditingTarget,
            startPointerScene: new Point(pointer.x, pointer.y),
            currentPointerScene: new Point(pointer.x, pointer.y),
            initialSelectedAnchorIndices: callbacks.getSelectedPathAnchorIndices(pointEditingTarget),
            toggleSelection: pointSelectionToggle,
          };
          fabricCanvas.setActiveObject(pointEditingTarget);
          fabricCanvas.requestRenderAll();
          return;
        }

        if (
          pointEditingTarget &&
          clickedPointEditingTarget &&
          !clickedActivePathControl &&
          opt.e.detail === 1 &&
          getFabricObjectType(pointEditingTarget) === 'path'
        ) {
          const insertedAnchorIndex = callbacks.insertPathPointAtScenePosition(pointEditingTarget, pointer);
          if (insertedAnchorIndex !== null) {
            callbacks.setSelectedPathAnchors(pointEditingTarget, [insertedAnchorIndex], {
              primaryAnchorIndex: insertedAnchorIndex,
            });
            fabricCanvas.setActiveObject(pointEditingTarget);
            callbacks.applyVectorPointControls(pointEditingTarget);
            callbacks.applyVectorPointEditingAppearance(pointEditingTarget);
            callbacks.syncVectorHandleModeFromSelection();
            callbacks.syncVectorStyleFromSelection();
            callbacks.syncSelectionState();
            const dragState = callbacks.getPathAnchorDragState(pointEditingTarget, insertedAnchorIndex);
            insertedPathAnchorDragSessionRef.current = dragState
              ? {
                  path: pointEditingTarget,
                  anchorIndex: insertedAnchorIndex,
                  dragState,
                }
              : null;
            fabricCanvas.requestRenderAll();
            return;
          }

          callbacks.clearSelectedPathAnchors(pointEditingTarget);
          return;
        }

        if (opt.e.detail >= 2 && clickedTarget && isVectorPointSelectableObject(clickedTarget)) {
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas) return;
            const vectorTarget = clickedTarget as any;
            if (!canvas.getObjects().includes(vectorTarget)) return;
            canvas.setActiveObject(vectorTarget);
            callbacksRef.current.activateVectorPointEditing(vectorTarget, true);
            callbacksRef.current.configureCanvasForTool();
          });
          return;
        }
      }

      if (tool === 'fill' && mode === 'bitmap') {
        void callbacks.applyFill(pointer.x, pointer.y);
        return;
      }

      if (tool === 'text' && mode === 'vector') {
        if (opt.target && isTextEditableObject(opt.target)) {
          const textObject = opt.target as any;
          attachTextEditingContainer(textObject, textEditingHostRef.current);
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas) return;
            if (!canvas.getObjects().includes(textObject)) return;
            beginTextEditing(canvas as any, textObject, { event: opt.e });
            callbacksRef.current.syncTextStyleFromSelection();
            callbacksRef.current.syncTextSelectionState();
            callbacksRef.current.syncSelectionState();
          });
          return;
        }

        const textObject = new IText('text', {
          left: pointer.x,
          top: pointer.y,
          fill: brushColorRef.current,
          fontFamily: textStyleRef.current.fontFamily,
          fontSize: textStyleRef.current.fontSize,
          fontWeight: textStyleRef.current.fontWeight,
          fontStyle: textStyleRef.current.fontStyle,
          underline: textStyleRef.current.underline,
          textAlign: textStyleRef.current.textAlign,
          opacity: textStyleRef.current.opacity,
        } as any);
        attachTextEditingContainer(textObject as any, textEditingHostRef.current);
        textObject.on('editing:exited', () => {
          callbacksRef.current.syncTextStyleFromSelection();
          callbacksRef.current.saveHistory();
        });
        fabricCanvas.add(textObject);
        beginTextEditing(fabricCanvas as any, textObject, { selectAll: true });
        callbacks.syncTextStyleFromSelection();
        callbacks.syncTextSelectionState();
        callbacks.syncSelectionState();
        callbacks.saveHistory();
        return;
      }

      if (tool === 'rectangle' || tool === 'circle' || tool === 'triangle' || tool === 'star' || tool === 'line') {
        shapeDraftModifierState.alt = opt.e.altKey === true;
        shapeDraftModifierState.shift = opt.e.shiftKey === true;
        shapeDraftModifierState.space = false;
        const isVectorMode = mode === 'vector';
        const activeShapeStyle = isVectorMode ? vectorStyleRef.current : bitmapShapeStyleRef.current;
        const fillColor = activeShapeStyle.fillColor;
        const strokeColor = activeShapeStyle.strokeColor;
        const strokeWidth = Math.max(0, activeShapeStyle.strokeWidth);
        const vectorRenderFill = isVectorMode
          ? getFabricFillValueForVectorTexture(
              vectorStyleRef.current.fillTextureId,
              fillColor,
              vectorStyleRef.current.fillOpacity,
            )
          : fillColor;
        const vectorRenderStroke = isVectorMode
          ? getFabricStrokeValueForVectorBrush(
              vectorStyleRef.current.strokeBrushId,
              strokeColor,
              vectorStyleRef.current.strokeOpacity,
            )
          : strokeColor;
        let object: any;
        if (tool === 'rectangle') {
          const bounds = getStrokedShapeBoundsFromPathBounds(
            pointer.x,
            pointer.y,
            pointer.x,
            pointer.y,
            strokeWidth,
          );
          object = new Rect({
            left: bounds.left,
            top: bounds.top,
            originX: 'left',
            originY: 'top',
            width: 0,
            height: 0,
            fill: vectorRenderFill,
            opacity: 1,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            selectable: false,
            evented: false,
            vectorFillTextureId: isVectorMode ? vectorStyleRef.current.fillTextureId : undefined,
            vectorFillColor: isVectorMode ? fillColor : undefined,
            vectorFillOpacity: isVectorMode ? vectorStyleRef.current.fillOpacity : undefined,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
            vectorStrokeOpacity: isVectorMode ? vectorStyleRef.current.strokeOpacity : undefined,
          } as any);
        } else if (tool === 'circle') {
          const bounds = getStrokedShapeBoundsFromPathBounds(
            pointer.x,
            pointer.y,
            pointer.x,
            pointer.y,
            strokeWidth,
          );
          object = new Ellipse({
            left: bounds.left,
            top: bounds.top,
            rx: 0,
            ry: 0,
            fill: vectorRenderFill,
            opacity: 1,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            originX: 'left',
            originY: 'top',
            selectable: false,
            evented: false,
            vectorFillTextureId: isVectorMode ? vectorStyleRef.current.fillTextureId : undefined,
            vectorFillColor: isVectorMode ? fillColor : undefined,
            vectorFillOpacity: isVectorMode ? vectorStyleRef.current.fillOpacity : undefined,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
            vectorStrokeOpacity: isVectorMode ? vectorStyleRef.current.strokeOpacity : undefined,
          } as any);
        } else if (tool === 'triangle' || tool === 'star') {
          const polygonDraft = buildPolygonShapeDraft(tool, pointer, pointer);
          object = new Polygon(polygonDraft.points, {
            left: polygonDraft.left,
            top: polygonDraft.top,
            originX: 'center',
            originY: 'center',
            fill: vectorRenderFill,
            opacity: 1,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            objectCaching: false,
            selectable: false,
            evented: false,
            vectorFillTextureId: isVectorMode ? vectorStyleRef.current.fillTextureId : undefined,
            vectorFillColor: isVectorMode ? fillColor : undefined,
            vectorFillOpacity: isVectorMode ? vectorStyleRef.current.fillOpacity : undefined,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
            vectorStrokeOpacity: isVectorMode ? vectorStyleRef.current.strokeOpacity : undefined,
          } as any);
        } else {
          object = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            opacity: 1,
            stroke: vectorRenderStroke,
            strokeWidth,
            strokeUniform: isVectorMode,
            noScaleCache: !isVectorMode ? undefined : false,
            selectable: false,
            evented: false,
            vectorStrokeBrushId: isVectorMode ? vectorStyleRef.current.strokeBrushId : undefined,
            vectorStrokeColor: isVectorMode ? strokeColor : undefined,
            vectorStrokeOpacity: isVectorMode ? vectorStyleRef.current.strokeOpacity : undefined,
          } as any);
        }
        shapeDraftRef.current = {
          type: tool,
          anchor: { x: pointer.x, y: pointer.y },
          currentPointer: { x: pointer.x, y: pointer.y },
          moveSession: null,
          object,
        };
        fabricCanvas.add(object);
      }
    };

    const onMouseMove = (opt: any) => {
      const callbacks = callbacksRef.current;
      if (editorModeRef.current === 'vector' && activeToolRef.current === 'pen' && opt.e) {
        const pointer = fabricCanvas.getScenePoint(opt.e);
        if (penAnchorPlacementSessionRef.current) {
          if (callbacks.updatePenAnchorPlacement(pointer)) {
            fabricCanvas.requestRenderAll();
          }
          return;
        }

        const draft = penDraftRef.current;
        if (draft) {
          draft.previewPoint = new Point(pointer.x, pointer.y);
          fabricCanvas.requestRenderAll();
          return;
        }
      }

      const pointSelectionTransformSession = pointSelectionTransformSessionRef.current;
      if (pointSelectionTransformSession && opt.e) {
        const pointer = fabricCanvas.getScenePoint(opt.e);
        if (
          editorModeRef.current !== 'vector' ||
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== pointSelectionTransformSession.path ||
          !fabricCanvas.getObjects().includes(pointSelectionTransformSession.path)
        ) {
          pointSelectionTransformSessionRef.current = null;
          return;
        }

        const transformed = callbacks.applyPointSelectionTransformSession(pointSelectionTransformSession, pointer, opt.e);
        if (transformed) {
          pointSelectionTransformSession.hasChanged = true;
          fabricCanvas.setActiveObject(pointSelectionTransformSession.path);
          fabricCanvas.requestRenderAll();
        }
        return;
      }

      if (
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select' &&
        !pointSelectionMarqueeSessionRef.current &&
        !insertedPathAnchorDragSessionRef.current &&
        opt.e
      ) {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        if (pointEditingTarget && getFabricObjectType(pointEditingTarget) === 'path') {
          const pointer = fabricCanvas.getScenePoint(opt.e);
          const snapshot = callbacks.getSelectedPathAnchorTransformSnapshot(pointEditingTarget);
          const pointSelectionTransformHit = snapshot
            ? callbacks.hitPointSelectionTransform(snapshot, pointer)
            : null;
          const cursor = (() => {
            const rotationRadians = snapshot?.bounds.rotationRadians ?? 0;
            if (pointSelectionTransformHit === 'move') {
              return 'move';
            }
            if (pointSelectionTransformHit?.startsWith('scale-') || pointSelectionTransformHit?.startsWith('rotate-')) {
              return getTransformGizmoCursorForCornerTarget(pointSelectionTransformHit, rotationRadians);
            }
            return 'default';
          })();
          applyCanvasCursor(fabricCanvas, cursor);
        }
      }

      const pointSelectionMarqueeSession = pointSelectionMarqueeSessionRef.current;
      if (pointSelectionMarqueeSession && opt.e) {
        if (
          editorModeRef.current !== 'vector' ||
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== pointSelectionMarqueeSession.path ||
          !fabricCanvas.getObjects().includes(pointSelectionMarqueeSession.path)
        ) {
          pointSelectionMarqueeSessionRef.current = null;
          return;
        }

        const pointer = fabricCanvas.getScenePoint(opt.e);
        pointSelectionMarqueeSession.currentPointerScene = new Point(pointer.x, pointer.y);
        fabricCanvas.setActiveObject(pointSelectionMarqueeSession.path);
        fabricCanvas.requestRenderAll();
        return;
      }

      const insertedPathAnchorDragSession = insertedPathAnchorDragSessionRef.current;
      if (insertedPathAnchorDragSession && opt.e) {
        const { path, anchorIndex, dragState } = insertedPathAnchorDragSession;
        if (
          editorModeRef.current !== 'vector' ||
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== path ||
          !fabricCanvas.getObjects().includes(path)
        ) {
          insertedPathAnchorDragSessionRef.current = null;
          return;
        }

        const pointer = fabricCanvas.getScenePoint(opt.e);
        const pointerCommandPoint = callbacks.toPathCommandPoint(path, pointer);
        if (!pointerCommandPoint) return;

        const deltaX = pointerCommandPoint.x - dragState.previousAnchor.x;
        const deltaY = pointerCommandPoint.y - dragState.previousAnchor.y;
        const moved = callbacks.movePathAnchorByDelta(path, anchorIndex, deltaX, deltaY, dragState);
        if (moved) {
          callbacks.enforcePathAnchorHandleType(path, anchorIndex, 'anchor', dragState);
          activePathAnchorRef.current = { path, anchorIndex };
          path.setCoords?.();
          fabricCanvas.setActiveObject(path);
          fabricCanvas.requestRenderAll();
        }
        return;
      }

      if (!shapeDraftRef.current || !opt.e) return;
      const pointer = fabricCanvas.getScenePoint(opt.e);
      shapeDraftModifierState.alt = opt.e.altKey === true;
      shapeDraftModifierState.shift = opt.e.shiftKey === true;
      renderActiveShapeDraft(pointer);
    };

    const onMouseUp = () => {
      const callbacks = callbacksRef.current;
      clearUnifiedCanvasTransformGuide(fabricCanvas, true);
      if (penAnchorPlacementSessionRef.current) {
        callbacks.commitCurrentPenPlacement();
        fabricCanvas.requestRenderAll();
        return;
      }

      if (pointSelectionTransformSessionRef.current) {
        const shouldSave = pointSelectionTransformSessionRef.current.hasChanged;
        pointSelectionTransformSessionRef.current = null;
        if (shouldSave) {
          callbacks.saveHistory();
        }
        return;
      }

      if (pointSelectionMarqueeSessionRef.current) {
        const pointSelectionMarqueeSession = pointSelectionMarqueeSessionRef.current;
        pointSelectionMarqueeSessionRef.current = null;
        callbacks.applyPointSelectionMarqueeSession(pointSelectionMarqueeSession);
        if (
          vectorPointEditingTargetRef.current === pointSelectionMarqueeSession.path &&
          fabricCanvas.getObjects().includes(pointSelectionMarqueeSession.path)
        ) {
          fabricCanvas.setActiveObject(pointSelectionMarqueeSession.path);
        }
        fabricCanvas.requestRenderAll();
        return;
      }

      if (insertedPathAnchorDragSessionRef.current) {
        insertedPathAnchorDragSessionRef.current = null;
        callbacks.saveHistory();
        return;
      }

      if (mirroredPathAnchorDragSessionRef.current) {
        const shouldSave = mirroredPathAnchorDragSessionRef.current.hasChanged;
        mirroredPathAnchorDragSessionRef.current = null;
        if (shouldSave) {
          callbacks.saveHistory();
        }
        return;
      }

      if (!shapeDraftRef.current) return;
      const completedShapeDraft = shapeDraftRef.current;
      shapeDraftRef.current = null;
      if (editorModeRef.current === 'bitmap') {
        const bitmapShapeObject = completedShapeDraft.object;
        void (async () => {
          await callbacks.flattenBitmapLayer(bitmapShapeObject);
          callbacks.configureCanvasForTool();
        })();
      } else {
        callbacks.saveHistory();
        callbacks.configureCanvasForTool();
      }
    };

    const onPathCreated = (event: { path?: any }) => {
      const callbacks = callbacksRef.current;
      if (editorModeRef.current !== 'bitmap') {
        const createdPath = event?.path;
        if (createdPath && editorModeRef.current === 'vector' && activeToolRef.current === 'brush') {
          normalizeVectorObjectRendering(createdPath);
          createdPath.setCoords?.();
          callbacks.syncVectorStyleFromSelection();
          callbacks.syncSelectionState();
          fabricCanvas.requestRenderAll();
        }
        callbacks.saveHistory();
        return;
      }

      void (async () => {
        await callbacks.flattenBitmapLayer(event?.path);
        const activeBrush = (fabricCanvas as any).freeDrawingBrush;
        if (typeof activeBrush?.completeDeferredPreview === 'function') {
          activeBrush.completeDeferredPreview((event?.path as any)?.__bitmapDeferredPreviewToken);
        }
      })();
    };

    const onObjectModified = () => {
      clearUnifiedCanvasTransformGuide(fabricCanvas, true);
      if (editorModeRef.current === 'vector') {
        callbacksRef.current.saveHistory();
      }
    };

    const onSelectionChange = () => {
      const callbacks = callbacksRef.current;
      const activeObject = fabricCanvas.getActiveObject() as any;
      if (
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select' &&
        vectorPointEditingTargetRef.current &&
        activeObject !== vectorPointEditingTargetRef.current
      ) {
        callbacks.restoreAllOriginalControls();
        callbacks.setVectorPointEditingTarget(null);
        queueMicrotask(() => {
          callbacksRef.current.configureCanvasForTool();
        });
      }
      callbacks.syncTextStyleFromSelection();
      callbacks.syncVectorStyleFromSelection();
      callbacks.syncTextSelectionState();
      callbacks.syncSelectionState();
      if (
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select' &&
        vectorPointEditingTargetRef.current &&
        activeObject === vectorPointEditingTargetRef.current
      ) {
        callbacks.activateVectorPointEditing(activeObject, false);
        callbacks.configureCanvasForTool();
      } else {
        callbacks.configureCanvasForTool();
      }
    };

    const onTextChanged = () => {
      if (editorModeRef.current !== 'vector') return;
      callbacksRef.current.syncTextStyleFromSelection();
      callbacksRef.current.syncTextSelectionState();
      callbacksRef.current.saveHistory();
    };

    const onAfterRender = () => {
      const vectorStrokeCtx = vectorStrokeCtxRef.current;
      if (vectorStrokeCtx) {
        callbacksRef.current.renderVectorBrushStrokeOverlay(vectorStrokeCtx);
      }
      callbacksRef.current.renderVectorPointEditingGuide();
      callbacksRef.current.onFabricCanvasAfterRender();
    };

    const onSelectionCleared = () => {
      const callbacks = callbacksRef.current;
      clearUnifiedCanvasTransformGuide(fabricCanvas, true);
      if (
        editorModeRef.current === 'bitmap' &&
        activeToolRef.current === 'select' &&
        bitmapFloatingObjectRef.current &&
        !bitmapSelectionBusyRef.current &&
        !suppressBitmapSelectionAutoCommitRef.current
      ) {
        void callbacks.commitBitmapSelection();
        return;
      }
      if (
        vectorPointEditingTargetRef.current &&
        editorModeRef.current === 'vector' &&
        activeToolRef.current === 'select'
      ) {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        queueMicrotask(() => {
          const canvas = fabricCanvasRef.current;
          if (!canvas) return;
          if (vectorPointEditingTargetRef.current !== pointEditingTarget) return;
          if (!canvas.getObjects().includes(pointEditingTarget)) {
            callbacksRef.current.restoreAllOriginalControls();
            callbacksRef.current.setVectorPointEditingTarget(null);
            callbacksRef.current.configureCanvasForTool();
            return;
          }
          canvas.setActiveObject(pointEditingTarget);
          callbacksRef.current.configureCanvasForTool();
        });
        return;
      }
      if (vectorPointEditingTargetRef.current) {
        callbacks.restoreAllOriginalControls();
        callbacks.setVectorPointEditingTarget(null);
        queueMicrotask(() => {
          callbacksRef.current.configureCanvasForTool();
        });
      }
      activePathAnchorRef.current = null;
      callbacks.syncSelectionState();
    };

    fabricCanvas.on('mouse:down', onMouseDown);
    fabricCanvas.on('mouse:move', onMouseMove);
    fabricCanvas.on('mouse:up', onMouseUp);
    fabricCanvas.on('path:created', onPathCreated);
    fabricCanvas.on('object:modified', onObjectModified);
    fabricCanvas.on('selection:created', onSelectionChange);
    fabricCanvas.on('selection:updated', onSelectionChange);
    fabricCanvas.on('selection:cleared', onSelectionCleared);
    fabricCanvas.on('text:changed', onTextChanged);
    fabricCanvas.on('text:editing:exited', onTextChanged);
    fabricCanvas.on('after:render', onAfterRender);
    window.addEventListener('keydown', handleShapeModifierKeyDown, true);
    window.addEventListener('keyup', handleShapeModifierKeyUp, true);
    document.addEventListener('keydown', handleShapeModifierKeyDown, true);
    document.addEventListener('keyup', handleShapeModifierKeyUp, true);

    const vectorStrokeCanvas = vectorStrokeCanvasRef.current;
    if (vectorStrokeCanvas) {
      vectorStrokeCtxRef.current = vectorStrokeCanvas.getContext('2d');
    }
    const vectorGuideCanvas = vectorGuideCanvasRef.current;
    if (vectorGuideCanvas) {
      vectorGuideCtxRef.current = vectorGuideCanvas.getContext('2d');
    }
    const bitmapSelectionCanvas = bitmapSelectionCanvasRef.current;
    if (bitmapSelectionCanvas) {
      bitmapSelectionCtxRef.current = bitmapSelectionCanvas.getContext('2d');
      callbacksRef.current.drawBitmapSelectionOverlay();
    }

    callbacksRef.current.saveHistory();
    callbacksRef.current.syncActiveLayerCanvasVisibility();
    callbacksRef.current.configureCanvasForTool();

    disposeFabricCanvasRef.current = () => {
      callbacksRef.current.restoreAllOriginalControls();
      fabricCanvas.off('mouse:down', onMouseDown);
      fabricCanvas.off('mouse:move', onMouseMove);
      fabricCanvas.off('mouse:up', onMouseUp);
      fabricCanvas.off('path:created', onPathCreated);
      fabricCanvas.off('object:modified', onObjectModified);
      fabricCanvas.off('selection:created', onSelectionChange);
      fabricCanvas.off('selection:updated', onSelectionChange);
      fabricCanvas.off('selection:cleared', onSelectionCleared);
      fabricCanvas.off('text:changed', onTextChanged);
      fabricCanvas.off('text:editing:exited', onTextChanged);
      fabricCanvas.off('after:render', onAfterRender);
      window.removeEventListener('keydown', handleShapeModifierKeyDown, true);
      window.removeEventListener('keyup', handleShapeModifierKeyUp, true);
      document.removeEventListener('keydown', handleShapeModifierKeyDown, true);
      document.removeEventListener('keyup', handleShapeModifierKeyUp, true);
      fabricCanvas.dispose();
      fabricCanvasHostRef.current?.replaceChildren();
      fabricCanvasElementRef.current = null;
      fabricCanvasRef.current = null;
      vectorStrokeCtxRef.current = null;
      vectorGuideCtxRef.current = null;
      bitmapSelectionCtxRef.current = null;
    };
  }, [hostElement]);

  useEffect(() => {
    return () => {
      disposeFabricCanvasRef.current?.();
      disposeFabricCanvasRef.current = null;
    };
  }, []);
}

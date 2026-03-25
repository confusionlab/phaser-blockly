import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { ActiveSelection, Point, util, type Canvas as FabricCanvas } from 'fabric';
import { applyBitmapBucketFill } from '@/lib/background/bitmapFillCore';
import {
  createEmptyCostumeVectorDocument,
  resolveActiveCostumeLayerEditorLoadState,
} from '@/lib/costume/costumeDocument';
import type {
  AlignAction,
  BitmapFillStyle,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorStyleCapabilities,
  VectorToolStyle,
} from './CostumeToolbar';
import type {
  CostumeDocument,
  CostumeEditorMode,
  CostumeVectorDocument,
} from '@/types';
import { deleteActiveCanvasSelection } from './costumeSelectionCommands';
import { CANVAS_SIZE, normalizeDegrees, type CanvasSelectionBoundsSnapshot } from './costumeCanvasShared';
import {
  applyVectorFillStyleToObject,
  applyVectorStrokeStyleToObject,
  getVectorObjectFillColor,
  getVectorObjectFillTextureId,
  getVectorObjectStrokeBrushId,
  getVectorObjectStrokeColor,
  getVectorStyleCapabilitiesForSelection,
  getVectorStyleTargets,
  isActiveSelectionObject,
  isTextObject,
  vectorObjectSupportsFill,
  VECTOR_JSON_EXTRA_PROPS,
} from './costumeCanvasVectorRuntime';

interface UseCostumeCanvasCommandControllerOptions {
  activeDocumentLayerId?: string;
  activeLayerOpacity: number;
  activeLayerVisible: boolean;
  bitmapFillStyleRef: MutableRefObject<BitmapFillStyle>;
  bitmapFloatingObjectRef: MutableRefObject<any | null>;
  bitmapMarqueeRectRef: MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  bitmapSelectionCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  bitmapSelectionBusyRef: MutableRefObject<boolean>;
  bitmapSelectionDragModeRef: MutableRefObject<'none' | 'marquee'>;
  bitmapSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  brushColorRef: MutableRefObject<string>;
  commitHostedLayerSurfaceSnapshot: (layerId: string | null) => void;
  documentLayers: CostumeDocument['layers'];
  drawBitmapSelectionOverlay: () => void;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getActiveLayerCanvasElement: () => HTMLCanvasElement;
  getSelectionBoundsSnapshot: () => CanvasSelectionBoundsSnapshot | null;
  hostedLayerIdRef: MutableRefObject<string | null>;
  isLoadRequestActive: (requestId?: number) => boolean;
  isHostedLayerReadyRef: MutableRefObject<boolean>;
  lastCommittedSnapshotRef: MutableRefObject<any>;
  layerSurfaceRefs: MutableRefObject<Map<string, HTMLCanvasElement>>;
  loadBitmapAsSingleVectorImage: (bitmapCanvas: HTMLCanvasElement, requestId?: number) => Promise<boolean>;
  loadBitmapLayer: (dataUrl: string, selectable: boolean, requestId?: number) => Promise<boolean>;
  loadRequestIdRef: MutableRefObject<number>;
  loadedSessionKeyRef: MutableRefObject<string | null>;
  markCurrentSnapshotPersisted: (sessionKey?: string | null) => void;
  normalizeCanvasVectorStrokeUniform: () => boolean;
  onTextSelectionChangeRef: MutableRefObject<((hasTextSelection: boolean) => void) | undefined>;
  onTextStyleSyncRef: MutableRefObject<((updates: Partial<TextToolStyle>) => void) | undefined>;
  onVectorStyleCapabilitiesSyncRef: MutableRefObject<((capabilities: VectorStyleCapabilities) => void) | undefined>;
  onVectorStyleSyncRef: MutableRefObject<((updates: Partial<VectorToolStyle>) => void) | undefined>;
  renderVectorBrushStrokeOverlay: (ctx: CanvasRenderingContext2D, options?: { clear?: boolean }) => void;
  resolveBitmapFillTextureSource: (textureId: BitmapFillStyle['textureId']) => CanvasImageSource | null;
  restoreCanvasSelection: (selectedObjects: any[]) => void;
  saveHistory: () => void;
  setEditorMode: (mode: CostumeEditorMode) => void;
  setHasBitmapFloatingSelection: Dispatch<SetStateAction<boolean>>;
  setHostedLayerId: (layerId: string | null) => void;
  setHostedLayerReady: (ready: boolean) => void;
  suppressBitmapSelectionAutoCommitRef: MutableRefObject<boolean>;
  suppressHistoryRef: MutableRefObject<boolean>;
  syncSelectionState: () => void;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  waitForFabricCanvas: (requestId?: number) => Promise<FabricCanvas | null>;
}

export function useCostumeCanvasCommandController({
  activeDocumentLayerId,
  activeLayerOpacity,
  activeLayerVisible,
  bitmapFillStyleRef,
  bitmapFloatingObjectRef,
  bitmapMarqueeRectRef,
  bitmapSelectionCanvasRef,
  bitmapSelectionBusyRef,
  bitmapSelectionDragModeRef,
  bitmapSelectionStartRef,
  brushColorRef,
  commitHostedLayerSurfaceSnapshot,
  documentLayers,
  drawBitmapSelectionOverlay,
  editorModeRef,
  fabricCanvasRef,
  getActiveLayerCanvasElement,
  getSelectionBoundsSnapshot,
  hostedLayerIdRef,
  isLoadRequestActive,
  isHostedLayerReadyRef,
  lastCommittedSnapshotRef,
  layerSurfaceRefs,
  loadBitmapAsSingleVectorImage,
  loadBitmapLayer,
  loadRequestIdRef,
  loadedSessionKeyRef,
  markCurrentSnapshotPersisted,
  normalizeCanvasVectorStrokeUniform,
  onTextSelectionChangeRef,
  onTextStyleSyncRef,
  onVectorStyleCapabilitiesSyncRef,
  onVectorStyleSyncRef,
  renderVectorBrushStrokeOverlay,
  resolveBitmapFillTextureSource,
  restoreCanvasSelection,
  saveHistory,
  setEditorMode,
  setHasBitmapFloatingSelection,
  setHostedLayerId,
  setHostedLayerReady,
  suppressBitmapSelectionAutoCommitRef,
  suppressHistoryRef,
  syncSelectionState,
  textStyle,
  vectorStyle,
  waitForFabricCanvas,
}: UseCostumeCanvasCommandControllerOptions) {
  const getComposedCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    const hostedLayerId = hostedLayerIdRef.current ?? activeDocumentLayerId;
    const canRenderHostedLayer = !!fabricCanvas && isHostedLayerReadyRef.current;
    const baseCanvas = canRenderHostedLayer ? getActiveLayerCanvasElement() : null;
    const composed = document.createElement('canvas');
    composed.width = CANVAS_SIZE;
    composed.height = CANVAS_SIZE;
    const composedCtx = composed.getContext('2d');
    if (!composedCtx) {
      return baseCanvas ?? composed;
    }

    for (const layer of documentLayers) {
      if (canRenderHostedLayer && layer.id === hostedLayerId && baseCanvas) {
          composedCtx.save();
          composedCtx.globalAlpha = activeLayerVisible ? activeLayerOpacity : 0;
          composedCtx.drawImage(baseCanvas, 0, 0);
          renderVectorBrushStrokeOverlay(composedCtx, { clear: false });
          composedCtx.restore();
        continue;
      }

      if (!layer.visible || layer.opacity <= 0) {
        continue;
      }

      const layerSurface = layerSurfaceRefs.current.get(layer.id);
      if (!layerSurface) {
        continue;
      }

      composedCtx.save();
      composedCtx.globalAlpha = layer.opacity;
      composedCtx.drawImage(layerSurface, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      composedCtx.restore();
    }

    return composed;
  }, [
    activeDocumentLayerId,
    activeLayerOpacity,
    activeLayerVisible,
    documentLayers,
    fabricCanvasRef,
    getActiveLayerCanvasElement,
    hostedLayerIdRef,
    isHostedLayerReadyRef,
    layerSurfaceRefs,
    renderVectorBrushStrokeOverlay,
  ]);

  const getSelectionMousePos = useCallback((event: MouseEvent) => {
    const canvas = bitmapSelectionCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: Math.max(0, Math.min(CANVAS_SIZE, (event.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(CANVAS_SIZE, (event.clientY - rect.top) * scaleY)),
    };
  }, [bitmapSelectionCanvasRef]);

  const pickBitmapLayerAtPoint = useCallback((point: { x: number; y: number }): string | null => {
    const x = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(point.y)));
    const hostedLayerId = hostedLayerIdRef.current ?? activeDocumentLayerId;
    const canUseHostedLayer = isHostedLayerReadyRef.current;

    for (let index = documentLayers.length - 1; index >= 0; index -= 1) {
      const layer = documentLayers[index];
      if (!layer || !layer.visible || layer.opacity <= 0) {
        continue;
      }

      const sourceCanvas = canUseHostedLayer && layer.id === hostedLayerId
        ? fabricCanvasRef.current?.toCanvasElement(1) ?? null
        : layerSurfaceRefs.current.get(layer.id) ?? null;
      if (!sourceCanvas) {
        continue;
      }

      const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      const alpha = ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
      if (alpha > 0) {
        return layer.id;
      }
    }

    return null;
  }, [activeDocumentLayerId, documentLayers, fabricCanvasRef, hostedLayerIdRef, isHostedLayerReadyRef, layerSurfaceRefs]);

  const applySelectionTransform = useCallback((transform: Parameters<typeof util.applyTransformToObject>[1]): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectedObjects = selectionSnapshot.selectedObjects.filter(Boolean);
    if (selectedObjects.length === 0) {
      return false;
    }

    if (isActiveSelectionObject(activeObject)) {
      fabricCanvas.discardActiveObject();
    }

    let changed = false;
    for (const obj of selectedObjects) {
      if (typeof obj?.calcTransformMatrix !== 'function') {
        continue;
      }
      const nextMatrix = util.multiplyTransformMatrices(transform, obj.calcTransformMatrix());
      util.applyTransformToObject(obj, nextMatrix);
      obj.setCoords?.();
      changed = true;
    }

    restoreCanvasSelection(selectedObjects);

    if (!changed) {
      return false;
    }

    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [fabricCanvasRef, getSelectionBoundsSnapshot, restoreCanvasSelection, saveHistory, syncSelectionState]);

  const deleteBitmapFloatingSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = bitmapFloatingObjectRef.current;
    if (!fabricCanvas || !floatingObject) return false;
    if (editorModeRef.current !== 'bitmap') return false;
    if (bitmapSelectionBusyRef.current) return false;

    suppressBitmapSelectionAutoCommitRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }

      fabricCanvas.remove(floatingObject);
      bitmapFloatingObjectRef.current = null;
      setHasBitmapFloatingSelection(false);
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();
      fabricCanvas.requestRenderAll();
      syncSelectionState();
      saveHistory();
      return true;
    } finally {
      queueMicrotask(() => {
        suppressBitmapSelectionAutoCommitRef.current = false;
      });
    }
  }, [
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapSelectionBusyRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    editorModeRef,
    fabricCanvasRef,
    saveHistory,
    setHasBitmapFloatingSelection,
    suppressBitmapSelectionAutoCommitRef,
    syncSelectionState,
  ]);

  const syncTextStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || !isTextObject(activeObject)) return;
    const textObj = activeObject as any;

    onTextStyleSyncRef.current?.({
      fontFamily: typeof textObj.fontFamily === 'string' ? textObj.fontFamily : undefined,
      fontSize: typeof textObj.fontSize === 'number' ? textObj.fontSize : undefined,
      fontWeight: textObj.fontWeight === 'bold' ? 'bold' : 'normal',
      fontStyle: textObj.fontStyle === 'italic' ? 'italic' : 'normal',
      underline: textObj.underline === true,
      textAlign: textObj.textAlign === 'center' || textObj.textAlign === 'right' ? textObj.textAlign : 'left',
      opacity: typeof textObj.opacity === 'number' ? textObj.opacity : undefined,
    });
  }, [fabricCanvasRef, onTextStyleSyncRef]);

  const syncVectorStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onVectorStyleCapabilitiesSyncRef.current?.(getVectorStyleCapabilitiesForSelection(activeObject));
    const [vectorObject] = getVectorStyleTargets(activeObject);
    if (!vectorObject) return;

    onVectorStyleSyncRef.current?.({
      fillColor: getVectorObjectFillColor(vectorObject),
      fillTextureId: getVectorObjectFillTextureId(vectorObject),
      strokeColor: getVectorObjectStrokeColor(vectorObject),
      strokeWidth: typeof vectorObject.strokeWidth === 'number' ? vectorObject.strokeWidth : undefined,
      strokeBrushId: getVectorObjectStrokeBrushId(vectorObject),
    });
  }, [fabricCanvasRef, onVectorStyleCapabilitiesSyncRef, onVectorStyleSyncRef]);

  const syncTextSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onTextSelectionChangeRef.current?.(!!activeObject && isTextObject(activeObject));
  }, [fabricCanvasRef, onTextSelectionChangeRef]);

  const applyFill = useCallback(async (x: number, y: number) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'bitmap') return;

    const raster = fabricCanvas.toCanvasElement(1);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const didFill = applyBitmapBucketFill(
      imageData,
      Math.floor(x),
      Math.floor(y),
      {
        fillColor: brushColorRef.current,
        textureId: bitmapFillStyleRef.current.textureId,
      },
      {
        textureSource: resolveBitmapFillTextureSource(bitmapFillStyleRef.current.textureId),
      },
    );
    if (!didFill) {
      return;
    }

    ctx.putImageData(imageData, 0, 0);
    const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
    if (!loaded) return;
    saveHistory();
  }, [
    bitmapFillStyleRef,
    brushColorRef,
    editorModeRef,
    fabricCanvasRef,
    loadBitmapLayer,
    resolveBitmapFillTextureSource,
    saveHistory,
  ]);

  const switchEditorMode = useCallback(async (nextMode: CostumeEditorMode) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    if (editorModeRef.current === nextMode) return;

    const rasterizedCanvas = getActiveLayerCanvasElement();
    const rasterized = rasterizedCanvas.toDataURL('image/png');

    if (nextMode === 'bitmap') {
      const loaded = await loadBitmapLayer(rasterized, false);
      if (!loaded) return;
      setEditorMode('bitmap');
    } else {
      const loaded = await loadBitmapAsSingleVectorImage(rasterizedCanvas);
      if (!loaded) return;
      setEditorMode('vector');
    }

    saveHistory();
  }, [
    editorModeRef,
    fabricCanvasRef,
    getActiveLayerCanvasElement,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    saveHistory,
    setEditorMode,
  ]);

  const exportCostumeState = useCallback((sessionKey?: string | null): {
    activeLayerDataUrl: string;
    editorMode: CostumeEditorMode;
    vectorDocument?: CostumeVectorDocument;
  } | null => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return null;
    }

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        activeLayerDataUrl: '',
        editorMode: editorModeRef.current,
      };
    }

    const activeLayerDataUrl = fabricCanvas.toCanvasElement(1).toDataURL('image/png');

    if (editorModeRef.current === 'vector') {
      return {
        activeLayerDataUrl,
        editorMode: 'vector',
        vectorDocument: {
          engine: 'fabric',
          version: 1,
          fabricJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
        },
      };
    }

    return {
      activeLayerDataUrl,
      editorMode: editorModeRef.current,
    };
  }, [editorModeRef, fabricCanvasRef, loadedSessionKeyRef]);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current === 'bitmap') {
      return deleteBitmapFloatingSelection();
    }
    if (editorModeRef.current !== 'vector') return false;
    const deleted = deleteActiveCanvasSelection(fabricCanvas);
    if (!deleted) return false;
    saveHistory();
    return true;
  }, [deleteBitmapFloatingSelection, editorModeRef, fabricCanvasRef, saveHistory]);

  const cloneFabricObject = useCallback(async (obj: any) => {
    if (!obj || typeof obj.clone !== 'function') {
      throw new Error('Object is not cloneable');
    }

    const maybePromise = obj.clone();
    if (maybePromise && typeof maybePromise.then === 'function') {
      return await maybePromise;
    }

    return await new Promise<any>((resolve) => {
      obj.clone((cloned: any) => resolve(cloned));
    });
  }, []);

  const duplicateSelection = useCallback(async (): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    const moveOffset = 20;
    const clones: any[] = [];

    if (isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function') {
      const selectedObjects = (activeObject.getObjects() as any[]).filter(Boolean);
      for (const selected of selectedObjects) {
        const cloned = await cloneFabricObject(selected);
        cloned.set({
          left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
          top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
        });
        fabricCanvas.add(cloned);
        clones.push(cloned);
      }
    } else {
      const cloned = await cloneFabricObject(activeObject);
      cloned.set({
        left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
        top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
      });
      fabricCanvas.add(cloned);
      clones.push(cloned);
    }

    if (clones.length === 0) return false;

    if (clones.length === 1) {
      fabricCanvas.setActiveObject(clones[0]);
    } else {
      const nextSelection = new ActiveSelection(clones, { canvas: fabricCanvas });
      fabricCanvas.setActiveObject(nextSelection);
    }

    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [cloneFabricObject, editorModeRef, fabricCanvasRef, saveHistory]);

  const moveSelectionOrder = useCallback((action: MoveOrderAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    const selectedObjects = isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function'
      ? (activeObject.getObjects() as any[]).filter(Boolean)
      : [activeObject];
    if (selectedObjects.length === 0) return false;

    const stack = fabricCanvas.getObjects();
    const withIndices = selectedObjects
      .map((obj) => ({ obj, index: stack.indexOf(obj) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index);
    if (withIndices.length === 0) return false;

    if (action === 'forward') {
      for (const entry of [...withIndices].reverse()) {
        fabricCanvas.bringObjectForward(entry.obj, false);
      }
    } else if (action === 'backward') {
      for (const entry of withIndices) {
        fabricCanvas.sendObjectBackwards(entry.obj, false);
      }
    } else if (action === 'front') {
      for (const entry of withIndices) {
        fabricCanvas.bringObjectToFront(entry.obj);
      }
    } else {
      for (const entry of [...withIndices].reverse()) {
        fabricCanvas.sendObjectToBack(entry.obj);
      }
    }

    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [editorModeRef, fabricCanvasRef, saveHistory]);

  const flipSelection = useCallback((axis: SelectionFlipAxis): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const centerX = selectionSnapshot.bounds.left + selectionSnapshot.bounds.width / 2;
    const centerY = selectionSnapshot.bounds.top + selectionSnapshot.bounds.height / 2;
    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectedObjects = selectionSnapshot.selectedObjects.filter(Boolean);
    if (selectedObjects.length === 0) {
      return false;
    }

    if (isActiveSelectionObject(activeObject)) {
      fabricCanvas.discardActiveObject();
    }

    let changed = false;
    for (const obj of selectedObjects) {
      if (typeof obj?.getCenterPoint !== 'function') {
        continue;
      }

      const currentCenter = obj.getCenterPoint();
      const nextCenter = new Point(
        axis === 'horizontal' ? centerX * 2 - currentCenter.x : currentCenter.x,
        axis === 'vertical' ? centerY * 2 - currentCenter.y : currentCenter.y,
      );
      const nextAngle = normalizeDegrees(-((typeof obj.angle === 'number' ? obj.angle : 0)));
      const currentFlipX = obj.flipX === true;
      const currentFlipY = obj.flipY === true;

      obj.set({
        angle: nextAngle,
        flipX: axis === 'horizontal' ? !currentFlipX : currentFlipX,
        flipY: axis === 'vertical' ? !currentFlipY : currentFlipY,
      });
      if (typeof obj.setPositionByOrigin === 'function') {
        obj.setPositionByOrigin(nextCenter, 'center', 'center');
      } else {
        obj.set({
          left: nextCenter.x,
          top: nextCenter.y,
          originX: 'center',
          originY: 'center',
        });
      }
      obj.setCoords?.();
      changed = true;
    }

    if (!changed) {
      return false;
    }

    restoreCanvasSelection(selectedObjects);
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [fabricCanvasRef, getSelectionBoundsSnapshot, restoreCanvasSelection, saveHistory, syncSelectionState]);

  const rotateSelection = useCallback((): boolean => {
    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const centerX = selectionSnapshot.bounds.left + selectionSnapshot.bounds.width / 2;
    const centerY = selectionSnapshot.bounds.top + selectionSnapshot.bounds.height / 2;
    const transform = util.createRotateMatrix({ angle: 90 }, { x: centerX, y: centerY });
    return applySelectionTransform(transform);
  }, [applySelectionTransform, getSelectionBoundsSnapshot]);

  const alignSelection = useCallback((action: AlignAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const { selectionObject, selectedObjects, bounds } = selectionSnapshot;
    let targetLeft = bounds.left;
    let targetTop = bounds.top;
    if (action === 'left') {
      targetLeft = 0;
    } else if (action === 'center-x') {
      targetLeft = (CANVAS_SIZE - bounds.width) / 2;
    } else if (action === 'right') {
      targetLeft = CANVAS_SIZE - bounds.width;
    }

    if (action === 'top') {
      targetTop = 0;
    } else if (action === 'center-y') {
      targetTop = (CANVAS_SIZE - bounds.height) / 2;
    } else if (action === 'bottom') {
      targetTop = CANVAS_SIZE - bounds.height;
    }

    const dx = targetLeft - bounds.left;
    const dy = targetTop - bounds.top;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return false;
    }

    for (const obj of selectedObjects) {
      obj.set({
        left: (typeof obj.left === 'number' ? obj.left : 0) + dx,
        top: (typeof obj.top === 'number' ? obj.top : 0) + dy,
      });
      obj.setCoords?.();
    }

    selectionObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    saveHistory();
    syncSelectionState();
    return true;
  }, [fabricCanvasRef, getSelectionBoundsSnapshot, saveHistory, syncSelectionState]);

  const isTextEditing = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return false;
    const activeObject = fabricCanvas.getActiveObject() as any;
    return !!activeObject && isTextObject(activeObject) && !!(activeObject as any).isEditing;
  }, [editorModeRef, fabricCanvasRef]);

  const loadDocument = useCallback(async (sessionKey: string, costumeDocument: CostumeDocument) => {
    const requestId = ++loadRequestIdRef.current;
    const fabricCanvas = await waitForFabricCanvas(requestId);
    if (!fabricCanvas) return;
    const previousHostedLayerId = hostedLayerIdRef.current ?? activeDocumentLayerId ?? null;
    commitHostedLayerSurfaceSnapshot(previousHostedLayerId);
    setHostedLayerReady(false);
    loadedSessionKeyRef.current = null;

    const requestedState = resolveActiveCostumeLayerEditorLoadState(costumeDocument);
    const nextHostedLayerId = requestedState.activeLayerId;
    if (requestedState.editorMode === 'vector') {
      const requestedVectorDocument = requestedState.vectorDocument ?? createEmptyCostumeVectorDocument();
      try {
        const parsed = JSON.parse(requestedVectorDocument.fabricJson);
        suppressHistoryRef.current = true;
        fabricCanvas.clear();
        await fabricCanvas.loadFromJSON(parsed);
        normalizeCanvasVectorStrokeUniform();
        if (!isLoadRequestActive(requestId)) return;
        fabricCanvas.requestRenderAll();
        setEditorMode('vector');
      } catch (error) {
        console.warn('Invalid vector document. Loading an empty active vector layer instead.', error);
        suppressHistoryRef.current = true;
        try {
          fabricCanvas.clear();
          if (!isLoadRequestActive(requestId)) return;
          fabricCanvas.requestRenderAll();
          setEditorMode('vector');
        } finally {
          suppressHistoryRef.current = false;
        }
      } finally {
        suppressHistoryRef.current = false;
      }
    } else {
      const loaded = await loadBitmapLayer(requestedState.bitmapAssetId ?? '', false, requestId);
      if (!loaded || !isLoadRequestActive(requestId)) {
        const resetToBlank = await loadBitmapLayer('', false, requestId);
        if (!resetToBlank || !isLoadRequestActive(requestId)) return;
      }
      setEditorMode('bitmap');
    }

    if (!isLoadRequestActive(requestId)) return;
    setHostedLayerId(nextHostedLayerId);
    setHostedLayerReady(true);
    loadedSessionKeyRef.current = sessionKey;
    lastCommittedSnapshotRef.current = null;
    saveHistory();
    markCurrentSnapshotPersisted(sessionKey);
  }, [
    activeDocumentLayerId,
    commitHostedLayerSurfaceSnapshot,
    hostedLayerIdRef,
    isLoadRequestActive,
    lastCommittedSnapshotRef,
    loadBitmapLayer,
    loadRequestIdRef,
    loadedSessionKeyRef,
    markCurrentSnapshotPersisted,
    normalizeCanvasVectorStrokeUniform,
    saveHistory,
    setEditorMode,
    setHostedLayerId,
    setHostedLayerReady,
    suppressHistoryRef,
    waitForFabricCanvas,
  ]);

  const syncActiveVectorStyle = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return;

    let changed = false;
    if (isTextObject(activeObject)) {
      const textObject = activeObject as any;
      if (textObject.fill !== brushColorRef.current) changed = true;
      if (textObject.fontFamily !== textStyle.fontFamily) changed = true;
      if (textObject.fontSize !== textStyle.fontSize) changed = true;
      if (textObject.fontWeight !== textStyle.fontWeight) changed = true;
      if (textObject.fontStyle !== textStyle.fontStyle) changed = true;
      if (textObject.underline !== textStyle.underline) changed = true;
      if (textObject.textAlign !== textStyle.textAlign) changed = true;
      if (textObject.opacity !== textStyle.opacity) changed = true;
      textObject.set({
        fill: brushColorRef.current,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        underline: textStyle.underline,
        textAlign: textStyle.textAlign,
        opacity: textStyle.opacity,
      });
    } else {
      const strokeWidth = Math.max(0, vectorStyle.strokeWidth);
      const vectorTargets = getVectorStyleTargets(activeObject);
      if (!vectorTargets.length) return;

      vectorTargets.forEach((target) => {
        const shouldPreserveCenter =
          target.strokeUniform !== true ||
          target.strokeWidth !== strokeWidth;
        const centerPoint = shouldPreserveCenter && typeof target.getCenterPoint === 'function'
          ? target.getCenterPoint()
          : null;
        const fillChanged = vectorObjectSupportsFill(target)
          ? applyVectorFillStyleToObject(target, {
              fillColor: vectorStyle.fillColor,
              fillTextureId: vectorStyle.fillTextureId,
            })
          : false;
        const strokeChanged = applyVectorStrokeStyleToObject(target, {
          strokeColor: vectorStyle.strokeColor,
          strokeWidth,
          strokeBrushId: vectorStyle.strokeBrushId,
        });
        changed = changed || fillChanged;
        changed = changed || strokeChanged;
        if (strokeChanged && centerPoint && typeof target.setPositionByOrigin === 'function') {
          target.setPositionByOrigin(centerPoint, 'center', 'center');
        }
        target.setCoords?.();
      });
    }

    if (!changed) return;

    activeObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [brushColorRef, editorModeRef, fabricCanvasRef, saveHistory, textStyle, vectorStyle]);

  return {
    alignSelection,
    applyFill,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getComposedCanvasElement,
    getSelectionMousePos,
    isTextEditing,
    loadDocument,
    moveSelectionOrder,
    pickBitmapLayerAtPoint,
    rotateSelection,
    switchEditorMode,
    syncActiveVectorStyle,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
  };
}

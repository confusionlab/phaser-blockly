import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { ActiveSelection, type Canvas as FabricCanvas } from 'fabric';
import { applyBitmapBucketFill } from '@/lib/background/bitmapFillCore';
import { getCanvas2dContext } from '@/utils/canvas2d';
import {
  createEmptyCostumeVectorDocument,
  resolveActiveCostumeLayerEditorLoadState,
} from '@/lib/costume/costumeDocument';
import { optimizeCostumeRasterCanvas } from '@/lib/costume/costumeAssetOptimization';
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
  CostumeAssetFrame,
  CostumeDocument,
  CostumeEditorMode,
  CostumeVectorDocument,
} from '@/types';
import { CANVAS_SIZE, type CanvasSelectionBoundsSnapshot } from './costumeCanvasShared';
import {
  applyVectorFillStyleToObject,
  applyVectorStrokeStyleToObject,
  getVectorObjectFillColor,
  getVectorObjectFillOpacity,
  getVectorObjectFillTextureId,
  getVectorObjectStrokeBrushId,
  getVectorObjectStrokeColor,
  getVectorObjectStrokeOpacity,
  getVectorStyleCapabilitiesForSelection,
  getVectorStyleTargets,
  isActiveSelectionObject,
  isTextObject,
  vectorObjectSupportsFill,
  VECTOR_JSON_EXTRA_PROPS,
} from './costumeCanvasVectorRuntime';
import { useCostumeCanvasSelectionTransformCommands } from './useCostumeCanvasSelectionTransformCommands';

interface UseCostumeCanvasCommandControllerOptions {
  activeDocumentLayerId?: string;
  activeLayerOpacity: number;
  activeLayerVisible: boolean;
  bitmapFillStyleRef: MutableRefObject<BitmapFillStyle>;
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
  getBitmapFloatingSelectionObject: () => any | null;
  getSelectionBoundsSnapshot: () => CanvasSelectionBoundsSnapshot | null;
  hostedLayerIdRef: MutableRefObject<string | null>;
  isLoadRequestActive: (requestId?: number) => boolean;
  isHostedLayerReadyRef: MutableRefObject<boolean>;
  lastCommittedSnapshotRef: MutableRefObject<any>;
  layerSurfaceRefs: MutableRefObject<Map<string, HTMLCanvasElement>>;
  loadBitmapAsSingleVectorImage: (bitmapCanvas: HTMLCanvasElement, requestId?: number) => Promise<boolean>;
  loadBitmapLayer: (
    dataUrl: string,
    selectable: boolean,
    requestId?: number,
    options?: { assetFrame?: CostumeAssetFrame | null },
  ) => Promise<boolean>;
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
  setBitmapFloatingSelectionObject: (nextObject: any | null, options?: { activate?: boolean; syncState?: boolean }) => void;
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
  getBitmapFloatingSelectionObject,
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
  setBitmapFloatingSelectionObject,
  setHostedLayerId,
  setHostedLayerReady,
  suppressBitmapSelectionAutoCommitRef,
  suppressHistoryRef,
  syncSelectionState,
  textStyle,
  vectorStyle,
  waitForFabricCanvas,
}: UseCostumeCanvasCommandControllerOptions) {
  const pendingVectorStyleHistorySaveRef = useRef<number | null>(null);

  const scheduleVectorStyleHistorySave = useCallback(() => {
    if (typeof window === 'undefined') {
      saveHistory();
      return;
    }

    if (pendingVectorStyleHistorySaveRef.current !== null) {
      window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
    }

    pendingVectorStyleHistorySaveRef.current = window.setTimeout(() => {
      pendingVectorStyleHistorySaveRef.current = null;
      saveHistory();
    }, 120);
  }, [saveHistory]);

  useEffect(() => {
    return () => {
      if (pendingVectorStyleHistorySaveRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
      }
    };
  }, []);

  const getComposedCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    const hostedLayerId = hostedLayerIdRef.current ?? activeDocumentLayerId;
    const canRenderHostedLayer = !!fabricCanvas && isHostedLayerReadyRef.current;
    const baseCanvas = canRenderHostedLayer ? getActiveLayerCanvasElement() : null;
    const composed = document.createElement('canvas');
    composed.width = CANVAS_SIZE;
    composed.height = CANVAS_SIZE;
    const composedCtx = getCanvas2dContext(composed, 'readback');
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

  const {
    alignSelection: alignCanvasSelection,
    deleteSelection: deleteCanvasSelection,
    moveSelectionOrder: moveCanvasSelectionOrder,
    flipSelection: flipCanvasSelection,
    rotateSelection: rotateCanvasSelection,
  } = useCostumeCanvasSelectionTransformCommands({
    fabricCanvasRef,
    getAlignmentBounds: () => ({
      left: 0,
      top: 0,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
    }),
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    saveHistory,
    syncSelectionState,
  });

  const deleteBitmapFloatingSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = getBitmapFloatingSelectionObject();
    if (!fabricCanvas || !floatingObject) return false;
    if (editorModeRef.current !== 'bitmap') return false;
    if (bitmapSelectionBusyRef.current) return false;

    suppressBitmapSelectionAutoCommitRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }

      fabricCanvas.remove(floatingObject);
      setBitmapFloatingSelectionObject(null, { syncState: false });
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
    bitmapMarqueeRectRef,
    bitmapSelectionBusyRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    editorModeRef,
    fabricCanvasRef,
    getBitmapFloatingSelectionObject,
    saveHistory,
    setBitmapFloatingSelectionObject,
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
      fillOpacity: getVectorObjectFillOpacity(vectorObject),
      fillTextureId: getVectorObjectFillTextureId(vectorObject),
      strokeColor: getVectorObjectStrokeColor(vectorObject),
      strokeOpacity: getVectorObjectStrokeOpacity(vectorObject),
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
    bitmapAssetFrame?: CostumeAssetFrame | null;
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

    const activeLayerCanvas = fabricCanvas.toCanvasElement(1);
    const optimizedBitmap = optimizeCostumeRasterCanvas(activeLayerCanvas);
    const activeLayerDataUrl = optimizedBitmap.dataUrl;

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
      bitmapAssetFrame: optimizedBitmap.assetFrame ?? null,
    };
  }, [editorModeRef, fabricCanvasRef, loadedSessionKeyRef]);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current === 'bitmap') {
      return deleteBitmapFloatingSelection();
    }
    if (editorModeRef.current !== 'vector') return false;
    return deleteCanvasSelection();
  }, [deleteBitmapFloatingSelection, deleteCanvasSelection, editorModeRef, fabricCanvasRef]);

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
    if (editorModeRef.current !== 'vector') return false;
    return moveCanvasSelectionOrder(action);
  }, [editorModeRef, moveCanvasSelectionOrder]);

  const flipSelection = useCallback((axis: SelectionFlipAxis): boolean => {
    return flipCanvasSelection(axis);
  }, [flipCanvasSelection]);

  const rotateSelection = useCallback((): boolean => {
    return rotateCanvasSelection();
  }, [rotateCanvasSelection]);

  const alignSelection = useCallback((action: AlignAction): boolean => {
    return alignCanvasSelection(action);
  }, [alignCanvasSelection]);

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
      const loaded = await loadBitmapLayer(requestedState.bitmapAssetId ?? '', false, requestId, {
        assetFrame: requestedState.bitmapAssetFrame,
      });
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
              fillOpacity: vectorStyle.fillOpacity,
              fillTextureId: vectorStyle.fillTextureId,
            })
          : false;
        const strokeChanged = applyVectorStrokeStyleToObject(target, {
          strokeColor: vectorStyle.strokeColor,
          strokeOpacity: vectorStyle.strokeOpacity,
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
    scheduleVectorStyleHistorySave();
  }, [brushColorRef, editorModeRef, fabricCanvasRef, saveHistory, scheduleVectorStyleHistorySave, textStyle, vectorStyle]);

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
    rotateSelection,
    switchEditorMode,
    syncActiveVectorStyle,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
  };
}
